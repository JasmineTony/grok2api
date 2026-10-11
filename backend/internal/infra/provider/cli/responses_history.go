package cli

import (
	"encoding/json"
	"fmt"
	"strings"
)

// historyItemRewrite 记录单条历史项的降级结果：写回 input 的值，
// 以及需要并入工具集合的加载工具与可见工具定义。
type historyItemRewrite struct {
	value        any
	loadedTools  []any
	visibleTools []any
	appendValue  bool
}

// normalizeInputItems 将 Codex/Responses 扩展历史降级为 Grok Build 可接受的结构，
// 同时收集 tool_search 或 additional_tools 动态加载的工具定义。
func (c *responsesToolCompatibility) normalizeInputItems(items []any) ([]any, []any, []any, error) {
	rewritten := make([]any, 0, len(items))
	loadedTools := make([]any, 0)
	visibleTools := make([]any, 0)
	for index, rawItem := range items {
		item, ok := rawItem.(map[string]any)
		if !ok {
			rewritten = append(rewritten, rawItem)
			continue
		}
		result, err := c.normalizeHistoryItem(item, index, len(items))
		if err != nil {
			return nil, nil, nil, err
		}
		loadedTools = append(loadedTools, result.loadedTools...)
		visibleTools = append(visibleTools, result.visibleTools...)
		if result.appendValue {
			rewritten = append(rewritten, result.value)
		}
	}
	return rewritten, loadedTools, visibleTools, nil
}

// normalizeHistoryItem 按输入项类型选择降级策略，返回需要写回的结果。
func (c *responsesToolCompatibility) normalizeHistoryItem(item map[string]any, index, total int) (historyItemRewrite, error) {
	param := fmt.Sprintf("input[%d]", index)
	itemType := strings.TrimSpace(stringField(item, "type"))
	// Codex/OpenAI 可能省略带 role 消息的 type；在重建前补成明确消息，
	// 避免无类型对象直接进入 ModelInput。
	if itemType == "" && strings.TrimSpace(stringField(item, "role")) != "" {
		itemType = "message"
	}
	switch itemType {
	case "message":
		return c.convertHistoryInputItem(c.normalizeMessageInput, item, param)
	case "function_call":
		return c.convertHistoryInputItem(c.normalizeFunctionCallInput, item, param)
	case "function_call_output":
		return c.convertHistoryInputItem(c.normalizeFunctionCallOutputInput, item, param)
	case "custom_tool_call":
		return c.convertHistoryInputItem(c.normalizeCustomToolCallInput, item, param)
	case "custom_tool_call_output":
		return c.convertHistoryInputItem(c.normalizeCustomToolCallOutputInput, item, param)
	case "apply_patch_call":
		return c.convertHistoryInputItem(c.normalizeApplyPatchCallInput, item, param)
	case "apply_patch_call_output":
		return c.convertHistoryInputItem(normalizeApplyPatchOutputInput, item, param)
	case "local_shell_call":
		return c.convertHistoryInputItem(normalizeLegacyLocalShellCallInput, item, param)
	case "local_shell_call_output":
		return c.convertHistoryInputItem(normalizeLegacyLocalShellOutputInput, item, param)
	case "shell_call_output":
		return c.convertHistoryInputItem(normalizeShellCallOutputInput, item, param)
	case "mcp_tool_call_output":
		return c.convertHistoryInputItem(normalizeMCPOutputInput, item, param)
	case "agent_message":
		if _, visible := textInputContent(item["content"]); !visible {
			c.addWarning("opaque_agent_message_redacted")
		}
		return c.convertHistoryInputItem(normalizeAgentMessageInput, item, param)
	}
	return c.normalizeHistoryExtensionItem(item, itemType, param, index, total)
}

// convertHistoryInputItem 执行单条历史项转换并按兼容层约定登记变更。
func (c *responsesToolCompatibility) convertHistoryInputItem(convert func(map[string]any, string) (map[string]any, error), item map[string]any, param string) (historyItemRewrite, error) {
	converted, err := convert(item, param)
	if err != nil {
		return historyItemRewrite{}, err
	}
	c.changed = true
	return historyItemRewrite{value: converted, appendValue: true}, nil
}

