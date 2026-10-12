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
		part, err := convertAnthropicToolResultBlock(block, declaredTools)
		if err != nil {
			return nil, err
		}
		parts = append(parts, part)
	}
	return parts, nil
}

// convertAnthropicToolResultBlock 转换单个 tool_result 内容块。
func convertAnthropicToolResultBlock(block map[string]json.RawMessage, declaredTools map[string]struct{}) (any, error) {
	var typeName string
	_ = json.Unmarshal(block["type"], &typeName)
	switch typeName {
	case "text":
		var value string
		if json.Unmarshal(block["text"], &value) != nil {
			return nil, errors.New("tool_result text 无效")
		}
		return map[string]any{"type": "input_text", "text": value}, nil
	case "image":
		imageURL, err := anthropicImageURL(block["source"])
		if err != nil {
			return nil, err
		}
		return map[string]any{"type": "input_image", "detail": "auto", "image_url": imageURL}, nil
	case "document":
		document, err := anthropicDocument(block)
		if err != nil {
			return nil, err
		}
		return document, nil
	case "tool_reference":
		return convertAnthropicToolReference(block, declaredTools)
	default:
		return nil, fmt.Errorf("tool_result 暂不支持 type=%q", typeName)
	}
}

// convertAnthropicToolReference 把 tool_reference 展开为确定性的结果文本。
func convertAnthropicToolReference(block map[string]json.RawMessage, declaredTools map[string]struct{}) (any, error) {
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
	return map[string]any{
		"type": "input_text",
		"text": fmt.Sprintf("Tool search matched declared tool %q; its definition is available in this request.", toolName),
	}, nil
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

// flushMessageParts 把已累积的普通内容块落盘为一条 message 输入项。
func (c *anthropicMessageConverter) flushMessageParts(role string, messageParts []any) []any {
	if len(messageParts) == 0 {
		return nil
	}
	c.input = append(c.input, map[string]any{"type": "message", "role": role, "content": messageParts})
	return nil
}

// convertRegularContentBlock 转换 text/image/document 三种普通内容块。
func (c *anthropicMessageConverter) convertRegularContentBlock(typeName string, block map[string]json.RawMessage, path string, messageParts []any, regularBeforeResult bool) ([]any, bool, error) {
	regularBeforeResult = regularBeforeResult || len(c.pendingCalls) > 0
	switch typeName {
	case "text":
		var value string
		if json.Unmarshal(block["text"], &value) != nil {
			return nil, false, fmt.Errorf("%s.text 无效", path)
		}
		messageParts = append(messageParts, map[string]any{"type": "input_text", "text": value})
	case "image":
		imageURL, err := anthropicImageURL(block["source"])
		if err != nil {
			return nil, false, fmt.Errorf("%s: %w", path, err)
		}
		messageParts = append(messageParts, map[string]any{"type": "input_image", "image_url": imageURL})
	case "document":
		document, err := anthropicDocument(block)
		if err != nil {
			return nil, false, fmt.Errorf("%s: %w", path, err)
		}
		messageParts = append(messageParts, document)
	}
	return messageParts, regularBeforeResult, nil
}

func (c *anthropicMessageConverter) convertToolUseBlock(role, path string, block map[string]json.RawMessage, messageParts []any) ([]any, error) {
	if role != "assistant" {
		return nil, fmt.Errorf("%s tool_use 只允许出现在 assistant 消息", path)
	}
	messageParts = c.flushMessageParts(role, messageParts)
	var value struct {
		ID    string         `json:"id"`
		Name  string         `json:"name"`
		Input map[string]any `json:"input"`
	}
	if encoded, _ := json.Marshal(block); json.Unmarshal(encoded, &value) != nil || strings.TrimSpace(value.ID) == "" || strings.TrimSpace(value.Name) == "" || value.Input == nil {
		return nil, fmt.Errorf("%s 缺少有效 id、name 或 object input", path)
	}
	if _, exists := c.usedCalls[value.ID]; exists {
		return nil, fmt.Errorf("%s 包含重复 tool_use id %q", path, value.ID)
	}
	arguments, _ := json.Marshal(value.Input)
	c.appendCachedToolUseReasoning(value.ID)
	c.input = append(c.input, map[string]any{"type": "function_call", "call_id": value.ID, "name": value.Name, "arguments": string(arguments)})
	c.pendingCalls[value.ID] = struct{}{}
	c.usedCalls[value.ID] = struct{}{}
	return messageParts, nil
}

// appendCachedReasoning 追加缓存中的桥接 reasoning 项，避免与显式签名重复。
func (c *anthropicMessageConverter) appendCachedReasoning(item responseItem) {
	if item.ID == "" || item.Encrypted == "" || reasoningAlreadyEmitted(c.seenReasoningIDs, c.seenReasoningEncrypted, item) {
		return
	}
	if _, exists := c.explicitReasoningEncrypted[strings.TrimSpace(item.Encrypted)]; exists {
		return
	}
	c.input = append(c.input, reasoningInputItem(item))
	markReasoningEmitted(c.seenReasoningIDs, c.seenReasoningEncrypted, item)
}

// appendCachedToolUseReasoning 回放与 tool_use 配对的缓存 reasoning。
func (c *anthropicMessageConverter) appendCachedToolUseReasoning(callID string) {
	if c.cache == nil || strings.TrimSpace(c.scope) == "" {
		return
	}
	if reasoning, found := c.cache.GetScoped(c.scope, callID); found && reasoning.ID != "" && reasoning.Encrypted != "" {
		c.appendCachedReasoning(reasoning)
	}
}

func (c *anthropicMessageConverter) convertToolResultBlock(role, path string, block map[string]json.RawMessage, messageParts []any, regularBeforeResult bool) ([]any, error) {
	if role != "user" {
		return nil, fmt.Errorf("%s tool_result 只允许出现在 user 消息", path)
	}
	messageParts = c.flushMessageParts(role, messageParts)
	var toolUseID string
	_ = json.Unmarshal(block["tool_use_id"], &toolUseID)
	if _, exists := c.pendingCalls[toolUseID]; strings.TrimSpace(toolUseID) == "" || !exists {
		return nil, fmt.Errorf("%s.tool_use_id %q 未匹配待处理 tool_use", path, toolUseID)
	}
	if regularBeforeResult {
		return nil, fmt.Errorf("%s tool_result 必须位于文本、图片或文档块之前", path)
	}
	output, err := c.convertToolResultOutput(path, block)
	if err != nil {
		return nil, err
	}
	c.input = append(c.input, map[string]any{"type": "function_call_output", "call_id": toolUseID, "output": output})
	delete(c.pendingCalls, toolUseID)
	return messageParts, nil
}

// convertToolResultOutput 解码 tool_result 内容，并按 is_error 标记补全失败前缀。
func (c *anthropicMessageConverter) convertToolResultOutput(path string, block map[string]json.RawMessage) (any, error) {
	output, err := anthropicToolResult(block["content"], c.declaredTools)
	if err != nil {
		return nil, fmt.Errorf("%s.content: %w", path, err)
	}
	if raw := block["is_error"]; !isEmptyJSON(raw) {
		var isError bool
		if json.Unmarshal(raw, &isError) != nil {
			return nil, fmt.Errorf("%s.is_error 必须是布尔值", path)
		}
		if isError {
			output = markAnthropicToolError(output)
		}
	}
	return output, nil
}

func (c *anthropicMessageConverter) convertThinkingBlock(role, path string, block map[string]json.RawMessage, messageParts []any) ([]any, error) {
	if role != "assistant" {
		return nil, fmt.Errorf("%s thinking 只允许出现在 assistant 消息", path)
	}
	messageParts = c.flushMessageParts(role, messageParts)
	var thinking, signature string
	_ = json.Unmarshal(block["thinking"], &thinking)
	_ = json.Unmarshal(block["signature"], &signature)
	item := map[string]any{"type": "reasoning", "summary": []any{map[string]any{"type": "summary_text", "text": thinking}}}
	if signature != "" {
		item["encrypted_content"] = signature
	}
	c.input = append(c.input, item)
	markReasoningEmitted(c.seenReasoningIDs, c.seenReasoningEncrypted, responseItem{Encrypted: signature})
	return messageParts, nil
}

func (c *anthropicMessageConverter) convertRedactedThinkingBlock(role, path string, block map[string]json.RawMessage, messageParts []any) ([]any, error) {
	if role != "assistant" {
		return nil, fmt.Errorf("%s redacted_thinking 只允许出现在 assistant 消息", path)
	}
	messageParts = c.flushMessageParts(role, messageParts)
	var data string
	if json.Unmarshal(block["data"], &data) != nil || data == "" {
		return nil, fmt.Errorf("%s.data 无效", path)
	}
	// Grok Build requires summary to exist whenever encrypted_content is replayed.
	// An empty array is the canonical Anthropic redacted_thinking representation.
	c.input = append(c.input, map[string]any{"type": "reasoning", "summary": []any{}, "encrypted_content": data})
	markReasoningEmitted(c.seenReasoningIDs, c.seenReasoningEncrypted, responseItem{Encrypted: data})
	return messageParts, nil
}

// convertServerToolUseBlock 记录 assistant 历史中的 web_search server tool 调用。
func (c *anthropicMessageConverter) convertServerToolUseBlock(role string, block map[string]json.RawMessage, messageParts []any) ([]any, error) {
	if role != "assistant" {
		return messageParts, nil
	}
	var value struct {
		ID    string         `json:"id"`
		Name  string         `json:"name"`
		Input map[string]any `json:"input"`
	}
	encoded, _ := json.Marshal(block)
	if json.Unmarshal(encoded, &value) != nil || value.Name != "web_search" || strings.TrimSpace(value.ID) == "" {
		return messageParts, nil
	}
	messageParts = c.flushMessageParts(role, messageParts)
	query, _ := value.Input["query"].(string)
	call := map[string]any{
		"type": "web_search_call", "id": value.ID, "status": "completed",
		"action": map[string]any{"type": "search", "query": query},
	}
	c.serverSearches[value.ID] = call
	c.input = append(c.input, call)
	return messageParts, nil
}

// convertWebSearchToolResultBlock 把 server tool 结果合并回已记录的搜索结果项。
func (c *anthropicMessageConverter) convertWebSearchToolResultBlock(role string, block map[string]json.RawMessage) {
	if role != "assistant" {
		return
	}
	var toolUseID string
	_ = json.Unmarshal(block["tool_use_id"], &toolUseID)
	call := c.serverSearches[strings.TrimSpace(toolUseID)]
	if call == nil {
		return
	}
	applyAnthropicWebSearchResult(call, block["content"])
}
