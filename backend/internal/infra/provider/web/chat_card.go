package web

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/chenyme/grok2api/backend/internal/infra/provider/searchresult"
)

func collectCardAttachment(parsed *parsedChat, value any) string {
	if values, ok := value.([]any); ok {
		first := ""
		for _, item := range values {
			if rawURL := collectCardAttachment(parsed, item); first == "" && rawURL != "" {
				first = rawURL
			}
		}
		return first
	}
	data := cardAttachmentData(value)
	if data == nil {
		return ""
	}
	if id, _ := data["id"].(string); id != "" {
		if parsed.cardCache == nil {
			parsed.cardCache = make(map[string]map[string]any)
		}
		parsed.cardCache[id] = data
	}
	return imageURLFromCardData(data)
}

func cardAttachmentData(value any) map[string]any {
	card, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	if raw, ok := card["jsonData"].(map[string]any); ok {
		return raw
	}
	if raw, _ := card["jsonData"].(string); raw != "" {
		var data map[string]any
		if json.Unmarshal([]byte(raw), &data) == nil {
			return data
		}
	}
	if card["image_chunk"] != nil || card["imageChunk"] != nil {
		return card
	}
	return nil
}

func imageURLFromCardData(data map[string]any) string {
	chunk, _ := data["image_chunk"].(map[string]any)
	if chunk == nil {
		chunk, _ = data["imageChunk"].(map[string]any)
	}
	if chunk == nil {
		return ""
	}
	moderated, _ := chunk["moderated"].(bool)
	progress, _ := numberAsInt(chunk["progress"])
	if moderated || progress < 100 {
		return ""
	}
	imageURL, _ := chunk["imageUrl"].(string)
	if imageURL == "" {
		imageURL, _ = chunk["image_url"].(string)
	}
	return imageURL
}

func cleanChatToken(parsed *parsedChat, token string) string {
	if !strings.Contains(token, "<grok:render") {
		if token != "" {
			// Visible assistant text separates two citations. Only truly adjacent
			// duplicate render frames should be collapsed.
			parsed.lastCitation = 0
		}
		return token
	}
	matches := grokRenderPattern.FindAllStringSubmatchIndex(token, -1)
	if len(matches) == 0 {
		return token
	}
	var builder strings.Builder
	builderCharacters := 0
	cursor := 0
	for _, match := range matches {
		prefix := token[cursor:match[0]]
		builder.WriteString(prefix)
		builderCharacters += utf8.RuneCountInString(prefix)
		if prefix != "" {
			parsed.lastCitation = 0
		}
		cardID := token[match[2]:match[3]]
		renderType := token[match[6]:match[7]]
		replacement, annotation := renderChatCard(parsed, cardID, renderType)
		if annotation != nil {
			if replacement != "" {
				start := parsed.textCharacterLen() + builderCharacters
				annotation["start_index"] = start
				annotation["end_index"] = start + utf8.RuneCountInString(replacement)
			}
			parsed.Annotations = append(parsed.Annotations, annotation)
		}
		builder.WriteString(replacement)
		builderCharacters += utf8.RuneCountInString(replacement)
		cursor = match[1]
	}
	suffix := token[cursor:]
	builder.WriteString(suffix)
	if suffix != "" {
		parsed.lastCitation = 0
	}
	return builder.String()
}

// renderSearchedImageCard 渲染上游检索图片卡片为 Markdown 图片/链接。
func renderSearchedImageCard(card map[string]any) (string, map[string]any) {
	image, _ := card["image"].(map[string]any)
	if image == nil {
		return "", nil
	}
	title, _ := image["title"].(string)
	thumbnail := firstString(image, "thumbnail", "original")
	link, _ := image["link"].(string)
	if thumbnail == "" {
		return "", nil
	}
	if title == "" {
		title = "image"
	}
	if link != "" {
		return fmt.Sprintf("[![%s](%s)](%s)", title, thumbnail, link), nil
	}
	return fmt.Sprintf("![%s](%s)", title, thumbnail), nil
}

// renderInlineCitationCard 登记内联引用序号并给出可见替换文本与结构化注解。
func renderInlineCitationCard(parsed *parsedChat, card map[string]any) (string, map[string]any) {
	value, _ := card["url"].(string)
	value, valid := searchresult.NormalizeURL(value)
	if !valid {
		return "", nil
	}
	if parsed.citationIndex == nil {
		parsed.citationIndex = make(map[string]int)
	}
	index, exists := parsed.citationIndex[value]
	if !exists {
		if len(parsed.citationIndex) >= maxTrackedCitationSources {
			return "", nil
		}
		index = len(parsed.citationIndex) + 1
		parsed.citationIndex[value] = index
	}
	if parsed.lastCitation == index {
		return "", nil
	}
	parsed.lastCitation = index
	annotation := citationAnnotation(parsed, value, index)
	if parsed.DisableInlineCitations {
		if len(parsed.Annotations) >= maxTrackedAnnotations {
			return "", nil
		}
		return "", annotation
	}
	// Inline marker keeps the numeric label. When the structured annotation
	// cap is reached, keep the visible text without growing retained state.
	replacement := fmt.Sprintf("[[%d]](%s)", index, value)
	if len(parsed.Annotations) >= maxTrackedAnnotations {
		return replacement, nil
	}
	return replacement, annotation
}

func renderChatCard(parsed *parsedChat, cardID, renderType string) (string, map[string]any) {
	if parsed.cardCache == nil {
		return "", nil
	}
	card := parsed.cardCache[cardID]
	if card == nil {
		return "", nil
	}
	switch renderType {
	case "render_generated_image", "render_file":
		return "", nil
	case "render_searched_image":
		return renderSearchedImageCard(card)
	case "render_inline_citation":
		return renderInlineCitationCard(parsed, card)
	default:
		return "", nil
	}
}
