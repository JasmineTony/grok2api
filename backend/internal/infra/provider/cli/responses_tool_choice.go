package cli

import (
	"encoding/json"
	"fmt"
	"strings"
)

func (c *responsesToolCompatibility) normalizeToolChoice(payload map[string]json.RawMessage, normalizedTools []any) error {
	raw := payload["tool_choice"]
	if isEmptyJSON(raw) {
		return nil
	}
	if len(normalizedTools) == 0 {
		c.dropToolChoiceWithoutTools(payload)
		return nil
	}
	var choice any
	if err := json.Unmarshal(raw, &choice); err != nil {
		return &responsesRequestError{Message: "tool_choice 格式无效", Param: "tool_choice", Code: "invalid_parameter"}
	}
	object, ok := choice.(map[string]any)
	if !ok {
		c.normalizeStringToolChoice(payload, choice, normalizedTools)
		return nil
	}
	kind := stringField(object, "type")
	if handled, err := c.normalizeNonFunctionToolChoice(payload, object, kind, normalizedTools); handled {
		return err
	}
	return c.normalizeFunctionToolChoice(payload, object)
}

// dropToolChoiceWithoutTools 在请求未声明任何工具时丢弃 tool_choice。
func (c *responsesToolCompatibility) dropToolChoiceWithoutTools(payload map[string]json.RawMessage) {
	delete(payload, "tool_choice")
	c.changed = true
	c.addWarning("tool_choice_without_tools_ignored")
	if c.serverSearchEager {
		c.addWarning("server_tool_search_choice_downgraded")
	}
}

// normalizeStringToolChoice 处理字符串形式的 tool_choice，web_search 被禁用时降级为 none。
func (c *responsesToolCompatibility) normalizeStringToolChoice(payload map[string]json.RawMessage, choice any, normalizedTools []any) {
	value, isString := choice.(string)
	if !isString || (value != "auto" && value != "required") {
		return
	}
	if !c.webSearchDisabled || len(normalizedTools) != 0 {
		return
	}
	payload["tool_choice"] = mustJSON("none")
	c.changed = true
	c.addWarning("web_search_tool_choice_disabled")
}

// normalizeNonFunctionToolChoice 处理非 function 类型的对象 tool_choice；
// handled 为 true 时调用方直接返回 err，为 false 时继续走 function 分支。
func (c *responsesToolCompatibility) normalizeNonFunctionToolChoice(payload map[string]json.RawMessage, object map[string]any, kind string, normalizedTools []any) (bool, error) {
	if c.webSearchDisabled && normalizeHostedToolChoiceKind(kind) == "web_search" && !hasToolType(normalizedTools, "web_search") {
		payload["tool_choice"] = mustJSON("none")
		c.changed = true
		c.addWarning("web_search_tool_choice_disabled")
		return true, nil
	}
	if kind == "tool_search" {
		return true, c.normalizeToolSearchChoice(payload)
	}
	if kind == "custom" {
		return true, c.normalizeCustomToolChoice(payload, object)
	}
	if kind == "apply_patch" {
		return true, c.normalizeApplyPatchToolChoice(payload)
	}
	if normalizedKind := normalizeHostedToolChoiceKind(kind); normalizedKind != "" {
		return true, c.normalizeHostedToolChoice(payload, normalizedTools, normalizedKind)
	}
	if kind != "function" {
		return true, &responsesRequestError{Message: fmt.Sprintf("Grok Build 不支持 tool_choice.type=%q", kind), Param: "tool_choice.type", Code: "unsupported_parameter"}
	}
	return false, nil
}

// normalizeToolSearchChoice 处理 tool_choice.type=tool_search。
func (c *responsesToolCompatibility) normalizeToolSearchChoice(payload map[string]json.RawMessage) error {
	if c.clientSearchTool == nil {
		if c.serverSearchEager {
			payload["tool_choice"] = mustJSON("auto")
			c.changed = true
			c.addWarning("server_tool_search_choice_downgraded")
			return nil
		}
		return &responsesRequestError{Message: "tool_choice 引用了未声明的 tool_search", Param: "tool_choice", Code: "invalid_parameter"}
	}
	object := map[string]any{
		"type": "function",
		"name": c.alias(responsesToolIdentity{Kind: responsesToolSearch, Name: "tool_search"}),
	}
	c.changed = true
	payload["tool_choice"] = mustJSON(object)
	return nil
}

// normalizeCustomToolChoice 处理 tool_choice.type=custom。
func (c *responsesToolCompatibility) normalizeCustomToolChoice(payload map[string]json.RawMessage, object map[string]any) error {
	name := strings.TrimSpace(stringField(object, "name"))
	namespace := strings.TrimSpace(stringField(object, "namespace"))
	if name == "" {
		return &responsesRequestError{Message: "tool_choice.name 不能为空", Param: "tool_choice.name", Code: "invalid_parameter"}
	}
	identity := responsesToolIdentity{Kind: responsesCustomTool, Namespace: namespace, Name: name}
	alias, exists := c.identityAliases[identity.key()]
	if !exists {
		return &responsesRequestError{Message: "tool_choice 引用了未声明的 custom 工具", Param: "tool_choice.name", Code: "invalid_parameter"}
	}
	object["type"] = "function"
	object["name"] = alias
	delete(object, "namespace")
	c.changed = true
	payload["tool_choice"] = mustJSON(object)
	return nil
}

