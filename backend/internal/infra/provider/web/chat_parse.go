package web

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

func consumeUpstream(source io.Reader, emit func(string, string) error) (parsedChat, error) {
	return consumeUpstreamWithCitations(source, emit, true)
}

func consumeUpstreamWithCitations(source io.Reader, emit func(string, string) error, inlineCitations bool) (parsedChat, error) {
	parsed := parsedChat{DisableInlineCitations: !inlineCitations}
	err := consumeUpstreamInto(source, &parsed, emit)
	return parsed, err
}

func consumeUpstreamInto(source io.Reader, parsed *parsedChat, emit func(string, string) error) error {
	return consumeJSONObjects(source, 8<<20, func(data []byte) error {
		kind, delta, err := parseUpstreamFrame(data, parsed)
		if err != nil {
			return err
		}
		if emit == nil {
			return nil
		}
		// Always invoke emit so streaming can flush tool/citation side-channels
		// even when the frame produced no visible text delta.
		return emit(kind, delta)
	})
}

// jsonFrameScanner 跟踪 JSON 对象帧的深度与字符串转义状态。
type jsonFrameScanner struct {
	frame    []byte
	depth    int
	inString bool
	escaped  bool
}

// scan 消费一个字节；complete 为 true 时返回值是完整对象帧内容。
func (s *jsonFrameScanner) scan(value byte) ([]byte, bool) {
	if s.depth == 0 {
		if value != '{' {
			return nil, false
		}
		s.frame = s.frame[:0]
		s.depth = 1
		s.inString = false
		s.escaped = false
		s.frame = append(s.frame, value)
		return nil, false
	}
	s.frame = append(s.frame, value)
	if s.inString {
		if s.escaped {
			s.escaped = false
		} else if value == '\\' {
			s.escaped = true
		} else if value == '"' {
			s.inString = false
		}
		return nil, false
	}
	switch value {
	case '"':
		s.inString = true
	case '{':
		s.depth++
	case '}':
		s.depth--
		if s.depth == 0 {
			return s.frame, true
		}
	}
	return nil, false
}

func consumeJSONObjects(source io.Reader, maxObjectBytes int, consume func([]byte) error) error {
	reader := bufio.NewReaderSize(source, 64<<10)
	scanner := &jsonFrameScanner{frame: make([]byte, 0, 64<<10)}
	for {
		value, err := reader.ReadByte()
		if err != nil {
			if errors.Is(err, io.EOF) {
				if scanner.depth != 0 {
					return io.ErrUnexpectedEOF
				}
				return nil
			}
			return err
		}
		frame, complete := scanner.scan(value)
		if len(scanner.frame) > maxObjectBytes {
			return fmt.Errorf("Grok Web 单个响应帧超过 %d MiB", maxObjectBytes>>20)
		}
		if !complete {
			continue
		}
		if err := consume(frame); err != nil {
			return err
		}
	}
}

// collectCardAttachmentImage 处理 cardAttachment/cardAttachments 图片事件。
func collectCardAttachmentImage(parsed *parsedChat, response map[string]any) (string, string, bool) {
	for _, key := range []string{"cardAttachment", "cardAttachments"} {
		if rawURL := collectCardAttachment(parsed, response[key]); rawURL != "" {
			rawURL = absoluteAssetURL(rawURL)
			parsed.Images = appendUniqueString(parsed.Images, rawURL)
			return "image", rawURL, true
		}
	}
	return "", "", false
}

