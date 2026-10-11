package conversation

import (
	"encoding/json"
	"strings"
)

func (c *streamConverter) handle(event string, data []byte) error {
	if c.finished {
		return nil
	}
	typeName, root, ok := parseSSEEvent(event, data)
	if !ok {
		return nil
	}
	if err := c.repeatTracker.trackEvent(typeName, root); err != nil {
		return err
	}
	if c.stopSequence != "" && typeName != "response.completed" && typeName != "response.incomplete" && typeName != "response.failed" && typeName != "error" {
		return nil
	}
	switch typeName {
	case "response.created", "response.in_progress":
		return c.handleResponseStart(root)
	case "response.output_text.delta":
		return c.handleTextDelta(root)
	case "response.refusal.delta":
		return c.handleRefusalDelta(root)
	case "response.output_text.annotation.added":
		return c.handleAnnotationAdded(root)
	case "response.reasoning_summary_text.delta":
		return c.handleReasoningSummaryDelta(root)
	case "response.reasoning_text.delta":
		return c.handleReasoningTextDelta(root)
	case "response.output_item.added":
		return c.handleOutputItemAdded(root)
	case "response.function_call_arguments.delta":
		return c.handleFunctionCallArgumentsDelta(root)
	case "response.function_call_arguments.done":
		return c.handleFunctionCallArgumentsDone(root)
	case "response.output_item.done":
		return c.handleOutputItemDone(root)
	case "response.completed", "response.incomplete":
		return c.handleTerminalResponse(typeName, root)
	case "error", "response.failed":
		return c.streamError(data)
	}
	return nil
}

func (c *streamConverter) handleResponseStart(root map[string]json.RawMessage) error {
	var response responseEnvelope
	_ = json.Unmarshal(root["response"], &response)
	c.setResponse(response)
	return c.start()
}

func (c *streamConverter) handleTextDelta(root map[string]json.RawMessage) error {
	var delta string
	_ = json.Unmarshal(root["delta"], &delta)
	if err := c.start(); err != nil {
		return err
	}
	if c.operation == OperationMessages && c.deferSearchText {
		return c.bufferSearchText(delta)
	}
	return c.textDelta(delta)
}

func (c *streamConverter) handleRefusalDelta(root map[string]json.RawMessage) error {
	var delta string
	_ = json.Unmarshal(root["delta"], &delta)
	c.refused = true
	if c.operation == OperationChat {
		return c.chatDelta(map[string]any{"refusal": delta})
	}
	return c.textDeltaMessages(delta)
}

func (c *streamConverter) handleAnnotationAdded(root map[string]json.RawMessage) error {
	if c.operation != OperationChat {
		return nil
	}
	var annotation any
	if json.Unmarshal(root["annotation"], &annotation) != nil || annotation == nil {
		return nil
	}
	return c.chatDelta(map[string]any{"annotations": []any{annotation}})
}

func (c *streamConverter) handleReasoningSummaryDelta(root map[string]json.RawMessage) error {
	var itemID, delta string
	_ = json.Unmarshal(root["item_id"], &itemID)
	_ = json.Unmarshal(root["delta"], &delta)
	return c.reasoningSummaryDelta(itemID, delta)
}

func (c *streamConverter) handleReasoningTextDelta(root map[string]json.RawMessage) error {
	var itemID, delta string
	_ = json.Unmarshal(root["item_id"], &itemID)
	_ = json.Unmarshal(root["delta"], &delta)
	return c.reasoningTextDelta(itemID, delta)
}

func (c *streamConverter) handleOutputItemAdded(root map[string]json.RawMessage) error {
	var item responseItem
	_ = json.Unmarshal(root["item"], &item)
	if item.Type == "reasoning" && c.reasoningOutputEnabled() {
		c.ensureReasoningState(item.ID)
	}
	if item.Type == "reasoning" && c.operation == OperationMessages && c.options.AnthropicThinking {
		if err := c.thinkingStart(item.ID); err != nil {
			return err
		}
		return c.emitEncrypted(item)
	}
	if item.Type == "reasoning" && item.ID != "" && c.operation == OperationChat {
		if err := c.markChatReasoningStart(); err != nil {
			return err
		}
		return c.emitEncrypted(item)
	}
	if item.Type == "web_search_call" && c.operation == OperationMessages && c.options.AnthropicWebSearch {
		if call, ok := parseWebSearchCallItem(item); ok {
			return c.noteWebSearch(call, false)
		}
		return nil
	}
	if item.Type != "function_call" {
		return nil
	}
	var outputIndex int
	_ = json.Unmarshal(root["output_index"], &outputIndex)
	return c.toolStart(item, outputIndex)
}

