package cli

import (
	"fmt"
	"strings"
)

func (c *responsesToolCompatibility) normalizeAdditionalToolsInput(item map[string]any, param string) (map[string]any, []any, []any, error) {
	if role := strings.TrimSpace(stringField(item, "role")); role != "" && role != "developer" {
		c.addWarning("additional_tools_role_approximated")
	}
	tools, ok := item["tools"].([]any)
	if !ok {
		return nil, nil, nil, &responsesRequestError{Message: param + ".tools 必须是数组", Param: param + ".tools", Code: "invalid_parameter"}
	}
	c.addWarning("additional_tools_position_approximated")
	normalized := make([]any, 0, len(tools))
	names := make([]string, 0, len(tools))
	for index, rawTool := range tools {
		converted, err := c.normalizeTool(rawTool, "", false, true, fmt.Sprintf("%s.tools[%d]", param, index))
		if err != nil {
			return nil, nil, nil, err
		}
		normalized = append(normalized, converted...)
		if tool, ok := rawTool.(map[string]any); ok {
			name := strings.TrimSpace(stringField(tool, "name"))
			if name == "" {
				name = strings.TrimSpace(stringField(tool, "server_label"))
			}
			if name == "" {
				name = strings.TrimSpace(stringField(tool, "type"))
			}
			if name != "" {
				names = append(names, name)
			}
		}
	}
	message := "Additional tools become available at this point in the conversation."
	if len(names) > 0 {
		message += "\nTools: " + strings.Join(names, ", ")
	}
	return compatibilityBoundaryMessage(message), normalized, cloneJSONArray(tools), nil
}

func compatibilityBoundaryMessage(text string) map[string]any {
	return map[string]any{
		"type": "message", "role": "developer",
		"content": []any{map[string]any{"type": "input_text", "text": text}},
	}
}

func dedupeNormalizedTools(tools []any) []any {
	result := make([]any, 0, len(tools))
	positions := make(map[string]int)
	for _, raw := range tools {
		tool, ok := raw.(map[string]any)
		if !ok {
			result = append(result, raw)
			continue
		}
		kind := stringField(tool, "type")
		name := stringField(tool, "name")
		if name == "" {
			name = stringField(tool, "server_label")
		}
		key := kind + "\x00" + name
		if name == "" {
			key = kind
		}
		if index, exists := positions[key]; exists {
			result[index] = raw
			continue
		}
		positions[key] = len(result)
		result = append(result, raw)
	}
	return result
}

func (c *responsesToolCompatibility) addWarning(code string) {
	if c == nil || code == "" {
		return
	}
	if _, exists := c.warningSet[code]; exists {
		return
	}
	c.warningSet[code] = struct{}{}
	c.warnings = append(c.warnings, code)
}

func (c *responsesToolCompatibility) warningHeader() string {
	if c == nil {
		return ""
	}
	return strings.Join(c.warnings, ",")
}
