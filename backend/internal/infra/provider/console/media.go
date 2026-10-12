package console

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	egressdomain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

const (
	consoleMediaBodyLimit       = 2 << 20
	consoleImageBodyLimit       = 32 << 20
	consoleImageDownloadTimeout = 45 * time.Second
	consoleMediaOutputAttempts  = 3
	consoleVideoPollEvery       = 2 * time.Second
	consoleMaxEditImages        = 3
	// Upstream enforces the two video image inputs separately (measured against
	// console.x.ai on both grok-imagine-video and grok-imagine-video-1.5):
	//   image            = first frame, image-to-video, at most 1
	//   reference_images = style/content references, reference-to-video, at most 7
	//     8 references answer 400 "Too many reference images: 8. Maximum allowed is 7."
	// The two are mutually exclusive below and their limits are never summed, so a
	// combined ceiling would accept payloads that upstream then rejects.
	consoleMaxVideoFirstFrames = 1
)

type consoleMediaUpstreamError struct {
	status        int
	summary       string
	retryAfter    time.Duration
	requestScoped bool
}

var (
	_ provider.HTTPStatusError    = (*consoleMediaUpstreamError)(nil)
	_ provider.RetryAfterError    = (*consoleMediaUpstreamError)(nil)
	_ provider.RequestScopedError = (*consoleMediaUpstreamError)(nil)
	_ provider.PublicMessageError = (*consoleMediaUpstreamError)(nil)
)

func (e *consoleMediaUpstreamError) Error() string {
	if e == nil {
		return ""
	}
	return e.summary
}

func (e *consoleMediaUpstreamError) HTTPStatusCode() int {
	if e == nil {
		return 0
	}
	return e.status
}

func (e *consoleMediaUpstreamError) RetryAfterDuration() time.Duration {
	if e == nil {
		return 0
	}
	return e.retryAfter
}

func (e *consoleMediaUpstreamError) RequestScopedFailure() bool {
	return e != nil && e.requestScoped
}

func (e *consoleMediaUpstreamError) PublicErrorMessage() string {
	if e == nil {
		return ""
	}
	return e.summary
}

// consoleMediaForwardState 汇总 Console 媒体转发的公共请求上下文，供各响应分支复用。
// 租约释放与出口反馈仍由各分支按原顺序显式执行，避免改变副作用时机。
type consoleMediaForwardState struct {
	ctx        context.Context
	credential account.Credential
	baseURL    string
	lease      *infraegress.Lease
	cancel     context.CancelFunc
	rateLimit  *provider.RateLimitMetadata
}

func (a *Adapter) forwardConsoleMedia(ctx context.Context, credential account.Credential, path string, payload any, format string, quotaUnits int) (*provider.Response, error) {
	token, err := a.cipher.Decrypt(credential.EncryptedAccessToken)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	cfg := a.config()
	requestCtx, cancel := context.WithTimeout(ctx, time.Duration(cfg.TimeoutSeconds)*time.Second)
	lease, err := a.egress.AcquireCredential(requestCtx, egressdomain.ScopeConsole, credential)
	if err != nil {
		cancel()
		return nil, err
	}
	response, err := a.doDPoPRequest(requestCtx, credential, token, lease, http.MethodPost, consoleV1Endpoint(cfg.BaseURL, path), body, "application/json")
	if err != nil {
		a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsole, lease.NodeID, 0, err)
		lease.Release()
		cancel()
		return nil, err
	}
	rateLimit, err := consoleMediaRateLimitMetadata(response)
	if err != nil {
		lease.Release()
		cancel()
		return nil, err
	}
	state := consoleMediaForwardState{ctx: ctx, credential: credential, baseURL: cfg.BaseURL, lease: lease, cancel: cancel, rateLimit: rateLimit}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return a.forwardConsoleMediaErrorResponse(state, response)
	}
	if format == "url" {
		return a.forwardConsoleMediaURLResponse(state, response, quotaUnits)
	}
	release := func() {
		a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsole, lease.NodeID, response.StatusCode, nil)
		lease.Release()
		cancel()
	}
	result := responseResult(response, &releaseBody{ReadCloser: response.Body, release: release})
	result.QuotaUnits = max(1, quotaUnits)
	result.RateLimit = rateLimit
	return result, nil
}

func (a *Adapter) forwardConsoleMediaErrorResponse(state consoleMediaForwardState, response *http.Response) (*provider.Response, error) {
	data, truncated, readErr := provider.ReadDiagnosticBody(response.Body)
	_ = response.Body.Close()
	dpopRequired := response.StatusCode == http.StatusForbidden && provider.IsDPoPProofRequiredBody(data)
	if response.StatusCode == http.StatusForbidden && shouldInvalidateConsoleClearance(data) {
		state.lease.InvalidateClearance()
	}
	if !dpopRequired {
		a.egress.FeedbackForScope(context.WithoutCancel(state.ctx), egressdomain.ScopeConsole, state.lease.NodeID, response.StatusCode, nil)
	}
	state.lease.Release()
	state.cancel()
	if readErr != nil {
		return nil, readErr
	}
	response.Body = io.NopCloser(bytes.NewReader(data))
	response.ContentLength = int64(len(data))
	response.Header.Set("Content-Length", strconv.Itoa(len(data)))
	if truncated {
		response.Header.Set("X-Grok2API-Body-Truncated", "1")
	}
	result := responseResult(response, response.Body)
	result.Diagnostic = &provider.DiagnosticResponse{StatusCode: response.StatusCode, Status: response.Status, Header: response.Header.Clone(), Body: data, BodyTruncated: truncated}
	result.RateLimit = state.rateLimit
	return result, nil
}

