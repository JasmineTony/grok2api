package conversation

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

func applyAnthropicWebSearchResult(call map[string]any, raw json.RawMessage) {
	var results []map[string]any
	if json.Unmarshal(raw, &results) == nil {
		sources := make([]any, 0, len(results))
		for _, result := range results {
			if result["type"] != "web_search_result" {
				continue
			}
			url, _ := result["url"].(string)
			if strings.TrimSpace(url) != "" {
				sources = append(sources, map[string]any{"type": "url", "url": strings.TrimSpace(url)})
			}
		}
		if action, ok := call["action"].(map[string]any); ok && len(sources) > 0 {
			action["sources"] = sources
		}
		return
	}
	var result map[string]any
	if json.Unmarshal(raw, &result) == nil && result["type"] == "web_search_tool_result_error" {
		call["status"] = "failed"
	}
}

func anthropicSystemText(raw json.RawMessage) (string, error) {
	if isEmptyJSON(raw) {
		return "", nil
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		if isAnthropicBillingHeaderText(text) {
			return "", nil
		}
		return text, nil
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) != nil {
		return "", errors.New("system 必须是字符串或 text block 数组")
	}
	parts := make([]string, 0, len(blocks))
	for _, block := range blocks {
		if block.Type != "text" {
			return "", fmt.Errorf("system 不支持 type=%q", block.Type)
		}
		// Claude Code identity blocks may carry a per-request cch fingerprint and are not model instructions.
		// Keeping them during Build conversion changes the cache prefix each turn and reduces cache hits.
		if isAnthropicBillingHeaderText(block.Text) {
			continue
		}
		parts = append(parts, block.Text)
	}
	return strings.Join(parts, "\n\n"), nil
}

func isAnthropicBillingHeaderText(text string) bool {
	return strings.HasPrefix(strings.TrimLeft(text, " \t\r\n"), anthropicBillingHeaderPrefix)
}

func anthropicImageURL(raw json.RawMessage) (string, error) {
	var source struct {
		Type      string `json:"type"`
		MediaType string `json:"media_type"`
		Data      string `json:"data"`
		URL       string `json:"url"`
	}
	if json.Unmarshal(raw, &source) != nil {
		return "", errors.New("image.source 无效")
	}
	switch source.Type {
	case "base64":
		if source.MediaType == "" || source.Data == "" {
			return "", errors.New("base64 image 缺少 media_type 或 data")
		}
		return "data:" + source.MediaType + ";base64," + source.Data, nil
	case "url":
		if strings.TrimSpace(source.URL) == "" {
			return "", errors.New("url image 缺少 url")
		}
		return source.URL, nil
	default:
		return "", fmt.Errorf("不支持 image.source.type=%q", source.Type)
	}
}

func anthropicDocument(block map[string]json.RawMessage) (map[string]any, error) {
	var source struct {
		Type      string `json:"type"`
		MediaType string `json:"media_type"`
		Data      string `json:"data"`
		URL       string `json:"url"`
	}
	if json.Unmarshal(block["source"], &source) != nil {
		return nil, errors.New("document.source 无效")
	}
	var title string
	_ = json.Unmarshal(block["title"], &title)
	switch source.Type {
	case "text":
		if source.Data == "" {
			return nil, errors.New("text document 缺少 data")
		}
		return map[string]any{"type": "input_text", "text": source.Data}, nil
	case "url":
		if strings.TrimSpace(source.URL) == "" {
			return nil, errors.New("url document 缺少 url")
		}
		value := map[string]any{"type": "input_file", "file_url": source.URL}
		if title != "" {
			value["filename"] = title
		}
		return value, nil
	case "base64":
		if source.MediaType == "" || source.Data == "" {
			return nil, errors.New("base64 document 缺少 media_type 或 data")
		}
		value := map[string]any{"type": "input_file", "file_data": "data:" + source.MediaType + ";base64," + source.Data}
		if title != "" {
			value["filename"] = title
		}
		return value, nil
	default:
		return nil, fmt.Errorf("不支持 document.source.type=%q", source.Type)
	}
}

func anthropicToolResult(raw json.RawMessage, declaredTools map[string]struct{}) (any, error) {
	if isEmptyJSON(raw) {
		return "", nil
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text, nil
	}
	var blocks []map[string]json.RawMessage
	if json.Unmarshal(raw, &blocks) != nil {
		return "", errors.New("tool_result.content 无效")
	}
	parts := make([]any, 0, len(blocks))
	for _, block := range blocks {
		var typeName string
		_ = json.Unmarshal(block["type"], &typeName)
		switch typeName {
		case "text":
			var value string
			if json.Unmarshal(block["text"], &value) != nil {
				return nil, errors.New("tool_result text 无效")
			}
			parts = append(parts, map[string]any{"type": "input_text", "text": value})
		case "image":
			imageURL, err := anthropicImageURL(block["source"])
			if err != nil {
				return nil, err
			}
			parts = append(parts, map[string]any{"type": "input_image", "detail": "auto", "image_url": imageURL})
		case "document":
			document, err := anthropicDocument(block)
			if err != nil {
				return nil, err
			}
			parts = append(parts, document)
		case "tool_reference":
			var toolName string
			if json.Unmarshal(block["tool_name"], &toolName) != nil || strings.TrimSpace(toolName) == "" {
				return nil, errors.New("tool_reference.tool_name 无效")
			}
			toolName = strings.TrimSpace(toolName)
			if _, exists := declaredTools[toolName]; !exists {
				return nil, fmt.Errorf("tool_reference 引用了未声明的工具 %q", toolName)
			}
			// Responses has no Anthropic tool_reference content block. All tool definitions from Messages
			// have already been sent upstream, so deterministic result text preserves the search-hit meaning.
			parts = append(parts, map[string]any{
				"type": "input_text",
				"text": fmt.Sprintf("Tool search matched declared tool %q; its definition is available in this request.", toolName),
			})
		default:
			return nil, fmt.Errorf("tool_result 暂不支持 type=%q", typeName)
		}
	}
	return parts, nil
}

func anthropicDeclaredToolNames(tools []map[string]json.RawMessage) map[string]struct{} {
	declared := make(map[string]struct{}, len(tools))
	for _, tool := range tools {
		var name string
		_ = json.Unmarshal(tool["name"], &name)
		if name = strings.TrimSpace(name); name != "" {
			declared[name] = struct{}{}
		}
	}
	return declared
}

func markAnthropicToolError(output any) any {
	const prefix = "Tool execution failed: "
	if text, ok := output.(string); ok {
		return prefix + text
	}
	parts, _ := output.([]any)
	return append([]any{map[string]any{"type": "input_text", "text": prefix}}, parts...)
}
