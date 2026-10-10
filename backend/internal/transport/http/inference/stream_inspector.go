package inference

import (
	"bytes"
	"encoding/json"
	"unicode/utf8"

	"github.com/chenyme/grok2api/backend/internal/application/gateway"
)

type responseInspector struct {
	protocol        streamProtocol
	pending         []byte
	metadata        responseMetadata
	onFirstToken    func()
	firstTokenSeen  bool
	firstTokenReady bool
	terminalSuccess bool
	terminalFailure bool
}

const (
	reasoningStartSSEComment    = ": grok2api-reasoning-start"
	reasoningEvidenceSSEComment = ": grok2api-reasoning-evidence"
)

var internalSSEMarkers = [][]byte{
	[]byte(reasoningStartSSEComment + "\n\n"),
	[]byte(reasoningEvidenceSSEComment + "\n\n"),
}

func (i *responseInspector) Inspect(chunk []byte) {
	i.pending = append(i.pending, chunk...)
	for {
		index := bytes.IndexByte(i.pending, '\n')
		if index < 0 {
			i.discardOversizedPendingLine()
			return
		}
		line := bytes.TrimSpace(i.pending[:index])
		i.pending = i.pending[index+1:]
		if i.protocol == streamProtocolChat && bytes.Equal(line, []byte(reasoningStartSSEComment)) {
			i.observeReasoningStart()
			continue
		}
		if bytes.HasPrefix(line, []byte("data:")) {
			i.inspectDataLine(bytes.TrimSpace(bytes.TrimPrefix(line, []byte("data:"))))
		}
	}
}

// discardOversizedPendingLine bounds the pending buffer when a single SSE data
// line never ends. The line has already been forwarded by copyStream, so an
// oversized data line is counted as observed output conservatively: a later
// idle timeout must not misclassify a non-empty response and apply the long
// empty-stream cooldown.
func (i *responseInspector) discardOversizedPendingLine() {
	if len(i.pending) <= maxStreamEventInspectionBytes {
		return
	}
	if bytes.HasPrefix(bytes.TrimSpace(i.pending), []byte("data:")) {
		i.metadata.Usage.OutputObserved = true
	}
	i.pending = nil
}

// inspectDataLine 处理单条已剥离 "data:" 前缀的 SSE 数据行。
func (i *responseInspector) inspectDataLine(value []byte) {
	if containsGeneratedDelta(value, i.protocol) {
		i.metadata.Usage.OutputObserved = true
	}
	i.observeFirstToken(value)
	i.observeTerminal(value)
	if bytes.Equal(value, []byte("[DONE]")) {
		return
	}
	i.mergeEventMetadata(extractMetadata(value))
}

// mergeEventMetadata 把单条事件的元数据合并进检查器，保持字段级覆盖顺序。
func (i *responseInspector) mergeEventMetadata(metadata responseMetadata) {
	if hasUsageMetadata(metadata.Usage) {
		if metadata.Usage.ResponseModel == "" {
			metadata.Usage.ResponseModel = i.metadata.Model
		}
		i.metadata.Usage = mergeGatewayUsage(i.metadata.Usage, metadata.Usage)
	}
	if metadata.ResponseID != "" {
		i.metadata.ResponseID = metadata.ResponseID
	}
	if metadata.SequenceNumber > i.metadata.SequenceNumber {
		i.metadata.SequenceNumber = metadata.SequenceNumber
	}
	if metadata.Model != "" {
		i.metadata.Model = metadata.Model
		i.metadata.Usage.ResponseModel = metadata.Model
	}
	if metadata.cacheCreationInputTokens > 0 {
		i.metadata.cacheCreationInputTokens = metadata.cacheCreationInputTokens
	}
}

func (i *responseInspector) Metadata() responseMetadata {
	return normalizeMetadataUsage(i.metadata, i.protocol)
}

func (i *responseInspector) observeReasoningStart() {
	if i.firstTokenSeen || i.firstTokenReady || i.onFirstToken == nil {
		return
	}
	i.firstTokenReady = true
}

func (i *responseInspector) observeFirstToken(data []byte) {
	if i.firstTokenSeen || i.firstTokenReady || i.onFirstToken == nil || len(data) == 0 || bytes.Equal(data, []byte("[DONE]")) {
		return
	}
	if !containsGeneratedDelta(data, i.protocol) {
		return
	}
	i.firstTokenReady = true
}

