package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	fhttp "github.com/bogdanfinn/fhttp"
	"github.com/bogdanfinn/websocket"
	"github.com/google/uuid"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	domainegress "github.com/chenyme/grok2api/backend/internal/domain/egress"
	inferencedomain "github.com/chenyme/grok2api/backend/internal/domain/inference"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/provider/searchresult"
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

func runGatewayStream(ctx context.Context, connection *websocket.Conn, writer io.Writer, model, prompt string, attachments []string, previous *inferencedomain.WebResponseState) error {
	connection.SetReadLimit(gatewayMaxFrameBytes)
	if deadline, ok := ctx.Deadline(); ok {
		_ = connection.SetReadDeadline(deadline)
	}
	sender := &gatewaySender{connection: connection}
	state := gatewayStreamState{initialEventID: "evt_init_" + newRequestUUID()}
	initial := map[string]any{
		"event": map[string]any{
			"type": "session.create", "event_id": state.initialEventID,
			"session": gatewaySession(model, previous),
		},
	}
	if previous != nil {
		state.currentSessionID = previous.ConversationID
		initial["session_id"] = state.currentSessionID
	}
	if err := sender.write(initial); err != nil {
		return fmt.Errorf("发送 Grok Gateway session.create: %w", err)
	}
	heartbeatDone := make(chan struct{})
	defer close(heartbeatDone)
	go gatewayHeartbeat(sender, heartbeatDone)
	for {
		messageType, data, err := connection.ReadMessage()
		if err != nil {
			return fmt.Errorf("读取 Grok Gateway: %w", err)
		}
		action, err := handleGatewayFrame(writer, messageType, data, &state)
		if err != nil {
			return err
		}
		switch action {
		case gatewayFrameStop:
			return nil
		case gatewayFrameSkip:
			continue
		}
		if err := sendGatewayTurn(sender, &state, prompt, attachments, previous); err != nil {
			return err
		}
	}
}

// gatewayStreamState 保存一次网关流会话在帧处理之间需要保持的状态。
type gatewayStreamState struct {
	initialEventID   string
	currentSessionID string
	created          bool
	attached         bool
	turnSent         bool
}

// gatewayFrameAction 表示单帧处理后消息循环的走向。
type gatewayFrameAction int

const (
	gatewayFrameSkip    gatewayFrameAction = iota // 跳过本轮 turn 发送判断
	gatewayFrameProceed                           // 继续执行 turn 发送判断
	gatewayFrameStop                              // 结束读取循环
)

// handleGatewayFrame 转发一帧并按事件类型更新会话状态与循环走向。
func handleGatewayFrame(writer io.Writer, messageType int, data []byte, state *gatewayStreamState) (gatewayFrameAction, error) {
	if messageType != websocket.TextMessage {
		return gatewayFrameSkip, nil
	}
	if len(data) > gatewayMaxFrameBytes {
		return gatewayFrameStop, fmt.Errorf("Grok Gateway 响应帧超过安全上限")
	}
	var envelope gatewayEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return gatewayFrameSkip, nil
	}
	if _, err := writer.Write(append(append([]byte(nil), data...), '\n')); err != nil {
		return gatewayFrameStop, err
	}
	switch envelope.Event.Type {
	case "session.created":
		if envelope.Event.ClientEventID != "" && envelope.Event.ClientEventID != state.initialEventID {
			return gatewayFrameSkip, nil
		}
		state.created = true
		if state.currentSessionID == "" {
			state.currentSessionID = envelope.SessionID
		}
	case "conversation.attached":
		state.attached = true
		if state.currentSessionID == "" {
			state.currentSessionID = envelope.Event.Conversation.ID
		}
		if envelope.Event.Conversation.ID == "" || envelope.Event.Conversation.ID != state.currentSessionID {
			return gatewayFrameStop, fmt.Errorf("Grok Gateway 返回了不一致的 conversation id")
		}
	case "response.done", "error":
		return gatewayFrameStop, nil
	case "session.ended":
		return gatewayFrameStop, fmt.Errorf("Grok Gateway session 在响应完成前结束")
	}
	return gatewayFrameProceed, nil
}

