package cli

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/provider/conversation"
	neterrorpkg "github.com/chenyme/grok2api/backend/internal/pkg/neterror"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// forwardState 承载一次 ForwardResponse 调用内部跨阶段传递的可变状态。
// 每个字段都只属于本次调用：状态在调用内创建并逐级传递，不构成包级共享状态。
type forwardState struct {
	ctx                 context.Context
	request             provider.ResponseResourceRequest
	accessToken         string
	primaryBase         string
	base                string
	conversationScope   string
	body                []byte
	replayBaseBody      []byte
	replayKey           string
	call                responseCall
	cacheRoute          buildPromptCacheRoute
	toolCompatibility   *responsesToolCompatibility
	compactionRequested bool
	conversationOptions conversation.ResponseOptions
	reasoningRecovery   reasoningRecoveryOutcome
	primaryFailure      *provider.DiagnosticResponse
	primaryAttempt      *provider.RecoveredAttempt
	response            *http.Response
	upstreamURL         string
	rateLimit           *provider.RateLimitMetadata
	rateLimitDiagnostic *provider.DiagnosticResponse
	modelCatalogChanged bool
}

func (a *Adapter) ForwardResponse(ctx context.Context, request provider.ResponseResourceRequest) (*provider.Response, error) {
	if request.NormalizedMetadata != nil {
		*request.NormalizedMetadata = provider.NormalizedRequestMetadata{}
	}
	accessToken, err := a.cipher.Decrypt(request.Credential.EncryptedAccessToken)
	if err != nil {
		return nil, err
	}
	// Resolve the physical inference plane before normalization so Chat and
	// Anthropic conversion can use the same scope for capture and restoration.
	// The scope contains the trusted session seed, model, and plane only; it is
	// intentionally independent of the selected account.
	state := &forwardState{
		ctx:         ctx,
		request:     request,
		accessToken: accessToken,
		body:        request.Body,
		primaryBase: a.primaryBaseURL(),
	}
	state.base = a.inferenceBaseForOperation(request.Credential, request.Billing, request.Method, request.Path)
	state.conversationScope = a.conversationReasoningScope(request, state.base)
	if invalid := a.normalizeForwardRequestBody(state); invalid != nil {
		return invalid, nil
	}
	if invalid := a.prepareForwardRouting(state); invalid != nil {
		return invalid, nil
	}
	if state.compactionRequested {
		warnings := ""
		if state.toolCompatibility != nil {
			warnings = state.toolCompatibility.warningHeader()
		}
		return a.forwardGatewayCompaction(ctx, state.request, accessToken, state.body, warnings)
	}
	if err := a.callResponseUpstream(state); err != nil {
		return nil, err
	}
	if err := a.probePlaneFallback(state); err != nil {
		return nil, err
	}
	if err := a.guardForwardResponse(state); err != nil {
		return nil, err
	}
	return a.finishForwardResponse(state)
}

// normalizeForwardRequestBody 按操作类型规范化请求体，失败时返回本地协议错误响应。
func (a *Adapter) normalizeForwardRequestBody(state *forwardState) *provider.Response {
	if !state.request.NormalizeBody {
		return nil
	}
	if state.request.Operation == conversation.OperationChat || state.request.Operation == conversation.OperationMessages {
		converted, options, err := conversation.ConvertRequestWithReasoningReplay(state.body, state.request.Model, state.request.Operation, a.conversationReasoningCache, state.conversationScope)
		if err == nil && options.ReasoningEffortSet && state.request.NormalizedMetadata != nil {
			state.request.NormalizedMetadata.ReasoningEffort = options.ReasoningEffort
		}
		if err == nil {
			converted, err = normalizeBuildRequestWithMetadata(converted, state.request.Model, state.request.Operation, state.request.NormalizedMetadata)
		}
		if err != nil {
			return invalidForwardResponse(state.request, err)
		}
		state.body, state.conversationOptions = converted, options
		return nil
	}
	expanded, driftedCompactions, err := expandGatewayCompactionHistory(state.body, a.compaction, state.request.PromptCacheKey)
	if err != nil {
		return invalidForwardResponse(state.request, err)
	}
	normalized, compatibility, err := normalizeResponsesRequestWithMetadata(expanded, state.request.Model, state.request.NormalizedMetadata)
	if compatibility != nil {
		state.compactionRequested = compatibility.compactionRequested
		if driftedCompactions > 0 {
			compatibility.addWarning("compaction_session_drifted")
		}
	}
	if err != nil {
		return invalidForwardResponse(state.request, err)
	}
	normalized, err = normalizeBuildRequestWithMetadata(normalized, state.request.Model, state.request.Operation, state.request.NormalizedMetadata)
	if err != nil {
		return invalidForwardResponse(state.request, err)
	}
	state.body, state.toolCompatibility = normalized, compatibility
	return nil
}

