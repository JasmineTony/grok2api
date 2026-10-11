package cli

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

func normalizeLegacyLocalShellCallInput(item map[string]any, param string) (map[string]any, error) {
	callID := strings.TrimSpace(stringField(item, "call_id"))
	if callID == "" {
		return nil, &responsesRequestError{Message: param + ".call_id 不能为空", Param: param + ".call_id", Code: "invalid_parameter"}
	}
	action, err := legacyShellAction(item["action"], param+".action")
	if err != nil {
		return nil, err
	}
	converted := map[string]any{"type": "shell_call", "call_id": callID, "action": action}
	for _, key := range []string{"id", "status", "timeout_ms", "max_output_length"} {
		if value, exists := item[key]; exists {
			converted[key] = cloneJSONValue(value)
		}
	}
	return converted, nil
}

func legacyShellAction(value any, param string) (map[string]any, error) {
	action, ok := value.(map[string]any)
	if !ok {
		return nil, &responsesRequestError{Message: "local_shell_call.action 必须是对象", Param: param, Code: "invalid_parameter"}
	}
	if kind := strings.TrimSpace(stringField(action, "type")); kind != "" && kind != "exec" {
		return nil, &responsesRequestError{Message: "local_shell_call.action.type 必须是 exec", Param: param + ".type", Code: "invalid_parameter"}
	}
	command, err := legacyShellCommand(action, param)
	if err != nil {
		return nil, err
	}
	return map[string]any{"type": "exec", "commands": []any{command}}, nil
}

func legacyShellCommand(action map[string]any, param string) (string, error) {
	command := ""
	switch value := action["command"].(type) {
	case string:
		command = strings.TrimSpace(value)
	case []any:
		parts := make([]string, 0, len(value))
		for index, raw := range value {
			part, ok := raw.(string)
			if !ok {
				return "", &responsesRequestError{Message: "local_shell command 参数必须是字符串", Param: fmt.Sprintf("%s.command[%d]", param, index), Code: "invalid_parameter"}
			}
			parts = append(parts, quoteShellArgument(part))
		}
		command = strings.Join(parts, " ")
	default:
		if commands, ok := action["commands"].([]any); ok {
			parts := make([]string, 0, len(commands))
			for index, raw := range commands {
				part, ok := raw.(string)
				if !ok {
					return "", &responsesRequestError{Message: "shell commands 必须是字符串", Param: fmt.Sprintf("%s.commands[%d]", param, index), Code: "invalid_parameter"}
				}
				parts = append(parts, part)
			}
			command = strings.Join(parts, "\n")
		}
	}
	if command == "" {
		return "", &responsesRequestError{Message: "local_shell_call.action.command 不能为空", Param: param + ".command", Code: "invalid_parameter"}
	}
	if environment, ok := action["env"].(map[string]any); ok && len(environment) > 0 {
		keys := make([]string, 0, len(environment))
		for key := range environment {
			if !validEnvironmentName(key) {
				return "", &responsesRequestError{Message: "local_shell env 名称无效", Param: param + ".env." + key, Code: "invalid_parameter"}
			}
			keys = append(keys, key)
		}
		sort.Strings(keys)
		assignments := make([]string, 0, len(keys))
		for _, key := range keys {
			value, ok := environment[key].(string)
			if !ok {
				return "", &responsesRequestError{Message: "local_shell env 值必须是字符串", Param: param + ".env." + key, Code: "invalid_parameter"}
			}
			assignments = append(assignments, key+"="+quoteShellArgument(value))
		}
		command = "env " + strings.Join(assignments, " ") + " " + command
	}
	if directory := strings.TrimSpace(stringField(action, "working_directory")); directory != "" {
		command = "cd " + quoteShellArgument(directory) + " && " + command
	}
	return command, nil
}

func normalizeLegacyLocalShellOutputInput(item map[string]any, param string) (map[string]any, error) {
	callID := strings.TrimSpace(stringField(item, "call_id"))
	if callID == "" {
		return nil, &responsesRequestError{Message: param + ".call_id 不能为空", Param: param + ".call_id", Code: "invalid_parameter"}
	}
	var output []any
	switch value := item["output"].(type) {
	case []any:
		output = cloneJSONArray(value)
	case string:
		exitCode := 0
		if strings.EqualFold(stringField(item, "status"), "failed") {
			exitCode = 1
		}
		if number, ok := item["exit_code"].(float64); ok {
			exitCode = int(number)
		}
		output = []any{map[string]any{
			"stdout": value, "stderr": "",
			"outcome": map[string]any{"type": "exit", "exit_code": exitCode},
		}}
	default:
		return nil, &responsesRequestError{Message: "local_shell_call_output.output 必须是字符串或数组", Param: param + ".output", Code: "invalid_parameter"}
	}
	converted := map[string]any{"type": "shell_call_output", "call_id": callID, "output": output}
	if value, exists := item["max_output_length"]; exists && value != nil {
		converted["max_output_length"] = cloneJSONValue(value)
	}
	return converted, nil
}