// sendGatewayTurn 在会话创建且挂载完成后发送一次性的 turn 事件。
func sendGatewayTurn(sender *gatewaySender, state *gatewayStreamState, prompt string, attachments []string, previous *inferencedomain.WebResponseState) error {
	if !state.created || !state.attached || state.turnSent {
		return nil
	}
	state.turnSent = true
	item, response := gatewayTurnEvents(state.currentSessionID, prompt, attachments, previous)
	if err := sender.write(item); err != nil {
		return fmt.Errorf("发送 Grok Gateway conversation.item.create: %w", err)
	}
	if err := sender.write(response); err != nil {
		return fmt.Errorf("发送 Grok Gateway response.create: %w", err)
	}
	return nil
}

func gatewayHeartbeat(sender *gatewaySender, done <-chan struct{}) {
	ticker := time.NewTicker(gatewayHeartbeatPeriod)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case now := <-ticker.C:
			if err := sender.write(map[string]any{"event": map[string]any{"type": "ping", "event_id": fmt.Sprintf("evt_hb_%d", now.UnixMilli())}}); err != nil {
				_ = sender.connection.Close()
				return
			}
		}
	}
}

func gatewaySession(model string, previous *inferencedomain.WebResponseState) map[string]any {
	xGrok := map[string]any{
		"protocol_capabilities": []string{"conversation_attached", "custom_methods_v1"},
		"use_chunk":             true, "enable_side_by_side": true, "force_side_by_side": false,
		"enable_image_generation": true, "image_generation_count": 2,
		"disable_text_follow_ups": false, "disable_artifact": true, "force_concise": false,
	}
	if previous == nil {
		xGrok["keep_context"] = false
		xGrok["is_temporary"] = true
		xGrok["disable_memory"] = true
	} else {
		xGrok["conversation_id"] = previous.ConversationID
		xGrok["load_existing"] = true
		xGrok["needs_history"] = false
	}
	return map[string]any{"model": model, "x_grok": xGrok}
}

func gatewayTurnEvents(sessionID, prompt string, attachments []string, previous *inferencedomain.WebResponseState) (map[string]any, map[string]any) {
	chunks := make([]any, 0, len(attachments)+1)
	for _, attachment := range attachments {
		chunks = append(chunks, map[string]any{"mention": map[string]any{"target": map[string]any{"file_mention": map[string]any{"file_id": attachment}}}})
	}
	chunks = append(chunks, map[string]any{"text": map[string]any{"text": prompt}})
	item := map[string]any{
		"type": "message", "role": "user",
		"x_grok": map[string]any{"client_message_id": newRequestUUID(), "input_chunks": chunks},
	}
	if len(attachments) > 0 {
		item["file_attachment_ids"] = attachments
	}
	now := time.Now().UnixMilli()
	itemEvent := map[string]any{
		"session_id": sessionID,
		"event": map[string]any{
			"type": "conversation.item.create", "event_id": fmt.Sprintf("evt_msg_%d", now), "item": item,
		},
	}
	if previous != nil {
		itemEvent["event"].(map[string]any)["parent_response_id"] = previous.UpstreamParentResponseID
	}
	if len(attachments) > 0 {
		itemEvent["event"].(map[string]any)["file_attachment_ids"] = attachments
	}
	responseEvent := map[string]any{
		"session_id": sessionID,
		"event":      map[string]any{"type": "response.create", "event_id": fmt.Sprintf("evt_resp_%d", now)},
	}
	return itemEvent, responseEvent
}

