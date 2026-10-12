package console

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	egressdomain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	settingsdomain "github.com/chenyme/grok2api/backend/internal/domain/settings"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/provider/conversation"
	providerstreamidle "github.com/chenyme/grok2api/backend/internal/infra/provider/streamidle"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	neterrorpkg "github.com/chenyme/grok2api/backend/internal/pkg/neterror"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

type Config struct {
	BaseURL                  string
	SessionBaseURL           string
	TimeoutSeconds           int
	StreamIdleTimeoutSeconds int
}

type Adapter struct {
	mu     sync.RWMutex
	cfg    Config
	egress *infraegress.Manager
	cipher *security.Cipher
	assets provider.ImageAssetStore
	dpop   *dpopSessionManager
}

func NewAdapter(cfg Config, egress *infraegress.Manager, cipher *security.Cipher, assets provider.ImageAssetStore) *Adapter {
	cfg = normalizedConfig(cfg)
	return &Adapter{cfg: cfg, egress: egress, cipher: cipher, assets: assets, dpop: newDPoPSessionManager()}
}

func normalizedConfig(cfg Config) Config {
	if cfg.StreamIdleTimeoutSeconds <= 0 {
		cfg.StreamIdleTimeoutSeconds = int(settingsdomain.DefaultConsoleStreamIdleTimeout.Seconds())
	}
	return cfg
}

func (a *Adapter) Provider() account.Provider { return account.ProviderConsole }

func (a *Adapter) UpdateConfig(cfg Config) {
	cfg = normalizedConfig(cfg)
	a.mu.Lock()
	a.cfg = cfg
	a.mu.Unlock()
}

func (a *Adapter) config() Config {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.cfg
}

func (a *Adapter) ModelAliases() []provider.ModelAlias { return Aliases() }

func (a *Adapter) QuotaMode(upstreamModel string) string {
	if _, ok := Resolve(upstreamModel); ok {
		return QuotaMode
	}
	if ResolveMedia(upstreamModel, modeldomain.CapabilityImage) || ResolveMedia(upstreamModel, modeldomain.CapabilityImageEdit) {
		return QuotaModeImage
	}
	if ResolveMedia(upstreamModel, modeldomain.CapabilityVideo) {
		return QuotaModeVideo
	}
	if ResolveMedia(upstreamModel, modeldomain.CapabilityTTS) || ResolveMedia(upstreamModel, modeldomain.CapabilitySTT) || ResolveMedia(upstreamModel, modeldomain.CapabilityRealtime) {
		return QuotaMode
	}
	return ""
}

func (a *Adapter) TierOrder(string) []account.WebTier { return nil }

func (a *Adapter) PricingModel(upstreamModel string) string { return upstreamModel }

func (a *Adapter) ListModels(context.Context, account.Credential) ([]string, error) {
	return allModels(), nil
}

func (a *Adapter) ParseImportedCredentials(data []byte) ([]provider.CredentialSeed, error) {
	return parseImportedCredentials(data)
}

func (a *Adapter) MarshalCredentials(values []provider.CredentialSeed) ([]byte, error) {
	return marshalCredentials(values)
}

func (a *Adapter) ForwardResponse(ctx context.Context, request provider.ResponseResourceRequest) (*provider.Response, error) {
	if request.NormalizedMetadata != nil {
		*request.NormalizedMetadata = provider.NormalizedRequestMetadata{}
	}
	if request.Method != http.MethodPost || request.Path != "/responses" {
		return jsonProviderResponse(http.StatusBadRequest, map[string]any{"error": map[string]any{"type": "invalid_request_error", "message": "Grok Console 仅支持 POST /responses"}}), nil
	}
	spec, ok := Resolve(request.Model)
	if !ok {
		return jsonProviderResponse(http.StatusBadRequest, map[string]any{"error": map[string]any{"type": "invalid_request_error", "message": "Console 模型不存在"}}), nil
	}
	token, err := a.cipher.Decrypt(request.Credential.EncryptedAccessToken)
	if err != nil {
		return nil, err
	}
	body, conversationOptions, invalid, err := normalizeForwardRequestBody(request, spec)
	if err != nil {
		return nil, err
	}
	if invalid != nil {
		return invalid, nil
	}
	cfg := a.config()
	requestCtx, idleCancel, cancel := consoleRequestContext(ctx, cfg)
	lease, err := a.egress.AcquireCredential(requestCtx, egressdomain.ScopeConsole, request.Credential)
	if err != nil {
		cancel()
		return nil, err
	}
	response, err := a.doDPoPRequest(requestCtx, request.Credential, token, lease, http.MethodPost, consoleEndpoint(cfg.BaseURL), body, "*/*")
	if err != nil {
		a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsole, lease.NodeID, 0, err)
		lease.Release()
		cancel()
		return nil, err
	}
	if idleCancel != nil && response.StatusCode >= 200 && response.StatusCode < 300 && response.Body != nil {
		response.Body = providerstreamidle.New(response.Body, time.Duration(cfg.StreamIdleTimeoutSeconds)*time.Second, idleCancel)
	}
	return a.completeConsoleResponse(ctx, request, response, conversationOptions, lease, cancel)
}

