package conversation

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const anthropicBillingHeaderPrefix = "x-anthropic-billing-header: "

func convertMessagesRequest(body []byte, model string) ([]byte, ResponseOptions, error) {
	return convertMessagesRequestWithReasoningReplay(body, model, nil, "")
}

func convertMessagesRequestWithReasoningReplay(body []byte, model string, cache *ReasoningCache, scope string) ([]byte, ResponseOptions, error) {
	var request anthropicRequest
	if err := json.Unmarshal(body, &request); err != nil {
		return nil, ResponseOptions{}, fmt.Errorf("解析 Messages 请求: %w", err)
	}
	if len(request.Messages) == 0 {
		return nil, ResponseOptions{}, errors.New("messages 必须是非空数组")
	}
	if request.MaxTokens <= 0 {
		return nil, ResponseOptions{}, errors.New("max_tokens 必须是正整数")
	}
	for name, value := range map[string]*float64{"temperature": request.Temperature, "top_p": request.TopP} {
		if value != nil && (*value < 0 || *value > 1) {
			return nil, ResponseOptions{}, fmt.Errorf("%s 必须在 0 到 1 之间", name)
		}
	}
	for index, sequence := range request.StopSequences {
		if sequence == "" {
			return nil, ResponseOptions{}, fmt.Errorf("stop_sequences[%d] 不能为空", index)
		}
	}
	thinkingEnabled := false
	reasoningEffort := ""
	reasoningEffortSet := false
	if request.Thinking != nil {
		switch request.Thinking.Type {
		case "":
		case "disabled":
			reasoningEffort = "none"
			reasoningEffortSet = true
		case "enabled", "adaptive":
			thinkingEnabled = true
		default:
			return nil, ResponseOptions{}, fmt.Errorf("不支持 thinking.type=%q", request.Thinking.Type)
		}
	}
	// Hosted web search has a separate server-side history contract.  The
	// gateway deliberately does not bridge opaque reasoning for these turns
	// (see the adapter's web-search isolation below), so disable the bridge
	// before converting messages rather than trying to remove an already
	// injected item afterwards.
	hasWebSearchTool := hasAnthropicWebSearchTool(request.Tools)
	webSearchEnabled := hasWebSearchTool && (request.ToolChoice == nil || !strings.EqualFold(strings.TrimSpace(request.ToolChoice.Type), "none"))
	replayCache, replayScope := cache, scope
	if webSearchEnabled {
		replayCache, replayScope = nil, ""
	}
	input, inlineInstructions, err := convertAnthropicMessagesWithReasoningReplay(request.Messages, anthropicDeclaredToolNames(request.Tools), replayCache, replayScope)
	if err != nil {
		return nil, ResponseOptions{}, err
	}
	if len(input) == 0 {
		return nil, ResponseOptions{}, errors.New("messages 中没有可发送的 user 或 assistant 内容")
	}
	target := map[string]any{
		"model": model, "input": input, "stream": request.Stream,
		"max_output_tokens": request.MaxTokens, "store": false,
	}
	instructions := make([]string, 0, len(inlineInstructions))
	if system, err := anthropicSystemText(request.System); err != nil {
		return nil, ResponseOptions{}, err
	} else if system != "" {
		instructions = append(instructions, system)
	}
	instructions = append(instructions, inlineInstructions...)
	if len(instructions) > 0 {
		target["instructions"] = strings.Join(instructions, "\n\n")
	}
	copyOptionalNumber(target, "temperature", request.Temperature)
	copyOptionalNumber(target, "top_p", request.TopP)
	if request.Metadata != nil {
		if userID, _ := request.Metadata["user_id"].(string); strings.TrimSpace(userID) != "" {
			target["safety_identifier"] = strings.TrimSpace(userID)
		}
	}
	if request.OutputConfig != nil && request.OutputConfig.Format != nil {
		if request.OutputConfig.Format.Type != "json_schema" || request.OutputConfig.Format.Schema == nil {
			return nil, ResponseOptions{}, errors.New("output_config.format 必须是带 schema 的 json_schema")
		}
		target["text"] = map[string]any{"format": map[string]any{"type": "json_schema", "name": "anthropic_output", "schema": request.OutputConfig.Format.Schema}}
	}
	webSearchRequired := webSearchEnabled && anthropicWebSearchRequired(request.Tools, request.ToolChoice)
	webSearchQuery := ""
	if webSearchEnabled {
		webSearchQuery = anthropicWebSearchQuery(request.Messages)
	}
	if thinkingEnabled {
		effort := anthropicThinkingEffort(request.Thinking.BudgetTokens)
		if request.Thinking.Effort != "" {
			effort = request.Thinking.Effort
		}
		if request.OutputConfig != nil && request.OutputConfig.Effort != "" {
			effort = request.OutputConfig.Effort
		}
		// Every grok-build wire tier passes through; the Build normalizer folds
		// tiers the selected model's catalog menu does not offer.
		switch effort {
		case "minimal", "low", "medium", "high", "xhigh", "max":
		default:
			return nil, ResponseOptions{}, fmt.Errorf("不支持 output_config.effort=%q", effort)
		}
		reasoningEffort = effort
		reasoningEffortSet = true
		target["reasoning"] = map[string]any{"effort": effort, "summary": "detailed"}
		target["include"] = []any{"reasoning.encrypted_content"}
	}
	if len(request.Tools) > 0 {
		tools, err := convertAnthropicTools(request.Tools)
		if err != nil {
			return nil, ResponseOptions{}, err
		}
		target["tools"] = tools
	}
	if len(request.MCPServers) > 0 {
		servers, err := convertAnthropicMCPServers(request.MCPServers)
		if err != nil {
			return nil, ResponseOptions{}, err
		}
		existing, _ := target["tools"].([]any)
		target["tools"] = append(existing, servers...)
	}
	if request.ToolChoice != nil {
		choice, parallel, err := convertAnthropicToolChoice(*request.ToolChoice, hasWebSearchTool)
		if err != nil {
			return nil, ResponseOptions{}, err
		}
		target["tool_choice"] = choice
		target["parallel_tool_calls"] = parallel
	}
	converted, err := json.Marshal(target)
	return converted, ResponseOptions{
		AnthropicThinking:          thinkingEnabled,
		ReasoningEffort:            reasoningEffort,
		ReasoningEffortSet:         reasoningEffortSet,
		AnthropicWebSearch:         webSearchEnabled,
		AnthropicWebSearchRequired: webSearchRequired,
		AnthropicWebSearchQuery:    webSearchQuery,
		StopSequences:              append([]string(nil), request.StopSequences...),
	}.WithReasoningReplay(replayCache, replayScope), err
}