func (c *streamConverter) handleFunctionCallArgumentsDelta(root map[string]json.RawMessage) error {
	var itemID, delta string
	_ = json.Unmarshal(root["item_id"], &itemID)
	_ = json.Unmarshal(root["delta"], &delta)
	return c.toolDelta(itemID, delta)
}

func (c *streamConverter) handleFunctionCallArgumentsDone(root map[string]json.RawMessage) error {
	var itemID, arguments string
	_ = json.Unmarshal(root["item_id"], &itemID)
	_ = json.Unmarshal(root["arguments"], &arguments)
	return c.toolArgumentsDone(itemID, arguments)
}

func (c *streamConverter) handleOutputItemDone(root map[string]json.RawMessage) error {
	var item responseItem
	_ = json.Unmarshal(root["item"], &item)
	c.recordOutputItem(item)
	if item.Type == "function_call" {
		return c.toolArgumentsDone(item.ID, item.Arguments)
	}
	if item.Type == "reasoning" {
		if c.reasoningOutputEnabled() {
			if err := c.reasoningDone(item); err != nil {
				return err
			}
		}
		if err := c.emitEncrypted(item); err != nil {
			return err
		}
		return c.thinkingDone(item)
	}
	if item.Type == "web_search_call" && c.operation == OperationMessages && c.options.AnthropicWebSearch {
		if call, ok := parseWebSearchCallItem(item); ok {
			return c.noteWebSearch(call, true)
		}
	}
	return nil
}

func (c *streamConverter) handleTerminalResponse(typeName string, root map[string]json.RawMessage) error {
	var response responseEnvelope
	_ = json.Unmarshal(root["response"], &response)
	// Some upstream streams omit output_item.done and put the complete
	// reasoning/function_call objects only in the terminal envelope. Record
	// those objects before done() commits the replay cache.
	c.recordReplayOutput(response.Output)
	response.Output = c.mergeOutputItems(response.Output)
	c.setResponse(response)
	for _, item := range response.Output {
		if item.Type == "reasoning" {
			if err := c.emitEncrypted(item); err != nil {
				return err
			}
		}
	}
	if c.operation == OperationMessages && c.options.AnthropicWebSearch {
		parsed := parseResponse(response)
		for _, call := range parsed.WebSearch {
			if err := c.noteWebSearch(call, true); err != nil {
				return err
			}
		}
	}
	status := response.Status
	if status == "" && typeName == "response.incomplete" {
		status = "incomplete"
	}
	c.terminalEvent = true
	return c.done(status)
}

// recordOutputItem retains the authoritative item-done payload. In streamed
// Responses, response.completed often contains usage/status only and an empty
// output array, while encrypted reasoning is present solely in these events.
func (c *streamConverter) recordOutputItem(item responseItem) {
	if c == nil || (item.Type != "reasoning" && item.Type != "function_call") {
		return
	}
	if c.outputItemIDs == nil {
		c.outputItemIDs = make(map[string]struct{})
	}
	key := replayOutputKey(item)
	if key != "" {
		if _, exists := c.outputItemIDs[key]; exists {
			for index := range c.outputItems {
				if replayOutputKey(c.outputItems[index]) == key {
					c.outputItems[index] = mergeResponseItem(c.outputItems[index], item)
					return
				}
			}
		}
		c.outputItemIDs[key] = struct{}{}
	}
	c.outputItems = append(c.outputItems, cloneResponseItem(item))
}

func replayOutputKey(item responseItem) string {
	if id := strings.TrimSpace(item.ID); id != "" {
		return "id:" + id
	}
	if item.Type == "function_call" {
		if callID := strings.TrimSpace(item.CallID); callID != "" {
			return "call:" + normalizeReasoningCallID(callID)
		}
	}
	if item.Type == "reasoning" {
		if encrypted := strings.TrimSpace(item.Encrypted); encrypted != "" {
			return "proof:" + encrypted
		}
	}
	return ""
}