func (i *responseInspector) markFirstTokenForwarded() {
	if i.firstTokenSeen || !i.firstTokenReady || i.onFirstToken == nil {
		return
	}
	i.firstTokenReady = false
	i.firstTokenSeen = true
	i.onFirstToken()
	i.onFirstToken = nil
}

func containsGeneratedDelta(data []byte, protocol streamProtocol) bool {
	switch protocol {
	case streamProtocolResponses:
		return responsesEventHasGeneratedDelta(data)
	case streamProtocolChat:
		return chatEventHasGeneratedDelta(data)
	case streamProtocolAnthropic:
		return anthropicEventHasGeneratedDelta(data)
	}
	return false
}

// responsesEventHasGeneratedDelta 判断 Responses 事件是否已产生可见生成量。
func responsesEventHasGeneratedDelta(data []byte) bool {
	var event struct {
		Type  string `json:"type"`
		Delta string `json:"delta"`
		Item  struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		} `json:"item"`
	}
	if json.Unmarshal(data, &event) != nil {
		return false
	}
	switch event.Type {
	case "response.output_text.delta", "response.reasoning_summary_text.delta", "response.reasoning_text.delta", "response.refusal.delta", "response.function_call_arguments.delta", "response.custom_tool_call_input.delta":
		return event.Delta != ""
	case "response.output_item.added":
		// Native Responses can stream an identified reasoning item with no
		// text delta when only encrypted_content is requested. That item is
		// still generation start; waiting for output_text kicks thinking
		// time out of the TPS denominator.
		return event.Item.Type == "reasoning" && event.Item.ID != ""
	}
	return false
}