func (a *Adapter) forwardConsoleMediaURLResponse(state consoleMediaForwardState, response *http.Response, quotaUnits int) (*provider.Response, error) {
	data, readErr := io.ReadAll(io.LimitReader(response.Body, consoleMediaBodyLimit+1))
	_ = response.Body.Close()
	a.egress.FeedbackForScope(context.WithoutCancel(state.ctx), egressdomain.ScopeConsole, state.lease.NodeID, response.StatusCode, readErr)
	state.lease.Release()
	state.cancel()
	if readErr == nil && len(data) > consoleMediaBodyLimit {
		readErr = errors.New("Console 图片上游响应超过 2 MiB")
	}
	if readErr == nil {
		data, readErr = a.localizeConsoleImageResponse(state.ctx, state.credential, state.baseURL, data)
	}
	if readErr != nil {
		if !provider.IsMediaPostProcessingError(readErr) {
			readErr = provider.NewMediaPostProcessingError(provider.MediaPostProcessingDownload, readErr)
		}
		return nil, readErr
	}
	response.Body = io.NopCloser(bytes.NewReader(data))
	response.ContentLength = int64(len(data))
	response.Header.Set("Content-Length", strconv.Itoa(len(data)))
	response.Header.Set("Content-Type", "application/json")
	result := responseResult(response, response.Body)
	result.QuotaUnits = max(1, quotaUnits)
	result.RateLimit = state.rateLimit
	return result, nil
}

func consoleMediaRateLimitMetadata(response *http.Response) (*provider.RateLimitMetadata, error) {
	if response.StatusCode != http.StatusTooManyRequests {
		return nil, nil
	}
	_, rateLimit, err := normalizeRateLimitResponse(response)
	if err != nil {
		return nil, err
	}
	return rateLimit, nil
}

func invalidConsoleMediaRequest(message string) *provider.Response {
	return jsonProviderResponse(http.StatusBadRequest, map[string]any{"error": map[string]any{
		"message": message, "type": "invalid_request_error",
	}})
}

func validConsoleMediaInputURL(value, mediaType string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	if strings.HasPrefix(lower, "data:"+mediaType+"/") {
		return strings.Contains(lower, ";base64,")
	}
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil
}

func waitConsoleMediaRetry(ctx context.Context, attempt int) error {
	delays := [...]time.Duration{200 * time.Millisecond, 750 * time.Millisecond}
	timer := time.NewTimer(delays[min(attempt, len(delays)-1)])
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func newConsoleMediaUpstreamError(status int, body []byte, retryAfter time.Duration) error {
	message := ""
	var payload map[string]any
	if json.Unmarshal(body, &payload) == nil {
		message = safeConsoleMediaErrorValue(payload["error"])
		if message == "" {
			message = safeConsoleMediaErrorValue(payload["message"])
		}
		if message == "" {
			message = safeConsoleMediaErrorValue(payload["detail"])
		}
	}
	summary := fmt.Sprintf("Console 媒体上游返回 %d", status)
	if message != "" {
		summary += ": " + message
	}
	if retryAfter <= 0 {
		retryAfter = consoleRetryAfter(body)
	}
	return &consoleMediaUpstreamError{
		status: status, summary: summary, retryAfter: retryAfter,
		requestScoped: status == http.StatusForbidden && provider.IsDPoPProofRequiredBody(body),
	}
}

func safeConsoleMediaErrorValue(value any) string {
	if object, ok := value.(map[string]any); ok {
		for _, key := range []string{"message", "msg", "code", "type", "detail", "error_description"} {
			raw, exists := object[key]
			if !exists || raw == nil {
				continue
			}
			if text := safeConsoleMediaErrorValue(raw); text != "" {
				return text
			}
		}
	}
	if values, ok := value.([]any); ok {
		for _, item := range values {
			if text := safeConsoleMediaErrorValue(item); text != "" {
				return text
			}
		}
	}
	if text, ok := value.(string); ok {
		return safeConsoleMediaText(text)
	}
	switch value.(type) {
	case json.Number, float64, float32, int, int64, int32, uint, uint64, uint32, bool:
		return safeConsoleMediaText(fmt.Sprint(value))
	}
	return ""
}

func safeConsoleMediaText(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	lower := strings.ToLower(value)
	for _, sensitive := range []string{
		"authorization", "cookie", "bearer ",
		"access_token", "access-token", "refresh_token", "refresh-token",
		"api_key", "api-key", "sso-rw", "cf_clearance",
	} {
		if strings.Contains(lower, sensitive) {
			return "上游拒绝请求"
		}
	}
	const limit = 160
	if len(value) <= limit {
		return value
	}
	end := limit
	for end > 0 && !utf8.ValidString(value[:end]) {
		end--
	}
	return value[:end]
}
