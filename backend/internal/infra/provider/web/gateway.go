package web

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	fhttp "github.com/bogdanfinn/fhttp"
	"github.com/bogdanfinn/websocket"
	"github.com/google/uuid"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	domainegress "github.com/chenyme/grok2api/backend/internal/domain/egress"
	inferencedomain "github.com/chenyme/grok2api/backend/internal/domain/inference"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/provider/sessionidentity"
	providerstreamidle "github.com/chenyme/grok2api/backend/internal/infra/provider/streamidle"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

const (
	gatewayHandshakeTimeout = 20 * time.Second
	gatewayHeartbeatPeriod  = 25 * time.Second
	gatewayMaxFrameBytes    = 16 << 20
)

type gatewayEnvelope struct {
	SessionID string `json:"session_id"`
	Event     struct {
		Type          string `json:"type"`
		ClientEventID string `json:"client_event_id"`
		Conversation  struct {
			ID string `json:"id"`
		} `json:"conversation"`
	} `json:"event"`
}

type gatewaySender struct {
	mu         sync.Mutex
	connection *websocket.Conn
}

type gatewayOpenOptions struct {
	enforceStreamIdle bool
	deferForbidden    bool
}

func (s *gatewaySender) write(value any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = s.connection.SetWriteDeadline(time.Now().Add(15 * time.Second))
	return s.connection.WriteJSON(value)
}

func (a *Adapter) openGatewayChat(ctx context.Context, credential account.Credential, previousResponseID string, spec ModelSpec, input normalizedChatInput, options gatewayOpenOptions) (*http.Response, *infraegress.Lease, *inferencedomain.WebResponseState, string, error) {
	setup, err := a.prepareGatewayChat(ctx, credential, previousResponseID, input)
	if err != nil {
		return nil, nil, nil, "", err
	}
	requestCtx, idleCancel, cancel := gatewayChatContext(ctx, setup.cfg, options)
	connection, handshake, dialErr := setup.dial(requestCtx, options)
	if dialErr != nil {
		cancel()
		if handshake != nil {
			return gatewayHandshakeResponse(handshake, setup.endpoint), setup.lease, setup.previous, "", nil
		}
		a.egress.Feedback(context.WithoutCancel(ctx), setup.lease.NodeID, 0, dialErr)
		setup.lease.Release()
		return nil, nil, nil, "", dialErr
	}
	body := gatewayChatStreamBody(requestCtx, connection, setup, spec, input, cancel)
	if idleCancel != nil {
		body = providerstreamidle.New(body, time.Duration(setup.cfg.StreamIdleTimeoutSeconds)*time.Second, idleCancel)
	}
	request, _ := http.NewRequestWithContext(requestCtx, http.MethodGet, setup.endpoint, nil)
	return &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       body,
		Request:    request,
	}, setup.lease, setup.previous, "", nil
}

// gatewayChatSetup 保存一次 Gateway 会话在建立连接前解析出的身份、租约与前序状态。
type gatewayChatSetup struct {
	cfg         Config
	token       string
	lease       *infraegress.Lease
	userID      string
	previous    *inferencedomain.WebResponseState
	attachments []string
	endpoint    string
	origin      string
}

// prepareGatewayChat 解析凭据、获取出口租约并准备前序状态与附件；失败时自行释放租约。
func (a *Adapter) prepareGatewayChat(ctx context.Context, credential account.Credential, previousResponseID string, input normalizedChatInput) (*gatewayChatSetup, error) {
	setup := &gatewayChatSetup{cfg: a.config()}
	token, err := a.cipher.Decrypt(credential.EncryptedAccessToken)
	if err != nil {
		return nil, err
	}
	setup.token = token
	lease, err := a.egress.AcquireCredential(ctx, domainegress.ScopeWeb, credential)
	if err != nil {
		return nil, err
	}
	setup.lease = lease
	userID, err := a.resolveGatewayUserID(ctx, setup.cfg.BaseURL, credential, token, lease)
	if err != nil {
		lease.Release()
		return nil, err
	}
	setup.userID = userID
	previous, err := a.gatewayPreviousState(ctx, previousResponseID, credential, lease)
	if err != nil {
		return nil, err
	}
	setup.previous = previous
	attachments, err := a.prepareChatAttachments(ctx, setup.cfg, lease, token, input.Attachments)
	if err != nil {
		lease.Release()
		return nil, err
	}
	setup.attachments = attachments
	endpoint, origin, err := gatewayEndpoint(setup.cfg.BaseURL, userID)
	if err != nil {
		lease.Release()
		return nil, err
	}
	setup.endpoint = endpoint
	setup.origin = origin
	return setup, nil
}

// gatewayPreviousState 读取并校验 previous_response_id 对应的会话状态；缺失或账号不一致时释放租约。
func (a *Adapter) gatewayPreviousState(ctx context.Context, previousResponseID string, credential account.Credential, lease *infraegress.Lease) (*inferencedomain.WebResponseState, error) {
	if previousResponseID == "" {
		return nil, nil
	}
	state, stateErr := a.states.GetWebState(ctx, previousResponseID, time.Now().UTC())
	if stateErr != nil {
		lease.Release()
		if errors.Is(stateErr, repository.ErrNotFound) {
			return nil, fmt.Errorf("previous_response_id 不存在或已过期")
		}
		return nil, stateErr
	}
	if state.AccountID != credential.ID {
		lease.Release()
		return nil, fmt.Errorf("previous_response_id 绑定的账号不一致")
	}
	return &state, nil
}

