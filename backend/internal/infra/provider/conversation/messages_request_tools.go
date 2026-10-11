package conversation

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

func convertAnthropicTools(tools []map[string]json.RawMessage) ([]any, error) {
	result := make([]any, 0, len(tools))
	for index, tool := range tools {
		var typeName string
		_ = json.Unmarshal(tool["type"], &typeName)
		if strings.HasPrefix(typeName, "web_search_") {
			converted, err := convertAnthropicWebSearchTool(tool, index)
			if err != nil {
				return nil, err
			}
			result = append(result, converted)
			continue
		}
		if typeName != "" && typeName != "custom" {
			return nil, fmt.Errorf("当前不支持 Anthropic server tool type=%q", typeName)
		}
		var name, description string
		_ = json.Unmarshal(tool["name"], &name)
		_ = json.Unmarshal(tool["description"], &description)
		if strings.TrimSpace(name) == "" {
			return nil, errors.New("Anthropic tool 缺少 name")
		}
		var schema any = map[string]any{"type": "object", "properties": map[string]any{}}
		if raw := tool["input_schema"]; !isEmptyJSON(raw) {
			if json.Unmarshal(raw, &schema) != nil {
				return nil, fmt.Errorf("tool %q 的 input_schema 无效", name)
			}
		}
		converted := map[string]any{"type": "function", "name": name, "description": description, "parameters": schema}
		var strict bool
		if raw := tool["strict"]; !isEmptyJSON(raw) {
			if json.Unmarshal(raw, &strict) != nil {
				return nil, fmt.Errorf("tool %q 的 strict 必须是布尔值", name)
			}
			converted["strict"] = strict
		}
		result = append(result, converted)
	}
	return result, nil
}

func hasAnthropicWebSearchTool(tools []map[string]json.RawMessage) bool {
	for _, tool := range tools {
		var typeName string
		_ = json.Unmarshal(tool["type"], &typeName)
		if strings.HasPrefix(typeName, "web_search_") {
			return true
		}
	}
	return false
}

func anthropicWebSearchRequired(tools []map[string]json.RawMessage, choice *anthropicToolChoice) bool {
	if choice == nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(choice.Type)) {
	case "tool":
		return strings.EqualFold(strings.TrimSpace(choice.Name), "web_search")
	case "any":
		return len(tools) == 1 && hasAnthropicWebSearchTool(tools)
	default:
		return false
	}
}

func anthropicWebSearchQuery(messages []anthropicMessage) string {
	const prefix = "perform a web search for the query:"
	for index := len(messages) - 1; index >= 0; index-- {
		if !strings.EqualFold(strings.TrimSpace(messages[index].Role), "user") {
			continue
		}
		text := anthropicMessageText(messages[index].Content)
		if text == "" {
			continue
		}
		if offset := strings.Index(strings.ToLower(text), prefix); offset >= 0 {
			text = strings.TrimSpace(text[offset+len(prefix):])
		}
		return truncateRunes(strings.TrimSpace(text), 4096)
	}
	return ""
}

func anthropicMessageText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return strings.TrimSpace(text)
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) != nil {
		return ""
	}
	parts := make([]string, 0, len(blocks))
	for _, block := range blocks {
		if block.Type == "text" && strings.TrimSpace(block.Text) != "" {
			parts = append(parts, strings.TrimSpace(block.Text))
		}
	}
	return strings.Join(parts, "\n")
}

func truncateRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func convertAnthropicWebSearchTool(tool map[string]json.RawMessage, index int) (map[string]any, error) {
	converted := map[string]any{"type": "web_search"}
	for key, raw := range tool {
		switch key {
		case "type", "name", "cache_control":
			continue
		case "allowed_domains", "blocked_domains", "excluded_domains":
			var value any
			if json.Unmarshal(raw, &value) != nil {
				return nil, fmt.Errorf("tools[%d].%s 无效", index, key)
			}
			domains, ok := value.([]any)
			if !ok {
				return nil, fmt.Errorf("tools[%d].%s 必须是字符串数组", index, key)
			}
			if len(domains) > MaxWebSearchDomains {
				return nil, fmt.Errorf("tools[%d].%s 不能超过 %d 个域名", index, key, MaxWebSearchDomains)
			}
			for domainIndex, domain := range domains {
				if text, ok := domain.(string); !ok || strings.TrimSpace(text) == "" {
					return nil, fmt.Errorf("tools[%d].%s[%d] 必须是非空字符串", index, key, domainIndex)
				}
			}
			field := key
			if field == "blocked_domains" {
				field = "excluded_domains"
			}
			filters, _ := converted["filters"].(map[string]any)
			if filters == nil {
				filters = make(map[string]any, 2)
			}
			if len(domains) > 0 {
				if _, exists := filters[field]; exists {
					return nil, fmt.Errorf("tools[%d].%s 与同义域名过滤字段重复", index, key)
				}
				other := "allowed_domains"
				if field == other {
					other = "excluded_domains"
				}
				if existing, ok := filters[other].([]any); ok && len(existing) > 0 {
					return nil, fmt.Errorf("tools[%d] 不能同时设置 allowed_domains 和 blocked_domains/excluded_domains", index)
				}
				filters[field] = value
				converted["filters"] = filters
			}
		case "max_uses", "user_location", "search_context_size":
			// These Anthropic controls have no equivalent in the Build web-search wire contract,
			// preventing unknown parameters from causing the upstream to reject the request.
			continue
		default:
			// Preserve forward compatibility with future hosted-tool optional fields.
			continue
		}
	}
	return converted, nil
}

type anthropicMCPServer struct {
	Name               string `json:"name"`
	URL                string `json:"url"`
	AuthorizationToken string `json:"authorization_token"`
}

func convertAnthropicMCPServers(servers []anthropicMCPServer) ([]any, error) {
	result := make([]any, 0, len(servers))
	for index, server := range servers {
		name := strings.TrimSpace(server.Name)
		url := strings.TrimSpace(server.URL)
		if name == "" || url == "" {
			return nil, fmt.Errorf("mcp_servers[%d] 缺少 name 或 url", index)
		}
		tool := map[string]any{"type": "mcp", "server_label": name, "server_url": url}
		if server.AuthorizationToken != "" {
			tool["authorization"] = server.AuthorizationToken
		}
		result = append(result, tool)
	}
	return result, nil
}

func anthropicThinkingEffort(budget int) string {
	switch {
	case budget > 0 && budget <= 2048:
		return "low"
	case budget > 10000:
		return "high"
	default:
		return "medium"
	}
}

func convertAnthropicToolChoice(choice anthropicToolChoice, hasHostedWebSearch bool) (any, bool, error) {
	parallel := !choice.DisableParallelToolUse
	switch choice.Type {
	case "auto", "none":
		return choice.Type, parallel, nil
	case "any":
		return "required", parallel, nil
	case "tool":
		if strings.TrimSpace(choice.Name) == "" {
			return nil, false, errors.New("tool_choice.tool 缺少 name")
		}
		// Claude Code secondary search uses a hosted tool with name=web_search.
		// When only one hosted tool remains, Grok Build accepts only required tool_choice.
		if hasHostedWebSearch && strings.EqualFold(strings.TrimSpace(choice.Name), "web_search") {
			return "required", parallel, nil
		}
		return map[string]any{"type": "function", "name": choice.Name}, parallel, nil
	default:
		return nil, false, fmt.Errorf("不支持 tool_choice.type=%q", choice.Type)
	}
}
