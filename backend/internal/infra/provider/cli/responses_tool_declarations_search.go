package cli

import (
	"strings"
)

func namespaceHasDeferredFunctions(children []any) bool {
	for _, rawChild := range children {
		child, ok := rawChild.(map[string]any)
		if !ok || stringField(child, "type") != "function" {
			continue
		}
		if deferred, _ := child["defer_loading"].(bool); deferred {
			return true
		}
	}
	return false
}

func describeDeferredTool(name, description string) string {
	description = strings.TrimSpace(description)
	if description == "" {
		return name
	}
	if len(description) > 240 {
		description = description[:240]
	}
	return name + ": " + description
}

func (c *responsesToolCompatibility) buildClientSearchFunction() (map[string]any, error) {
	identity := responsesToolIdentity{Kind: responsesToolSearch, Name: "tool_search"}
	description := strings.TrimSpace(stringField(c.clientSearchTool, "description"))
	if description == "" {
		description = "Search for tools needed to continue the task."
	}
	if len(c.deferredSurfaces) > 0 {
		description += "\nDeferred tool surfaces available to search:\n- " + strings.Join(c.deferredSurfaces, "\n- ")
	}
	if len(description) > maxToolSearchDescriptionBytes {
		description = description[:maxToolSearchDescriptionBytes]
	}
	parameters, exists := c.clientSearchTool["parameters"]
	if !exists {
		parameters = map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": true}
	} else if _, ok := parameters.(map[string]any); !ok {
		return nil, &responsesRequestError{Message: "tool_search.parameters 必须是对象", Param: c.clientSearchParam + ".parameters", Code: "invalid_parameter"}
	}
	return map[string]any{
		"type": "function", "name": c.alias(identity), "description": description,
		"parameters": cloneJSONValue(parameters),
	}, nil
}

func dedupeSlice(slice []any) []any {
	seen := make(map[string]bool)
	var result []any
	for _, item := range slice {
		str, ok := item.(string)
		if ok {
			if !seen[str] {
				seen[str] = true
				result = append(result, str)
			}
		} else {
			result = append(result, item)
		}
	}
	return result
}
