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
	request, err := decodeAnthropicRequest(body)
	if err != nil {
		return nil, ResponseOptions{}, err
	}
	thinkingEnabled, reasoningEffort, reasoningEffortSet, err := anthropicThinkingOptions(&request)
	if err != nil {
		return nil, ResponseOptions{}, err
	}
	hasWebSearchTool := hasAnthropicWebSearchTool(request.Tools)
	webSearchEnabled := hasWebSearchTool && (request.ToolChoice == nil || !strings.EqualFold(strings.TrimSpace(request.ToolChoice.Type), "none"))
	replayCache, replayScope := anthropicReplayScope(cache, scope, webSearchEnabled)
	input, inlineInstructions, err := convertAnthropicRequestInput(&request, replayCache, replayScope)
	if err != nil {
		return nil, ResponseOptions{}, err
	}
	target, err := buildAnthropicTarget(&request, model, input, inlineInstructions)
	if err != nil {
		return nil, ResponseOptions{}, err
	}
	if err := applyAnthropicSamplingOptions(target, &request); err != nil {
		return nil, ResponseOptions{}, err
	}
	webSearchRequired, webSearchQuery := anthropicWebSearchOptions(&request, webSearchEnabled)
	reasoningEffort, reasoningEffortSet, err = applyAnthropicReasoningOptions(target, &request, thinkingEnabled, reasoningEffort, reasoningEffortSet)
	if err != nil {
		return nil, ResponseOptions{}, err
	}
	if err := applyAnthropicToolOptions(target, &request, hasWebSearchTool); err != nil {
		return nil, ResponseOptions{}, err
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

// decodeAnthropicRequest 解析并校验 Messages 请求的必需字段。
func decodeAnthropicRequest(body []byte) (anthropicRequest, error) {
	var request anthropicRequest
	if err := json.Unmarshal(body, &request); err != nil {
		return request, fmt.Errorf("解析 Messages 请求: %w", err)
	}
	if len(request.Messages) == 0 {
		return request, errors.New("messages 必须是非空数组")
	}
	if request.MaxTokens <= 0 {
		return request, errors.New("max_tokens 必须是正整数")
	}
	for name, value := range map[string]*float64{"temperature": request.Temperature, "top_p": request.TopP} {
		if value != nil && (*value < 0 || *value > 1) {
			return request, fmt.Errorf("%s 必须在 0 到 1 之间", name)
		}
	}
	for index, sequence := range request.StopSequences {
		if sequence == "" {
			return request, fmt.Errorf("stop_sequences[%d] 不能为空", index)
		}
	}
	return request, nil
}

// anthropicThinkingOptions 解析 thinking 配置，返回是否开启思考与初始 reasoning effort。
func anthropicThinkingOptions(request *anthropicRequest) (bool, string, bool, error) {
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
			return false, "", false, fmt.Errorf("不支持 thinking.type=%q", request.Thinking.Type)
		}
	}
	return thinkingEnabled, reasoningEffort, reasoningEffortSet, nil
}

// anthropicReplayScope 决定本轮是否复用 reasoning 缓存。Hosted web search has a separate
// server-side history contract.  The gateway deliberately does not bridge opaque reasoning for
// these turns (see the adapter's web-search isolation below), so disable the bridge before
// converting messages rather than trying to remove an already injected item afterwards.
func anthropicReplayScope(cache *ReasoningCache, scope string, webSearchEnabled bool) (*ReasoningCache, string) {
	if webSearchEnabled {
		return nil, ""
	}
	return cache, scope
}

// convertAnthropicRequestInput 转换消息历史，并拒绝没有可发送内容的请求。
func convertAnthropicRequestInput(request *anthropicRequest, cache *ReasoningCache, scope string) ([]any, []string, error) {
	input, inlineInstructions, err := convertAnthropicMessagesWithReasoningReplay(request.Messages, anthropicDeclaredToolNames(request.Tools), cache, scope)
	if err != nil {
		return nil, nil, err
	}
	if len(input) == 0 {
		return nil, nil, errors.New("messages 中没有可发送的 user 或 assistant 内容")
	}
	return input, inlineInstructions, nil
}

// buildAnthropicTarget 组装 Responses 请求骨架，并合并 system 与消息内联指令。
func buildAnthropicTarget(request *anthropicRequest, model string, input []any, inlineInstructions []string) (map[string]any, error) {
	target := map[string]any{
		"model": model, "input": input, "stream": request.Stream,
		"max_output_tokens": request.MaxTokens, "store": false,
	}
	instructions := make([]string, 0, len(inlineInstructions))
	if system, err := anthropicSystemText(request.System); err != nil {
		return nil, err
	} else if system != "" {
		instructions = append(instructions, system)
	}
	instructions = append(instructions, inlineInstructions...)
	if len(instructions) > 0 {
		target["instructions"] = strings.Join(instructions, "\n\n")
	}
	return target, nil
}

