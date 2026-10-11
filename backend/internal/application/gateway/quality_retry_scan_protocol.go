package gateway

import (
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"
)

// qualityChatEvent 是 Chat Completions 流中用于质量观测的事件负载。
type qualityChatEvent struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Delta struct {
			Content          string `json:"content"`
			Reasoning        string `json:"reasoning"`
			ReasoningContent string `json:"reasoning_content"`
			ThinkingContent  string `json:"thinking_content"`
			ToolCalls        []any  `json:"tool_calls"`
			FunctionCall     any    `json:"function_call"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens            int64 `json:"prompt_tokens"`
		CompletionTokens        int64 `json:"completion_tokens"`
		TotalTokens             int64 `json:"total_tokens"`
		CompletionTokensDetails struct {
			ReasoningTokens int64 `json:"reasoning_tokens"`
		} `json:"completion_tokens_details"`
	} `json:"usage"`
}

func observeQualityChat(state *qualityScanState, payload []byte) {
	var event qualityChatEvent
	if json.Unmarshal(payload, &event) != nil {
		return
	}
	if state.responseID == "" {
		state.responseID = event.ID
	}
	if event.Usage != nil {
		state.usage.Reported = true
		state.usage.InputTokens = event.Usage.PromptTokens
		state.usage.OutputTokens = event.Usage.CompletionTokens
		state.usage.ReasoningTokens = event.Usage.CompletionTokensDetails.ReasoningTokens
		state.usage.TotalTokens = event.Usage.TotalTokens
		state.usage.ResponseModel = event.Model
		state.outputTokens = event.Usage.CompletionTokens
		state.reasoningTokens = event.Usage.CompletionTokensDetails.ReasoningTokens
	}
	for _, choice := range event.Choices {
		delta := choice.Delta
		if strings.TrimSpace(delta.Reasoning) != "" || strings.TrimSpace(delta.ReasoningContent) != "" || strings.TrimSpace(delta.ThinkingContent) != "" {
			state.hasThinking = true
		}
		if delta.Content != "" {
			noteVisibleContent(state, delta.Content)
		}
		if len(delta.ToolCalls) > 0 || delta.FunctionCall != nil {
			state.semanticOutput = true
		}
		if choice.FinishReason != "" {
			state.terminal = true
		}
	}
}

type qualityResponsesOutputItem struct {
	ID               string `json:"id"`
	Type             string `json:"type"`
	EncryptedContent string `json:"encrypted_content"`
	Content          []struct {
		Type    string `json:"type"`
		Text    string `json:"text"`
		Refusal string `json:"refusal"`
	} `json:"content"`
}

func noteEncryptedBytes(state *qualityScanState, blob string) {
	if n := len(strings.TrimSpace(blob)); n > state.encryptedBytes {
		state.encryptedBytes = n
	}
}

func noteResponsesReasoningItem(state *qualityScanState, item qualityResponsesOutputItem) {
	if !strings.EqualFold(strings.TrimSpace(item.Type), "reasoning") {
		return
	}
	if strings.TrimSpace(item.ID) != "" {
		state.reasoningStarted = true
	}
	noteEncryptedBytes(state, item.EncryptedContent)
}

// qualityResponsesEvent 是 Responses 流中用于质量观测的事件负载。
type qualityResponsesEvent struct {
	Type     string                     `json:"type"`
	Delta    string                     `json:"delta"`
	Item     qualityResponsesOutputItem `json:"item"`
	Response *struct {
		ID     string                       `json:"id"`
		Model  string                       `json:"model"`
		Output []qualityResponsesOutputItem `json:"output"`
		Usage  *struct {
			OutputTokens        int64 `json:"output_tokens"`
			InputTokens         int64 `json:"input_tokens"`
			TotalTokens         int64 `json:"total_tokens"`
			OutputTokensDetails struct {
				ReasoningTokens int64 `json:"reasoning_tokens"`
			} `json:"output_tokens_details"`
		} `json:"usage"`
	} `json:"response"`
}

func observeQualityResponses(state *qualityScanState, payload []byte) {
	var event qualityResponsesEvent
	if json.Unmarshal(payload, &event) != nil {
		return
	}
	switch event.Type {
	case "response.completed", "response.incomplete", "response.failed":
		state.terminal = true
	case "response.reasoning_text.delta", "response.reasoning_summary_text.delta":
		if strings.TrimSpace(event.Delta) != "" {
			state.hasThinking = true
		}
	case "response.output_item.added", "response.output_item.done":
		noteResponsesReasoningItem(state, event.Item)
		state.aggregateRunes = max(state.aggregateRunes, observeQualityResponsesOutputItem(state, event.Item))
	case "response.output_text.delta":
		if event.Delta != "" {
			noteVisibleContent(state, event.Delta)
		}
	case "response.function_call_arguments.delta", "response.custom_tool_call_input.delta", "response.mcp_call_arguments.delta":
		if event.Delta != "" {
			state.semanticOutput = true
		}
	}
	if event.Response != nil {
		if state.responseID == "" {
			state.responseID = event.Response.ID
		}
		for _, item := range event.Response.Output {
			noteResponsesReasoningItem(state, item)
		}
		if event.Response.Usage != nil {
			state.usage.Reported = true
			state.usage.InputTokens = event.Response.Usage.InputTokens
			state.usage.OutputTokens = event.Response.Usage.OutputTokens
			state.usage.ReasoningTokens = event.Response.Usage.OutputTokensDetails.ReasoningTokens
			state.usage.TotalTokens = event.Response.Usage.TotalTokens
			state.usage.ResponseModel = event.Response.Model
			state.outputTokens = event.Response.Usage.OutputTokens
			state.reasoningTokens = event.Response.Usage.OutputTokensDetails.ReasoningTokens
		}
		aggregateRunes := 0
		for _, item := range event.Response.Output {
			aggregateRunes += observeQualityResponsesOutputItem(state, item)
		}
		state.aggregateRunes = max(state.aggregateRunes, aggregateRunes)
	}
}

func observeQualityResponsesOutputItem(state *qualityScanState, item qualityResponsesOutputItem) int {
	if state == nil {
		return 0
	}
	visibleRunes := 0
	switch item.Type {
	case "", "reasoning":
		return 0
	case "message":
		for _, content := range item.Content {
			text := content.Text
			if text == "" {
				text = content.Refusal
			}
			if text != "" {
				visibleRunes += utf8.RuneCountInString(text)
				state.semanticOutput = true
				continue
			}
			if content.Type != "" && content.Type != "output_text" && content.Type != "refusal" {
				state.semanticOutput = true
			}
		}
	default:
		// Function, shell, MCP and other call items are meaningful output even
		// when the provider omits usage and argument-delta events.
		state.semanticOutput = true
	}
	return visibleRunes
}

// qualityAnthropicEvent 是 Anthropic Messages 流中用于质量观测的事件负载。
type qualityAnthropicEvent struct {
	Type         string `json:"type"`
	ContentBlock struct {
		Type string `json:"type"`
		Text string `json:"text"`
		Data string `json:"data"`
	} `json:"content_block"`
	Delta struct {
		Type        string `json:"type"`
		Text        string `json:"text"`
		Thinking    string `json:"thinking"`
		PartialJSON string `json:"partial_json"`
		Signature   string `json:"signature"`
	} `json:"delta"`
	Usage *struct {
		OutputTokens        int64 `json:"output_tokens"`
		OutputTokensDetails struct {
			ThinkingTokens int64 `json:"thinking_tokens"`
		} `json:"output_tokens_details"`
	} `json:"usage"`
}

func observeQualityAnthropic(state *qualityScanState, payload []byte) {
	var event qualityAnthropicEvent
	if json.Unmarshal(payload, &event) != nil {
		return
	}
	switch event.Type {
	case "message_stop":
		state.terminal = true
	case "content_block_start":
		switch event.ContentBlock.Type {
		case "thinking":
			state.reasoningStarted = true
		case "redacted_thinking":
			state.reasoningStarted = true
			noteEncryptedBytes(state, event.ContentBlock.Data)
		case "text":
			if event.ContentBlock.Text != "" {
				noteVisibleContent(state, event.ContentBlock.Text)
				state.semanticOutput = true
			}
		case "":
		default:
			state.semanticOutput = true
		}
	case "content_block_delta":
		if event.Delta.Type == "thinking_delta" && strings.TrimSpace(event.Delta.Thinking) != "" {
			state.hasThinking = true
		}
		if event.Delta.Type == "signature_delta" && strings.TrimSpace(event.Delta.Signature) != "" {
			// Anthropic Messages represents Responses encrypted_content as a
			// signature delta. Length is judged against the ciphertext floor.
			state.reasoningStarted = true
			noteEncryptedBytes(state, event.Delta.Signature)
		}
		if event.Delta.Type == "text_delta" && event.Delta.Text != "" {
			noteVisibleContent(state, event.Delta.Text)
		}
		if event.Delta.Type == "input_json_delta" && event.Delta.PartialJSON != "" {
			state.semanticOutput = true
		}
	}
	if event.Usage != nil {
		state.usage.Reported = true
		state.usage.OutputTokens = event.Usage.OutputTokens
		state.usage.ReasoningTokens = event.Usage.OutputTokensDetails.ThinkingTokens
		state.outputTokens = event.Usage.OutputTokens
		state.reasoningTokens = event.Usage.OutputTokensDetails.ThinkingTokens
	}
}

func noteVisibleContent(state *qualityScanState, text string) {
	if text == "" {
		return
	}
	if state.firstVisibleAt.IsZero() {
		state.firstVisibleAt = time.Now()
	}
	state.visibleRunes += utf8.RuneCountInString(text)
}
