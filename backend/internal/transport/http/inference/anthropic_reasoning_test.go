package inference

import (
	"testing"
)

// Anthropic Messages reports thinking tokens inside a thinking content block and does not
// send output_tokens_details.reasoning_tokens or completion_tokens_details, so reasoning
// must be recovered from the thinking block rather than from an OpenAI-shaped details field.
func TestAnthropicMessagesUsageCarriesReasoningTokens(t *testing.T) {
	payload := []byte(`{
	  "id": "msg_01",
	  "type": "message",
	  "model": "grok-4.20",
	  "content": [
	    {"type": "thinking", "thinking": "step one then step two", "signature": "sig"},
	    {"type": "text", "text": "done"}
	  ],
	  "usage": {"input_tokens": 42, "output_tokens": 130, "cache_read_input_tokens": 8}
	}`)

	metadata := extractMetadata(payload)
	normalized := normalizeMetadataUsage(metadata, streamProtocolAnthropic)

	if normalized.Usage.OutputTokens != 130 {
		t.Fatalf("output tokens = %d, want 130", normalized.Usage.OutputTokens)
	}
	if normalized.Usage.ReasoningTokens <= 0 {
		t.Fatalf("reasoning tokens = %d, want > 0 for a response with a thinking block", normalized.Usage.ReasoningTokens)
	}
	if normalized.Usage.ReasoningTokens > normalized.Usage.OutputTokens {
		t.Fatalf("reasoning tokens = %d, must not exceed output tokens %d", normalized.Usage.ReasoningTokens, normalized.Usage.OutputTokens)
	}
}

// A Messages response without a thinking block must stay at zero rather than inventing
// reasoning tokens from the text output.
func TestAnthropicMessagesUsageWithoutThinkingReportsNoReasoning(t *testing.T) {
	payload := []byte(`{
	  "id": "msg_02",
	  "model": "grok-4.20",
	  "content": [{"type": "text", "text": "plain answer"}],
	  "usage": {"input_tokens": 10, "output_tokens": 20}
	}`)

	normalized := normalizeMetadataUsage(extractMetadata(payload), streamProtocolAnthropic)
	if normalized.Usage.ReasoningTokens != 0 {
		t.Fatalf("reasoning tokens = %d, want 0", normalized.Usage.ReasoningTokens)
	}
}

// Streaming Messages requests deliver thinking through thinking_delta frames, so the
// accumulated text must produce the same reasoning estimate as the non-streaming path.
func TestAnthropicStreamAccumulatesThinkingDeltas(t *testing.T) {
	inspector := &responseInspector{protocol: streamProtocolAnthropic}
	frames := []string{
		`{"type":"message_start","message":{"id":"msg_04","model":"grok-4.20","usage":{"input_tokens":12,"output_tokens":0}}}`,
		`{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"weighing the options "}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"and settling on one"}}`,
		`{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"answer"}}`,
		`{"type":"message_delta","delta":{},"usage":{"output_tokens":64}}`,
		`{"type":"message_stop"}`,
	}
	for _, frame := range frames {
		inspector.Inspect([]byte("data: " + frame + "\n"))
	}

	usage := inspector.Metadata().Usage
	if usage.OutputTokens != 64 {
		t.Fatalf("output tokens = %d, want 64", usage.OutputTokens)
	}
	if usage.ReasoningTokens <= 0 {
		t.Fatalf("reasoning tokens = %d, want > 0 from the streamed thinking deltas", usage.ReasoningTokens)
	}
	if usage.ReasoningTokens > usage.OutputTokens {
		t.Fatalf("reasoning tokens = %d, must not exceed output tokens %d", usage.ReasoningTokens, usage.OutputTokens)
	}
}

// Text-only streams must not report reasoning tokens.
func TestAnthropicStreamWithoutThinkingReportsNoReasoning(t *testing.T) {
	inspector := &responseInspector{protocol: streamProtocolAnthropic}
	for _, frame := range []string{
		`{"type":"message_start","message":{"id":"msg_05","model":"grok-4.20","usage":{"input_tokens":5}}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}`,
		`{"type":"message_delta","delta":{},"usage":{"output_tokens":9}}`,
	} {
		inspector.Inspect([]byte("data: " + frame + "\n"))
	}

	if usage := inspector.Metadata().Usage; usage.ReasoningTokens != 0 {
		t.Fatalf("reasoning tokens = %d, want 0", usage.ReasoningTokens)
	}
}

// An explicit reasoning field from the upstream must win over any local estimate.
func TestAnthropicMessagesUsagePrefersReportedReasoning(t *testing.T) {
	payload := []byte(`{
	  "id": "msg_03",
	  "model": "grok-4.20",
	  "content": [{"type": "thinking", "thinking": "a b c d e f g h"}],
	  "usage": {"input_tokens": 10, "output_tokens": 90, "output_tokens_details": {"reasoning_tokens": 77}}
	}`)

	normalized := normalizeMetadataUsage(extractMetadata(payload), streamProtocolAnthropic)
	if normalized.Usage.ReasoningTokens != 77 {
		t.Fatalf("reasoning tokens = %d, want the upstream-reported 77", normalized.Usage.ReasoningTokens)
	}
}