// normalizeHistoryExtensionItem 处理 Codex 扩展历史项；未知类型降级为可见边界标记。
func (c *responsesToolCompatibility) normalizeHistoryExtensionItem(item map[string]any, itemType, param string, index, total int) (historyItemRewrite, error) {
	switch itemType {
	case "reasoning":
		converted := sanitizeReasoningInput(item)
		c.changed = true
		return historyItemRewrite{value: converted, appendValue: true}, nil
	case "file_search_call", "web_search_call", "image_generation_call", "code_interpreter_call",
		"shell_call", "mcp_list_tools", "mcp_approval_request", "mcp_approval_response", "mcp_call", "compaction":
		// These types are part of the native Grok Build Responses InputItem contract.
		// Remove only Codex-private fields and nulls; native calls must not degrade to text.
		converted := sanitizeNativeHistoryInput(item, itemType)
		c.changed = true
		return historyItemRewrite{value: converted, appendValue: true}, nil
	case "tool_search_call":
		return c.normalizeToolSearchCallInput(item, param)
	case "tool_search_output":
		return c.normalizeToolSearchOutputInput(item, param)
	case "additional_tools":
		return c.normalizeAdditionalToolsHistoryItem(item, param)
	case "compaction_trigger":
		return c.normalizeCompactionTriggerItem(param, index, total)
	}
	return c.normalizeUnsupportedHistoryItem(item, itemType)
}

// normalizeUnsupportedHistoryItem 把无法反序列化的 Codex 历史项替换为可见边界标记。
func (c *responsesToolCompatibility) normalizeUnsupportedHistoryItem(item map[string]any, itemType string) (historyItemRewrite, error) {
	if itemType == "" {
		return historyItemRewrite{value: cloneJSONValue(item), appendValue: true}, nil
	}
	c.changed = true
	c.addWarning("unsupported_input_history_omitted")
	return historyItemRewrite{value: unsupportedInputHistoryBoundary(item, itemType), appendValue: true}, nil
}

func (c *responsesToolCompatibility) normalizeToolSearchCallInput(item map[string]any, param string) (historyItemRewrite, error) {
	callID := strings.TrimSpace(stringField(item, "call_id"))
	if callID == "" {
		return historyItemRewrite{}, &responsesRequestError{Message: param + ".call_id 不能为空", Param: param + ".call_id", Code: "invalid_parameter"}
	}
	execution := strings.ToLower(strings.TrimSpace(stringField(item, "execution")))
	if execution == "" || execution == "server" {
		c.serverSearchEager = true
		c.changed = true
		c.addWarning("server_tool_search_history_approximated")
		message := compatibilityBoundaryMessage("A server-side tool search occurred here; selected tools are made available directly.")
		return historyItemRewrite{value: message, appendValue: true}, nil
	}
	if execution != "client" {
		return historyItemRewrite{}, &responsesRequestError{Message: "tool_search_call.execution 只支持 client 或 server", Param: param + ".execution", Code: "invalid_parameter"}
	}
	arguments, err := encodeFunctionArguments(item["arguments"])
	if err != nil {
		return historyItemRewrite{}, &responsesRequestError{Message: param + ".arguments 无法编码", Param: param + ".arguments", Code: "invalid_parameter"}
	}
	converted := map[string]any{
		"type": "function_call", "call_id": callID,
		"name": c.alias(responsesToolIdentity{Kind: responsesToolSearch, Name: "tool_search"}), "arguments": arguments,
	}
	c.changed = true
	return historyItemRewrite{value: converted, appendValue: true}, nil
}

func (c *responsesToolCompatibility) normalizeToolSearchOutputInput(item map[string]any, param string) (historyItemRewrite, error) {
	execution := strings.ToLower(strings.TrimSpace(stringField(item, "execution")))
	if execution != "" && execution != "client" && execution != "server" {
		return historyItemRewrite{}, &responsesRequestError{Message: "tool_search_output.execution 只支持 client 或 server", Param: param + ".execution", Code: "invalid_parameter"}
	}
	callID := strings.TrimSpace(stringField(item, "call_id"))
	if callID == "" {
		return historyItemRewrite{}, &responsesRequestError{Message: param + ".call_id 不能为空", Param: param + ".call_id", Code: "invalid_parameter"}
	}
	tools, ok := item["tools"].([]any)
	if !ok {
		return historyItemRewrite{}, &responsesRequestError{Message: param + ".tools 必须是数组", Param: param + ".tools", Code: "invalid_parameter"}
	}
	loadedTools, err := c.normalizeToolSearchOutputTools(tools, param)
	if err != nil {
		return historyItemRewrite{}, err
	}
	c.changed = true
	message := fmt.Sprintf("Tool search completed; %d selected tool definitions are now available.", len(tools))
	if execution == "client" {
		converted := map[string]any{"type": "function_call_output", "call_id": callID, "output": message}
		return historyItemRewrite{value: converted, loadedTools: loadedTools, visibleTools: cloneJSONArray(tools), appendValue: true}, nil
	}
	c.serverSearchEager = true
	c.addWarning("server_tool_search_history_approximated")
	return historyItemRewrite{
		value:        compatibilityBoundaryMessage(message),
		loadedTools:  loadedTools,
		visibleTools: cloneJSONArray(tools),
		appendValue:  true,
	}, nil
}