// normalizeForwardRequestBody rewrites the client body into the Console request
// shape. A non-nil response means the request was rejected for the client.
func normalizeForwardRequestBody(request provider.ResponseResourceRequest, spec ModelSpec) ([]byte, conversation.ResponseOptions, *provider.Response, error) {
	body := request.Body
	var conversationOptions conversation.ResponseOptions
	if !request.NormalizeBody {
		return body, conversationOptions, nil, nil
	}
	var err error
	if request.Operation == conversation.OperationMessages {
		body, conversationOptions, err = conversation.ConvertRequestWithOptions(body, request.Model, request.Operation)
		if err == nil && conversationOptions.ReasoningEffortSet && request.NormalizedMetadata != nil {
			request.NormalizedMetadata.ReasoningEffort = conversationOptions.ReasoningEffort
		}
	} else {
		body, err = conversation.ConvertRequest(body, request.Model, request.Operation)
	}
	if err == nil {
		body, err = normalizeRequestWithMetadata(body, spec, request.NormalizedMetadata)
	}
	if err != nil {
		return nil, conversationOptions, invalidConversationResponse(request.Operation, err), nil
	}
	return body, conversationOptions, nil, nil
}

// consoleRequestContext applies the total Console request timeout plus the
// optional stream idle timeout, exposing one cancel that releases both.
func consoleRequestContext(ctx context.Context, cfg Config) (context.Context, context.CancelCauseFunc, func()) {
	requestCtx, totalCancel := context.WithTimeout(ctx, time.Duration(cfg.TimeoutSeconds)*time.Second)
	var idleCancel context.CancelCauseFunc
	if cfg.StreamIdleTimeoutSeconds > 0 {
		requestCtx, idleCancel = context.WithCancelCause(requestCtx)
	}
	cancel := func() {
		if idleCancel != nil {
			idleCancel(nil)
		}
		totalCancel()
	}
	return requestCtx, idleCancel, cancel
}

// completeConsoleResponse releases the egress lease exactly once and converts
// the upstream response into the client-facing shape.
func (a *Adapter) completeConsoleResponse(ctx context.Context, request provider.ResponseResourceRequest, response *http.Response, conversationOptions conversation.ResponseOptions, lease *infraegress.Lease, cancel func()) (*provider.Response, error) {
	responseBodyTruncated, rateLimit, responseReleased, err := a.prepareConsoleErrorResponse(ctx, response, lease, cancel)
	if err != nil {
		return nil, err
	}
	release := func() {
		if responseReleased {
			return
		}
		a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsole, lease.NodeID, response.StatusCode, nil)
		lease.Release()
		cancel()
	}
	if request.Operation == conversation.OperationChat || request.Operation == conversation.OperationMessages {
		return finalizeConversationResponse(request, response, conversationOptions, rateLimit, responseBodyTruncated, release)
	}
	result := responseResult(response, &releaseBody{ReadCloser: response.Body, release: release})
	result.RateLimit = rateLimit
	return result, nil
}

// prepareConsoleErrorResponse normalizes rate-limit and forbidden Console
// responses and reports whether the lease has already been released.
func (a *Adapter) prepareConsoleErrorResponse(ctx context.Context, response *http.Response, lease *infraegress.Lease, cancel func()) (bool, *provider.RateLimitMetadata, bool, error) {
	truncated := false
	var rateLimit *provider.RateLimitMetadata
	if response.StatusCode == http.StatusTooManyRequests {
		var err error
		truncated, rateLimit, err = normalizeRateLimitResponse(response)
		if err != nil {
			_ = response.Body.Close()
			lease.Release()
			cancel()
			return false, nil, false, err
		}
	}
	if response.StatusCode != http.StatusForbidden {
		return truncated, rateLimit, false, nil
	}
	forbiddenTruncated, err := a.rewriteForbiddenResponse(ctx, response, lease)
	cancel()
	if err != nil {
		return false, nil, false, err
	}
	return truncated || forbiddenTruncated, rateLimit, true, nil
}

