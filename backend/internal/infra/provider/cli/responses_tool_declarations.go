package cli

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
)

func normalizeResponsesTools(payload map[string]json.RawMessage) (*responsesToolCompatibility, error) {
	if rawTools := payload["tools"]; len(rawTools) > 0 && strings.Contains(string(rawTools), "automation_update") {
		slog.Info("DEBUG_RAW_AUTOMATION_TOOLS", "tools", string(rawTools))
	}
	compatibility := newResponsesToolCompatibility()
	tools, hasTools, err := decodeOptionalArray(payload["tools"], "tools")
	if err != nil {
		return nil, err
	}
	if hasTools {
		compatibility.visibleTools = cloneJSONArray(tools)
	}
	clientSearch, err := inspectToolSearch(tools)
	if err != nil {
		return nil, err
	}
	if err := compatibility.normalizeClientToolSearchParallel(payload, clientSearch); err != nil {
		return nil, err
	}
	normalizedTools, err := compatibility.collectNormalizedTools(tools, clientSearch, payload)
	if err != nil {
		return nil, err
	}
	if err := compatibility.publishNormalizedTools(payload, normalizedTools, hasTools); err != nil {
		return nil, err
	}
	if !compatibility.changed && len(compatibility.functionSchemas) == 0 {
		return nil, nil
	}
	return compatibility, nil
}

// collectNormalizedTools 归一化已声明工具，并并入 input 历史与客户端搜索加载的定义。
func (c *responsesToolCompatibility) collectNormalizedTools(tools []any, clientSearch bool, payload map[string]json.RawMessage) ([]any, error) {
	normalizedTools := make([]any, 0, len(tools))
	for index, rawTool := range tools {
		converted, err := c.normalizeTool(rawTool, "", clientSearch, false, fmt.Sprintf("tools[%d]", index))
		if err != nil {
			return nil, err
		}
		normalizedTools = append(normalizedTools, converted...)
	}
	loadedTools, err := c.rewriteDeclaredInput(payload)
	if err != nil {
		return nil, err
	}
	normalizedTools = append(normalizedTools, loadedTools...)
	if c.clientSearchTool != nil {
		searchTool, err := c.buildClientSearchFunction()
		if err != nil {
			return nil, err
		}
		normalizedTools = append(normalizedTools, searchTool)
	}
	return dedupeNormalizedTools(normalizedTools), nil
}

// rewriteDeclaredInput 归一化 input 历史项并回写，返回其中动态加载的工具定义。
func (c *responsesToolCompatibility) rewriteDeclaredInput(payload map[string]json.RawMessage) ([]any, error) {
	rawInput := payload["input"]
	if isEmptyJSON(rawInput) {
		return nil, nil
	}
	var input any
	if err := json.Unmarshal(rawInput, &input); err != nil {
		return nil, &responsesRequestError{Message: "input 必须是字符串或数组", Param: "input", Code: "invalid_parameter"}
	}
	items, ok := input.([]any)
	if !ok {
		return nil, nil
	}
	rewritten, loadedTools, visibleTools, err := c.normalizeInputItems(items)
	if err != nil {
		return nil, err
	}
	c.visibleTools = append(c.visibleTools, visibleTools...)
	payload["input"] = mustJSON(rewritten)
	return loadedTools, nil
}

// publishNormalizedTools 回写 tools 字段并同步 tool_choice。
func (c *responsesToolCompatibility) publishNormalizedTools(payload map[string]json.RawMessage, normalizedTools []any, hasTools bool) error {
	if len(normalizedTools) > 0 {
		payload["tools"] = mustJSON(normalizedTools)
	} else if hasTools {
		delete(payload, "tools")
		if _, exists := payload["parallel_tool_calls"]; exists {
			delete(payload, "parallel_tool_calls")
			c.addWarning("parallel_tool_calls_without_tools_ignored")
		}
		c.changed = true
	}
	if rawTools := payload["tools"]; len(rawTools) > 0 && strings.Contains(string(rawTools), "automation_update") {
		slog.Info("DEBUG_NORMALIZED_AUTOMATION_TOOLS", "tools", string(rawTools))
	}
	return c.normalizeToolChoice(payload, normalizedTools)
}

// normalizeClientToolSearchParallel 保证搜索函数先独立完成，再由客户端选择并回传工具定义。
func (c *responsesToolCompatibility) normalizeClientToolSearchParallel(payload map[string]json.RawMessage, clientSearch bool) error {
	if !clientSearch {
		return nil
	}
	raw, exists := payload["parallel_tool_calls"]
	if !exists || isEmptyJSON(raw) {
		payload["parallel_tool_calls"] = mustJSON(false)
		c.changed = true
		return nil
	}
	var parallel bool
	if err := json.Unmarshal(raw, &parallel); err != nil {
		return &responsesRequestError{
			Message: "parallel_tool_calls 必须是布尔值",
			Param:   "parallel_tool_calls", Code: "invalid_parameter",
		}
	}
	if parallel {
		payload["parallel_tool_calls"] = mustJSON(false)
		c.changed = true
		c.addWarning("client_tool_search_forced_serial")
	}
	return nil
}

