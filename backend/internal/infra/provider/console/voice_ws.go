package console

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	fhttp "github.com/bogdanfinn/fhttp"
	"github.com/bogdanfinn/websocket"

	egressdomain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// DialVoiceWebSocket opens an authenticated Console websocket for realtime or STT streaming.
func (a *Adapter) DialVoiceWebSocket(ctx context.Context, request provider.VoiceWebSocketRequest) (provider.VoiceWebSocketConn, func(), error) {
	pathValue, err := validateVoiceWebSocketPath(request.Path)
	if err != nil {
		return nil, nil, err
	}
	token, err := a.cipher.Decrypt(request.Credential.EncryptedAccessToken)
	if err != nil {
		return nil, nil, err
	}
	requestCtx, cancel := context.WithCancel(ctx)
	lease, err := a.egress.AcquireCredential(requestCtx, egressdomain.ScopeConsole, request.Credential)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	cleanup := func() {
		lease.Release()
		cancel()
	}
	endpoint, err := a.voiceWebSocketEndpoint(pathValue, request.Model)
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	proofEndpoint, err := voiceWebSocketProofEndpoint(endpoint)
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	for attempt := 0; attempt < 2; attempt++ {
		connection, retry, dialErr := a.dialVoiceWebSocketAttempt(ctx, requestCtx, request, token, lease, endpoint, proofEndpoint, attempt)
		if connection != nil {
			return connection, cleanup, nil
		}
		if retry {
			continue
		}
		cleanup()
		return nil, nil, dialErr
	}
	cleanup()
	return nil, nil, errors.New("Console voice websocket DPoP 重试状态无效")
}

// validateVoiceWebSocketPath normalizes and validates the requested Console
// voice websocket path.
func validateVoiceWebSocketPath(pathValue string) (string, error) {
	pathValue = strings.TrimSpace(pathValue)
	if pathValue == "" || strings.Contains(pathValue, "://") || strings.Contains(pathValue, "..") {
		return "", invalidConsoleVoiceError("voice websocket path 无效")
	}
	if !strings.HasPrefix(pathValue, "/") {
		pathValue = "/" + pathValue
	}
	switch pathValue {
	case "/realtime", "/stt":
	default:
		return "", invalidConsoleVoiceError("不支持的 voice websocket path")
	}
	return pathValue, nil
}

// dialVoiceWebSocketAttempt performs one DPoP-signed websocket upgrade. A nil
// connection with retry set asks the caller to refresh the DPoP session.
func (a *Adapter) dialVoiceWebSocketAttempt(ctx context.Context, requestCtx context.Context, request provider.VoiceWebSocketRequest, token string, lease *infraegress.Lease, endpoint, proofEndpoint string, attempt int) (provider.VoiceWebSocketConn, bool, error) {
	session, cacheKey, sessionErr := a.dpop.get(requestCtx, a, request.Credential, token, lease)
	if sessionErr != nil {
		return nil, false, sessionErr
	}
	httpReq, requestErr := newVoiceWebSocketProofRequest(requestCtx, proofEndpoint, token, lease, session)
	if requestErr != nil {
		return nil, false, requestErr
	}
	connection, response, dialErr := lease.DialWebSocket(requestCtx, endpoint, voiceWebSocketDialHeaders(httpReq), 30*time.Second)
	if dialErr == nil {
		return a.voiceWebSocketDialResult(ctx, lease, connection, response)
	}
	if response == nil {
		a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsole, lease.NodeID, 0, dialErr)
		return nil, false, fmt.Errorf("拨号 Console voice websocket 失败: %w", dialErr)
	}
	return a.voiceWebSocketUpgradeFailure(ctx, response, lease, attempt, cacheKey, session)
}

// newVoiceWebSocketProofRequest builds the HTTP Upgrade request carrying the
// DPoP proof for one websocket dial attempt.
func newVoiceWebSocketProofRequest(ctx context.Context, proofEndpoint, token string, lease *infraegress.Lease, session dpopSession) (*http.Request, error) {
	// The websocket dialer needs wss://, while DPoP protects the underlying
	// HTTP Upgrade request and Console validates htu against https://. Signing
	// the websocket URI itself produces a valid JWT with the wrong htu and the
	// server rejects an otherwise healthy session with 401.
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, proofEndpoint, nil)
	if err != nil {
		return nil, err
	}
	applyBrowserHeaders(httpReq, token, lease)
	httpReq.Header.Set("Accept", "*/*")
	httpReq.Header.Set("Sec-Fetch-Mode", "websocket")
	httpReq.Header.Set("Sec-Fetch-Dest", "empty")
	httpReq.Header.Set("Sec-Fetch-Site", "same-origin")
	httpReq.Header.Set("Cache-Control", "no-cache")
	httpReq.Header.Set("Pragma", "no-cache")
	if err := applyDPoPAuthorization(httpReq, session); err != nil {
		return nil, err
	}
	return httpReq, nil
}