// applyAnthropicSamplingOptions 写入采样参数、安全标识与结构化输出格式。
func applyAnthropicSamplingOptions(target map[string]any, request *anthropicRequest) error {
	copyOptionalNumber(target, "temperature", request.Temperature)
	copyOptionalNumber(target, "top_p", request.TopP)
	if request.Metadata != nil {
		if userID, _ := request.Metadata["user_id"].(string); strings.TrimSpace(userID) != "" {
			target["safety_identifier"] = strings.TrimSpace(userID)
		}
	}
	if request.OutputConfig != nil && request.OutputConfig.Format != nil {
		if request.OutputConfig.Format.Type != "json_schema" || request.OutputConfig.Format.Schema == nil {
			return errors.New("output_config.format 必须是带 schema 的 json_schema")
		}
		target["text"] = map[string]any{"format": map[string]any{"type": "json_schema", "name": "anthropic_output", "schema": request.OutputConfig.Format.Schema}}
	}
	return nil
}

// anthropicWebSearchOptions 计算托管 web search 的强制工具语义与查询文本。
func anthropicWebSearchOptions(request *anthropicRequest, webSearchEnabled bool) (bool, string) {
	if !webSearchEnabled {
		return false, ""
	}
	return anthropicWebSearchRequired(request.Tools, request.ToolChoice), anthropicWebSearchQuery(request.Messages)
}

// applyAnthropicReasoningOptions 解析 reasoning effort，校验后写入 reasoning 与 include。
func applyAnthropicReasoningOptions(target map[string]any, request *anthropicRequest, thinkingEnabled bool, reasoningEffort string, reasoningEffortSet bool) (string, bool, error) {
	if !thinkingEnabled {
		return reasoningEffort, reasoningEffortSet, nil
	}
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
		return "", false, fmt.Errorf("不支持 output_config.effort=%q", effort)
	}
	target["reasoning"] = map[string]any{"effort": effort, "summary": "detailed"}
	target["include"] = []any{"reasoning.encrypted_content"}
	return effort, true, nil
}

// applyAnthropicToolOptions 写入函数工具、MCP server 与 tool_choice。
func applyAnthropicToolOptions(target map[string]any, request *anthropicRequest, hasWebSearchTool bool) error {
	if len(request.Tools) > 0 {
		tools, err := convertAnthropicTools(request.Tools)
		if err != nil {
			return err
		}
		target["tools"] = tools
	}
	if len(request.MCPServers) > 0 {
		servers, err := convertAnthropicMCPServers(request.MCPServers)
		if err != nil {
			return err
		}
		existing, _ := target["tools"].([]any)
		target["tools"] = append(existing, servers...)
	}
	if request.ToolChoice != nil {
		choice, parallel, err := convertAnthropicToolChoice(*request.ToolChoice, hasWebSearchTool)
		if err != nil {
			return err
		}
		target["tool_choice"] = choice
		target["parallel_tool_calls"] = parallel
	}
	return nil
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
	converter := newAnthropicMessageConverter(messages, declaredTools, cache, scope)
	for messageIndex, message := range messages {
		if err := converter.convertMessage(message, messageIndex); err != nil {
			return nil, nil, err
		}
	}
	if len(converter.pendingCalls) > 0 {
		return nil, nil, errors.New("messages 必须为每个 tool_use 提供 tool_result")
	}
	return converter.input, converter.instructions, nil
}

// anthropicMessageConverter 承载单次 Anthropic Messages 历史转换中跨内容块共享的状态：
// 已转换的输入项与指令、待处理与已使用的 tool_use、server tool 搜索结果，以及已发出的 reasoning 标识。
type anthropicMessageConverter struct {
	declaredTools              map[string]struct{}
	cache                      *ReasoningCache
	scope                      string
	input                      []any
	instructions               []string
	pendingCalls               map[string]struct{}
	usedCalls                  map[string]struct{}
	serverSearches             map[string]map[string]any
	seenReasoningIDs           map[string]struct{}
	seenReasoningEncrypted     map[string]struct{}
	explicitReasoningEncrypted map[string]struct{}
}