func decodeOptionalArray(raw json.RawMessage, param string) ([]any, bool, error) {
	if isEmptyJSON(raw) {
		return nil, false, nil
	}
	var values []any
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, false, &responsesRequestError{Message: param + " 必须是数组", Param: param, Code: "invalid_parameter"}
	}
	return values, true, nil
}

func inspectToolSearch(tools []any) (bool, error) {
	clientSearch := false
	serverSearch := false
	for index, rawTool := range tools {
		tool, ok := rawTool.(map[string]any)
		if !ok {
			return false, &responsesRequestError{Message: fmt.Sprintf("tools[%d] 必须是对象", index), Param: fmt.Sprintf("tools[%d]", index), Code: "invalid_parameter"}
		}
		if stringField(tool, "type") != "tool_search" {
			continue
		}
		param := fmt.Sprintf("tools[%d]", index)
		execution := strings.ToLower(strings.TrimSpace(stringField(tool, "execution")))
		if execution == "" || execution == "server" {
			if clientSearch {
				return false, &responsesRequestError{Message: "单次请求不能混用 client 与 server tool_search", Param: param + ".execution", Code: "invalid_parameter"}
			}
			serverSearch = true
			continue
		}
		if execution != "client" {
			return false, &responsesRequestError{Message: "tool_search.execution 必须是 client 或 server", Param: param + ".execution", Code: "invalid_parameter"}
		}
		if clientSearch {
			return false, &responsesRequestError{Message: "单次请求只能声明一个客户端 tool_search", Param: param, Code: "invalid_parameter"}
		}
		if serverSearch {
			return false, &responsesRequestError{Message: "单次请求不能混用 client 与 server tool_search", Param: param + ".execution", Code: "invalid_parameter"}
		}
		clientSearch = true
	}
	return clientSearch, nil
}

func (c *responsesToolCompatibility) normalizeTool(raw any, namespace string, clientSearch, force bool, param string) ([]any, error) {
	tool, ok := raw.(map[string]any)
	if !ok {
		return nil, &responsesRequestError{Message: param + " 必须是对象", Param: param, Code: "invalid_parameter"}
	}
	kind := strings.TrimSpace(stringField(tool, "type"))
	switch kind {
	case "function":
		return c.normalizeFunctionTool(tool, namespace, clientSearch, force, param)
	case "namespace":
		return c.normalizeNamespaceTool(tool, clientSearch, force, param)
	case "tool_search":
		return c.normalizeToolSearchDeclaration(tool, force, param)
	case "custom":
		return c.normalizeCustomTool(tool, namespace, param)
	case "web_search", "web_search_preview", "web_search_preview_2025_03_11", "web_search_2025_08_26":
		return c.normalizeWebSearchTool(tool, kind, param)
	case "mcp":
		return c.normalizeMCPTool(tool, clientSearch, force, param)
	case "shell":
		return c.normalizeShellTool(tool, param)
	case "local_shell":
		return c.normalizeLegacyLocalShellTool(tool, param)
	case "apply_patch":
		return c.normalizeApplyPatchTool(tool, param)
	case "x_search":
		return c.normalizeXSearchTool(tool, param)
	case "image_generation", "collections_search", "file_search", "code_execution", "code_interpreter":
		return c.normalizeNativeTool(tool, param)
	case "computer_use_preview":
		return nil, unsupportedBuildToolError(kind, param)
	default:
		if kind == "" {
			return nil, &responsesRequestError{Message: param + ".type 不能为空", Param: param + ".type", Code: "invalid_parameter"}
		}
		return nil, unsupportedBuildToolError(kind, param)
	}
}