type anthropicRequest struct {
	Model         string             `json:"model"`
	MaxTokens     int                `json:"max_tokens"`
	Messages      []anthropicMessage `json:"messages"`
	System        json.RawMessage    `json:"system"`
	Stream        bool               `json:"stream"`
	Temperature   *float64           `json:"temperature"`
	TopP          *float64           `json:"top_p"`
	StopSequences []string           `json:"stop_sequences"`
	Metadata      map[string]any     `json:"metadata"`
	Thinking      *struct {
		Type         string `json:"type"`
		Effort       string `json:"effort"`
		BudgetTokens int    `json:"budget_tokens"`
	} `json:"thinking"`
	TopK         json.RawMessage      `json:"top_k"`
	MCPServers   []anthropicMCPServer `json:"mcp_servers"`
	OutputConfig *struct {
		Effort string `json:"effort"`
		Format *struct {
			Type   string         `json:"type"`
			Schema map[string]any `json:"schema"`
		} `json:"format"`
	} `json:"output_config"`
	Tools      []map[string]json.RawMessage `json:"tools"`
	ToolChoice *anthropicToolChoice         `json:"tool_choice"`
}

type anthropicMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type anthropicToolChoice struct {
	Type                   string `json:"type"`
	Name                   string `json:"name"`
	DisableParallelToolUse bool   `json:"disable_parallel_tool_use"`
}

func convertAnthropicMessages(messages []anthropicMessage, declaredTools map[string]struct{}) ([]any, []string, error) {
	return convertAnthropicMessagesWithReasoningReplay(messages, declaredTools, nil, "")
}