// rewriteForbiddenResponse turns a Console 403 into a replayable body so the
// client still sees the upstream rejection after the lease is released.
func (a *Adapter) rewriteForbiddenResponse(ctx context.Context, response *http.Response, lease *infraegress.Lease) (bool, error) {
	data, truncated, readErr := provider.ReadDiagnosticBody(response.Body)
	_ = response.Body.Close()
	if readErr != nil {
		lease.Release()
		return false, readErr
	}
	if shouldInvalidateConsoleClearance(data) {
		lease.InvalidateClearance()
		a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsole, lease.NodeID, response.StatusCode, nil)
	}
	lease.Release()
	response.Body = io.NopCloser(bytes.NewReader(data))
	response.ContentLength = int64(len(data))
	response.Header.Set("Content-Length", strconv.Itoa(len(data)))
	if truncated {
		response.Header.Set("X-Grok2API-Body-Truncated", "1")
	}
	return truncated, nil
}

// finalizeConversationResponse converts a Console conversation response into the
// OpenAI-compatible shape expected by the client.
func finalizeConversationResponse(request provider.ResponseResourceRequest, response *http.Response, conversationOptions conversation.ResponseOptions, rateLimit *provider.RateLimitMetadata, responseBodyTruncated bool, release func()) (*provider.Response, error) {
	if request.Streaming && response.StatusCode >= 200 && response.StatusCode < 300 {
		return streamConversationResponse(response, request.Operation, conversationOptions, rateLimit, release), nil
	}
	data, diagnosticTruncated, readErr := readConversationResponseBody(response, responseBodyTruncated)
	_ = response.Body.Close()
	release()
	if readErr != nil {
		return nil, readErr
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return diagnosticConversationResponse(response, request.Operation, data, diagnosticTruncated, rateLimit), nil
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil, neterrorpkg.ErrUpstreamResponseEmpty
	}
	if len(data) > 64<<20 {
		return nil, fmt.Errorf("Console 对话响应超过 64 MiB")
	}
	return jsonConversationResponse(response, request.Operation, data, conversationOptions, rateLimit)
}

// readConversationResponseBody reads a bounded conversation body; error
// responses use the diagnostic reader that also reports truncation.
func readConversationResponseBody(response *http.Response, responseBodyTruncated bool) ([]byte, bool, error) {
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		data, err := io.ReadAll(io.LimitReader(response.Body, (64<<20)+1))
		return data, false, err
	}
	data, truncated, err := provider.ReadDiagnosticBody(response.Body)
	return data, truncated || responseBodyTruncated, err
}

// streamConversationResponse rewrites the upstream body as an SSE stream.
func streamConversationResponse(response *http.Response, operation string, conversationOptions conversation.ResponseOptions, rateLimit *provider.RateLimitMetadata, release func()) *provider.Response {
	response.Body = conversation.ConvertResponseStreamWithOptions(response.Body, operation, conversationOptions)
	response.Header.Del("Content-Length")
	response.Header.Set("Content-Type", "text/event-stream")
	result := responseResult(response, &releaseBody{ReadCloser: response.Body, release: release})
	result.RateLimit = rateLimit
	return result
}

// diagnosticConversationResponse exposes the raw upstream failure together with
// the normalized error envelope.
func diagnosticConversationResponse(response *http.Response, operation string, data []byte, diagnosticTruncated bool, rateLimit *provider.RateLimitMetadata) *provider.Response {
	diagnostic := &provider.DiagnosticResponse{StatusCode: response.StatusCode, Status: response.Status, Header: response.Header.Clone(), Body: data, BodyTruncated: diagnosticTruncated}
	converted := normalizeConversationError(data, operation, response.StatusCode)
	response.Header.Set("Content-Length", strconv.Itoa(len(converted)))
	response.Header.Set("Content-Type", "application/json")
	result := responseResult(response, io.NopCloser(bytes.NewReader(converted)))
	result.Diagnostic = diagnostic
	result.RateLimit = rateLimit
	return result
}

// jsonConversationResponse converts a successful non-streaming body.
func jsonConversationResponse(response *http.Response, operation string, data []byte, conversationOptions conversation.ResponseOptions, rateLimit *provider.RateLimitMetadata) (*provider.Response, error) {
	converted, convertErr := conversation.ConvertResponseJSONWithOptions(data, operation, conversationOptions)
	if convertErr != nil {
		return nil, convertErr
	}
	response.Header.Set("Content-Length", strconv.Itoa(len(converted)))
	response.Header.Set("Content-Type", "application/json")
	result := responseResult(response, io.NopCloser(bytes.NewReader(converted)))
	result.RateLimit = rateLimit
	return result, nil
}