func voiceWebSocketDialHeaders(httpReq *http.Request) fhttp.Header {
	headers := fhttp.Header{}
	for key, values := range httpReq.Header {
		for _, value := range values {
			headers.Add(key, value)
		}
	}
	return headers
}

// voiceWebSocketDialResult closes the unused upgrade response and reports the
// established connection back to the egress pool.
func (a *Adapter) voiceWebSocketDialResult(ctx context.Context, lease *infraegress.Lease, connection provider.VoiceWebSocketConn, response *fhttp.Response) (provider.VoiceWebSocketConn, bool, error) {
	if response != nil && response.Body != nil {
		_ = response.Body.Close()
	}
	if connection == nil {
		return nil, false, errors.New("Console voice websocket 连接为空")
	}
	a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsole, lease.NodeID, http.StatusSwitchingProtocols, nil)
	return connection, false, nil
}

// voiceWebSocketUpgradeFailure classifies a failed websocket upgrade and asks
// the caller to refresh the DPoP session when the proof itself was rejected.
func (a *Adapter) voiceWebSocketUpgradeFailure(ctx context.Context, response *fhttp.Response, lease *infraegress.Lease, attempt int, cacheKey string, session dpopSession) (provider.VoiceWebSocketConn, bool, error) {
	status := response.StatusCode
	var body []byte
	if response.Body != nil {
		body, _, _ = provider.ReadDiagnosticBody(response.Body)
		_ = response.Body.Close()
	}
	if status == http.StatusUnauthorized {
		a.dpop.invalidate(cacheKey, session.accessToken)
		if attempt == 0 {
			return nil, true, nil
		}
	}
	dpopRequired := status == http.StatusForbidden && provider.IsDPoPProofRequiredBody(body)
	if status == http.StatusForbidden && shouldInvalidateConsoleClearance(body) {
		lease.InvalidateClearance()
	}
	if !dpopRequired {
		a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsole, lease.NodeID, status, nil)
	}
	retryAfter := parseConsoleRetryAfterHeader(response.Header.Get("Retry-After"), time.Now().UTC())
	return nil, false, newConsoleMediaUpstreamError(status, body, retryAfter)
}

func (a *Adapter) voiceWebSocketEndpoint(pathValue, modelName string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(a.config().BaseURL), "/")
	if base == "" {
		return "", errors.New("Console BaseURL 未配置")
	}
	endpoint, err := url.Parse(consoleV1Endpoint(base, pathValue))
	if err != nil {
		return "", err
	}
	switch strings.ToLower(endpoint.Scheme) {
	case "https":
		endpoint.Scheme = "wss"
	case "http":
		endpoint.Scheme = "ws"
	case "wss", "ws":
	default:
		return "", fmt.Errorf("不支持的 Console voice websocket scheme: %s", endpoint.Scheme)
	}
	values := endpoint.Query()
	if modelName = strings.TrimSpace(modelName); modelName != "" {
		values.Set("model", modelName)
	}
	endpoint.RawQuery = values.Encode()
	return endpoint.String(), nil
}

func voiceWebSocketProofEndpoint(endpoint string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || parsed.Host == "" {
		return "", errors.New("Console voice websocket endpoint 无效")
	}
	switch strings.ToLower(parsed.Scheme) {
	case "wss":
		parsed.Scheme = "https"
	case "ws":
		parsed.Scheme = "http"
	case "https", "http":
	default:
		return "", fmt.Errorf("不支持的 Console voice websocket scheme: %s", parsed.Scheme)
	}
	return parsed.String(), nil
}

// Ensure bogdanfinn websocket.Conn satisfies the provider contract at compile time.
var _ provider.VoiceWebSocketConn = (*websocket.Conn)(nil)