// applyGatewayResponseChunk 处理 mgw response.chunk 帧（工具卡片、工具结果、引用与文本增量）。
func applyGatewayResponseChunk(parsed *parsedChat, chunk map[string]any) (string, string, error) {
	if chunk == nil {
		return "", "", nil
	}
	// Current grok.com mgw protocol streams search tools and citations as
	// dedicated chunk fields (not <grok:render> tokens).
	if card, _ := chunk["tool_usage_card"].(map[string]any); card != nil {
		collectGatewayToolUsageCard(parsed, card)
	}
	if result, _ := chunk["tool_result"].(map[string]any); result != nil {
		collectGatewayToolResult(parsed, result)
	}
	if cite, _ := chunk["render_citation"].(map[string]any); cite != nil {
		return applyGatewayRenderCitation(parsed, cite)
	}
	text, _ := chunk["text"].(map[string]any)
	delta, _ := text["text"].(string)
	channel, _ := text["channel"].(string)
	return appendGatewayDelta(parsed, channel, delta)
}

// applyGatewayResponseDone 记录父响应 id 并校验终态。
func applyGatewayResponseDone(parsed *parsedChat, event map[string]any) error {
	response, _ := event["response"].(map[string]any)
	parsed.ParentID, _ = response["id"].(string)
	status, _ := response["status"].(string)
	if status != "" && status != "completed" {
		return fmt.Errorf("Grok Gateway response 状态为 %s", status)
	}
	return nil
}

// applyGatewayGrokOutput 处理 response.grok.output 帧（流错误与卡片附件图片）。
func applyGatewayGrokOutput(parsed *parsedChat, event map[string]any) (string, string, error) {
	output, _ := event["output"].(map[string]any)
	if streamError, _ := output["stream_error"].(map[string]any); streamError != nil {
		return "", "", webResponseError(streamError)
	}
	if rawURL := collectCardAttachment(parsed, output["card_attachment"]); rawURL != "" {
		rawURL = absoluteAssetURL(rawURL)
		parsed.Images = appendUniqueString(parsed.Images, rawURL)
		return "image", rawURL, nil
	}
	return "", "", nil
}

func parseGatewayEvent(event map[string]any, parsed *parsedChat) (string, string, error) {
	typeName, _ := event["type"].(string)
	switch typeName {
	case "conversation.attached":
		conversation, _ := event["conversation"].(map[string]any)
		parsed.ConversationID, _ = conversation["id"].(string)
	case "response.chunk":
		chunk, _ := event["chunk"].(map[string]any)
		return applyGatewayResponseChunk(parsed, chunk)
	case "response.output_text.delta":
		delta, _ := event["delta"].(string)
		return appendGatewayDelta(parsed, "CHANNEL_ASSISTANT_RESPONSE", delta)
	case "response.output_text.done":
		text, _ := event["text"].(string)
		if parsed.upstreamText.Len() == 0 && text != "" {
			return appendGatewayDelta(parsed, "CHANNEL_ASSISTANT_RESPONSE", text)
		}
	case "response.done":
		return "", "", applyGatewayResponseDone(parsed, event)
	case "response.search.result":
		result, _ := event["result"].(map[string]any)
		if rawURL, _ := result["url"].(string); rawURL != "" {
			appendSearchSource(parsed, rawURL, firstString(result, "title"), "web")
		}
	case "response.grok.output":
		return applyGatewayGrokOutput(parsed, event)
	case "error":
		return "", "", gatewayEventError(event)
	}
	return "", "", nil
}

// collectGatewayToolUsageCard records mgw tool_usage_card starts (web_search / x_search)
// and maps them to xAI web_search_call / x_search_call skeletons.
func collectGatewayToolUsageCard(parsed *parsedChat, card map[string]any) {
	if parsed == nil || card == nil {
		return
	}
	id := firstString(card, "tool_usage_card_id", "id")
	if id == "" {
		id = fmt.Sprintf("card:%d", parsed.ServerTools+1)
	}
	if web, _ := card["web_search"].(map[string]any); web != nil {
		recordGatewaySearchTool(parsed, id, "web_search")
		query := nestedSearchQuery(web)
		upsertHostedSearchCall(parsed, id, "web_search", query, "in_progress")
		return
	}
	if xSearch, _ := card["x_search"].(map[string]any); xSearch != nil {
		recordGatewaySearchTool(parsed, id, "x_search")
		query := nestedSearchQuery(xSearch)
		upsertHostedSearchCall(parsed, id, "x_search", query, "in_progress")
		return
	}
	recordGatewaySearchTool(parsed, id, "")
}

