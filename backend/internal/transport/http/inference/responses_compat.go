package inference

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// responsesCompatState fills fields Grok CLI serde treats as required.
type responsesCompatState struct {
	responseID      string
	createdAt       int64
	model           string
	itemSeq         int
	itemIDs         map[int64]string
	usedItemIDs     map[string]struct{}
	pending         []byte
	passingLongLine bool
}

func rewriteResponsesStreamChunk(chunk []byte, state *responsesCompatState) []byte {
	if state == nil {
		return chunk
	}
	var out []byte
	if state.passingLongLine {
		index := bytes.IndexByte(chunk, '\n')
		if index < 0 {
			return append(out, chunk...)
		}
		out = append(out, chunk[:index+1]...)
		chunk = chunk[index+1:]
		state.passingLongLine = false
	}
	state.pending = append(state.pending, chunk...)
	for {
		index := bytes.IndexByte(state.pending, '\n')
		if index < 0 {
			// Compatibility rewriting only needs ordinary JSON-sized SSE lines.
			// Stream an oversized line through instead of retaining unbounded
			// memory; rewriting resumes at its terminating newline.
			if len(state.pending) > maxStreamEventInspectionBytes {
				out = append(out, state.pending...)
				state.pending = nil
				state.passingLongLine = true
			}
			break
		}
		line := state.pending[:index+1]
		state.pending = state.pending[index+1:]
		out = append(out, rewriteResponsesDataLine(line, state)...)
	}
	return out
}

// flushResponsesStreamTail forwards the final unterminated SSE line instead
// of silently dropping it. Two newlines complete the event so downstream SSE
// parsers can dispatch it before EOF or a locally generated abort event.
func flushResponsesStreamTail(state *responsesCompatState) []byte {
	if state == nil || state.passingLongLine || len(state.pending) == 0 {
		return nil
	}
	tail := state.pending
	state.pending = nil
	trimmed := bytes.TrimSpace(tail)
	if !bytes.HasPrefix(trimmed, []byte("data:")) {
		return nil
	}
	payload := bytes.TrimSpace(bytes.TrimPrefix(trimmed, []byte("data:")))
	if len(payload) == 0 {
		return nil
	}
	if bytes.Equal(payload, []byte("[DONE]")) {
		return []byte("data: [DONE]\n\n")
	}
	var event map[string]any
	if json.Unmarshal(payload, &event) != nil {
		// Never turn a truncated JSON fragment into a dispatchable SSE event;
		// the locally generated terminal event must remain parseable.
		return nil
	}
	sanitizeResponsesEvent(event, state)
	encoded, err := json.Marshal(event)
	if err != nil {
		return nil
	}
	return append([]byte("data: "+string(encoded)), '\n', '\n')
}

func (s *responsesCompatState) ensureID() string {
	if s.responseID == "" {
		s.responseID = "resp_abort"
	}
	if s.createdAt == 0 {
		s.createdAt = time.Now().Unix()
	}
	return s.responseID
}

func (s *responsesCompatState) rememberFromMeta(meta responseMetadata) {
	if id := strings.TrimSpace(meta.ResponseID); id != "" {
		s.responseID = id
	}
	if model := strings.TrimSpace(meta.Model); model != "" {
		s.model = model
	}
	s.ensureID()
}

func rewriteResponsesDataLine(line []byte, state *responsesCompatState) []byte {
	trimmed := bytes.TrimSpace(line)
	if !bytes.HasPrefix(trimmed, []byte("data:")) {
		return line
	}
	payload := bytes.TrimSpace(bytes.TrimPrefix(trimmed, []byte("data:")))
	if len(payload) == 0 || bytes.Equal(payload, []byte("[DONE]")) {
		return line
	}
	var event map[string]any
	if json.Unmarshal(payload, &event) != nil {
		return line
	}
	changed := sanitizeResponsesEvent(event, state)
	if !changed {
		return line
	}
	encoded, err := json.Marshal(event)
	if err != nil {
		return line
	}
	newline := ""
	if bytes.HasSuffix(line, []byte("\n")) {
		newline = "\n"
	}
	return []byte("data: " + string(encoded) + newline)
}

