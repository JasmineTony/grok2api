package web

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/bogdanfinn/websocket"

	inferencedomain "github.com/chenyme/grok2api/backend/internal/domain/inference"
)

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