func recordGatewaySearchTool(parsed *parsedChat, id, kind string) {
	if parsed == nil || id == "" {
		return
	}
	if parsed.serverToolKeys == nil {
		parsed.serverToolKeys = make(map[string]struct{})
	}
	if _, exists := parsed.serverToolKeys[id]; !exists {
		if len(parsed.serverToolKeys) >= maxTrackedServerTools {
			return
		}
		parsed.serverToolKeys[id] = struct{}{}
		parsed.ServerTools++
	}
	var keys *map[string]struct{}
	var count *int64
	switch kind {
	case "web_search":
		keys, count = &parsed.webSearchKeys, &parsed.WebSearchTools
	case "x_search":
		keys, count = &parsed.xSearchKeys, &parsed.XSearchTools
	default:
		return
	}
	if *keys == nil {
		*keys = make(map[string]struct{})
	}
	if _, exists := (*keys)[id]; exists || len(*keys) >= maxTrackedServerTools {
		return
	}
	(*keys)[id] = struct{}{}
	*count++
}

func nestedSearchQuery(tool map[string]any) string {
	if tool == nil {
		return ""
	}
	if q := firstString(tool, "query"); q != "" {
		return q
	}
	if args, _ := tool["args"].(map[string]any); args != nil {
		return firstString(args, "query")
	}
	return ""
}

// collectGatewayToolResult folds mgw tool_result into SearchSources and completes hosted calls.
// gatewayActionSource 构造 OpenAPI 搜索 sources 条目：type 固定为 url，
// title 作为不影响协议的 UI 扩展保留。
func gatewayActionSource(rawURL, title string) (map[string]any, bool) {
	normalized, ok := searchresult.NormalizeURL(rawURL)
	if !ok {
		return nil, false
	}
	return map[string]any{
		"type": "url", "url": normalized, "title": searchresult.NormalizeTitle(title, normalized),
	}, true
}

// collectGatewayWebSearchResult 把 mgw tool_result.web_search 折叠为 web 搜索来源并完成宿主调用。
func collectGatewayWebSearchResult(parsed *parsedChat, callID string, web map[string]any) {
	var sources []map[string]any
	pages, _ := web["webpages"].([]any)
	for _, raw := range pages {
		item, _ := raw.(map[string]any)
		if item == nil {
			continue
		}
		u := firstString(item, "url")
		title := firstString(item, "title")
		appendSearchSource(parsed, u, title, "web")
		if source, ok := gatewayActionSource(u, title); ok {
			sources = append(sources, source)
		}
	}
	call := upsertHostedSearchCall(parsed, callID, "web_search", nestedSearchQuery(web), "completed")
	appendHostedSearchSources(call, sources)
	if call != nil {
		call.Status = "completed"
		recordGatewaySearchTool(parsed, call.ID, "web_search")
	}
}

// gatewayXPostTitle 复刻 mgw x_post 的标题拼接规则：作者名在前，正文追加在后。
func gatewayXPostTitle(item map[string]any) string {
	title := firstString(item, "name", "userhandle", "username")
	text, _ := item["text"].(string)
	if text == "" {
		return title
	}
	if title != "" {
		return title + ": " + text
	}
	return text
}

// collectGatewayXPostResult 把 mgw tool_result.x_post 折叠为 X 搜索来源并完成宿主调用。
func collectGatewayXPostResult(parsed *parsedChat, callID string, xPost map[string]any) {
	var sources []map[string]any
	posts, _ := xPost["posts"].([]any)
	for _, raw := range posts {
		item, _ := raw.(map[string]any)
		if item == nil {
			continue
		}
		handle := firstString(item, "userhandle", "username")
		postID := firstString(item, "post_id", "postId")
		if handle == "" || postID == "" {
			continue
		}
		rawURL := "https://x.com/" + url.PathEscape(handle) + "/status/" + url.PathEscape(postID)
		title := gatewayXPostTitle(item)
		appendSearchSource(parsed, rawURL, title, "x_post")
		if source, ok := gatewayActionSource(rawURL, title); ok {
			sources = append(sources, source)
		}
	}
	call := upsertHostedSearchCall(parsed, callID, "x_search", "", "completed")
	appendHostedSearchSources(call, sources)
	if call != nil {
		call.Status = "completed"
		if call.Kind == "" {
			call.Kind = "x_search"
		}
		recordGatewaySearchTool(parsed, call.ID, "x_search")
	}
}

