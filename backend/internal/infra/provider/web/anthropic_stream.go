package web

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/infra/provider/conversation"
)

type webMessagesStream struct {
	writer          io.Writer
	responseID      string
	model           string
	inputTokens     int64
	options         conversation.ResponseOptions
	started         bool
	thinkingStarted bool
	thinkingClosed  bool
	thinkingIndex   int
	textStarted     bool
	textClosed      bool
	textIndex       int
	nextIndex       int
	hasTools        bool
	webSearchID     string
	webSearchUse    bool
	pendingText     strings.Builder
	stopSequence    string
	stopFilter      *webStopFilter
}

func newWebMessagesStream(writer io.Writer, responseID, model string, inputTokens int64, options conversation.ResponseOptions) *webMessagesStream {
	return &webMessagesStream{
		writer: writer, responseID: responseID, model: model, inputTokens: inputTokens,
		options: options, stopFilter: newWebStopFilter(options.StopSequences),
	}
}

func (s *webMessagesStream) Start() error {
	if s.started {
		return nil
	}
	s.started = true
	if err := writeSSE(s.writer, "message_start", map[string]any{
		"type": "message_start", "message": map[string]any{
			"id": strings.Replace(s.responseID, "resp_", "msg_", 1), "type": "message", "role": "assistant", "model": s.model,
			"content": []any{}, "stop_reason": nil, "stop_sequence": nil,
			"usage": map[string]any{"input_tokens": s.inputTokens, "output_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
		},
	}); err != nil {
		return err
	}
	if s.options.AnthropicWebSearchRequired && !s.options.AnthropicThinking {
		return s.startWebSearch()
	}
	return nil
}

// writeAnthropicThinkingDelta 首次收到推理增量时开启 thinking 块，随后写入 thinking_delta。
func (s *webMessagesStream) writeAnthropicThinkingDelta(delta string) error {
	if !s.options.AnthropicThinking {
		return nil
	}
	if !s.thinkingStarted {
		s.thinkingStarted = true
		s.thinkingIndex = s.nextIndex
		s.nextIndex++
		if err := writeSSE(s.writer, "content_block_start", map[string]any{
			"type": "content_block_start", "index": s.thinkingIndex,
			"content_block": map[string]any{"type": "thinking", "thinking": ""},
		}); err != nil {
			return err
		}
	}
	return writeSSE(s.writer, "content_block_delta", map[string]any{
		"type": "content_block_delta", "index": s.thinkingIndex,
		"delta": map[string]any{"type": "thinking_delta", "thinking": delta},
	})
}

// writeAnthropicTextDelta 处理可见文本增量：托管搜索先缓冲，否则按停用序列过滤后输出。
func (s *webMessagesStream) writeAnthropicTextDelta(delta string) error {
	if s.options.AnthropicWebSearch {
		if err := s.closeThinking(); err != nil {
			return err
		}
		if s.options.AnthropicWebSearchRequired {
			if err := s.startWebSearch(); err != nil {
				return err
			}
		}
		return s.bufferSearchText(delta)
	}
	if err := s.startText(); err != nil {
		return err
	}
	emit, matched := s.stopFilter.Push(delta)
	if matched != "" {
		s.stopSequence = matched
	}
	if emit == "" {
		return nil
	}
	return s.writeTextDelta(emit)
}

func (s *webMessagesStream) Delta(kind, delta string) error {
	if err := s.Start(); err != nil {
		return err
	}
	if s.stopSequence != "" {
		return nil
	}
	if kind == "reasoning" {
		return s.writeAnthropicThinkingDelta(delta)
	}
	if kind != "text" {
		return nil
	}
	return s.writeAnthropicTextDelta(delta)
}

func (s *webMessagesStream) bufferSearchText(delta string) error {
	pending := s.pendingText.Len()
	if pending >= maxDeferredSearchTextBytes || len(delta) > maxDeferredSearchTextBytes-pending {
		return fmt.Errorf("WebSearch 延迟文本缓冲超过 %d MiB", maxDeferredSearchTextBytes>>20)
	}
	s.pendingText.WriteString(delta)
	return nil
}

func (s *webMessagesStream) startText() error {
	if s.textStarted && !s.textClosed {
		return nil
	}
	if err := s.closeThinking(); err != nil {
		return err
	}
	s.textStarted = true
	s.textClosed = false
	s.textIndex = s.nextIndex
	s.nextIndex++
	return writeSSE(s.writer, "content_block_start", map[string]any{
		"type": "content_block_start", "index": s.textIndex,
		"content_block": map[string]any{"type": "text", "text": ""},
	})
}

func (s *webMessagesStream) writeTextDelta(delta string) error {
	if delta == "" {
		return nil
	}
	return writeSSE(s.writer, "content_block_delta", map[string]any{
		"type": "content_block_delta", "index": s.textIndex,
		"delta": map[string]any{"type": "text_delta", "text": delta},
	})
}

func (s *webMessagesStream) Tools(calls []parsedToolCall) error {
	if err := s.Start(); err != nil {
		return err
	}
	if err := s.closeThinking(); err != nil {
		return err
	}
	if err := s.closeText(); err != nil {
		return err
	}
	for _, call := range calls {
		index := s.nextIndex
		s.nextIndex++
		id := webAnthropicToolID(call.ID)
		if err := writeSSE(s.writer, "content_block_start", map[string]any{
			"type": "content_block_start", "index": index,
			"content_block": map[string]any{"type": "tool_use", "id": id, "name": call.Name, "input": map[string]any{}},
		}); err != nil {
			return err
		}
		if err := writeSSE(s.writer, "content_block_delta", map[string]any{
			"type": "content_block_delta", "index": index,
			"delta": map[string]any{"type": "input_json_delta", "partial_json": call.Arguments},
		}); err != nil {
			return err
		}
		if err := writeSSE(s.writer, "content_block_stop", map[string]any{"type": "content_block_stop", "index": index}); err != nil {
			return err
		}
		s.hasTools = true
	}
	return nil
}

func (s *webMessagesStream) startWebSearch() error {
	if s.webSearchUse {
		return nil
	}
	s.webSearchUse = true
	if s.webSearchID == "" {
		s.webSearchID = newWebID("srvtoolu")
	}
	index := s.nextIndex
	s.nextIndex++
	if err := writeSSE(s.writer, "content_block_start", map[string]any{
		"type": "content_block_start", "index": index,
		"content_block": map[string]any{"type": "server_tool_use", "id": s.webSearchID, "name": "web_search", "input": map[string]any{}},
	}); err != nil {
		return err
	}
	if query := s.options.AnthropicWebSearchQuery; query != "" {
		encoded, _ := json.Marshal(map[string]string{"query": query})
		if err := writeSSE(s.writer, "content_block_delta", map[string]any{
			"type": "content_block_delta", "index": index,
			"delta": map[string]any{"type": "input_json_delta", "partial_json": string(encoded)},
		}); err != nil {
			return err
		}
	}
	return writeSSE(s.writer, "content_block_stop", map[string]any{"type": "content_block_stop", "index": index})
}

func (s *webMessagesStream) finishWebSearch(parsed parsedChat) error {
	if !shouldEmitWebMessagesSearch(parsed, s.options) {
		return nil
	}
	if err := s.startWebSearch(); err != nil {
		return err
	}
	blocks := webMessagesSearchBlocks(s.webSearchID, parsed, s.options)
	result := blocks[1]
	index := s.nextIndex
	s.nextIndex++
	if err := writeSSE(s.writer, "content_block_start", map[string]any{
		"type": "content_block_start", "index": index, "content_block": result,
	}); err != nil {
		return err
	}
	return writeSSE(s.writer, "content_block_stop", map[string]any{"type": "content_block_stop", "index": index})
}

// flushPendingAnthropicText 在收尾时输出缓冲文本：托管搜索先经停用序列过滤，再冲刷残留。
func (s *webMessagesStream) flushPendingAnthropicText() error {
	if s.options.AnthropicWebSearch && s.pendingText.Len() > 0 {
		if err := s.startText(); err != nil {
			return err
		}
		emit, matched := s.stopFilter.Push(s.pendingText.String())
		if matched != "" {
			s.stopSequence = matched
		}
		if err := s.writeTextDelta(emit); err != nil {
			return err
		}
	}
	if s.stopSequence != "" {
		return nil
	}
	if pending := s.stopFilter.Flush(); pending != "" {
		if err := s.startText(); err != nil {
			return err
		}
		return s.writeTextDelta(pending)
	}
	return nil
}

// anthropicStopReason 依据工具调用与停用序列得出 message_delta 的 stop_reason。
func (s *webMessagesStream) anthropicStopReason(parsed parsedChat) string {
	if s.hasTools || len(parsed.ToolCalls) > 0 {
		return "tool_use"
	}
	if s.stopSequence != "" {
		return "stop_sequence"
	}
	return "end_turn"
}

func (s *webMessagesStream) Finish(parsed parsedChat, payload map[string]any) error {
	if err := s.Start(); err != nil {
		return err
	}
	if err := s.closeThinking(); err != nil {
		return err
	}
	if err := s.finishWebSearch(parsed); err != nil {
		return err
	}
	if err := s.flushPendingAnthropicText(); err != nil {
		return err
	}
	if err := s.closeText(); err != nil {
		return err
	}
	usage, _ := payload["usage"].(map[string]any)
	finalUsage := map[string]any{"output_tokens": usage["output_tokens"]}
	if shouldEmitWebMessagesSearch(parsed, s.options) {
		finalUsage["server_tool_use"] = map[string]any{"web_search_requests": webMessagesSearchRequests(parsed)}
	}
	if err := writeSSE(s.writer, "message_delta", map[string]any{
		"type": "message_delta", "delta": map[string]any{"stop_reason": s.anthropicStopReason(parsed), "stop_sequence": nullableWebString(s.stopSequence)},
		"usage": finalUsage,
	}); err != nil {
		return err
	}
	return writeSSE(s.writer, "message_stop", map[string]any{"type": "message_stop"})
}

func (s *webMessagesStream) closeThinking() error {
	if !s.thinkingStarted || s.thinkingClosed {
		return nil
	}
	s.thinkingClosed = true
	return writeSSE(s.writer, "content_block_stop", map[string]any{"type": "content_block_stop", "index": s.thinkingIndex})
}

func (s *webMessagesStream) closeText() error {
	if !s.textStarted || s.textClosed {
		return nil
	}
	s.textClosed = true
	return writeSSE(s.writer, "content_block_stop", map[string]any{"type": "content_block_stop", "index": s.textIndex})
}

func writeWebStreamDelta(writer io.Writer, stream *webMessagesStream, operation, responseID, model, kind, delta string) error {
	if operation == conversation.OperationMessages {
		return stream.Delta(kind, delta)
	}
	return writeStreamDelta(writer, operation, responseID, model, kind, delta)
}

func writeWebStreamToolCalls(writer io.Writer, stream *webMessagesStream, operation, responseID, model string, calls []parsedToolCall) error {
	if operation == conversation.OperationMessages {
		return stream.Tools(calls)
	}
	return writeStreamToolCalls(writer, operation, responseID, model, calls)
}