// shouldInvalidateConsoleClearance keeps account-level and protocol-level
// rejections from being misclassified as a broken browser/egress binding.
func shouldInvalidateConsoleClearance(body []byte) bool {
	return !provider.IsDefinitiveAccountBlockBody(body) && !provider.IsDPoPProofRequiredBody(body)
}

func normalizeConversationError(data []byte, operation string, status int) []byte {
	var envelope struct {
		Error   json.RawMessage `json:"error"`
		Message string          `json:"message"`
	}
	if json.Unmarshal(data, &envelope) == nil && len(bytes.TrimSpace(envelope.Error)) > 0 && string(bytes.TrimSpace(envelope.Error)) != "null" {
		if converted, err := conversation.ConvertResponseJSON(data, operation); err == nil {
			return converted
		}
	}
	message := strings.TrimSpace(envelope.Message)
	if message == "" {
		message = strings.TrimSpace(string(data))
	}
	if message == "" {
		message = http.StatusText(status)
	}
	if len(message) > 4096 {
		message = message[:4096]
	}
	errorType := conversationErrorType(status, operation)
	if operation == conversation.OperationMessages {
		result, _ := json.Marshal(map[string]any{"type": "error", "error": map[string]any{"type": errorType, "message": message}})
		return result
	}
	result, _ := json.Marshal(map[string]any{"error": map[string]any{"type": errorType, "message": message}})
	return result
}

func conversationErrorType(status int, operation string) string {
	switch status {
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		return "invalid_request_error"
	case http.StatusUnauthorized:
		return "authentication_error"
	case http.StatusForbidden:
		return "permission_error"
	case http.StatusNotFound:
		return "not_found_error"
	case http.StatusTooManyRequests:
		return "rate_limit_error"
	case http.StatusServiceUnavailable:
		if operation == conversation.OperationMessages {
			return "overloaded_error"
		}
	}
	if operation == conversation.OperationMessages {
		return "api_error"
	}
	return "server_error"
}

func consoleEndpoint(baseURL string) string {
	return consoleV1Endpoint(baseURL, "/responses")
}

func normalizeRateLimitResponse(response *http.Response) (bool, *provider.RateLimitMetadata, error) {
	data, truncated, err := provider.ReadDiagnosticBody(response.Body)
	if err != nil {
		return truncated, nil, err
	}
	_ = response.Body.Close()
	response.Body = io.NopCloser(bytes.NewReader(data))
	response.ContentLength = int64(len(data))
	response.Header.Set("Content-Length", strconv.Itoa(len(data)))
	metadata := parseConsoleRateLimitMetadata(data)
	if headerValue := response.Header.Get("Retry-After"); headerValue != "" {
		if metadata != nil {
			if retryAfter := parseConsoleRetryAfterHeader(headerValue, time.Now().UTC()); retryAfter > 0 {
				metadata.RetryAfter = retryAfter
			}
		}
	} else {
		retryAfter := consoleRetryAfter(data)
		if metadata != nil {
			retryAfter = metadata.RetryAfter
		}
		if retryAfter > 0 {
			response.Header.Set("Retry-After", strconv.FormatInt(int64(retryAfter/time.Second), 10))
		}
	}
	return truncated, metadata, nil
}

func responseResult(response *http.Response, body io.ReadCloser) *provider.Response {
	upstreamURL := ""
	if response.Request != nil && response.Request.URL != nil {
		upstreamURL = response.Request.URL.String()
	}
	return &provider.Response{
		StatusCode: response.StatusCode, Status: response.Status, Header: response.Header.Clone(), Body: body, QuotaUnits: 1, UpstreamURL: upstreamURL,
	}
}

func jsonProviderResponse(status int, value any) *provider.Response {
	data, _ := json.Marshal(value)
	return &provider.Response{
		StatusCode: status, Status: fmt.Sprintf("%d %s", status, http.StatusText(status)),
		Header: http.Header{"Content-Type": []string{"application/json"}, "Content-Length": []string{strconv.Itoa(len(data))}},
		Body:   io.NopCloser(bytes.NewReader(data)),
	}
}

func invalidConversationResponse(operation string, err error) *provider.Response {
	if operation == conversation.OperationMessages {
		return jsonProviderResponse(http.StatusBadRequest, map[string]any{"type": "error", "error": map[string]any{"type": "invalid_request_error", "message": err.Error()}})
	}
	return jsonProviderResponse(http.StatusBadRequest, map[string]any{"error": map[string]any{"type": "invalid_request_error", "message": err.Error()}})
}

type releaseBody struct {
	io.ReadCloser
	once    sync.Once
	release func()
}

func (b *releaseBody) Close() error {
	err := b.ReadCloser.Close()
	b.once.Do(b.release)
	return err
}