// parseChatResponseToken 记录父响应 ID 与搜索来源，并按 messageTag 分类 token。
// handled 为 true 表示该响应已由本函数产出结果。
func parseChatResponseToken(parsed *parsedChat, response map[string]any) (string, string, bool, error) {
	if userResponse, _ := response["userResponse"].(map[string]any); userResponse != nil {
		if id, _ := userResponse["responseId"].(string); id != "" {
			parsed.ParentID = id
		}
	}
	collectSearchSources(parsed, response)
	token, _ := response["token"].(string)
	thinking, _ := response["isThinking"].(bool)
	tag, _ := response["messageTag"].(string)
	if tag == "tool_usage_card" {
		collectServerTool(parsed, response)
		// tool_usage_card 的 token 是 Grok 内部 XML 协议，不属于模型 reasoning。
		return "", "", true, nil
	}
	if token != "" && thinking {
		parsed.Reasoning.WriteString(token)
		return "reasoning", token, true, nil
	}
	if token != "" && !thinking && (tag == "final" || tag == "") {
		parsed.upstreamText.WriteString(token)
		cleaned := cleanChatToken(parsed, token)
		parsed.appendText(cleaned)
		return "text", cleaned, true, nil
	}
	return "", "", false, nil
}

// parseStreamingImageResponse 处理内置流式图片生成事件。
func parseStreamingImageResponse(parsed *parsedChat, imageResponse map[string]any) (string, string, error) {
	rawURL, _ := imageResponse["imageUrl"].(string)
	if rawURL == "" {
		rawURL, _ = imageResponse["url"].(string)
	}
	if rawURL == "" {
		return "", "", nil
	}
	moderated, _ := imageResponse["moderated"].(bool)
	if moderated {
		markModeratedImage(parsed, rawURL)
		return "", "", nil
	}
	completed, _ := imageResponse["isFinal"].(bool)
	if completed || imageResponse["progress"] == float64(100) {
		rawURL = absoluteAssetURL(rawURL)
		parsed.Images = appendUniqueString(parsed.Images, rawURL)
		return "image", rawURL, nil
	}
	return "", "", nil
}

func parseUpstreamFrame(data []byte, parsed *parsedChat) (string, string, error) {
	var root map[string]any
	if json.Unmarshal(data, &root) != nil {
		return "", "", nil
	}
	if event, ok := root["event"].(map[string]any); ok {
		return parseGatewayEvent(event, parsed)
	}
	if errorValue, ok := root["error"].(map[string]any); ok {
		return "", "", webResponseError(errorValue)
	}
	result, _ := root["result"].(map[string]any)
	if conversation, _ := result["conversation"].(map[string]any); conversation != nil {
		parsed.ConversationID, _ = conversation["conversationId"].(string)
		return "", "", nil
	}
	response, _ := result["response"].(map[string]any)
	if response == nil {
		return "", "", nil
	}
	if errorValue, ok := response["error"].(map[string]any); ok {
		return "", "", webResponseError(errorValue)
	}
	if kind, delta, ok := collectCardAttachmentImage(parsed, response); ok {
		return kind, delta, nil
	}
	if kind, delta, handled, err := parseChatResponseToken(parsed, response); handled || err != nil {
		return kind, delta, err
	}
	if modelResponse, _ := response["modelResponse"].(map[string]any); modelResponse != nil {
		return collectModelResponse(parsed, modelResponse)
	}
	if imageResponse, _ := response["streamingImageGenerationResponse"].(map[string]any); imageResponse != nil {
		return parseStreamingImageResponse(parsed, imageResponse)
	}
	return "", "", nil
}

func collectModelResponse(parsed *parsedChat, modelResponse map[string]any) (string, string, error) {
	if err := modelResponseStreamError(modelResponse); err != nil {
		return "", "", err
	}
	if parsed.ParentID == "" {
		parsed.ParentID, _ = modelResponse["parentResponseId"].(string)
	}
	collectSearchSources(parsed, modelResponse)
	firstImage := collectModelResponseImages(parsed, modelResponse)
	message, _ := modelResponse["message"].(string)
	if delta := mergeModelResponseText(parsed, message); delta != "" {
		return "text", delta, nil
	}
	if firstImage != "" {
		return "image", firstImage, nil
	}
	return "", "", nil
}