// chatEventHasGeneratedDelta 判断 Chat Completions 分片是否已产生可见生成量。
func chatEventHasGeneratedDelta(data []byte) bool {
	var event struct {
		Choices []struct {
			Delta struct {
				Content          string `json:"content"`
				Reasoning        string `json:"reasoning"`
				ReasoningContent string `json:"reasoning_content"`
				ThinkingContent  string `json:"thinking_content"`
				Refusal          string `json:"refusal"`
				ToolCalls        []struct {
					Function struct {
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"delta"`
		} `json:"choices"`
	}
	if json.Unmarshal(data, &event) != nil {
		return false
	}
	for _, choice := range event.Choices {
		if chatDeltaHasGeneratedDelta(choice.Delta) {
			return true
		}
	}
	return false
}

// chatDeltaHasGeneratedDelta 汇总单个 choice 的 delta 可见字段。
func chatDeltaHasGeneratedDelta(delta struct {
	Content          string `json:"content"`
	Reasoning        string `json:"reasoning"`
	ReasoningContent string `json:"reasoning_content"`
	ThinkingContent  string `json:"thinking_content"`
	Refusal          string `json:"refusal"`
	ToolCalls        []struct {
		Function struct {
			Arguments string `json:"arguments"`
		} `json:"function"`
	} `json:"tool_calls"`
}) bool {
	if delta.Content != "" || delta.Reasoning != "" || delta.ReasoningContent != "" || delta.ThinkingContent != "" || delta.Refusal != "" {
		return true
	}
	for _, call := range delta.ToolCalls {
		if call.Function.Arguments != "" {
			return true
		}
	}
	return false
}

// anthropicEventHasGeneratedDelta 判断 Anthropic 事件是否已产生可见生成量。
func anthropicEventHasGeneratedDelta(data []byte) bool {
	var event struct {
		Type         string `json:"type"`
		ContentBlock struct {
			Type string `json:"type"`
		} `json:"content_block"`
		Delta struct {
			Type        string `json:"type"`
			Text        string `json:"text"`
			Thinking    string `json:"thinking"`
			PartialJSON string `json:"partial_json"`
		} `json:"delta"`
	}
	if json.Unmarshal(data, &event) != nil {
		return false
	}
	if event.Type == "content_block_start" {
		return event.ContentBlock.Type == "thinking"
	}
	if event.Type != "content_block_delta" {
		return false
	}
	switch event.Delta.Type {
	case "text_delta":
		return event.Delta.Text != ""
	case "thinking_delta":
		return event.Delta.Thinking != ""
	case "input_json_delta":
		return event.Delta.PartialJSON != ""
	}
	return false
}

func (i *responseInspector) TerminalError() error {
	if i.terminalFailure {
		return errUpstreamStreamFailed
	}
	if !i.terminalSuccess {
		return errUpstreamStreamIncomplete
	}
	return nil
}

func (i *responseInspector) observeTerminal(data []byte) {
	if bytes.Equal(data, []byte("[DONE]")) {
		if i.protocol == streamProtocolChat {
			i.terminalSuccess = true
		}
		return
	}
	var payload struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(data, &payload) != nil {
		return
	}
	switch i.protocol {
	case streamProtocolResponses:
		switch payload.Type {
		case "response.completed":
			i.terminalSuccess = true
		case "response.failed", "response.incomplete", "response.error", "error":
			i.markTerminalFailure(data)
		}
	case streamProtocolChat:
		if payload.Type == "error" {
			i.markTerminalFailure(data)
		}
	case streamProtocolAnthropic:
		switch payload.Type {
		case "message_stop":
			i.terminalSuccess = true
		case "error":
			i.markTerminalFailure(data)
		}
	case streamProtocolImage:
		switch payload.Type {
		case "image_generation.completed":
			i.terminalSuccess = true
		case "image_generation.failed", "error":
			i.markTerminalFailure(data)
		}
	}
}

func (i *responseInspector) markTerminalFailure(data []byte) {
	i.terminalFailure = true
	if i.metadata.StreamFailure != nil {
		return
	}
	diagnostic := projectStreamFailureDiagnostic(data)
	if len(diagnostic.Body) > 0 {
		i.metadata.StreamFailure = &diagnostic
	}
}

func projectStreamFailureDiagnostic(data []byte) gateway.StreamFailureDiagnostic {
	var root map[string]json.RawMessage
	if json.Unmarshal(data, &root) != nil {
		return gateway.StreamFailureDiagnostic{}
	}
	projected := make(map[string]json.RawMessage)
	copySafeDiagnosticFields(projected, root, "type", "status", "code", "message", "param")
	if raw := projectSafeErrorValue(root["error"]); len(raw) > 0 {
		projected["error"] = raw
	}
	if responseRaw := root["response"]; len(responseRaw) > 0 {
		var response map[string]json.RawMessage
		if json.Unmarshal(responseRaw, &response) == nil {
			safeResponse := make(map[string]json.RawMessage)
			copySafeDiagnosticFields(safeResponse, response, "id", "status", "code", "message")
			if raw := projectSafeErrorValue(response["error"]); len(raw) > 0 {
				safeResponse["error"] = raw
			}
			if raw := projectSafeErrorValue(response["incomplete_details"]); len(raw) > 0 {
				safeResponse["incomplete_details"] = raw
			}
			if len(safeResponse) > 0 {
				if encoded, err := json.Marshal(safeResponse); err == nil {
					projected["response"] = encoded
				}
			}
		}
	}
	if len(projected) == 0 {
		return gateway.StreamFailureDiagnostic{}
	}
	encoded, err := json.Marshal(projected)
	if err != nil {
		return gateway.StreamFailureDiagnostic{}
	}
	diagnostic := gateway.StreamFailureDiagnostic{Body: encoded}
	if len(diagnostic.Body) > maxStreamFailureDiagnosticBytes {
		bounded := diagnostic.Body[:maxStreamFailureDiagnosticBytes]
		for len(bounded) > 0 && !utf8.Valid(bounded) {
			bounded = bounded[:len(bounded)-1]
		}
		diagnostic.Body = append([]byte(nil), bounded...)
		diagnostic.BodyTruncated = true
	} else {
		diagnostic.Body = append([]byte(nil), diagnostic.Body...)
	}
	return diagnostic
}

func copySafeDiagnosticFields(destination, source map[string]json.RawMessage, fields ...string) {
	for _, field := range fields {
		if raw := projectSafeScalar(source[field]); len(raw) > 0 {
			destination[field] = raw
		}
	}
}

func projectSafeErrorValue(raw json.RawMessage) json.RawMessage {
	if scalar := projectSafeScalar(raw); len(scalar) > 0 {
		return scalar
	}
	var value map[string]json.RawMessage
	if json.Unmarshal(raw, &value) != nil {
		return nil
	}
	projected := make(map[string]json.RawMessage)
	copySafeDiagnosticFields(projected, value, "type", "status", "code", "message", "param", "reason")
	if len(projected) == 0 {
		return nil
	}
	encoded, err := json.Marshal(projected)
	if err != nil {
		return nil
	}
	return encoded
}

func projectSafeScalar(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return nil
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return nil
	}
	switch value.(type) {
	case nil, string, bool, float64:
		return append(json.RawMessage(nil), raw...)
	default:
		return nil
	}
}

func (i *responseInspector) Finish() {
	if len(i.pending) == 0 {
		return
	}
	i.pending = append(i.pending, '\n')
	i.Inspect(nil)
}