// recordReplayOutput merges the terminal envelope into the items observed in
// output_item.done. The event stream carries the authoritative output order;
// the terminal envelope is used to fill richer fields and append items that
// were never announced as done.
func (c *streamConverter) recordReplayOutput(output []responseItem) {
	if c == nil || len(output) == 0 {
		return
	}
	merged := make([]responseItem, 0, len(c.outputItems)+len(output))
	if len(c.outputItems) == 0 {
		for _, item := range output {
			if item.Type == "reasoning" || item.Type == "function_call" {
				merged = append(merged, cloneResponseItem(item))
			}
		}
	} else {
		merged = mergeReplayOutputItems(c.outputItems, output)
	}
	c.outputItems = merged
	c.outputItemIDs = make(map[string]struct{}, len(merged))
	for _, item := range merged {
		if key := replayOutputKey(item); key != "" {
			c.outputItemIDs[key] = struct{}{}
		}
	}
}

// mergeReplayOutputItems 以事件流顺序为主，用终端信封补全字段并追加未宣告的 item。
func mergeReplayOutputItems(observed, output []responseItem) []responseItem {
	merged := make([]responseItem, 0, len(observed)+len(output))
	terminal := make(map[string]responseItem, len(output))
	for _, item := range output {
		if item.Type == "reasoning" || item.Type == "function_call" {
			if key := replayOutputKey(item); key != "" {
				terminal[key] = item
			}
		}
	}
	seen := make(map[string]struct{}, len(observed)+len(output))
	for _, item := range observed {
		key := replayOutputKey(item)
		if key != "" {
			if update, ok := terminal[key]; ok {
				item = mergeResponseItem(item, update)
			}
			seen[key] = struct{}{}
		}
		merged = append(merged, cloneResponseItem(item))
	}
	for _, item := range output {
		if item.Type != "reasoning" && item.Type != "function_call" {
			continue
		}
		key := replayOutputKey(item)
		if key != "" {
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
		}
		merged = append(merged, cloneResponseItem(item))
	}
	return merged
}

func (c *streamConverter) commitReasoningReplay() {
	if c == nil || c.options.reasoningCache == nil || strings.TrimSpace(c.options.reasoningScope) == "" || len(c.outputItems) == 0 {
		return
	}
	c.options.reasoningCache.RememberReasoningForEnvelope(c.options.reasoningScope, responseEnvelope{Output: c.outputItems})
}

func (c *streamConverter) mergeOutputItems(output []responseItem) []responseItem {
	if len(c.outputItems) == 0 {
		return output
	}
	if len(output) == 0 {
		return append([]responseItem(nil), c.outputItems...)
	}
	merged := append([]responseItem(nil), output...)
	for _, item := range c.outputItems {
		found := false
		if key := replayOutputKey(item); key != "" {
			for index := range merged {
				if replayOutputKey(merged[index]) == key {
					merged[index] = mergeResponseItem(merged[index], item)
					found = true
					break
				}
			}
		}
		if !found {
			merged = append(merged, item)
		}
	}
	return merged
}

func mergeResponseItem(base, update responseItem) responseItem {
	if base.ID == "" {
		base.ID = update.ID
	}
	if base.Type == "" {
		base.Type = update.Type
	}
	if base.Status == "" {
		base.Status = update.Status
	}
	if base.Role == "" {
		base.Role = update.Role
	}
	if base.CallID == "" {
		base.CallID = update.CallID
	}
	if base.Name == "" {
		base.Name = update.Name
	}
	if base.Arguments == "" {
		base.Arguments = update.Arguments
	}
	if base.Encrypted == "" {
		base.Encrypted = update.Encrypted
	}
	if len(base.Content) == 0 {
		base.Content = update.Content
	}
	if len(base.Summary) == 0 {
		base.Summary = update.Summary
	}
	if base.Action == nil {
		base.Action = update.Action
	}
	return base
}

func streamErrorValue(data []byte) any {
	var root map[string]any
	if json.Unmarshal(data, &root) != nil {
		return strings.TrimSpace(string(data))
	}
	if response, ok := root["response"].(map[string]any); ok {
		if value, exists := response["error"]; exists && value != nil {
			return value
		}
	}
	if value, exists := root["error"]; exists && value != nil {
		return value
	}
	if message, ok := root["message"].(string); ok {
		return message
	}
	return strings.TrimSpace(string(data))
}