func mergeModelResponseText(parsed *parsedChat, message string) string {
	if message == "" {
		return ""
	}
	raw := parsed.upstreamText.String()
	if raw == message || strings.HasPrefix(raw, message) {
		return ""
	}
	if raw != "" && !strings.HasPrefix(message, raw) {
		// 已输出内容与最终 envelope 不同，保留已输出结果，避免重复或回滚流式内容。
		return ""
	}
	delta := message[len(raw):]
	parsed.upstreamText.WriteString(delta)
	delta = cleanChatToken(parsed, delta)
	parsed.appendText(delta)
	return delta
}

func modelResponseStreamError(modelResponse map[string]any) error {
	values, _ := modelResponse["streamErrors"].([]any)
	for _, raw := range values {
		switch value := raw.(type) {
		case string:
			if message := strings.TrimSpace(value); message != "" {
				return errors.New(message)
			}
		case map[string]any:
			if nested, _ := value["error"].(map[string]any); nested != nil {
				return webResponseError(nested)
			}
			if message := firstString(value, "message", "error", "detail"); message != "" {
				return webResponseError(map[string]any{"message": message, "code": value["code"]})
			}
		}
	}
	return nil
}

func webResponseError(value map[string]any) error {
	message, _ := value["message"].(string)
	if message == "" {
		message = "Grok Web stream error"
	}
	code, _ := numberAsInt(value["code"])
	if code == 7 || strings.Contains(strings.ToLower(message), "anti-bot") {
		return fmt.Errorf("%w: %s", errWebAntiBot, message)
	}
	normalized := strings.ToLower(message)
	if strings.Contains(normalized, "usage limit") || strings.Contains(normalized, "usage quota") {
		return fmt.Errorf("%w: %s", errWebUsageLimit, message)
	}
	return errors.New(message)
}

func antiBotProviderResponse() *provider.Response {
	return jsonProviderResponse(http.StatusForbidden, map[string]any{"error": map[string]any{
		"message": "Grok Web 出口会话被上游反机器人规则拒绝，请检查代理、User-Agent 与 Cloudflare Cookie 是否来自同一浏览器会话",
		"type":    "upstream_error", "code": "anti_bot_rejected",
	}})
}

func collectModelResponseImages(parsed *parsedChat, modelResponse map[string]any) string {
	first := ""
	appendImage := func(value string) {
		if strings.TrimSpace(value) == "" {
			return
		}
		value = absoluteAssetURL(value)
		if _, moderated := parsed.moderatedImages[value]; moderated {
			return
		}
		if containsString(parsed.Images, value) {
			return
		}
		parsed.Images = append(parsed.Images, value)
		if first == "" {
			first = value
		}
	}
	if urls, ok := modelResponse["generatedImageUrls"].([]any); ok {
		for _, raw := range urls {
			value, _ := raw.(string)
			appendImage(value)
		}
	}
	if cards, ok := modelResponse["cardAttachmentsJson"].([]any); ok {
		for _, raw := range cards {
			encoded, _ := raw.(string)
			var card map[string]any
			if encoded == "" || json.Unmarshal([]byte(encoded), &card) != nil {
				continue
			}
			appendImage(imageURLFromCardData(card))
		}
	}
	return first
}

func markModeratedImage(parsed *parsedChat, value string) {
	if strings.TrimSpace(value) == "" {
		return
	}
	if parsed.moderatedImages == nil {
		parsed.moderatedImages = make(map[string]struct{})
	}
	parsed.moderatedImages[absoluteAssetURL(value)] = struct{}{}
}

func applyParsedToolCalls(parsed *parsedChat, configuration toolConfiguration) {
	if len(configuration.Functions) == 0 || configuration.Choice == "none" {
		return
	}
	result := parseToolCalls(parsed.Text.String(), configuration.available)
	if len(result.Calls) == 0 {
		return
	}
	cleaned := removeToolSyntax(parsed.Text.String(), result)
	parsed.resetText(cleaned)
	parsed.ToolCalls = result.Calls
}
