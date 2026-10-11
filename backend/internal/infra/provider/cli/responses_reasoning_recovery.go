package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"

	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

var reasoningDecodeFailureMarkers = [][]byte{
	[]byte("could not decrypt the provided encrypted_content"),
	[]byte("invalid_encrypted_content"),
}

var compactionBlobDecodeFailureMarkers = [][]byte{
	[]byte("could not decode the compaction blob"),
}

type reasoningRecoveryOutcome struct {
	encryptedContentDowngraded bool
	sessionReset               bool
	failed                     bool
	attempts                   []provider.RecoveredAttempt
}

func (o reasoningRecoveryOutcome) merge(other reasoningRecoveryOutcome) reasoningRecoveryOutcome {
	attempts := append([]provider.RecoveredAttempt{}, o.attempts...)
	attempts = append(attempts, other.attempts...)
	return reasoningRecoveryOutcome{
		encryptedContentDowngraded: o.encryptedContentDowngraded || other.encryptedContentDowngraded,
		sessionReset:               o.sessionReset || other.sessionReset,
		failed:                     o.failed || other.failed,
		attempts:                   attempts,
	}
}

// recordHidden 追加一次确实发出的、但未作为最终响应返回的上游调用。
func (o *reasoningRecoveryOutcome) recordHidden(stage, result string, call responseCall, body []byte, truncated bool, failure error) {
	if o == nil {
		return
	}
	diagnostic := provider.DiagnosticResponse{Body: append([]byte(nil), body...), BodyTruncated: truncated}
	if call.response != nil {
		diagnostic.StatusCode = call.response.StatusCode
		diagnostic.Status = call.response.Status
		if call.response.Header != nil {
			diagnostic.Header = call.response.Header.Clone()
		}
	}
	o.attempts = append(o.attempts, provider.RecoveredAttempt{
		Stage: stage, Result: result, UpstreamURL: call.upstreamURL,
		StartedAt: call.startedAt, DurationMS: call.durationMS,
		Diagnostic: diagnostic, Failure: failure,
	})
}

// prependOriginal 在最终响应已被替换时，把最初的 decode 400 放回真实调用序列首位。
func (o *reasoningRecoveryOutcome) prependOriginal(result string, call responseCall, body []byte, truncated bool) {
	if o == nil {
		return
	}
	previous := o.attempts
	o.attempts = nil
	o.recordHidden("reasoning_decode_rejected", result, call, body, truncated, nil)
	o.attempts = append(o.attempts, previous...)
}

func (o reasoningRecoveryOutcome) appendWarnings(header http.Header) {
	if o.encryptedContentDowngraded {
		appendCompatibilityWarning(header, "reasoning_encrypted_content_downgraded")
	}
	if o.sessionReset {
		appendCompatibilityWarning(header, "reasoning_session_reset")
	}
	if o.failed {
		appendCompatibilityWarning(header, "reasoning_recovery_failed")
	}
}

// recoverReasoningDecodeFailure 只处理上游在生成前明确返回的 opaque reasoning 解码失败。
// 恢复始终留在同一账号和同一 Build/XAI 平面：先移除 encrypted_content 并保留可读摘要，
// 若仍为 400 再清空服务端会话身份重试。最终仍失败时返回原始 400 和内部失败标记，由网关换号。
func (a *Adapter) recoverReasoningDecodeFailure(
	ctx context.Context,
	request provider.ResponseResourceRequest,
	accessToken string,
	body []byte,
	base string,
	replayKey string,
	initialCall responseCall,
) (responseCall, reasoningRecoveryOutcome, error) {
	plan := &reasoningRecoveryPlan{
		request: request, accessToken: accessToken, base: base, body: body,
		initialCall: initialCall,
	}
	if done, result := a.prepareReasoningRecovery(plan); done {
		return result, reasoningRecoveryOutcome{}, nil
	}
	// 一旦上游明确拒绝 opaque reasoning，立即清理该账号/平面的服务端回放，
	// 防止下次请求再次注入同一份已失效密文。成功响应会按正常 Capture 流程写回新状态。
	if a.replay != nil && replayKey != "" {
		a.replay.Clear(ctx, request.Model, replayKey)
	}
	portableBody, encryptedChanged, retryCall, replaced, err := a.downgradeEncryptedContent(ctx, plan)
	if err != nil {
		return responseCall{}, plan.out, err
	}
	if replaced {
		return retryCall, plan.out, nil
	}
	retryCall, replaced, err = a.resetReasoningSession(ctx, plan, portableBody, encryptedChanged)
	if err != nil {
		return responseCall{}, plan.out, err
	}
	if replaced {
		return retryCall, plan.out, nil
	}
	return plan.originalCall, plan.out, nil
}