// gatewayChatContext 构造会话请求上下文；启用流空闲检测时返回可取消的 idle 句柄。
func gatewayChatContext(ctx context.Context, cfg Config, options gatewayOpenOptions) (context.Context, context.CancelCauseFunc, context.CancelFunc) {
	requestCtx, totalCancel := context.WithTimeout(ctx, time.Duration(cfg.ChatTimeoutSeconds)*time.Second)
	var idleCancel context.CancelCauseFunc
	if options.enforceStreamIdle && cfg.StreamIdleTimeoutSeconds > 0 {
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

// dial 按 deferForbidden 选项建立 WebSocket 连接，失败时返回握手响应供上层生成 HTTP 诊断响应。
func (s *gatewayChatSetup) dial(requestCtx context.Context, options gatewayOpenOptions) (*websocket.Conn, *fhttp.Response, error) {
	headers := gatewayHeaders(s.origin, s.userID, s.token, s.lease)
	if options.deferForbidden {
		return s.lease.DialWebSocketDeferredForbidden(requestCtx, s.endpoint, headers, gatewayHandshakeTimeout)
	}
	return s.lease.DialWebSocket(requestCtx, s.endpoint, headers, gatewayHandshakeTimeout)
}

// gatewayChatStreamBody 启动连接读循环与心跳，返回转发上游帧的流式响应体。
func gatewayChatStreamBody(requestCtx context.Context, connection *websocket.Conn, setup *gatewayChatSetup, spec ModelSpec, input normalizedChatInput, cancel context.CancelFunc) io.ReadCloser {
	reader, writer := io.Pipe()
	go func() {
		<-requestCtx.Done()
		_ = connection.Close()
	}()
	go func() {
		streamErr := runGatewayStream(requestCtx, connection, writer, spec.Mode, input.Prompt, setup.attachments, setup.previous)
		cancel()
		_ = connection.Close()
		_ = writer.CloseWithError(streamErr)
	}()
	return &cancelBody{ReadCloser: reader, cancel: cancel}
}

func (a *Adapter) resolveGatewayUserID(ctx context.Context, baseURL string, credential account.Credential, token string, lease *infraegress.Lease) (string, error) {
	if userID, err := normalizeGatewayUserID(credential.UserID); err == nil {
		return userID, nil
	}
	// Imported and pre-Gateway accounts may only contain an SSO token or email.
	// Resolve the uid just in time so they remain immediately usable; the normal
	// account synchronization path persists the same identity for later calls.
	identity, err := sessionidentity.FetchWithLease(ctx, baseURL, token, lease, a.egress)
	if err != nil {
		return "", fmt.Errorf("同步 Grok Web Gateway 用户身份: %w", err)
	}
	return normalizeGatewayUserID(identity.UserID)
}

func normalizeGatewayUserID(value string) (string, error) {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", fmt.Errorf("Grok Web 账号缺少有效 user_id，请先同步账号资料")
	}
	return parsed.String(), nil
}

func gatewayEndpoint(baseURL, userID string) (string, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || parsed.Host == "" {
		return "", "", fmt.Errorf("Grok Web Base URL 无效")
	}
	origin := (&url.URL{Scheme: parsed.Scheme, Host: parsed.Host}).String()
	switch parsed.Scheme {
	case "https":
		parsed.Scheme = "wss"
	case "http":
		parsed.Scheme = "ws"
	default:
		return "", "", fmt.Errorf("Grok Web Base URL 协议无效")
	}
	parsed.Path = "/ws/mgw/"
	parsed.RawPath = ""
	parsed.RawQuery = url.Values{"uid": []string{userID}}.Encode()
	parsed.Fragment = ""
	return parsed.String(), origin, nil
}

func gatewayHeaders(origin, userID, token string, lease *infraegress.Lease) fhttp.Header {
	headers := fhttp.Header{}
	headers.Set("Origin", origin)
	headers.Set("User-Agent", lease.UserAgent)
	headers.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	headers.Set("Cache-Control", "no-cache")
	headers.Set("Pragma", "no-cache")
	headers.Set("Cookie", infraegress.BuildSSOCookie(token, lease.CFCookies)+"; x-userid="+userID)
	return headers
}

func gatewayHandshakeResponse(response *fhttp.Response, endpoint string) *http.Response {
	request, _ := http.NewRequest(http.MethodGet, endpoint, nil)
	status := response.Status
	if status == "" {
		status = fmt.Sprintf("%d %s", response.StatusCode, http.StatusText(response.StatusCode))
	}
	body := response.Body
	if body == nil {
		body = io.NopCloser(strings.NewReader(""))
	}
	return &http.Response{
		StatusCode: response.StatusCode,
		Status:     status,
		Header:     http.Header(response.Header).Clone(),
		Body:       body,
		Request:    request,
	}
}
