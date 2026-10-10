package web

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/infra/provider/conversation"
)

type webStopFilter struct {
	sequences []string
	pending   string
	matched   string
}

func newWebStopFilter(sequences []string) *webStopFilter {
	filtered := make([]string, 0, len(sequences))
	for _, sequence := range sequences {
		if sequence != "" {
			filtered = append(filtered, sequence)
		}
	}
	return &webStopFilter{sequences: filtered}
}

func (f *webStopFilter) Push(delta string) (string, string) {
	if f == nil || len(f.sequences) == 0 {
		return delta, ""
	}
	if f.matched != "" {
		return "", f.matched
	}
	f.pending += delta
	matchAt := -1
	matched := ""
	for _, sequence := range f.sequences {
		if index := strings.Index(f.pending, sequence); index >= 0 && (matchAt < 0 || index < matchAt) {
			matchAt = index
			matched = sequence
		}
	}
	if matchAt >= 0 {
		emit := f.pending[:matchAt]
		f.pending = ""
		f.matched = matched
		return emit, matched
	}
	hold := 0
	for _, sequence := range f.sequences {
		maxPrefix := min(len(sequence)-1, len(f.pending))
		for size := maxPrefix; size > hold; size-- {
			if strings.HasSuffix(f.pending, sequence[:size]) {
				hold = size
				break
			}
		}
	}
	emitAt := len(f.pending) - hold
	emit := f.pending[:emitAt]
	f.pending = f.pending[emitAt:]
	return emit, ""
}

func (f *webStopFilter) Flush() string {
	if f == nil || f.matched != "" {
		return ""
	}
	value := f.pending
	f.pending = ""
	return value
}

func writeStreamStart(writer io.Writer, operation, responseID, model string, inputTokens int64) {
	if operation == "chat" {
		chunk := map[string]any{"id": strings.Replace(responseID, "resp_", "chatcmpl_", 1), "object": "chat.completion.chunk", "created": time.Now().Unix(), "model": model, "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"role": "assistant"}, "finish_reason": nil}}}
		writeSSE(writer, "", chunk)
		return
	}
	if operation == conversation.OperationMessages {
		writeSSE(writer, "message_start", map[string]any{
			"type": "message_start", "message": map[string]any{
				"id": strings.Replace(responseID, "resp_", "msg_", 1), "type": "message", "role": "assistant", "model": model,
				"content": []any{}, "stop_reason": nil, "stop_sequence": nil,
				"usage": map[string]any{"input_tokens": inputTokens, "output_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
			},
		})
		writeSSE(writer, "content_block_start", map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]any{"type": "text", "text": ""}})
		return
	}
	writeSSE(writer, "response.created", map[string]any{"type": "response.created", "response": map[string]any{"id": responseID, "object": "response", "status": "in_progress", "model": model, "output": []any{}}})
}

type webVisibleStreamPhase struct {
	textStarted bool
}

// Allow keeps client-visible output monotonic when Grok Web emits additional
// reasoning after final text has already started. The complete reasoning is
// still retained in parsedChat for non-streaming output and usage accounting.
func (p *webVisibleStreamPhase) Allow(kind, delta string) bool {
	if delta == "" {
		return false
	}
	if kind == "reasoning" {
		return !p.textStarted
	}
	if kind == "text" {
		p.textStarted = true
	}
	return true
}

func writeStreamDelta(writer io.Writer, operation, responseID, model, kind, delta string) error {
	if operation == "chat" {
		field := "content"
		if kind == "reasoning" {
			field = "reasoning_content"
		}
		chunk := map[string]any{"id": strings.Replace(responseID, "resp_", "chatcmpl_", 1), "object": "chat.completion.chunk", "created": time.Now().Unix(), "model": model, "choices": []any{map[string]any{"index": 0, "delta": map[string]any{field: delta}, "finish_reason": nil}}}
		return writeSSE(writer, "", chunk)
	}
	if operation == conversation.OperationMessages {
		if kind == "reasoning" {
			return nil
		}
		return writeSSE(writer, "content_block_delta", map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "text_delta", "text": delta}})
	}
	return errors.New("Responses 流式 delta 必须通过统一 output 状态机发送")
}