// reasoningRecoveryPlan 承载一次 reasoning 解码失败恢复所需的原始 400 上下文与累计结果。
type reasoningRecoveryPlan struct {
	request      provider.ResponseResourceRequest
	accessToken  string
	base         string
	body         []byte
	initialCall  responseCall
	original     *http.Response
	originalCall responseCall
	errorBody    []byte
	truncated    bool
	out          reasoningRecoveryOutcome
}

// prepareReasoningRecovery 判定上游 400 是否属于可恢复的 opaque reasoning 解码失败；
// done 为 true 时 result 已是最终响应，调用方直接返回空 outcome。
func (a *Adapter) prepareReasoningRecovery(plan *reasoningRecoveryPlan) (bool, responseCall) {
	response := plan.initialCall.response
	if response == nil || response.StatusCode != http.StatusBadRequest {
		return true, plan.initialCall
	}
	errorBody, truncated, err := provider.ReadDiagnosticBody(response.Body)
	_ = response.Body.Close()
	if err != nil {
		plan.initialCall.response = cloneBufferedResponse(response, errorBody, truncated)
		return true, plan.initialCall
	}
	original := cloneBufferedResponse(response, errorBody, truncated)
	originalCall := plan.initialCall
	originalCall.response = original
	if truncated || !isReasoningDecodeFailure(errorBody) {
		return true, originalCall
	}
	// Build historically reused the compaction-decode wording for opaque
	// reasoning and server-side session failures. Only treat that wording as a
	// real compaction rejection when the rejected request actually carried a
	// compaction input item. This preserves reasoning recovery without ever
	// rewriting a client-held compact state.
	if isCompactionBlobDecodeFailure(errorBody) && hasCompactionInputItem(plan.body) {
		return true, originalCall
	}
	plan.original = original
	plan.originalCall = originalCall
	plan.errorBody = errorBody
	plan.truncated = truncated
	return false, originalCall
}

// downgradeEncryptedContent 先剥离不可解码的 opaque reasoning 再重试；
// replaced 为 true 时 retryCall 就是最终响应。
func (a *Adapter) downgradeEncryptedContent(ctx context.Context, plan *reasoningRecoveryPlan) ([]byte, bool, responseCall, bool, error) {
	portableBody, encryptedChanged := stripReasoningEncryptedContent(plan.body)
	if !encryptedChanged {
		return portableBody, false, responseCall{}, false, nil
	}
	retryCall := a.retryReasoningRecovery(ctx, plan.request, plan.accessToken, portableBody, plan.base, false)
	if retryCall.err != nil {
		a.logReasoningRecovery(plan.request, plan.base, "encrypted_content", "transport_failed", 0, retryCall.err)
		_ = plan.original.Body.Close()
		return portableBody, encryptedChanged, responseCall{}, false, retryCall.err
	}
	if err := normalizeGzipResponse(retryCall.response); err != nil {
		_ = retryCall.response.Body.Close()
		a.logReasoningRecovery(plan.request, plan.base, "encrypted_content", "response_decode_failed", retryCall.response.StatusCode, err)
		_ = plan.original.Body.Close()
		return portableBody, encryptedChanged, responseCall{}, false, err
	}
	if retryCall.response.StatusCode != http.StatusBadRequest {
		plan.out.encryptedContentDowngraded = true
		return portableBody, encryptedChanged, a.recordReasoningRetryReplacement(plan, "encrypted_content", "recovered_encrypted_content_stripped", retryCall), true, nil
	}
	retryBody, retryTrunc, inspectErr := provider.ReadDiagnosticBody(retryCall.response.Body)
	_ = retryCall.response.Body.Close()
	if inspectErr != nil {
		a.logReasoningRecovery(plan.request, plan.base, "encrypted_content", "retry_rejected", retryCall.response.StatusCode, inspectErr)
		_ = plan.original.Body.Close()
		return portableBody, encryptedChanged, responseCall{}, false, inspectErr
	}
	retryResult := "retry_still_400"
	if !retryTrunc && isReasoningDecodeFailure(retryBody) {
		retryResult = "decode_error_persisted"
	}
	plan.out.recordHidden("reasoning_encrypted_content_retry", retryResult, retryCall, retryBody, retryTrunc, nil)
	a.logReasoningRecovery(plan.request, plan.base, "encrypted_content", retryResult, retryCall.response.StatusCode, nil)
	return portableBody, encryptedChanged, responseCall{}, false, nil
}