func sanitizeResponsesEvent(event map[string]any, state *responsesCompatState) bool {
	changed := false
	typ := stringAny(event["type"])
	rememberResponseIDFromEvent(typ, event, state)
	if sanitizeResponseObject(event, state) {
		changed = true
	}
	if sanitizeResponseItem(event, state) {
		changed = true
	}
	if sanitizeEventItemID(event, state) {
		changed = true
	}
	if sanitizeEventResponseID(typ, event, state) {
		changed = true
	}
	if ensureOutputTextAnnotations(event) {
		changed = true
	}
	return changed
}

// rememberResponseIDFromEvent 在事件自身携带响应 ID 时先确立会话级响应 ID。
func rememberResponseIDFromEvent(typ string, event map[string]any, state *responsesCompatState) {
	if !responsesEventCarriesResponseID(typ) || state.responseID != "" {
		return
	}
	if id := strings.TrimSpace(stringAny(event["id"])); id != "" {
		state.responseID = id
	}
}

// sanitizeResponseObject 统一 response 子对象中的 id / created_at / object / output / model / error.id。
func sanitizeResponseObject(event map[string]any, state *responsesCompatState) bool {
	resp, ok := event["response"].(map[string]any)
	if !ok {
		return false
	}
	changed := false
	if id := strings.TrimSpace(stringAny(resp["id"])); id != "" {
		if state.responseID == "" {
			state.responseID = id
		} else if id != state.responseID {
			resp["id"] = state.responseID
			changed = true
		}
	} else {
		resp["id"] = state.ensureID()
		changed = true
	}
	if resp["created_at"] == nil {
		_ = state.ensureID()
		resp["created_at"] = state.createdAt
		changed = true
	} else if ts, ok := asInt64(resp["created_at"]); ok && ts > 0 {
		if state.createdAt == 0 {
			state.createdAt = ts
		} else if ts != state.createdAt {
			resp["created_at"] = state.createdAt
			changed = true
		}
	}
	if resp["object"] == nil {
		resp["object"] = "response"
		changed = true
	}
	if resp["output"] == nil {
		resp["output"] = []any{}
		changed = true
	}
	if model := strings.TrimSpace(stringAny(resp["model"])); model != "" {
		state.model = model
	} else {
		// Grok TUI serde requires `model` on response.failed / completed.
		resp["model"] = state.model
		changed = true
	}
	if ensureResponseErrorID(resp, state) {
		changed = true
	}
	event["response"] = resp
	return changed
}

// ensureResponseErrorID 为响应级错误补齐稳定 id，保持跨事件可引用。
func ensureResponseErrorID(resp map[string]any, state *responsesCompatState) bool {
	errObj, ok := resp["error"].(map[string]any)
	if !ok || strings.TrimSpace(stringAny(errObj["id"])) != "" {
		return false
	}
	errObj["id"] = "err_" + strings.TrimPrefix(state.ensureID(), "resp_")
	return true
}

// sanitizeResponseItem 统一 item.id 与 output_index 的对应关系并记录映射。
func sanitizeResponseItem(event map[string]any, state *responsesCompatState) bool {
	item, ok := event["item"].(map[string]any)
	if !ok {
		return false
	}
	itemID := strings.TrimSpace(stringAny(item["id"]))
	outputIndex, hasOutputIndex := asInt64(event["output_index"])
	if hasOutputIndex {
		if remembered := state.itemID(outputIndex); remembered != "" {
			itemID = remembered
		}
	}
	if itemID == "" {
		itemID = state.nextItemID()
	}
	changed := false
	if strings.TrimSpace(stringAny(item["id"])) != itemID {
		item["id"] = itemID
		event["item"] = item
		changed = true
	}
	state.rememberItemID(outputIndex, hasOutputIndex, itemID)
	return changed
}