func newAnthropicMessageConverter(messages []anthropicMessage, declaredTools map[string]struct{}, cache *ReasoningCache, scope string) *anthropicMessageConverter {
	return &anthropicMessageConverter{
		declaredTools:          declaredTools,
		cache:                  cache,
		scope:                  scope,
		input:                  make([]any, 0, len(messages)),
		instructions:           make([]string, 0),
		pendingCalls:           make(map[string]struct{}),
		usedCalls:              make(map[string]struct{}),
		serverSearches:         make(map[string]map[string]any),
		seenReasoningIDs:       make(map[string]struct{}),
		seenReasoningEncrypted: make(map[string]struct{}),
		// A client is allowed to preserve an Anthropic thinking block in a
		// different order from the tool_use block.  Pre-scan explicit signatures so
		// a cached bridge item is not emitted first and then duplicated when that
		// explicit block is encountered later in the same history.
		explicitReasoningEncrypted: anthropicExplicitReasoningProofs(messages),
	}
}

// convertMessage 转换单条消息的角色语义与内容。
func (c *anthropicMessageConverter) convertMessage(message anthropicMessage, messageIndex int) error {
	role := strings.ToLower(strings.TrimSpace(message.Role))
	if role == "system" || role == "developer" {
		text, err := anthropicSystemText(message.Content)
		if err != nil {
			return fmt.Errorf("messages[%d] %s 内容无效: %w", messageIndex, role, err)
		}
		if text != "" {
			c.instructions = append(c.instructions, text)
		}
		return nil
	}
	if role != "user" && role != "assistant" {
		return fmt.Errorf("Messages API 不支持 role=%q", message.Role)
	}
	if len(c.pendingCalls) > 0 && role != "user" {
		return fmt.Errorf("messages[%d] 必须是包含 tool_result 的 user 消息", messageIndex)
	}
	var text string
	if json.Unmarshal(message.Content, &text) == nil {
		if len(c.pendingCalls) > 0 {
			return fmt.Errorf("messages[%d] 必须返回全部待处理 tool_use", messageIndex)
		}
		c.input = append(c.input, map[string]any{"type": "message", "role": role, "content": text})
		return nil
	}
	var blocks []map[string]json.RawMessage
	if json.Unmarshal(message.Content, &blocks) != nil {
		return fmt.Errorf("messages[%d].content 必须是字符串或内容块数组", messageIndex)
	}
	return c.convertContentBlocks(role, messageIndex, blocks)
}

// convertContentBlocks 按顺序转换内容块，并在需要时把累积的普通内容块落盘为消息项。
func (c *anthropicMessageConverter) convertContentBlocks(role string, messageIndex int, blocks []map[string]json.RawMessage) error {
	hadPending := len(c.pendingCalls) > 0
	regularBeforeResult := false
	messageParts := make([]any, 0, len(blocks))
	for blockIndex, block := range blocks {
		path := fmt.Sprintf("messages[%d].content[%d]", messageIndex, blockIndex)
		parts, regular, err := c.convertContentBlock(role, path, block, messageParts, regularBeforeResult)
		if err != nil {
			return err
		}
		messageParts = parts
		regularBeforeResult = regular
	}
	_ = c.flushMessageParts(role, messageParts)
	if hadPending && len(c.pendingCalls) > 0 {
		return fmt.Errorf("messages[%d] 必须返回全部待处理 tool_use", messageIndex)
	}
	return nil
}

func (c *anthropicMessageConverter) convertContentBlock(role, path string, block map[string]json.RawMessage, messageParts []any, regularBeforeResult bool) ([]any, bool, error) {
	var typeName string
	_ = json.Unmarshal(block["type"], &typeName)
	switch typeName {
	case "text", "image", "document":
		return c.convertRegularContentBlock(typeName, block, path, messageParts, regularBeforeResult)
	case "tool_use":
		parts, err := c.convertToolUseBlock(role, path, block, messageParts)
		return parts, regularBeforeResult, err
	case "tool_result":
		parts, err := c.convertToolResultBlock(role, path, block, messageParts, regularBeforeResult)
		return parts, regularBeforeResult, err
	case "thinking":
		parts, err := c.convertThinkingBlock(role, path, block, messageParts)
		return parts, regularBeforeResult, err
	case "redacted_thinking":
		parts, err := c.convertRedactedThinkingBlock(role, path, block, messageParts)
		return parts, regularBeforeResult, err
	case "server_tool_use":
		parts, err := c.convertServerToolUseBlock(role, block, messageParts)
		return parts, regularBeforeResult, err
	case "web_search_tool_result":
		c.convertWebSearchToolResultBlock(role, block)
		return messageParts, regularBeforeResult, nil
	default:
		return nil, false, fmt.Errorf("当前不支持 Anthropic content.type=%q", typeName)
	}
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