func (c *responsesToolCompatibility) normalizeToolSearchOutputTools(tools []any, param string) ([]any, error) {
	loadedTools := make([]any, 0)
	for toolIndex, rawTool := range tools {
		converted, err := c.normalizeTool(rawTool, "", false, true, fmt.Sprintf("%s.tools[%d]", param, toolIndex))
		if err != nil {
			return nil, err
		}
		loadedTools = append(loadedTools, converted...)
	}
	return loadedTools, nil
}

// normalizeAdditionalToolsHistoryItem 处理 additional_tools 动态加载的工具定义。
func (c *responsesToolCompatibility) normalizeAdditionalToolsHistoryItem(item map[string]any, param string) (historyItemRewrite, error) {
	marker, additional, visible, err := c.normalizeAdditionalToolsInput(item, param)
	if err != nil {
		return historyItemRewrite{}, err
	}
	c.changed = true
	return historyItemRewrite{value: marker, loadedTools: additional, visibleTools: visible, appendValue: true}, nil
}

func (c *responsesToolCompatibility) normalizeCompactionTriggerItem(param string, index, total int) (historyItemRewrite, error) {
	if c.compactionRequested {
		return historyItemRewrite{}, &responsesRequestError{Message: "compaction_trigger 只能出现一次", Param: param, Code: "invalid_parameter"}
	}
	if index != total-1 {
		return historyItemRewrite{}, &responsesRequestError{Message: "compaction_trigger 必须是 input 的最后一项", Param: param, Code: "invalid_parameter"}
	}
	c.compactionRequested = true
	c.changed = true
	c.addWarning("remote_compaction_v2_emulated")
	return historyItemRewrite{}, nil
}

func (c *responsesToolCompatibility) normalizeFunctionCallInput(item map[string]any, param string) (map[string]any, error) {
	name := strings.TrimSpace(stringField(item, "name"))
	if name == "" {
		return nil, &responsesRequestError{Message: param + ".name 不能为空", Param: param + ".name", Code: "invalid_parameter"}
	}
	callID := strings.TrimSpace(stringField(item, "call_id"))
	if callID == "" {
		return nil, &responsesRequestError{Message: param + ".call_id 不能为空", Param: param + ".call_id", Code: "invalid_parameter"}
	}
	arguments, err := encodeFunctionArguments(item["arguments"])
	if err != nil {
		return nil, &responsesRequestError{Message: param + ".arguments 无法编码", Param: param + ".arguments", Code: "invalid_parameter"}
	}
	namespace := strings.TrimSpace(stringField(item, "namespace"))
	if namespace != "" || strings.EqualFold(name, "view_image") {
		name = c.functionAlias(responsesToolIdentity{Kind: responsesFunctionTool, Namespace: namespace, Name: name})
	}
	// 按官方 Build 回放结构仅保留四个输入字段，避免输出态字段和私有元数据
	// 干扰 Grok 的 untagged ModelInput 反序列化。
	return map[string]any{"type": "function_call", "call_id": callID, "name": name, "arguments": arguments}, nil
}

func (c *responsesToolCompatibility) normalizeCustomToolCallInput(item map[string]any, param string) (map[string]any, error) {
	name := strings.TrimSpace(stringField(item, "name"))
	if name == "" {
		return nil, &responsesRequestError{Message: param + ".name 不能为空", Param: param + ".name", Code: "invalid_parameter"}
	}
	input, ok := item["input"].(string)
	if !ok {
		return nil, &responsesRequestError{Message: param + ".input 必须是字符串", Param: param + ".input", Code: "invalid_parameter"}
	}
	arguments, err := encodeCustomToolArguments(input)
	if err != nil {
		return nil, err
	}
	callID := strings.TrimSpace(stringField(item, "call_id"))
	if callID == "" {
		return nil, &responsesRequestError{Message: param + ".call_id 不能为空", Param: param + ".call_id", Code: "invalid_parameter"}
	}
	namespace := strings.TrimSpace(stringField(item, "namespace"))
	return map[string]any{
		"type": "function_call", "call_id": callID,
		"name":      c.alias(responsesToolIdentity{Kind: responsesCustomTool, Namespace: namespace, Name: name}),
		"arguments": arguments,
	}, nil
}