// prepareForwardRouting 处理 Anthropic web search 的重放重置、compaction 采样与 Build prompt cache 路由注入。
func (a *Adapter) prepareForwardRouting(state *forwardState) *provider.Response {
	if state.request.Operation == conversation.OperationMessages && state.conversationOptions.AnthropicWebSearch {
		state.request.ReasoningReplayKey = ""
		state.conversationScope = ""
		state.conversationOptions = state.conversationOptions.WithReasoningReplay(nil, "")
	}
	if state.compactionRequested {
		sampled, err := prepareGatewayCompactionSample(state.body)
		if err != nil {
			return invalidForwardResponse(state.request, err)
		}
		state.body = sampled
	}
	if len(state.body) > 0 && state.request.Method == http.MethodPost {
		if !state.compactionRequested {
			allowClientTools := state.request.AllowClientToolCacheRoute || (account.RoutingCandidate{Credential: state.request.Credential, Billing: state.request.Billing}).IsKnownFreeBuild()
			routed, route, err := prepareBuildPromptCacheRoute(state.body, state.request.Operation, state.request.Model, state.request.PromptCacheKey, allowClientTools)
			if err != nil {
				return invalidForwardResponse(state.request, fmt.Errorf("准备 Build prompt cache 路由: %w", err))
			}
			routed, err = injectPromptCacheKey(routed, state.request.PromptCacheKey)
			if err != nil {
				return invalidForwardResponse(state.request, fmt.Errorf("写入 prompt_cache_key: %w", err))
			}
			state.body, state.cacheRoute = routed, route
		}
	}
	return nil
}

// invalidForwardResponse 按操作类型把本地请求校验错误映射为对应的协议错误响应。
func invalidForwardResponse(request provider.ResponseResourceRequest, err error) *provider.Response {
	if request.Operation == conversation.OperationChat || request.Operation == conversation.OperationMessages {
		return invalidConversationResponse(request.Operation, err)
	}
	return invalidResponsesResponse(err)
}

// callResponseUpstream 应用推理重放并完成一次真实上游调用，必要时执行推理解码恢复。
func (a *Adapter) callResponseUpstream(state *forwardState) error {
	state.replayBaseBody = state.body
	state.body, state.replayKey = a.applyReasoningReplay(state.ctx, state.request, state.replayBaseBody, state.base)
	state.call = a.doResponseRequest(state.ctx, state.request, state.accessToken, state.body, state.base)
	if state.call.err != nil {
		return state.call.err
	}
	if err := normalizeGzipResponse(state.call.response); err != nil {
		return err
	}
	call, recovery, err := a.recoverReasoningDecodeFailure(state.ctx, state.request, state.accessToken, state.body, state.base, state.replayKey, state.call)
	if err != nil {
		return err
	}
	state.call, state.reasoningRecovery = call, recovery
	state.response, state.upstreamURL = call.response, call.upstreamURL
	return nil
}

