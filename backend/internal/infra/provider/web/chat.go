package web

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	inferencedomain "github.com/chenyme/grok2api/backend/internal/domain/inference"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/provider/conversation"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

const webResponseTTL = 30 * 24 * time.Hour

const maxDeferredSearchTextBytes = 8 << 20

const maxTrackedServerTools = 1024

const (
	maxTrackedCitationSources = 256
	maxTrackedAnnotations     = 2048
)

var (
	errWebAntiBot    = errors.New("Grok Web anti-bot rejection")
	errWebUsageLimit = errors.New("Grok Web usage limit reached")
)

var (
	grokRenderPattern   = regexp.MustCompile(`(?s)<grok:render\s+card_id="([^"]+)"\s+card_type="([^"]+)"\s+type="([^"]+)"[^>]*>.*?</grok:render>`)
	grokToolNamePattern = regexp.MustCompile(`(?is)<xai:tool_name>\s*(.*?)\s*</xai:tool_name>`)
)

func (a *Adapter) ForwardResponse(ctx context.Context, request provider.ResponseResourceRequest) (*provider.Response, error) {
	if request.Method == http.MethodGet || request.Method == http.MethodDelete {
		return a.handleResponseResource(ctx, request)
	}
	if early := rejectUnsupportedForwardOperation(request); early != nil {
		return early, nil
	}
	var conversationOptions conversation.ResponseOptions
	if request.Operation == conversation.OperationMessages {
		var early *provider.Response
		conversationOptions, early = convertForwardRequestBody(&request)
		if early != nil {
			return early, nil
		}
	}
	plan, early, err := a.parseForwardChatPlan(ctx, request, conversationOptions)
	if err != nil || early != nil {
		return early, err
	}
	resp, parsed, err := a.forwardChatAttempts(ctx, plan)
	if err != nil || resp != nil {
		return resp, err
	}
	return a.finishForwardChat(ctx, plan, parsed)
}

// forwardChatPlan 承载一次非流式转发所需的解析结果与尝试期状态。
type forwardChatPlan struct {
	request    provider.ResponseResourceRequest
	input      openAIRequest
	normalized normalizedChatInput
	tools      toolConfiguration
	parallel   bool
	options    conversation.ResponseOptions
	spec       ModelSpec
	modelKnown bool
	responseID string
	streaming  bool
	previous   *inferencedomain.WebResponseState
}

// rejectUnsupportedForwardOperation 拒绝 /responses/compact 与非 POST 方法。
func rejectUnsupportedForwardOperation(request provider.ResponseResourceRequest) *provider.Response {
	if request.Path == "/responses/compact" {
		return jsonProviderResponse(http.StatusBadRequest, map[string]any{"error": map[string]any{
			"type": "invalid_request_error", "code": "unsupported_operation",
			"message": "Grok Web 模型不支持 /responses/compact",
		}})
	}
	if request.Method != http.MethodPost {
		return jsonProviderResponse(http.StatusMethodNotAllowed, map[string]any{"error": map[string]any{"message": "method not allowed"}})
	}
	return nil
}

// convertForwardRequestBody 把 Anthropic Messages 请求体就地转换为内部格式。
func convertForwardRequestBody(request *provider.ResponseResourceRequest) (conversation.ResponseOptions, *provider.Response) {
	converted, options, err := conversation.ConvertRequestWithOptions(request.Body, request.Model, request.Operation)
	if err != nil {
		return conversation.ResponseOptions{}, jsonProviderResponse(http.StatusBadRequest, map[string]any{"type": "error", "error": map[string]any{"type": "invalid_request_error", "message": err.Error()}})
	}
	request.Body = converted
	return options, nil
}

// normalizeForwardChatInput 按模型能力选择图片或文本归一化路径。
func normalizeForwardChatInput(input openAIRequest, operation string, spec ModelSpec, modelKnown bool) (normalizedChatInput, error) {
	if modelKnown && spec.Capability == modeldomain.CapabilityImage {
		return normalizeLatestImageInput(input, operation)
	}
	return normalizeOpenAIInput(input, operation)
}