func convertAnthropicMessagesWithReasoningReplay(messages []anthropicMessage, declaredTools map[string]struct{}, cache *ReasoningCache, scope string) ([]any, []string, error) {
	input := make([]any, 0, len(messages))
	instructions := make([]string, 0)
	pendingCalls := make(map[string]struct{})
	usedCalls := make(map[string]struct{})
	serverSearches := make(map[string]map[string]any)
	seenReasoningIDs := make(map[string]struct{})
	seenReasoningEncrypted := make(map[string]struct{})
	// A client is allowed to preserve an Anthropic thinking block in a
	// different order from the tool_use block.  Pre-scan explicit signatures so
	// a cached bridge item is not emitted first and then duplicated when that
	// explicit block is encountered later in the same history.
	explicitReasoningEncrypted := anthropicExplicitReasoningProofs(messages)
	appendCachedReasoning := func(item responseItem) {
		if item.ID == "" || item.Encrypted == "" || reasoningAlreadyEmitted(seenReasoningIDs, seenReasoningEncrypted, item) {
			return
		}
		if _, exists := explicitReasoningEncrypted[strings.TrimSpace(item.Encrypted)]; exists {
			return
		}
		input = append(input, reasoningInputItem(item))
		markReasoningEmitted(seenReasoningIDs, seenReasoningEncrypted, item)
	}
	for messageIndex, message := range messages {
		role := strings.ToLower(strings.TrimSpace(message.Role))
		if role == "system" || role == "developer" {
			text, err := anthropicSystemText(message.Content)
			if err != nil {
				return nil, nil, fmt.Errorf("messages[%d] %s 内容无效: %w", messageIndex, role, err)
			}
			if text != "" {
				instructions = append(instructions, text)
			}
			continue
		}
		if role != "user" && role != "assistant" {
			return nil, nil, fmt.Errorf("Messages API 不支持 role=%q", message.Role)
		}
		if len(pendingCalls) > 0 && role != "user" {
			return nil, nil, fmt.Errorf("messages[%d] 必须是包含 tool_result 的 user 消息", messageIndex)
		}
		var text string
		if json.Unmarshal(message.Content, &text) == nil {
			if len(pendingCalls) > 0 {
				return nil, nil, fmt.Errorf("messages[%d] 必须返回全部待处理 tool_use", messageIndex)
			}
			input = append(input, map[string]any{"type": "message", "role": role, "content": text})
			continue
		}
		var blocks []map[string]json.RawMessage
		if json.Unmarshal(message.Content, &blocks) != nil {
			return nil, nil, fmt.Errorf("messages[%d].content 必须是字符串或内容块数组", messageIndex)
		}
		hadPending := len(pendingCalls) > 0
		regularBeforeResult := false
		messageParts := make([]any, 0, len(blocks))
		flushMessage := func() {
			if len(messageParts) > 0 {
				input = append(input, map[string]any{"type": "message", "role": role, "content": messageParts})
				messageParts = nil
			}
		}
		for blockIndex, block := range blocks {
			path := fmt.Sprintf("messages[%d].content[%d]", messageIndex, blockIndex)
			var typeName string
			_ = json.Unmarshal(block["type"], &typeName)
			switch typeName {
			case "text":
				regularBeforeResult = regularBeforeResult || len(pendingCalls) > 0
				var value string
				if json.Unmarshal(block["text"], &value) != nil {
					return nil, nil, fmt.Errorf("%s.text 无效", path)
				}
				messageParts = append(messageParts, map[string]any{"type": "input_text", "text": value})
			case "image":
				regularBeforeResult = regularBeforeResult || len(pendingCalls) > 0
				imageURL, err := anthropicImageURL(block["source"])
				if err != nil {
					return nil, nil, fmt.Errorf("%s: %w", path, err)
				}
				messageParts = append(messageParts, map[string]any{"type": "input_image", "image_url": imageURL})
			case "document":
				regularBeforeResult = regularBeforeResult || len(pendingCalls) > 0
				document, err := anthropicDocument(block)
				if err != nil {
					return nil, nil, fmt.Errorf("%s: %w", path, err)
				}
				messageParts = append(messageParts, document)
			case "tool_use":
				if role != "assistant" {
					return nil, nil, fmt.Errorf("%s tool_use 只允许出现在 assistant 消息", path)
				}
				flushMessage()
				var value struct {
					ID    string         `json:"id"`
					Name  string         `json:"name"`
					Input map[string]any `json:"input"`
				}
				if encoded, _ := json.Marshal(block); json.Unmarshal(encoded, &value) != nil || strings.TrimSpace(value.ID) == "" || strings.TrimSpace(value.Name) == "" || value.Input == nil {
					return nil, nil, fmt.Errorf("%s 缺少有效 id、name 或 object input", path)
				}
				if _, exists := usedCalls[value.ID]; exists {
					return nil, nil, fmt.Errorf("%s 包含重复 tool_use id %q", path, value.ID)
				}
				arguments, _ := json.Marshal(value.Input)
				if cache != nil && strings.TrimSpace(scope) != "" {
					if reasoning, found := cache.GetScoped(scope, value.ID); found && reasoning.ID != "" && reasoning.Encrypted != "" {
						appendCachedReasoning(reasoning)
					}
				}
				input = append(input, map[string]any{"type": "function_call", "call_id": value.ID, "name": value.Name, "arguments": string(arguments)})
				pendingCalls[value.ID] = struct{}{}
				usedCalls[value.ID] = struct{}{}
			case "tool_result":
				if role != "user" {
					return nil, nil, fmt.Errorf("%s tool_result 只允许出现在 user 消息", path)
				}
				flushMessage()
				var toolUseID string
				_ = json.Unmarshal(block["tool_use_id"], &toolUseID)
				if _, exists := pendingCalls[toolUseID]; strings.TrimSpace(toolUseID) == "" || !exists {
					return nil, nil, fmt.Errorf("%s.tool_use_id %q 未匹配待处理 tool_use", path, toolUseID)
				}
				if regularBeforeResult {
					return nil, nil, fmt.Errorf("%s tool_result 必须位于文本、图片或文档块之前", path)
				}
				output, err := anthropicToolResult(block["content"], declaredTools)
				if err != nil {
					return nil, nil, fmt.Errorf("%s.content: %w", path, err)
				}
				if raw := block["is_error"]; !isEmptyJSON(raw) {
					var isError bool
					if json.Unmarshal(raw, &isError) != nil {
						return nil, nil, fmt.Errorf("%s.is_error 必须是布尔值", path)
					}
					if isError {
						output = markAnthropicToolError(output)
					}
				}
				input = append(input, map[string]any{"type": "function_call_output", "call_id": toolUseID, "output": output})
				delete(pendingCalls, toolUseID)
			case "thinking":
				if role != "assistant" {
					return nil, nil, fmt.Errorf("%s thinking 只允许出现在 assistant 消息", path)
				}
				flushMessage()
				var thinking, signature string
				_ = json.Unmarshal(block["thinking"], &thinking)
				_ = json.Unmarshal(block["signature"], &signature)
				item := map[string]any{"type": "reasoning", "summary": []any{map[string]any{"type": "summary_text", "text": thinking}}}
				if signature != "" {
					item["encrypted_content"] = signature
				}
				input = append(input, item)
				markReasoningEmitted(seenReasoningIDs, seenReasoningEncrypted, responseItem{Encrypted: signature})
			case "redacted_thinking":
				if role != "assistant" {
					return nil, nil, fmt.Errorf("%s redacted_thinking 只允许出现在 assistant 消息", path)
				}
				flushMessage()
				var data string
				if json.Unmarshal(block["data"], &data) != nil || data == "" {
					return nil, nil, fmt.Errorf("%s.data 无效", path)
				}
				// Grok Build requires summary to exist whenever encrypted_content is replayed.
				// An empty array is the canonical Anthropic redacted_thinking representation.
				input = append(input, map[string]any{"type": "reasoning", "summary": []any{}, "encrypted_content": data})
				markReasoningEmitted(seenReasoningIDs, seenReasoningEncrypted, responseItem{Encrypted: data})
			case "server_tool_use":
				if role != "assistant" {
					continue
				}
				var value struct {
					ID    string         `json:"id"`
					Name  string         `json:"name"`
					Input map[string]any `json:"input"`
				}
				encoded, _ := json.Marshal(block)
				if json.Unmarshal(encoded, &value) != nil || value.Name != "web_search" || strings.TrimSpace(value.ID) == "" {
					continue
				}
				flushMessage()
				query, _ := value.Input["query"].(string)
				call := map[string]any{
					"type": "web_search_call", "id": value.ID, "status": "completed",
					"action": map[string]any{"type": "search", "query": query},
				}
				serverSearches[value.ID] = call
				input = append(input, call)
			case "web_search_tool_result":
				if role != "assistant" {
					continue
				}
				var toolUseID string
				_ = json.Unmarshal(block["tool_use_id"], &toolUseID)
				call := serverSearches[strings.TrimSpace(toolUseID)]
				if call == nil {
					continue
				}
				applyAnthropicWebSearchResult(call, block["content"])
			default:
				return nil, nil, fmt.Errorf("当前不支持 Anthropic content.type=%q", typeName)
			}
		}
		flushMessage()
		if hadPending && len(pendingCalls) > 0 {
			return nil, nil, fmt.Errorf("messages[%d] 必须返回全部待处理 tool_use", messageIndex)
		}
	}
	if len(pendingCalls) > 0 {
		return nil, nil, errors.New("messages 必须为每个 tool_use 提供 tool_result")
	}
	return input, instructions, nil
}

func anthropicExplicitReasoningProofs(messages []anthropicMessage) map[string]struct{} {
	proofs := make(map[string]struct{})
	for _, message := range messages {
		if !strings.EqualFold(strings.TrimSpace(message.Role), "assistant") {
			continue
		}
		var blocks []map[string]json.RawMessage
		if json.Unmarshal(message.Content, &blocks) != nil {
			continue
		}
		for _, block := range blocks {
			var typeName string
			_ = json.Unmarshal(block["type"], &typeName)
			var proof string
			switch typeName {
			case "thinking":
				_ = json.Unmarshal(block["signature"], &proof)
			case "redacted_thinking":
				_ = json.Unmarshal(block["data"], &proof)
			}
			if proof = strings.TrimSpace(proof); proof != "" {
				proofs[proof] = struct{}{}
			}
		}
	}
	return proofs
}