// probePlaneFallback 在 Build 主平面明确返回 403 时用等价请求探测 XAI 平面。
// 主平面 403 响应体被完整缓冲，回退失败时原样重放，绝不再次请求主平面。
func (a *Adapter) probePlaneFallback(state *forwardState) error {
	if !strings.EqualFold(state.base, state.primaryBase) ||
		!shouldProbeXAIInferenceFallback(state.request.Credential, state.request.Billing, state.request.Method, state.request.Path, state.response.StatusCode) {
		return nil
	}
	primaryCall := state.call
	primaryBody, primaryTruncated, err := provider.ReadDiagnosticBody(state.response.Body)
	_ = state.response.Body.Close()
	if err != nil {
		return err
	}
	primaryResp := cloneBufferedResponse(state.response, primaryBody, primaryTruncated)
	if shouldSkipXAIFallback(primaryBody) {
		state.response = primaryResp
		return nil
	}
	fallbackBase := a.fallbackBaseURL()
	if fallbackBase == "" || strings.EqualFold(fallbackBase, state.base) {
		state.response = primaryResp
		return nil
	}
	fallbackCall, fallbackReplayKey, fallbackRecovery, err := a.callFallbackPlane(state, fallbackBase)
	if err != nil || !isHTTPSuccess(fallbackCall.response.StatusCode) {
		if err == nil && fallbackCall.response != nil {
			_ = fallbackCall.response.Body.Close()
		}
		// Preserve the original primary 403 URL and buffered body without requesting the primary again.
		state.response = primaryResp
		return nil
	}
	state.primaryFailure = bufferedFailureDiagnostic(primaryResp, primaryBody, primaryTruncated)
	state.primaryAttempt = &provider.RecoveredAttempt{
		Stage:       "primary_plane_response",
		Result:      "replaced_by_plane_fallback",
		UpstreamURL: primaryCall.upstreamURL,
		StartedAt:   primaryCall.startedAt,
		DurationMS:  primaryCall.durationMS,
		Diagnostic:  *state.primaryFailure,
	}
	a.activateBuildAPIFallback(state.ctx, &state.request.Credential)
	state.call = fallbackCall
	state.response, state.upstreamURL, state.replayKey = fallbackCall.response, fallbackCall.upstreamURL, fallbackReplayKey
	state.conversationOptions = state.conversationOptions.WithReasoningReplay(a.conversationReasoningCache, a.conversationReasoningScope(state.request, fallbackBase))
	state.reasoningRecovery = state.reasoningRecovery.merge(fallbackRecovery)
	return nil
}

// callFallbackPlane 在 XAI 平面用等价请求重发一次，并复用与主平面相同的推理解码恢复流程。
func (a *Adapter) callFallbackPlane(state *forwardState, fallbackBase string) (responseCall, string, reasoningRecoveryOutcome, error) {
	fallbackBody, fallbackReplayKey := a.applyReasoningReplay(state.ctx, state.request, state.replayBaseBody, fallbackBase)
	fallbackCtx := infraegress.WithPhysicalCallStage(state.ctx, "plane_fallback")
	call := a.doResponseRequest(fallbackCtx, state.request, state.accessToken, fallbackBody, fallbackBase)
	if call.err != nil {
		return call, fallbackReplayKey, reasoningRecoveryOutcome{}, call.err
	}
	if err := normalizeGzipResponse(call.response); err != nil {
		return call, fallbackReplayKey, reasoningRecoveryOutcome{}, err
	}
	call, recovery, err := a.recoverReasoningDecodeFailure(state.ctx, state.request, state.accessToken, fallbackBody, fallbackBase, fallbackReplayKey, call)
	if err != nil {
		return call, fallbackReplayKey, reasoningRecoveryOutcome{}, err
	}
	return call, fallbackReplayKey, recovery, nil
}