// parseForwardChatPlan 解析请求体、归一化输入并按模型能力分流；early 非 nil 时直接应答。
func (a *Adapter) parseForwardChatPlan(ctx context.Context, request provider.ResponseResourceRequest, options conversation.ResponseOptions) (*forwardChatPlan, *provider.Response, error) {
	var input openAIRequest
	if err := json.Unmarshal(request.Body, &input); err != nil {
		return nil, jsonProviderResponse(http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "请求 JSON 无效", "type": "invalid_request_error"}}), nil
	}
	if len(input.Include) > 0 {
		options.Include = append([]string{}, input.Include...)
	}
	spec, modelKnown := Resolve(request.Model)
	normalized, err := normalizeForwardChatInput(input, request.Operation, spec, modelKnown)
	if err != nil {
		return nil, jsonProviderResponse(http.StatusBadRequest, map[string]any{"error": map[string]any{"message": err.Error(), "type": "invalid_request_error"}}), nil
	}
	tools, err := parseToolConfiguration(input.Tools, input.ToolChoice)
	if err != nil {
		return nil, jsonProviderResponse(http.StatusBadRequest, map[string]any{"error": map[string]any{"message": err.Error(), "type": "invalid_request_error", "code": "invalid_tools"}}), nil
	}
	parallelTools := true
	if input.ParallelToolCalls != nil {
		parallelTools = *input.ParallelToolCalls
	}
	plan := &forwardChatPlan{
		request: request, input: input, normalized: normalized, tools: tools, parallel: parallelTools,
		options: options, spec: spec, modelKnown: modelKnown,
	}
	early, err := a.forwardChatCapability(ctx, plan)
	if early != nil || err != nil {
		return nil, early, err
	}
	plan.normalized.Prompt = injectToolPrompt(normalized.Prompt, tools)
	plan.responseID = newWebID("resp")
	plan.streaming = input.Stream || request.Streaming
	return plan, nil, nil
}

func forwardChatUnsupportedModel() *provider.Response {
	return jsonProviderResponse(http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "模型不支持文本对话", "type": "invalid_request_error"}})
}

// forwardChatCapability 在图片能力上分流到图片转发，非文本对话能力返回 400；
// 返回 (nil, nil) 表示按文本对话继续。
func (a *Adapter) forwardChatCapability(ctx context.Context, plan *forwardChatPlan) (*provider.Response, error) {
	if !plan.modelKnown {
		return forwardChatUnsupportedModel(), nil
	}
	switch plan.spec.Capability {
	case modeldomain.CapabilityImage:
		if len(plan.tools.ResponseTools) > 0 {
			return invalidImageRequest("图片生成模型不支持 tools")
		}
		return a.forwardImageChatCompletion(ctx, plan.request, plan.input, plan.normalized, plan.spec)
	case modeldomain.CapabilityImageEdit:
		return invalidImageRequest("图片编辑模型请使用 /v1/images/edits，并在当前请求中显式提供输入图片")
	case modeldomain.CapabilityChat:
		return nil, nil
	default:
		return forwardChatUnsupportedModel(), nil
	}
}