func normalizeShellCallOutputInput(item map[string]any, param string) (map[string]any, error) {
	callID := strings.TrimSpace(stringField(item, "call_id"))
	if callID == "" {
		return nil, &responsesRequestError{Message: param + ".call_id 不能为空", Param: param + ".call_id", Code: "invalid_parameter"}
	}
	output, err := normalizeShellOutputBlocks(item["output"], item["status"], param+".output")
	if err != nil {
		return nil, err
	}
	converted := map[string]any{"type": "shell_call_output", "call_id": callID, "output": output}
	if value, exists := item["max_output_length"]; exists && value != nil {
		converted["max_output_length"] = cloneJSONValue(value)
	}
	return converted, nil
}

func normalizeShellOutputBlocks(value, status any, param string) ([]any, error) {
	switch typed := value.(type) {
	case []any:
		output := make([]any, 0, len(typed))
		for index, raw := range typed {
			block, ok := raw.(map[string]any)
			if !ok {
				return nil, &responsesRequestError{Message: fmt.Sprintf("%s[%d] 必须是对象", param, index), Param: fmt.Sprintf("%s[%d]", param, index), Code: "invalid_parameter"}
			}
			normalized, err := normalizeShellOutputBlock(block, fmt.Sprintf("%s[%d]", param, index))
			if err != nil {
				return nil, err
			}
			output = append(output, normalized)
		}
		return output, nil
	case string:
		exitCode := 0
		if strings.EqualFold(fmt.Sprint(status), "failed") {
			exitCode = 1
		}
		return []any{map[string]any{
			"stdout": typed, "stderr": "",
			"outcome": map[string]any{"type": "exit", "exit_code": exitCode},
		}}, nil
	default:
		return nil, &responsesRequestError{Message: param + " 必须是字符串或数组", Param: param, Code: "invalid_parameter"}
	}
}

func normalizeShellOutputBlock(block map[string]any, param string) (map[string]any, error) {
	stdout, _ := block["stdout"].(string)
	stderr, _ := block["stderr"].(string)
	outcome, ok := block["outcome"].(map[string]any)
	if !ok {
		return nil, &responsesRequestError{Message: param + ".outcome 必须是对象", Param: param + ".outcome", Code: "invalid_parameter"}
	}
	normalizedOutcome := map[string]any{"type": strings.TrimSpace(stringField(outcome, "type"))}
	switch normalizedOutcome["type"] {
	case "exit":
		exitCode, ok := shellExitCode(outcome["exit_code"])
		if !ok {
			exitCode, ok = shellExitCode(outcome["exitCode"])
		}
		if !ok {
			return nil, &responsesRequestError{Message: param + ".outcome.exit_code 必须是数字", Param: param + ".outcome.exit_code", Code: "invalid_parameter"}
		}
		normalizedOutcome["exit_code"] = exitCode
	case "timeout":
	default:
		return nil, &responsesRequestError{Message: param + ".outcome.type 无效", Param: param + ".outcome.type", Code: "invalid_parameter"}
	}
	return map[string]any{"stdout": stdout, "stderr": stderr, "outcome": normalizedOutcome}, nil
}

func shellExitCode(value any) (int, bool) {
	switch typed := value.(type) {
	case float64:
		return int(typed), true
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		return int(parsed), err == nil
	default:
		return 0, false
	}
}

func rewriteLegacyShellAction(value any) map[string]any {
	action, _ := value.(map[string]any)
	commands, _ := action["commands"].([]any)
	parts := make([]string, 0, len(commands))
	for _, raw := range commands {
		if command, ok := raw.(string); ok {
			parts = append(parts, command)
		}
	}
	legacy := map[string]any{"type": "exec", "command": strings.Join(parts, "\n")}
	return legacy
}

func quoteShellArgument(value string) string {
	if value == "" {
		return "''"
	}
	safe := true
	for _, character := range value {
		if !((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') || strings.ContainsRune("_@%+=:,./-", character)) {
			safe = false
			break
		}
	}
	if safe {
		return value
	}
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func validEnvironmentName(value string) bool {
	if value == "" {
		return false
	}
	for index, character := range value {
		if !((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || character == '_' || (index > 0 && character >= '0' && character <= '9')) {
			return false
		}
	}
	return true
}