// guardForwardResponse 在 429 时缓冲响应体以保留限流元数据与诊断证据，
// 并为流式成功响应附加语义空闲保护。
func (a *Adapter) guardForwardResponse(state *forwardState) error {
	resp := state.response
	if resp.StatusCode == http.StatusTooManyRequests {
		body, truncated, err := provider.ReadDiagnosticBody(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			return err
		}
		resp.Body = io.NopCloser(bytes.NewReader(body))
		resp.ContentLength = int64(len(body))
		resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
		state.rateLimit = provider.RateLimitFromResponse(resp.StatusCode, resp.Header, body)
		if truncated {
			state.rateLimitDiagnostic = &provider.DiagnosticResponse{
				StatusCode: resp.StatusCode, Status: resp.Status, Header: resp.Header.Clone(),
				Body: append([]byte(nil), body...), BodyTruncated: true,
			}
		}
	}
	if state.request.Streaming && isHTTPSuccess(resp.StatusCode) && resp.Body != nil {
		resp.Body = wrapBuildSemanticIdle(resp.Body, a.config().StreamIdleTimeout)
	}
	return nil
}

// finishForwardResponse 完成推理重放捕获、兼容性与协议转换，并组装最终响应。
func (a *Adapter) finishForwardResponse(state *forwardState) (*provider.Response, error) {
	resp := state.response
	state.modelCatalogChanged = a.modelCatalogChanged(state.request.Credential.ID, resp.Header.Get("x-models-etag"))
	// Capture or clear reasoning replay in the upstream Responses shape before protocol conversion.
	if a.shouldCaptureReplay(state.request, resp, state.replayKey) {
		resp.Body = a.replay.CaptureBody(resp.Body, state.request.Model, state.replayKey, state.request.Streaming, isCompactPath(state.request.Path))
	}
	// Replay must read the raw upstream output. Hide xAI native search subcalls from downstream clients
	// only after capture wrapping has completed.
	if isHTTPSuccess(resp.StatusCode) {
		if err := filterBuildPromptCacheResponse(resp, state.request.Streaming, state.cacheRoute); err != nil {
			return nil, err
		}
	}
	responsesOperation := state.request.Operation == "" || state.request.Operation == conversation.OperationResponses || state.request.Operation == conversation.OperationCompaction
	if responsesOperation && state.toolCompatibility != nil {
		if warnings := state.toolCompatibility.warningHeader(); warnings != "" {
			resp.Header.Set("X-Grok2API-Compatibility-Warnings", warnings)
		}
	}
	state.reasoningRecovery.appendWarnings(resp.Header)
	if responsesOperation && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if err := a.convertCompatibleResponses(state, resp); err != nil {
			return nil, err
		}
	}
	if state.request.Operation == conversation.OperationChat || state.request.Operation == conversation.OperationMessages {
		return a.convertConversationResponse(state, resp)
	}
	return forwardResponseBody(state, resp, resp.Header.Clone(), resp.Body, state.rateLimitDiagnostic), nil
}

// convertCompatibleResponses 在 Responses 兼容模式下改写上游响应：隐藏 xAI 原生搜索子调用，
// 流式响应直接包裹转换，非流式响应按 128 MiB 上限读取后转换。
func (a *Adapter) convertCompatibleResponses(state *forwardState, resp *http.Response) error {
	if state.request.Streaming {
		resp.Body = state.toolCompatibility.normalizeResponseStream(resp.Body)
		resp.Header.Del("Content-Length")
		resp.Header.Set("Content-Type", "text/event-stream")
		return nil
	}
	if state.toolCompatibility == nil {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxCompatibleResponseBytes+1))
	_ = resp.Body.Close()
	if err != nil {
		return err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return neterrorpkg.ErrUpstreamResponseEmpty
	}
	if len(data) > maxCompatibleResponseBytes {
		return fmt.Errorf("上游兼容 Responses 响应超过 128 MiB")
	}
	converted, err := state.toolCompatibility.normalizeResponseJSON(data)
	if err != nil {
		return err
	}
	resp.Body = io.NopCloser(bytes.NewReader(converted))
	resp.Header.Set("Content-Length", strconv.Itoa(len(converted)))
	resp.Header.Set("Content-Type", "application/json")
	return nil
}

