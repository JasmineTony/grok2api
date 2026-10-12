package web

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/chenyme/grok2api/backend/internal/infra/provider/searchresult"
)

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