// forwardChatAttempts 执行至多两次上游尝试；返回非 nil 响应用于提前应答。
func (a *Adapter) forwardChatAttempts(ctx context.Context, plan *forwardChatPlan) (*provider.Response, parsedChat, error) {
	for attempt := 0; attempt < 2; attempt++ {
		attemptCtx := ctx
		if attempt > 0 {
			attemptCtx = infraegress.WithPhysicalCallStage(ctx, "anti_bot_retry")
		}
		upstream, lease, currentPrevious, statsigTarget, openErr := a.openChat(attemptCtx, plan.request.Credential, plan.input.PreviousResponseID, plan.spec, plan.normalized, gatewayOpenOptions{enforceStreamIdle: true})
		if openErr != nil {
			if early := invalidForwardChatAttachmentResponse(openErr); early != nil {
				return early, parsedChat{}, nil
			}
			return nil, parsedChat{}, openErr
		}
		plan.previous = currentPrevious
		if upstream.StatusCode < 200 || upstream.StatusCode >= 300 {
			early, retry, err := a.forwardChatUpstreamError(ctx, upstream, lease, statsigTarget, attempt)
			if !retry {
				return early, parsedChat{}, err
			}
			continue
		}
		if plan.streaming {
			early, retry, err := a.forwardChatStreamingAttempt(ctx, plan, upstream, lease, statsigTarget, attempt)
			if !retry {
				return early, parsedChat{}, err
			}
			continue
		}
		currentParsed, consumeErr := consumeUpstreamWithCitations(upstream.Body, nil, plan.options.InlineCitationsEnabled())
		_ = upstream.Body.Close()
		if statsigTarget != "" && errors.Is(consumeErr, errWebAntiBot) && attempt == 0 && a.invalidateSignedStatsig(http.MethodPost, statsigTarget) {
			lease.Release()
			continue
		}
		lease.Release()
		if consumeErr != nil {
			early, err := a.forwardChatConsumeError(ctx, lease, statsigTarget, consumeErr)
			return early, parsedChat{}, err
		}
		a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, http.StatusOK, nil)
		return nil, currentParsed, nil
	}
	return nil, parsedChat{}, nil
}

// invalidForwardChatAttachmentResponse 把附件/图片入参错误映射为 400，其他错误返回 nil。
func invalidForwardChatAttachmentResponse(err error) *provider.Response {
	if !errors.Is(err, errInvalidChatAttachment) && !errors.Is(err, errInvalidChatImage) && !errors.Is(err, errInvalidChatFile) {
		return nil
	}
	code := "invalid_attachment_input"
	if errors.Is(err, errInvalidChatImage) {
		code = "invalid_image_input"
	}
	return jsonProviderResponse(http.StatusBadRequest, map[string]any{"error": map[string]any{
		"message": err.Error(), "type": "invalid_request_error", "code": code,
	}})
}

// forwardChatUpstreamError 处理非 2xx 上游响应：返回提前响应，或标记需要重试。
func (a *Adapter) forwardChatUpstreamError(ctx context.Context, upstream *http.Response, lease *infraegress.Lease, statsigTarget string, attempt int) (*provider.Response, bool, error) {
	if upstream.StatusCode == http.StatusForbidden {
		return a.forwardChatForbiddenResponse(ctx, upstream, lease, statsigTarget, attempt)
	}
	return a.forwardedUpstreamResponse(ctx, upstream, lease, upstream.Body), false, nil
}

// forwardChatForbiddenResponse 先保留确定性封锁信号，再按 Statsig 清除结果决定是否重试。
func (a *Adapter) forwardChatForbiddenResponse(ctx context.Context, upstream *http.Response, lease *infraegress.Lease, statsigTarget string, attempt int) (*provider.Response, bool, error) {
	body, readErr := io.ReadAll(io.LimitReader(upstream.Body, 4<<20))
	_ = upstream.Body.Close()
	if readErr != nil {
		lease.Release()
		return nil, false, readErr
	}
	if provider.IsDefinitiveAccountBlockBody(body) {
		return forwardChatForbiddenBodyResponse(upstream, lease, body), false, nil
	}
	lease.InvalidateClearance()
	if statsigTarget != "" && attempt == 0 && a.invalidateSignedStatsig(http.MethodPost, statsigTarget) {
		lease.Release()
		return nil, true, nil
	}
	return a.forwardedUpstreamResponse(ctx, upstream, lease, io.NopCloser(bytes.NewReader(body))), false, nil
}

// forwardedUpstreamResponse 复刻原错误响应结构，Body 释放时回写 egress 反馈并释放租约。
func (a *Adapter) forwardedUpstreamResponse(ctx context.Context, upstream *http.Response, lease *infraegress.Lease, body io.ReadCloser) *provider.Response {
	return &provider.Response{
		StatusCode: upstream.StatusCode, Status: upstream.Status, Header: http.Header(upstream.Header),
		UpstreamURL: responseUpstreamURL(upstream),
		Body: &releaseBody{ReadCloser: body, release: func() {
			a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, upstream.StatusCode, nil)
			lease.Release()
		}},
	}
}