// convertConversationResponse 把上游响应转换为 Chat Completions 或 Anthropic Messages 协议。
func (a *Adapter) convertConversationResponse(state *forwardState, resp *http.Response) (*provider.Response, error) {
	if state.request.Streaming && isHTTPSuccess(resp.StatusCode) {
		resp.Body = conversation.ConvertResponseStreamWithOptions(resp.Body, state.request.Operation, state.conversationOptions)
		resp.Header.Del("Content-Length")
		resp.Header.Set("Content-Type", "text/event-stream")
		return forwardResponseBody(state, resp, resp.Header.Clone(), resp.Body, state.rateLimitDiagnostic), nil
	}
	data, diagnosticTruncated, err := readConversationBody(resp)
	if err != nil {
		return nil, err
	}
	var diagnostic *provider.DiagnosticResponse
	if !isHTTPSuccess(resp.StatusCode) {
		diagnostic = &provider.DiagnosticResponse{
			StatusCode: resp.StatusCode, Status: resp.Status, Header: resp.Header.Clone(),
			Body: data, BodyTruncated: diagnosticTruncated || state.rateLimitDiagnostic != nil,
		}
	}
	converted, convertErr := conversation.ConvertResponseJSONWithOptions(data, state.request.Operation, state.conversationOptions)
	if convertErr != nil {
		if diagnostic == nil {
			return nil, convertErr
		}
		return forwardResponseBody(state, resp, diagnostic.Header.Clone(), io.NopCloser(bytes.NewReader(data)), diagnostic), nil
	}
	resp.Body = io.NopCloser(bytes.NewReader(converted))
	resp.Header.Set("Content-Length", strconv.Itoa(len(converted)))
	resp.Header.Set("Content-Type", "application/json")
	return forwardResponseBody(state, resp, resp.Header.Clone(), resp.Body, diagnostic), nil
}

// readConversationBody 读取对话响应体：成功响应按 64 MiB 上限读取，失败响应保留诊断截断标记。
func readConversationBody(resp *http.Response) ([]byte, bool, error) {
	var data []byte
	var diagnosticTruncated bool
	var err error
	if isHTTPSuccess(resp.StatusCode) {
		data, err = io.ReadAll(io.LimitReader(resp.Body, (64<<20)+1))
	} else {
		data, diagnosticTruncated, err = provider.ReadDiagnosticBody(resp.Body)
	}
	_ = resp.Body.Close()
	if err != nil {
		return nil, false, err
	}
	if isHTTPSuccess(resp.StatusCode) && len(bytes.TrimSpace(data)) == 0 {
		return nil, false, neterrorpkg.ErrUpstreamResponseEmpty
	}
	if isHTTPSuccess(resp.StatusCode) && len(data) > 64<<20 {
		return nil, false, fmt.Errorf("上游对话响应超过 64 MiB")
	}
	return data, diagnosticTruncated, nil
}

// forwardResponseBody 组装最终响应，统一附加上游 URL、恢复审计与限流元数据。
func forwardResponseBody(state *forwardState, resp *http.Response, header http.Header, body io.ReadCloser, diagnostic *provider.DiagnosticResponse) *provider.Response {
	return &provider.Response{
		StatusCode: resp.StatusCode, Status: resp.Status, Header: header, Body: body, UpstreamURL: state.upstreamURL,
		Diagnostic: diagnostic, ReasoningRecoveryFailed: state.reasoningRecovery.failed,
		RecoveredPrimaryFailure: state.primaryFailure, RecoveredAttempts: recoveredAttempts(state.primaryAttempt, state.reasoningRecovery),
		RateLimit: state.rateLimit, ModelCatalogChanged: state.modelCatalogChanged,
	}
}