func sanitizeReasoningInput(item map[string]any) map[string]any {
	// Keep ciphertext-backed reasoning native. Summary-only items are rewritten
	// as assistant messages so the readable plan survives without sending a
	// bare type=reasoning item that Grok Build may reject.
	converted := copyNonNullHistoryFields(item, "id", "summary", "content", "encrypted_content")
	converted["type"] = "reasoning"
	if encrypted, ok := converted["encrypted_content"].(string); ok && strings.TrimSpace(encrypted) != "" {
		if _, exists := converted["summary"]; !exists {
			converted["summary"] = []any{}
		}
		return converted
	}
	if portable, ok := portableReasoningSummaryMessage(converted); ok {
		return portable
	}
	return compatibilityBoundaryMessage("A prior model reasoning item was omitted because it has no portable content for Grok Build.")
}

// sanitizeNativeHistoryInput rebuilds history from native Grok Build InputItem fields
// so Codex extension metadata cannot interfere with Rust untagged enum deserialization.
func sanitizeNativeHistoryInput(item map[string]any, itemType string) map[string]any {
	var fields []string
	switch itemType {
	case "file_search_call":
		fields = []string{"id", "queries", "status", "results"}
	case "web_search_call":
		fields = []string{"action", "id", "status"}
	case "image_generation_call":
		fields = []string{"id", "result", "status"}
	case "code_interpreter_call":
		fields = []string{"code", "container_id", "id", "outputs", "status"}
	case "shell_call":
		fields = []string{"id", "call_id", "action", "status", "environment"}
	case "mcp_list_tools":
		fields = []string{"id", "server_label", "tools", "error"}
	case "mcp_approval_request":
		fields = []string{"arguments", "id", "name", "server_label"}
	case "mcp_approval_response":
		fields = []string{"approval_request_id", "approve", "id", "reason"}
	case "mcp_call":
		fields = []string{"arguments", "id", "name", "server_label", "approval_request_id", "error", "output", "status"}
	case "compaction":
		fields = []string{"id", "encrypted_content"}
	}
	converted := copyNonNullHistoryFields(item, fields...)
	converted["type"] = itemType
	return converted
}

func copyNonNullHistoryFields(item map[string]any, fields ...string) map[string]any {
	converted := make(map[string]any, len(fields)+1)
	for _, key := range fields {
		if value, ok := sanitizeHistoryJSONValue(item[key]); ok {
			converted[key] = value
		}
	}
	return converted
}

func sanitizeHistoryJSONValue(value any) (any, bool) {
	switch typed := value.(type) {
	case nil:
		return nil, false
	case map[string]any:
		cleaned := make(map[string]any, len(typed))
		for key, nested := range typed {
			if key == "phase" || key == "internal_chat_message_metadata_passthrough" {
				continue
			}
			if normalized, ok := sanitizeHistoryJSONValue(nested); ok {
				cleaned[key] = normalized
			}
		}
		return cleaned, true
	case []any:
		cleaned := make([]any, 0, len(typed))
		for _, nested := range typed {
			if normalized, ok := sanitizeHistoryJSONValue(nested); ok {
				cleaned = append(cleaned, normalized)
			}
		}
		return cleaned, true
	default:
		return cloneJSONValue(value), true
	}
}

func unsupportedInputHistoryBoundary(item map[string]any, kind string) map[string]any {
	parts := []string{"A prior Responses history item was omitted because Grok Build cannot deserialize this Codex item type.", "Type: " + kind}
	for _, key := range []string{"id", "call_id", "name", "status"} {
		if value := strings.TrimSpace(stringField(item, key)); value != "" {
			parts = append(parts, strings.ReplaceAll(key, "_", " ")+": "+value)
		}
	}
	return compatibilityBoundaryMessage(strings.Join(parts, "\n"))
}

func encodeFunctionArguments(value any) (string, error) {
	if text, ok := value.(string); ok {
		return text, nil
	}
	if value == nil {
		return "{}", nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}