// forwardChatForbiddenBodyResponse 复刻确定性封锁分支：释放租约但不回写 egress 反馈。
func forwardChatForbiddenBodyResponse(upstream *http.Response, lease *infraegress.Lease, body []byte) *provider.Response {
	return &provider.Response{
		StatusCode: upstream.StatusCode, Status: upstream.Status, Header: http.Header(upstream.Header),
		UpstreamURL: responseUpstreamURL(upstream),
		Body: &releaseBody{ReadCloser: io.NopCloser(bytes.NewReader(body)), release: func() {
			lease.Release()
		}},
	}
}

// forwardChatStreamingAttempt 处理流式分支：预检通过即接管连接，否则按反爬结果决定重试。
func (a *Adapter) forwardChatStreamingAttempt(ctx context.Context, plan *forwardChatPlan, upstream *http.Response, lease *infraegress.Lease, statsigTarget string, attempt int) (*provider.Response, bool, error) {
	prepared, preflightErr := preflightUpstream(upstream.Body)
	if preflightErr == nil {
		body := a.streamOpenAIResponse(ctx, prepared, lease, plan.request.Credential, plan.responseID, plan.input.Model, plan.request.Operation, plan.normalized.Prompt, plan.previous, plan.tools, plan.parallel, plan.options)
		return &provider.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: streamHeaders(), Body: body}, false, nil
	}
	if statsigTarget != "" && errors.Is(preflightErr, errWebAntiBot) && attempt == 0 && a.invalidateSignedStatsig(http.MethodPost, statsigTarget) {
		a.releaseStatsigRetry(upstream, lease)
		return nil, true, nil
	}
	_ = upstream.Body.Close()
	lease.Release()
	if errors.Is(preflightErr, errWebAntiBot) {
		a.feedbackAntiBot(ctx, lease, statsigTarget)
		return antiBotProviderResponse(), false, nil
	}
	return nil, false, preflightErr
}

// forwardChatConsumeError 分类非流式消费错误：反爬返回 403 响应，其他错误原样上抛。
func (a *Adapter) forwardChatConsumeError(ctx context.Context, lease *infraegress.Lease, statsigTarget string, consumeErr error) (*provider.Response, error) {
	if errors.Is(consumeErr, errWebAntiBot) {
		a.feedbackAntiBot(ctx, lease, statsigTarget)
		return antiBotProviderResponse(), nil
	}
	a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, 0, consumeErr)
	return nil, consumeErr
}

// finishForwardChat 在非流式消费完成后补齐工具字段、归档图片并写出 JSON 响应。
func (a *Adapter) finishForwardChat(ctx context.Context, plan *forwardChatPlan, parsed parsedChat) (*provider.Response, error) {
	parsed.InputTokens = estimateTokens(plan.normalized.Prompt)
	parsed.Tools = plan.tools.ResponseTools
	parsed.ToolChoice = plan.tools.ResponseChoice
	parsed.ParallelTools = plan.parallel
	applyParsedToolCalls(&parsed, plan.tools)
	if err := a.archiveChatImages(ctx, plan.request.Credential, &parsed); err != nil {
		return nil, err
	}
	payload := buildOpenAIResult(plan.request.Operation, plan.responseID, plan.input.Model, parsed, false, plan.options)
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	if plan.request.Operation == conversation.OperationResponses {
		a.saveResponseState(context.WithoutCancel(ctx), plan.request.Credential.ID, plan.responseID, parsed, data)
	}
	return &provider.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: jsonHeaders(), Body: io.NopCloser(bytes.NewReader(data))}, nil
}

func (a *Adapter) releaseStatsigRetry(upstream *http.Response, lease *infraegress.Lease) {
	_ = upstream.Body.Close()
	lease.Release()
}

func (a *Adapter) feedbackAntiBot(ctx context.Context, lease *infraegress.Lease, statsigTarget string) {
	if statsigTarget != "" {
		a.invalidateSignedStatsig(http.MethodPost, statsigTarget)
	}
	a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, http.StatusForbidden, nil)
}