func writeStreamToolCalls(writer io.Writer, operation, responseID, model string, calls []parsedToolCall) error {
	if operation == "chat" {
		for index, call := range calls {
			chunk := map[string]any{
				"id": strings.Replace(responseID, "resp_", "chatcmpl_", 1), "object": "chat.completion.chunk",
				"created": time.Now().Unix(), "model": model,
				"choices": []any{map[string]any{"index": 0, "finish_reason": nil, "delta": map[string]any{
					"tool_calls": []any{map[string]any{
						"index": index, "id": call.ID, "type": "function",
						"function": map[string]any{"name": call.Name, "arguments": call.Arguments},
					}},
				}}},
			}
			if err := writeSSE(writer, "", chunk); err != nil {
				return err
			}
		}
		return nil
	}
	if operation == conversation.OperationMessages {
		for index, call := range calls {
			contentIndex := index + 1
			if err := writeSSE(writer, "content_block_start", map[string]any{
				"type": "content_block_start", "index": contentIndex,
				"content_block": map[string]any{"type": "tool_use", "id": call.ID, "name": call.Name, "input": map[string]any{}},
			}); err != nil {
				return err
			}
			if err := writeSSE(writer, "content_block_delta", map[string]any{
				"type": "content_block_delta", "index": contentIndex,
				"delta": map[string]any{"type": "input_json_delta", "partial_json": call.Arguments},
			}); err != nil {
				return err
			}
			if err := writeSSE(writer, "content_block_stop", map[string]any{"type": "content_block_stop", "index": contentIndex}); err != nil {
				return err
			}
		}
		return nil
	}
	return errors.New("Responses 流式 tool call 必须通过统一 output 状态机发送")
}

func writeStreamDone(writer io.Writer, operation, responseID, model string, parsed parsedChat, payload map[string]any) {
	if operation == "chat" {
		finishReason := "stop"
		if len(parsed.ToolCalls) > 0 {
			finishReason = "tool_calls"
		}
		// Progressive annotations were already emitted as deltas. Repeating all of
		// them here makes clients that accumulate deltas display duplicates.
		// Top-level citations + server_side_tool_usage match non-stream chat (xAI).
		chunk := map[string]any{"id": strings.Replace(responseID, "resp_", "chatcmpl_", 1), "object": "chat.completion.chunk", "created": time.Now().Unix(), "model": model, "choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": finishReason}}, "usage": payload["usage"]}
		if citations := payload["citations"]; citations != nil {
			chunk["citations"] = citations
		}
		if toolUsage := payload["server_side_tool_usage"]; toolUsage != nil {
			chunk["server_side_tool_usage"] = toolUsage
		}
		writeSSE(writer, "", chunk)
		_, _ = io.WriteString(writer, "data: [DONE]\n\n")
		return
	}
	if operation == conversation.OperationMessages {
		writeSSE(writer, "content_block_stop", map[string]any{"type": "content_block_stop", "index": 0})
		stopReason := "end_turn"
		if len(parsed.ToolCalls) > 0 {
			stopReason = "tool_use"
		}
		usage, _ := payload["usage"].(map[string]any)
		writeSSE(writer, "message_delta", map[string]any{
			"type": "message_delta", "delta": map[string]any{"stop_reason": stopReason, "stop_sequence": nil},
			"usage": map[string]any{"output_tokens": usage["output_tokens"]},
		})
		writeSSE(writer, "message_stop", map[string]any{"type": "message_stop"})
		return
	}
	writeSSE(writer, "response.completed", map[string]any{"type": "response.completed", "response": payload})
}

// writeStreamAnnotations emits Chat Completions delta.annotations. Responses
// annotations are owned by webResponsesStream so their item coordinates cannot drift.
func writeStreamAnnotations(writer io.Writer, operation, responseID, model string, annotations []map[string]any, _ int) error {
	if len(annotations) == 0 || operation == conversation.OperationMessages {
		return nil
	}
	if operation == "chat" {
		chunk := map[string]any{
			"id": strings.Replace(responseID, "resp_", "chatcmpl_", 1), "object": "chat.completion.chunk",
			"created": time.Now().Unix(), "model": model,
			"choices": []any{map[string]any{
				"index": 0, "delta": map[string]any{"annotations": chatAnnotations(annotations)}, "finish_reason": nil,
			}},
		}
		return writeSSE(writer, "", chunk)
	}
	return nil
}

func writeSSE(writer io.Writer, event string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if event != "" {
		if _, err := fmt.Fprintf(writer, "event: %s\n", event); err != nil {
			return err
		}
	}
	_, err = fmt.Fprintf(writer, "data: %s\n\n", data)
	return err
}