// normalizeApplyPatchToolChoice 处理 tool_choice.type=apply_patch。
func (c *responsesToolCompatibility) normalizeApplyPatchToolChoice(payload map[string]json.RawMessage) error {
	identity := responsesToolIdentity{Kind: responsesApplyPatchTool, Name: "apply_patch"}
	alias, exists := c.identityAliases[identity.key()]
	if !exists {
		return &responsesRequestError{Message: "tool_choice 引用了未声明的 apply_patch 工具", Param: "tool_choice", Code: "invalid_parameter"}
	}
	payload["tool_choice"] = mustJSON(map[string]any{"type": "function", "name": alias})
	c.changed = true
	return nil
}

// normalizeHostedToolChoice 把 hosted tool 选择收窄为上游支持的 required。
func (c *responsesToolCompatibility) normalizeHostedToolChoice(payload map[string]json.RawMessage, normalizedTools []any, normalizedKind string) error {
	matching := toolsOfType(normalizedTools, normalizedKind)
	if len(matching) == 0 {
		return &responsesRequestError{Message: "tool_choice 引用了未声明的 hosted tool", Param: "tool_choice", Code: "invalid_parameter"}
	}
	if len(matching) != len(normalizedTools) {
		// 上游只支持 required，收窄本轮可见工具即可保持“指定该类工具”的语义。
		payload["tools"] = mustJSON(matching)
		c.addWarning("hosted_tool_choice_tools_narrowed")
	}
	payload["tool_choice"] = mustJSON("required")
	c.changed = true
	return nil
}

// normalizeFunctionToolChoice 处理 tool_choice.type=function（含嵌套 function 对象）。
func (c *responsesToolCompatibility) normalizeFunctionToolChoice(payload map[string]json.RawMessage, object map[string]any) error {
	name := strings.TrimSpace(stringField(object, "name"))
	namespace := strings.TrimSpace(stringField(object, "namespace"))
	if function, nested := object["function"].(map[string]any); nested {
		return c.normalizeNestedFunctionChoice(payload, object, function)
	}
	if name != "" && namespace == "" {
		c.aliasFlatFunctionChoice(payload, object, name)
		return nil
	}
	if name == "" || namespace == "" {
		return nil
	}
	return c.aliasNamespacedFunctionChoice(payload, object, namespace, name)
}

// normalizeNestedFunctionChoice 处理 tool_choice.function 嵌套形式。
func (c *responsesToolCompatibility) normalizeNestedFunctionChoice(payload map[string]json.RawMessage, object, function map[string]any) error {
	name := strings.TrimSpace(stringField(function, "name"))
	namespace := strings.TrimSpace(stringField(function, "namespace"))
	if name != "" && c.applyNestedFunctionAlias(payload, object, function, namespace, name) {
		return nil
	}
	if name == "" || namespace == "" {
		return nil
	}
	identity := responsesToolIdentity{Kind: responsesFunctionTool, Namespace: namespace, Name: name}
	alias, exists := c.identityAliases[identity.key()]
	if !exists {
		return &responsesRequestError{Message: "tool_choice 引用了未声明的 namespace 函数", Param: "tool_choice.function.name", Code: "invalid_parameter"}
	}
	function["name"] = alias
	delete(function, "namespace")
	c.changed = true
	payload["tool_choice"] = mustJSON(object)
	return nil
}

// applyNestedFunctionAlias 在嵌套 function 已声明时改写别名；返回 true 表示已写回 payload。
func (c *responsesToolCompatibility) applyNestedFunctionAlias(payload map[string]json.RawMessage, object, function map[string]any, namespace, name string) bool {
	identity := responsesToolIdentity{Kind: responsesFunctionTool, Namespace: namespace, Name: name}
	alias, exists := c.identityAliases[identity.key()]
	if !exists {
		return false
	}
	function["name"] = alias
	if namespace == "" && alias != name {
		c.changed = true
		payload["tool_choice"] = mustJSON(object)
		return true
	}
	if name != "" && namespace != "" {
		delete(function, "namespace")
		c.changed = true
		payload["tool_choice"] = mustJSON(object)
		return true
	}
	return false
}

// aliasFlatFunctionChoice 处理无 namespace 的 function tool_choice 别名改写。
func (c *responsesToolCompatibility) aliasFlatFunctionChoice(payload map[string]json.RawMessage, object map[string]any, name string) {
	identity := responsesToolIdentity{Kind: responsesFunctionTool, Name: name}
	if alias, exists := c.identityAliases[identity.key()]; exists && alias != name {
		object["name"] = alias
		c.changed = true
		payload["tool_choice"] = mustJSON(object)
	}
}

// aliasNamespacedFunctionChoice 处理带 namespace 的 function tool_choice 别名改写。
func (c *responsesToolCompatibility) aliasNamespacedFunctionChoice(payload map[string]json.RawMessage, object map[string]any, namespace, name string) error {
	identity := responsesToolIdentity{Kind: responsesFunctionTool, Namespace: namespace, Name: name}
	alias, exists := c.identityAliases[identity.key()]
	if !exists {
		return &responsesRequestError{Message: "tool_choice 引用了未声明的 namespace 函数", Param: "tool_choice.name", Code: "invalid_parameter"}
	}
	object["name"] = alias
	delete(object, "namespace")
	c.changed = true
	payload["tool_choice"] = mustJSON(object)
	return nil
}

func toolsOfType(tools []any, kind string) []any {
	matching := make([]any, 0)
	for _, rawTool := range tools {
		tool, ok := rawTool.(map[string]any)
		if ok && stringField(tool, "type") == kind {
			matching = append(matching, rawTool)
		}
	}
	return matching
}