func preflightUpstream(source io.ReadCloser) (io.ReadCloser, error) {
	reader := bufio.NewReaderSize(source, 64<<10)
	var prefetched bytes.Buffer
	for prefetched.Len() <= 1<<20 {
		line, err := reader.ReadString('\n')
		if line != "" {
			prefetched.WriteString(line)
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "data:") {
				trimmed = strings.TrimSpace(strings.TrimPrefix(trimmed, "data:"))
			}
			if strings.HasPrefix(trimmed, "{") {
				var root map[string]any
				if json.Unmarshal([]byte(trimmed), &root) == nil {
					if errorValue, ok := root["error"].(map[string]any); ok {
						return nil, webResponseError(errorValue)
					}
					if event, ok := root["event"].(map[string]any); ok {
						if event["type"] == "error" {
							return nil, gatewayEventError(event)
						}
						return &readerCloser{Reader: io.MultiReader(bytes.NewReader(prefetched.Bytes()), reader), closer: source}, nil
					}
					if result, ok := root["result"].(map[string]any); ok && (result["conversation"] != nil || result["response"] != nil) {
						return &readerCloser{Reader: io.MultiReader(bytes.NewReader(prefetched.Bytes()), reader), closer: source}, nil
					}
				}
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) && prefetched.Len() > 0 {
				return &readerCloser{Reader: bytes.NewReader(prefetched.Bytes()), closer: source}, nil
			}
			return nil, err
		}
	}
	return nil, fmt.Errorf("Grok Web 首个流事件超过安全检查上限")
}

func (a *Adapter) openChat(ctx context.Context, credential account.Credential, previousResponseID string, spec ModelSpec, input normalizedChatInput, options gatewayOpenOptions) (*http.Response, *infraegress.Lease, *inferencedomain.WebResponseState, string, error) {
	return a.openGatewayChat(ctx, credential, previousResponseID, spec, input, options)
}

func (a *Adapter) handleResponseResource(ctx context.Context, request provider.ResponseResourceRequest) (*provider.Response, error) {
	id := strings.TrimPrefix(request.Path, "/responses/")
	if before, _, ok := strings.Cut(id, "?"); ok {
		id = before
	}
	id, _ = url.PathUnescape(id)
	if request.Method == http.MethodDelete {
		if err := a.states.DeleteWebState(ctx, id); err != nil {
			return jsonProviderResponse(http.StatusNotFound, map[string]any{"error": map[string]any{"message": "Response 不存在", "type": "invalid_request_error"}}), nil
		}
		return jsonProviderResponse(http.StatusOK, map[string]any{"id": id, "object": "response.deleted", "deleted": true}), nil
	}
	state, err := a.states.GetWebState(ctx, id, time.Now().UTC())
	if err != nil {
		return jsonProviderResponse(http.StatusNotFound, map[string]any{"error": map[string]any{"message": "Response 不存在或已过期", "type": "invalid_request_error"}}), nil
	}
	return &provider.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: jsonHeaders(), Body: io.NopCloser(strings.NewReader(state.ResponseJSON))}, nil
}

func (a *Adapter) saveResponseState(ctx context.Context, accountID uint64, responseID string, parsed parsedChat, data []byte) {
	if parsed.ConversationID == "" || parsed.ParentID == "" || a.states == nil {
		return
	}
	now := time.Now().UTC()
	_ = a.states.SaveWebState(ctx, inferencedomain.WebResponseState{
		ResponseID: responseID, AccountID: accountID, ConversationID: parsed.ConversationID,
		UpstreamParentResponseID: parsed.ParentID, ResponseJSON: string(data), Status: "completed",
		ExpiresAt: now.Add(webResponseTTL), CreatedAt: now, UpdatedAt: now,
	})
}

func (a *Adapter) archiveChatImages(ctx context.Context, credential account.Credential, parsed *parsedChat) error {
	for _, rawURL := range parsed.Images {
		item, err := a.imageDataItem(ctx, credential, imagineImageValue{URL: rawURL}, "url")
		if err != nil {
			return err
		}
		if parsed.Text.Len() > 0 {
			parsed.appendText("\n\n")
		}
		parsed.appendText(liteImageMarkdown(item))
	}
	return nil
}
