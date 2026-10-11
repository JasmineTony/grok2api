package cli

import (
	"encoding/json"
	"strings"
)

// normalizeShellTool 保留 OpenAI 新版 shell；同一请求不能同时声明新旧两套本地 shell。
func (c *responsesToolCompatibility) normalizeShellTool(tool map[string]any, param string) ([]any, error) {
	if c.legacyLocalShell {
		return nil, &responsesRequestError{
			Message: "同一请求不能同时声明 shell 和 local_shell",
			Param:   param + ".type", Code: "invalid_parameter",
		}
	}
	c.nativeShell = true
	return c.normalizeNativeTool(tool, param)
}

// normalizeLegacyLocalShellTool upgrades the legacy Codex local_shell declaration to Build's native shell shape.
func (c *responsesToolCompatibility) normalizeLegacyLocalShellTool(tool map[string]any, param string) ([]any, error) {
	if c.nativeShell || c.legacyLocalShell {
		return nil, &responsesRequestError{
			Message: "单次请求只能声明一个 shell/local_shell 工具",
			Param:   param + ".type", Code: "invalid_parameter",
		}
	}
	if len(tool) > 1 {
		c.addWarning("legacy_local_shell_controls_ignored")
	}
	c.legacyLocalShell = true
	c.changed = true
	c.addWarning("legacy_local_shell_upgraded")
	return []any{map[string]any{
		"type":        "shell",
		"environment": map[string]any{"type": "local"},
	}}, nil
}

// normalizeApplyPatchTool 将客户端执行的 apply_patch 包装为严格 function。
func (c *responsesToolCompatibility) normalizeApplyPatchTool(tool map[string]any, param string) ([]any, error) {
	if len(tool) > 1 {
		c.addWarning("apply_patch_controls_ignored")
	}
	identity := responsesToolIdentity{Kind: responsesApplyPatchTool, Name: "apply_patch"}
	c.changed = true
	c.addWarning("apply_patch_emulated")
	return []any{map[string]any{
		"type": "function",
		"name": c.alias(identity),
		"description": "Create, update, or delete one file using a structured V4A patch operation. " +
			"create_file and update_file require path and diff; delete_file requires path.",
		"parameters": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"operation": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"type": map[string]any{"type": "string", "enum": []any{"create_file", "update_file", "delete_file"}},
						"path": map[string]any{"type": "string", "minLength": 1},
						"diff": map[string]any{"type": "string"},
					},
					"required": []any{"type", "path"}, "additionalProperties": false,
				},
			},
			"required": []any{"operation"}, "additionalProperties": false,
		},
		"strict": true,
	}}, nil
}

func (c *responsesToolCompatibility) normalizeApplyPatchCallInput(item map[string]any, param string) (map[string]any, error) {
	callID := strings.TrimSpace(stringField(item, "call_id"))
	if callID == "" {
		return nil, &responsesRequestError{Message: param + ".call_id 不能为空", Param: param + ".call_id", Code: "invalid_parameter"}
	}
	operation, err := validateApplyPatchOperation(item["operation"], param+".operation")
	if err != nil {
		return nil, err
	}
	arguments, err := json.Marshal(map[string]any{"operation": operation})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"type": "function_call", "call_id": callID,
		"name":      c.alias(responsesToolIdentity{Kind: responsesApplyPatchTool, Name: "apply_patch"}),
		"arguments": string(arguments),
	}, nil
}

func normalizeApplyPatchOutputInput(item map[string]any, param string) (map[string]any, error) {
	callID := strings.TrimSpace(stringField(item, "call_id"))
	if callID == "" {
		return nil, &responsesRequestError{Message: param + ".call_id 不能为空", Param: param + ".call_id", Code: "invalid_parameter"}
	}
	status := strings.TrimSpace(stringField(item, "status"))
	if status == "" {
		status = "completed"
	}
	if status != "completed" && status != "failed" {
		return nil, &responsesRequestError{Message: "apply_patch_call_output.status 只支持 completed 或 failed", Param: param + ".status", Code: "invalid_parameter"}
	}
	output := ""
	if value, exists := item["output"]; exists && value != nil {
		if text, ok := value.(string); ok {
			output = text
		} else {
			encoded, err := json.Marshal(value)
			if err != nil {
				return nil, &responsesRequestError{Message: "apply_patch_call_output.output 无法编码", Param: param + ".output", Code: "invalid_parameter"}
			}
			output = string(encoded)
		}
	}
	message := "Apply patch status: " + status
	if output != "" {
		message += "\n" + output
	}
	return map[string]any{"type": "function_call_output", "call_id": callID, "output": message}, nil
}

func validateApplyPatchOperation(value any, param string) (map[string]any, error) {
	operation, ok := value.(map[string]any)
	if !ok {
		return nil, &responsesRequestError{Message: "apply_patch operation 必须是对象", Param: param, Code: "invalid_parameter"}
	}
	kind := strings.TrimSpace(stringField(operation, "type"))
	path := strings.TrimSpace(stringField(operation, "path"))
	if path == "" {
		return nil, &responsesRequestError{Message: "apply_patch operation.path 不能为空", Param: param + ".path", Code: "invalid_parameter"}
	}
	switch kind {
	case "create_file", "update_file":
		if _, ok := operation["diff"].(string); !ok {
			return nil, &responsesRequestError{Message: kind + " 必须提供 diff 字符串", Param: param + ".diff", Code: "invalid_parameter"}
		}
	case "delete_file":
	default:
		return nil, &responsesRequestError{Message: "apply_patch operation.type 无效", Param: param + ".type", Code: "invalid_parameter"}
	}
	return cloneJSONObject(operation), nil
}

func decodeApplyPatchArguments(value any, param string) (map[string]any, error) {
	text, ok := value.(string)
	if !ok {
		return nil, &responsesRequestError{Message: "apply_patch function arguments 必须是字符串", Param: param, Code: "invalid_parameter"}
	}
	var wrapper map[string]any
	if err := json.Unmarshal([]byte(text), &wrapper); err != nil {
		return nil, &responsesRequestError{Message: "apply_patch function arguments 不是有效 JSON", Param: param, Code: "invalid_parameter"}
	}
	return validateApplyPatchOperation(wrapper["operation"], param+".operation")
}