func collectGatewayToolResult(parsed *parsedChat, result map[string]any) {
	if parsed == nil || result == nil {
		return
	}
	callID := firstString(result, "tool_call_id", "tool_usage_card_id", "id")
	if web, _ := result["web_search"].(map[string]any); web != nil {
		collectGatewayWebSearchResult(parsed, callID, web)
	}
	if xPost, _ := result["x_post"].(map[string]any); xPost != nil {
		collectGatewayXPostResult(parsed, callID, xPost)
	}
}

// applyGatewayRenderCitation turns an mgw render_citation chunk into client citations.
// When InlineCitations is enabled (default), embeds [[N]](url) and records positional
// annotations. N stays in the marker while structured metadata retains the source title.
func applyGatewayRenderCitation(parsed *parsedChat, cite map[string]any) (string, string, error) {
	if parsed == nil || cite == nil {
		return "", "", nil
	}
	rawURL := firstString(cite, "url")
	normalized, valid := searchresult.NormalizeURL(rawURL)
	if !valid {
		return "", "", nil
	}
	if parsed.citationIndex == nil {
		parsed.citationIndex = make(map[string]int)
	}
	index, exists := parsed.citationIndex[normalized]
	if !exists {
		if len(parsed.citationIndex) >= maxTrackedCitationSources {
			return "", "", nil
		}
		index = len(parsed.citationIndex) + 1
		parsed.citationIndex[normalized] = index
	}
	// Skip consecutive duplicate of the same source (UI collapses them).
	if parsed.lastCitation == index {
		return "", "", nil
	}
	parsed.lastCitation = index

	annotation := citationAnnotation(parsed, normalized, index)
	if parsed.DisableInlineCitations {
		// no_inline_citations: no markdown in text; positional fields omitted later at finalize.
		if len(parsed.Annotations) < maxTrackedAnnotations {
			parsed.Annotations = append(parsed.Annotations, annotation)
		}
		return "", "", nil
	}
	// Inline marker and xAI Responses annotation use the same numeric label.
	replacement := fmt.Sprintf("[[%d]](%s)", index, normalized)
	start := parsed.textCharacterLen()
	parsed.upstreamText.WriteString(replacement)
	parsed.appendText(replacement)
	annotation["start_index"] = start
	annotation["end_index"] = start + utf8.RuneCountInString(replacement)
	if len(parsed.Annotations) < maxTrackedAnnotations {
		parsed.Annotations = append(parsed.Annotations, annotation)
	}
	return "text", replacement, nil
}

func appendGatewayDelta(parsed *parsedChat, channel, delta string) (string, string, error) {
	if delta == "" {
		return "", "", nil
	}
	normalized := strings.ToUpper(strings.TrimSpace(channel))
	if strings.Contains(normalized, "ANALYSIS") || strings.Contains(normalized, "REASONING") {
		parsed.Reasoning.WriteString(delta)
		return "reasoning", delta, nil
	}
	if normalized != "" && normalized != "CHANNEL_ASSISTANT_RESPONSE" {
		return "", "", nil
	}
	parsed.upstreamText.WriteString(delta)
	cleaned := cleanChatToken(parsed, delta)
	parsed.appendText(cleaned)
	return "text", cleaned, nil
}

func gatewayEventError(event map[string]any) error {
	errorValue, _ := event["error"].(map[string]any)
	if errorValue == nil {
		return errors.New("Grok Gateway 返回未知错误")
	}
	return webResponseError(errorValue)
}