func sanitizeEventItemID(event map[string]any, state *responsesCompatState) bool {
	if strings.TrimSpace(stringAny(event["item_id"])) != "" || !responsesEventNeedsItemID(stringAny(event["type"])) {
		return false
	}
	outputIndex, ok := asInt64(event["output_index"])
	if !ok {
		return false
	}
	itemID := state.itemID(outputIndex)
	if itemID == "" {
		itemID = state.nextItemID()
		state.rememberItemID(outputIndex, true, itemID)
	}
	event["item_id"] = itemID
	return true
}

// sanitizeEventResponseID 保证携带响应 ID 的事件始终使用同一会话级 ID。
func sanitizeEventResponseID(typ string, event map[string]any, state *responsesCompatState) bool {
	if !responsesEventCarriesResponseID(typ) {
		return false
	}
	id := strings.TrimSpace(stringAny(event["id"]))
	if id == "" {
		event["id"] = state.ensureID()
		return true
	}
	if state.responseID == "" {
		state.responseID = id
		return false
	}
	if id != state.responseID {
		event["id"] = state.responseID
		return true
	}
	return false
}

// Grok CLI serde requires output_text.annotations even when there are no
// citations. Missing the field makes a retry fail with
// "serialization error: missing field `annotations`".
func ensureOutputTextAnnotations(node any) bool {
	changed := false
	switch typed := node.(type) {
	case map[string]any:
		if stringAny(typed["type"]) == "output_text" && typed["annotations"] == nil {
			typed["annotations"] = []any{}
			changed = true
		}
		for _, key := range []string{"item", "part", "response", "content", "output", "delta"} {
			if ensureOutputTextAnnotations(typed[key]) {
				changed = true
			}
		}
	case []any:
		for _, child := range typed {
			if ensureOutputTextAnnotations(child) {
				changed = true
			}
		}
	}
	return changed
}

func responsesEventCarriesResponseID(eventType string) bool {
	switch eventType {
	case "response.created", "response.in_progress", "response.completed", "response.incomplete", "response.failed":
		return true
	default:
		return false
	}
}

func (s *responsesCompatState) nextItemID() string {
	if s.usedItemIDs == nil {
		s.usedItemIDs = make(map[string]struct{})
	}
	for {
		s.itemSeq++
		candidate := fmt.Sprintf("item_%d", s.itemSeq)
		if _, exists := s.usedItemIDs[candidate]; exists {
			continue
		}
		s.usedItemIDs[candidate] = struct{}{}
		return candidate
	}
}

func (s *responsesCompatState) rememberItemID(outputIndex int64, hasOutputIndex bool, itemID string) {
	if itemID == "" {
		return
	}
	if s.usedItemIDs == nil {
		s.usedItemIDs = make(map[string]struct{})
	}
	s.usedItemIDs[itemID] = struct{}{}
	if !hasOutputIndex {
		return
	}
	if s.itemIDs == nil {
		s.itemIDs = make(map[int64]string)
	}
	if _, exists := s.itemIDs[outputIndex]; !exists {
		s.itemIDs[outputIndex] = itemID
	}
}

func (s *responsesCompatState) itemID(outputIndex int64) string {
	if s == nil || s.itemIDs == nil {
		return ""
	}
	return s.itemIDs[outputIndex]
}

func responsesEventNeedsItemID(eventType string) bool {
	switch eventType {
	case "response.output_text.delta", "response.output_text.done",
		"response.reasoning_text.delta", "response.reasoning_text.done",
		"response.reasoning_summary_text.delta", "response.reasoning_summary_text.done",
		"response.refusal.delta", "response.refusal.done",
		"response.function_call_arguments.delta", "response.function_call_arguments.done",
		"response.custom_tool_call_input.delta", "response.custom_tool_call_input.done":
		return true
	default:
		return false
	}
}

func stringAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}

func asInt64(value any) (int64, bool) {
	switch typed := value.(type) {
	case float64:
		return int64(typed), true
	case int64:
		return typed, true
	case json.Number:
		n, err := typed.Int64()
		return n, err == nil
	default:
		return 0, false
	}
}