// resetReasoningSession 清空服务端会话身份后重试；replaced 为 true 时 retryCall 就是最终响应。
func (a *Adapter) resetReasoningSession(ctx context.Context, plan *reasoningRecoveryPlan, portableBody []byte, encryptedChanged bool) (responseCall, bool, error) {
	if !canResetReasoningSession(plan.request, portableBody) {
		a.logReasoningRecovery(plan.request, plan.base, "session_reset", "not_safe", 0, nil)
		plan.out.failed = true
		return responseCall{}, false, nil
	}
	statelessBody := removePromptCacheKey(portableBody)
	retryCall := a.retryReasoningRecovery(ctx, plan.request, plan.accessToken, statelessBody, plan.base, true)
	if retryCall.err != nil {
		a.logReasoningRecovery(plan.request, plan.base, "session_reset", "transport_failed", 0, retryCall.err)
		_ = plan.original.Body.Close()
		return responseCall{}, false, retryCall.err
	}
	if err := normalizeGzipResponse(retryCall.response); err != nil {
		_ = retryCall.response.Body.Close()
		a.logReasoningRecovery(plan.request, plan.base, "session_reset", "response_decode_failed", retryCall.response.StatusCode, err)
		_ = plan.original.Body.Close()
		return responseCall{}, false, err
	}
	if retryCall.response.StatusCode != http.StatusBadRequest {
		plan.out.encryptedContentDowngraded = encryptedChanged
		plan.out.sessionReset = true
		return a.recordReasoningRetryReplacement(plan, "session_reset", "recovered_session_reset", retryCall), true, nil
	}
	retryBody, retryTrunc, inspectErr := provider.ReadDiagnosticBody(retryCall.response.Body)
	_ = retryCall.response.Body.Close()
	a.logReasoningRecovery(plan.request, plan.base, "session_reset", "retry_rejected", retryCall.response.StatusCode, inspectErr)
	plan.out.recordHidden("reasoning_session_reset", "retry_rejected", retryCall, retryBody, retryTrunc, inspectErr)
	plan.out.failed = true
	return responseCall{}, false, nil
}

// recordReasoningRetryReplacement 记录恢复重试已替换原始 400 的审计结果，并返回重试响应。
func (a *Adapter) recordReasoningRetryReplacement(plan *reasoningRecoveryPlan, stage, recoveredAuditResult string, retryCall responseCall) responseCall {
	_ = plan.original.Body.Close()
	logResult := "retry_response"
	auditResult := "replaced_by_retry_response"
	if isHTTPSuccess(retryCall.response.StatusCode) {
		logResult = "recovered"
		auditResult = recoveredAuditResult
	} else if retryCall.response.StatusCode == http.StatusTooManyRequests {
		auditResult = "replaced_by_rate_limit"
	}
	a.logReasoningRecovery(plan.request, plan.base, stage, logResult, retryCall.response.StatusCode, nil)
	plan.out.prependOriginal(auditResult, plan.originalCall, plan.errorBody, plan.truncated)
	return retryCall
}

// retryReasoningRecovery 使用新的幂等键执行同账号、同平面的恢复调用。
func (a *Adapter) retryReasoningRecovery(ctx context.Context, request provider.ResponseResourceRequest, accessToken string, body []byte, base string, resetSession bool) responseCall {
	retryRequest := request
	retryRequest.IdempotencyID, _ = security.NewOpaqueToken(18)
	stage := "reasoning_replay"
	if resetSession {
		retryRequest.PromptCacheKey = ""
		retryRequest.GrokTurnIndex = ""
		stage = "reasoning_session_reset"
	}
	return a.doResponseRequest(infraegress.WithPhysicalCallStage(ctx, stage), retryRequest, accessToken, body, base)
}

func canResetReasoningSession(request provider.ResponseResourceRequest, body []byte) bool {
	if request.Method != http.MethodPost || strings.TrimSpace(request.PromptCacheKey) == "" {
		return false
	}
	var payload map[string]any
	if json.Unmarshal(body, &payload) != nil {
		return false
	}
	previousResponseID, _ := payload["previous_response_id"].(string)
	return strings.TrimSpace(previousResponseID) == ""
}

func removePromptCacheKey(body []byte) []byte {
	var payload map[string]any
	if json.Unmarshal(body, &payload) != nil {
		return body
	}
	delete(payload, "prompt_cache_key")
	encoded, err := json.Marshal(payload)
	if err != nil {
		return body
	}
	return encoded
}