func (c *responsesToolCompatibility) normalizeFunctionTool(tool map[string]any, namespace string, clientSearch, force bool, param string) ([]any, error) {
	name := strings.TrimSpace(stringField(tool, "name"))
	if name == "" {
		return nil, &responsesRequestError{Message: param + ".name 不能为空", Param: param + ".name", Code: "invalid_parameter"}
	}
	deferred, _ := tool["defer_loading"].(bool)
	if deferred && !clientSearch && !force {
		c.changed = true
		c.addWarning("orphan_deferred_tool_loaded")
	}
	if deferred && clientSearch && !force {
		c.changed = true
		if namespace == "" {
			c.deferredSurfaces = append(c.deferredSurfaces, describeDeferredTool(name, stringField(tool, "description")))
		}
		return nil, nil
	}
	converted := cloneJSONObject(tool)
	if err := c.normalizeFunctionToolParameters(converted, param, name); err != nil {
		return nil, err
	}
	identity := responsesToolIdentity{Kind: responsesFunctionTool, Namespace: namespace, Name: name}
	alias := c.functionAlias(identity)
	if alias != name {
		c.changed = true
		if strings.EqualFold(name, "view_image") && namespace == "" {
			c.addWarning("view_image_name_normalized")
		}
	}
	if parameters, exists := tool["parameters"]; exists && schemaContainsInteger(parameters) {
		c.functionSchemas[alias] = cloneJSONValue(parameters)
	}
	converted["name"] = alias
	if namespace != "" || alias != name {
		c.changed = true
	}
	if _, exists := converted["defer_loading"]; exists {
		delete(converted, "defer_loading")
		c.changed = true
	}
	return []any{converted}, nil
}

// normalizeFunctionToolParameters 统一 function 工具的 schema 键名并归一化参数根结构。
func (c *responsesToolCompatibility) normalizeFunctionToolParameters(converted map[string]any, param, name string) error {
	if inputSchema, exists := converted["inputSchema"]; exists {
		converted["parameters"] = inputSchema
		delete(converted, "inputSchema")
		c.changed = true
	} else if inputSchema, exists := converted["input_schema"]; exists {
		converted["parameters"] = inputSchema
		delete(converted, "input_schema")
		c.changed = true
	}
	parameters, exists := converted["parameters"]
	if !exists {
		return nil
	}
	normalized, changed, err := normalizeBuildFunctionParametersRootForTool(parameters, param+".parameters", name)
	if err != nil {
		return err
	}
	if changed {
		converted["parameters"] = normalized
		c.changed = true
		c.addWarning("function_parameters_root_normalized")
	}
	return nil
}

// normalizeNamespaceTool 展开 namespace 容器，把子工具按命名空间别名展平。
func (c *responsesToolCompatibility) normalizeNamespaceTool(tool map[string]any, clientSearch, force bool, param string) ([]any, error) {
	name := strings.TrimSpace(stringField(tool, "name"))
	if name == "" {
		return nil, &responsesRequestError{Message: param + ".name 不能为空", Param: param + ".name", Code: "invalid_parameter"}
	}
	children, ok := tool["tools"].([]any)
	if !ok {
		return nil, &responsesRequestError{Message: param + ".tools 必须是数组", Param: param + ".tools", Code: "invalid_parameter"}
	}
	c.changed = true
	c.addWarning("namespace_flattened")
	if clientSearch && !force && namespaceHasDeferredFunctions(children) {
		c.deferredSurfaces = append(c.deferredSurfaces, describeDeferredTool(name, stringField(tool, "description")))
	}
	converted := make([]any, 0, len(children))
	for index, rawChild := range children {
		items, err := c.normalizeNamespaceChild(rawChild, name, clientSearch, force, fmt.Sprintf("%s.tools[%d]", param, index))
		if err != nil {
			return nil, err
		}
		converted = append(converted, items...)
	}
	return converted, nil
}

func (c *responsesToolCompatibility) normalizeNamespaceChild(rawChild any, namespace string, clientSearch, force bool, childParam string) ([]any, error) {
	child, ok := rawChild.(map[string]any)
	if !ok {
		return nil, &responsesRequestError{Message: childParam + " 必须是对象", Param: childParam, Code: "invalid_parameter"}
	}
	if stringField(child, "type") != "function" {
		return nil, &responsesRequestError{Message: "namespace.tools 只能包含 function 工具", Param: childParam + ".type", Code: "invalid_parameter"}
	}
	return c.normalizeTool(child, namespace, clientSearch, force, childParam)
}

// normalizeToolSearchDeclaration 处理顶层 tool_search 声明：Build 上游没有服务端搜索。
func (c *responsesToolCompatibility) normalizeToolSearchDeclaration(tool map[string]any, force bool, param string) ([]any, error) {
	if force {
		c.changed = true
		c.addWarning("nested_tool_search_ignored")
		return nil, nil
	}
	execution := strings.ToLower(strings.TrimSpace(stringField(tool, "execution")))
	if execution == "" || execution == "server" {
		// Build 上游没有服务端 Tool Search。将已声明的延迟工具提前展开，
		// 比让 Codex 因一个可选优化能力整次失败更符合兼容层语义。
		c.serverSearchEager = true
		c.changed = true
		c.addWarning("server_tool_search_eager_loaded")
		return nil, nil
	}
	c.changed = true
	c.addWarning("client_tool_search_emulated")
	c.clientSearchTool = cloneJSONObject(tool)
	c.clientSearchParam = param
	return nil, nil
}