func (a *Adapter) logReasoningRecovery(request provider.ResponseResourceRequest, base, stage, result string, status int, err error) {
	plane := "build"
	if fallback := a.fallbackBaseURL(); fallback != "" && strings.EqualFold(strings.TrimRight(base, "/"), fallback) {
		plane = "xai"
	}
	attributes := []any{
		"account_id", request.Credential.ID,
		"model", request.Model,
		"operation", request.Operation,
		"plane", plane,
		"stage", stage,
		"result", result,
	}
	if status != 0 {
		attributes = append(attributes, "status", status)
	}
	if err != nil {
		attributes = append(attributes, "error", err)
	}
	logger := a.logger
	if logger != nil {
		logger.Warn("reasoning_decode_recovery", attributes...)
	}
}

func isReasoningDecodeFailure(body []byte) bool {
	return isCompactionBlobDecodeFailure(body) || containsDecodeFailureMarker(body, reasoningDecodeFailureMarkers)
}

func isCompactionBlobDecodeFailure(body []byte) bool {
	return containsDecodeFailureMarker(body, compactionBlobDecodeFailureMarkers)
}

func containsDecodeFailureMarker(body []byte, markers [][]byte) bool {
	lower := bytes.ToLower(body)
	for _, marker := range markers {
		if bytes.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func hasCompactionInputItem(body []byte) bool {
	var payload struct {
		Input []struct {
			Type string `json:"type"`
		} `json:"input"`
	}
	if json.Unmarshal(body, &payload) != nil {
		return false
	}
	for _, item := range payload.Input {
		if strings.TrimSpace(item.Type) == "compaction" {
			return true
		}
	}
	return false
}

// stripReasoningEncryptedContent removes only undecodable opaque reasoning.
// Readable reasoning summaries are kept as portable assistant messages; empty
// encrypted-only reasoning items are dropped. Compaction items are client-held
// upstream state and must never be rewritten by reasoning recovery.
func stripReasoningEncryptedContent(body []byte) ([]byte, bool) {
	var payload map[string]any
	if json.Unmarshal(body, &payload) != nil {
		return body, false
	}
	input, ok := payload["input"].([]any)
	if !ok || len(input) == 0 {
		return body, false
	}
	changed := false
	rebuilt := make([]any, 0, len(input))
	for _, raw := range input {
		item, ok := raw.(map[string]any)
		if !ok {
			rebuilt = append(rebuilt, raw)
			continue
		}
		replacement, itemChanged := rebuildReasoningInputItem(item, raw)
		if itemChanged {
			changed = true
		}
		rebuilt = append(rebuilt, replacement...)
	}
	if !changed {
		return body, false
	}
	payload["input"] = rebuilt
	encoded, err := json.Marshal(payload)
	if err != nil {
		return body, false
	}
	return encoded, true
}

// rebuildReasoningInputItem 返回单个 input item 的重建结果：nil 表示丢弃该项，
// 单元素切片表示保留（原样或可移植摘要）；changed 表示该项是否发生改写。
func rebuildReasoningInputItem(item map[string]any, raw any) ([]any, bool) {
	if stringField(item, "type") != "reasoning" {
		return []any{raw}, false
	}
	encrypted, hasEncrypted := item["encrypted_content"].(string)
	if !hasEncrypted || strings.TrimSpace(encrypted) == "" {
		if portable, ok := portableReasoningSummaryMessage(item); ok {
			return []any{portable}, true
		}
		return []any{raw}, false
	}
	if portable, ok := portableReasoningSummaryMessage(item); ok {
		return []any{portable}, true
	}
	return nil, true
}

func portableReasoningSummaryMessage(item map[string]any) (map[string]any, bool) {
	text := reasoningPortableText(item)
	if text == "" {
		return nil, false
	}
	return map[string]any{
		"type": "message", "role": "assistant",
		"content": "Prior model reasoning summary:\n" + text,
	}, true
}

func reasoningPortableText(item map[string]any) string {
	var parts []string
	for _, field := range []string{"summary", "content"} {
		values, _ := item[field].([]any)
		for _, raw := range values {
			part, _ := raw.(map[string]any)
			if text := strings.TrimSpace(stringField(part, "text")); text != "" {
				parts = append(parts, text)
			}
		}
	}
	return strings.Join(parts, "\n")
}

func appendCompatibilityWarning(header http.Header, warning string) {
	if header == nil || strings.TrimSpace(warning) == "" {
		return
	}
	existing := strings.TrimSpace(header.Get("X-Grok2API-Compatibility-Warnings"))
	if existing == "" {
		header.Set("X-Grok2API-Compatibility-Warnings", warning)
		return
	}
	for _, value := range strings.Split(existing, ",") {
		if strings.TrimSpace(value) == warning {
			return
		}
	}
	header.Set("X-Grok2API-Compatibility-Warnings", existing+","+warning)
}
