package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

const (
	maxCompatibleResponseBytes        = 128 << 20
	maxCompatibleSSEEventBytes        = 8 << 20
	maxBufferedFunctionArgumentsBytes = 1 << 20
	maxTotalBufferedFunctionArgsBytes = 4 << 20
)

// normalizeResponseJSON 将上游普通函数别名恢复为下游 namespace 和 Tool Search 输出项。
func (c *responsesToolCompatibility) normalizeResponseJSON(body []byte) ([]byte, error) {
	if c == nil {
		return body, nil
	}
	var response map[string]any
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("解析 Grok Build Responses 响应: %w", err)
	}
	if err := c.rewriteResponseValue(response); err != nil {
		return nil, err
	}
	c.restoreVisibleTools(response)
	converted, err := json.Marshal(response)
	if err != nil {
		return nil, fmt.Errorf("编码兼容 Responses 响应: %w", err)
	}
	return converted, nil
}

// normalizeResponseStream applies the Build-to-OpenAI SSE boundary for every
// Responses stream. Tool rewriting is optional, while BOM removal and private
// Grok control-event filtering always apply.
func (c *responsesToolCompatibility) normalizeResponseStream(source io.ReadCloser) io.ReadCloser {
	reader, writer := io.Pipe()
	go func() {
		defer source.Close()
		err := consumeCompatibleSSE(source, func(event compatibleSSEEvent) error {
			if isPrivateBuildControlEvent(event) {
				return nil
			}
			if c == nil {
				return event.writeTo(writer)
			}
			if !event.HasData() {
				return event.writeTo(writer)
			}
			outputs, rewriteErr := c.rewriteStreamData(event.Event, event.Data())
			if rewriteErr != nil {
				return rewriteErr
			}
			for index, output := range outputs {
				outputData := output.Data
				if output.Payload != nil {
					c.resequenceStreamPayload(output.Payload)
					encoded, encodeErr := json.Marshal(output.Payload)
					if encodeErr != nil {
						return fmt.Errorf("编码兼容 Responses SSE: %w", encodeErr)
					}
					outputData = encoded
				}
				current := event
				if output.Event != "" {
					current.Event = output.Event
				}
				if index > 0 {
					current.ID = ""
					current.Retry = ""
					current.Comments = nil
					current.Other = nil
				}
				current.SetData(outputData)
				if err := current.writeTo(writer); err != nil {
					return err
				}
			}
			return nil
		})
		_ = writer.CloseWithError(err)
	}()
	return reader
}

func isPrivateBuildControlEvent(event compatibleSSEEvent) bool {
	if strings.TrimSpace(event.Event) == "response.doom_loop_check" {
		return true
	}
	if !event.HasData() {
		return false
	}
	var payload struct {
		Type string `json:"type"`
	}
	return json.Unmarshal(event.Data(), &payload) == nil && payload.Type == "response.doom_loop_check"
}

type responsesStreamOutput struct {
	Event   string
	Data    []byte
	Payload map[string]any
}

type responsesStreamCall struct {
	identity     responsesToolIdentity
	schema       any
	arguments    strings.Builder
	passthrough  bool
	lastDelta    map[string]any
	addedPayload map[string]any
}

func (c *responsesToolCompatibility) rewriteStreamData(event string, data []byte) ([]responsesStreamOutput, error) {
	if bytes.Equal(bytes.TrimSpace(data), []byte("[DONE]")) {
		return []responsesStreamOutput{{Data: data}}, nil
	}
	if !isCompatibleResponsesEvent(event) {
		return nil, nil
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		if event == "" {
			return nil, nil
		}
		return []responsesStreamOutput{{Data: data}}, nil
	}
	kind := stringField(payload, "type")
	if kind == "" {
		kind = event
	}
	if !isCompatibleResponsesEvent(kind) {
		return nil, nil
	}
	outputs, handled, err := c.rewriteStreamCallEvent(kind, payload)
	if err != nil {
		return nil, err
	}
	if handled {
		return outputs, nil
	}
	if err := c.rewriteResponseValue(payload); err != nil {
		return nil, err
	}
	if response, ok := payload["response"].(map[string]any); ok {
		c.restoreVisibleTools(response)
	}
	return []responsesStreamOutput{{Payload: payload}}, nil
}

// rewriteStreamCallEvent 处理工具调用相关事件；handled 为 false 时由调用方继续通用响应重写。
func (c *responsesToolCompatibility) rewriteStreamCallEvent(kind string, payload map[string]any) ([]responsesStreamOutput, bool, error) {
	switch kind {
	case "response.output_item.added":
		return c.rewriteStreamOutputItemAdded(payload)
	case "response.function_call_arguments.delta":
		return c.rewriteStreamArgumentsDelta(payload)
	case "response.function_call_arguments.done":
		return c.rewriteStreamArgumentsDone(payload)
	case "response.output_item.done":
		return c.rewriteStreamOutputItemDone(payload)
	}
	return nil, false, nil
}

// rewriteStreamOutputItemAdded 暂存 apply_patch 调用的 added 事件，等 done 事件一起对下游可见。
func (c *responsesToolCompatibility) rewriteStreamOutputItemAdded(payload map[string]any) ([]responsesStreamOutput, bool, error) {
	item, ok := payload["item"].(map[string]any)
	if !ok {
		return nil, false, nil
	}
	state := c.rememberStreamCall(item)
	if state == nil || state.identity.Kind != responsesApplyPatchTool {
		return nil, false, nil
	}
	state.addedPayload = cloneJSONObject(payload)
	return nil, true, nil
}

// rewriteStreamArgumentsDelta 累积函数参数增量；超出缓冲上限时改为直通下游。
func (c *responsesToolCompatibility) rewriteStreamArgumentsDelta(payload map[string]any) ([]responsesStreamOutput, bool, error) {
	identity, state, found := c.streamIdentity(payload)
	if !found {
		return nil, false, nil
	}
	if identity.Kind == responsesFunctionTool && state.schema != nil {
		delta := stringField(payload, "delta")
		callLimitExceeded := state.arguments.Len()+len(delta) > maxBufferedFunctionArgumentsBytes
		totalLimitExceeded := c.streamArgumentBytes+len(delta) > maxTotalBufferedFunctionArgsBytes
		if !state.passthrough && (callLimitExceeded || totalLimitExceeded) {
			buffered := state.arguments.String()
			c.releaseBufferedFunctionArguments(state)
			state.passthrough = true
			outputs := make([]responsesStreamOutput, 0, 2)
			if buffered != "" {
				flushed := cloneJSONObject(payload)
				flushed["delta"] = buffered
				outputs = append(outputs, responsesStreamOutput{Event: "response.function_call_arguments.delta", Payload: flushed})
			}
			outputs = append(outputs, responsesStreamOutput{Event: "response.function_call_arguments.delta", Payload: payload})
			return outputs, true, nil
		}
		if !state.passthrough {
			state.arguments.WriteString(delta)
			c.streamArgumentBytes += len(delta)
			state.lastDelta = cloneJSONObject(payload)
			return nil, true, nil
		}
	}
	if identity.Kind == responsesToolSearch || identity.Kind == responsesCustomTool || identity.Kind == responsesApplyPatchTool {
		state.arguments.WriteString(stringField(payload, "delta"))
		if identity.Kind == responsesCustomTool {
			state.lastDelta = cloneJSONObject(payload)
		}
		return nil, true, nil
	}
	return nil, false, nil
}

// rewriteStreamArgumentsDone 处理参数完成事件，把归一化后的参数交给下游。
func (c *responsesToolCompatibility) rewriteStreamArgumentsDone(payload map[string]any) ([]responsesStreamOutput, bool, error) {
	identity, state, found := c.streamIdentity(payload)
	if !found {
		return nil, false, nil
	}
	if identity.Kind == responsesFunctionTool && state.schema != nil {
		return c.finishFunctionCallArguments(payload, state), true, nil
	}
	if identity.Kind == responsesToolSearch || identity.Kind == responsesApplyPatchTool {
		// Tool Search 的 arguments 是结构化对象；等 output_item.done 带齐参数后再对下游可见。
		return nil, true, nil
	}
	if identity.Kind != responsesCustomTool {
		return nil, false, nil
	}
	arguments := stringField(payload, "arguments")
	if arguments == "" {
		arguments = state.arguments.String()
	}
	input := decodeCustomToolInput(arguments)
	outputs := make([]responsesStreamOutput, 0, 2)
	if state.lastDelta != nil {
		delta := customToolStreamPayload(state.lastDelta, "response.custom_tool_call_input.delta", "delta", input)
		outputs = append(outputs, responsesStreamOutput{Event: "response.custom_tool_call_input.delta", Payload: delta})
	}
	done := customToolStreamPayload(payload, "response.custom_tool_call_input.done", "input", input)
	outputs = append(outputs, responsesStreamOutput{Event: "response.custom_tool_call_input.done", Payload: done})
	return outputs, true, nil
}

// finishFunctionCallArguments 归一化函数参数，并按需补发最后一帧参数增量。
func (c *responsesToolCompatibility) finishFunctionCallArguments(payload map[string]any, state *responsesStreamCall) []responsesStreamOutput {
	arguments := stringField(payload, "arguments")
	if arguments == "" {
		arguments = state.arguments.String()
	}
	normalized, _ := normalizeFunctionArguments(arguments, state.schema)
	if state.passthrough {
		done := cloneJSONObject(payload)
		done["arguments"] = normalized
		return []responsesStreamOutput{{Event: "response.function_call_arguments.done", Payload: done}}
	}
	outputs := make([]responsesStreamOutput, 0, 2)
	if state.lastDelta != nil {
		delta := cloneJSONObject(state.lastDelta)
		delta["delta"] = normalized
		outputs = append(outputs, responsesStreamOutput{Event: "response.function_call_arguments.delta", Payload: delta})
	}
	done := cloneJSONObject(payload)
	done["arguments"] = normalized
	outputs = append(outputs, responsesStreamOutput{Event: "response.function_call_arguments.done", Payload: done})
	c.releaseBufferedFunctionArguments(state)
	return outputs
}

// rewriteStreamOutputItemDone 恢复 apply_patch 调用的 added 与 done 事件。
func (c *responsesToolCompatibility) rewriteStreamOutputItemDone(payload map[string]any) ([]responsesStreamOutput, bool, error) {
	item, ok := payload["item"].(map[string]any)
	if !ok {
		return nil, false, nil
	}
	identity, exists := c.aliases[stringField(item, "name")]
	if !exists || identity.Kind != responsesApplyPatchTool {
		return nil, false, nil
	}
	outputs, err := c.rewriteApplyPatchDoneEvent(payload, item)
	return outputs, true, err
}

func (c *responsesToolCompatibility) releaseBufferedFunctionArguments(state *responsesStreamCall) {
	if c == nil || state == nil {
		return
	}
	c.streamArgumentBytes -= state.arguments.Len()
	if c.streamArgumentBytes < 0 {
		c.streamArgumentBytes = 0
	}
	state.arguments.Reset()
	state.lastDelta = nil
}

func (c *responsesToolCompatibility) resequenceStreamPayload(payload map[string]any) {
	if c == nil || payload == nil {
		return
	}
	rawSequence, exists := payload["sequence_number"]
	if !exists {
		return
	}
	if !c.streamSequenceSet {
		sequence, ok := exactJSONInt64(rawSequence)
		if !ok {
			return
		}
		c.streamSequenceNext = sequence
		c.streamSequenceSet = true
	}
	payload["sequence_number"] = c.streamSequenceNext
	c.streamSequenceNext++
}

func exactJSONInt64(value any) (int64, bool) {
	number, ok := value.(float64)
	if !ok || number < 0 || number > float64(maxExactJSONInteger) || number != float64(int64(number)) {
		return 0, false
	}
	return int64(number), true
}

func (c *responsesToolCompatibility) rememberStreamCall(item map[string]any) *responsesStreamCall {
	if stringField(item, "type") != "function_call" {
		return nil
	}
	identity, exists := c.aliases[stringField(item, "name")]
	if !exists {
		return nil
	}
	state := &responsesStreamCall{identity: identity, schema: c.functionSchemas[stringField(item, "name")]}
	for _, key := range []string{stringField(item, "id"), stringField(item, "call_id")} {
		if key != "" {
			c.streamCalls[key] = state
		}
	}
	return state
}

func (c *responsesToolCompatibility) streamIdentity(payload map[string]any) (responsesToolIdentity, *responsesStreamCall, bool) {
	for _, key := range []string{stringField(payload, "item_id"), stringField(payload, "call_id")} {
		if state, exists := c.streamCalls[key]; exists {
			return state.identity, state, true
		}
	}
	identity, exists := c.aliases[stringField(payload, "name")]
	if !exists {
		return responsesToolIdentity{}, nil, false
	}
	state := &responsesStreamCall{identity: identity, schema: c.functionSchemas[stringField(payload, "name")]}
	for _, key := range []string{stringField(payload, "item_id"), stringField(payload, "call_id")} {
		if key != "" {
			c.streamCalls[key] = state
		}
	}
	return identity, state, true
}

func (c *responsesToolCompatibility) rewriteResponseValue(value any) error {
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			if err := c.rewriteResponseValue(item); err != nil {
				return err
			}
		}
	case map[string]any:
		for _, item := range typed {
			if err := c.rewriteResponseValue(item); err != nil {
				return err
			}
		}
		switch stringField(typed, "type") {
		case "function_call":
			if err := c.rewriteFunctionCall(typed); err != nil {
				return err
			}
		case "shell_call":
			if c.legacyLocalShell {
				rewriteLegacyLocalShellCall(typed)
			}
		}
	}
	return nil
}

func (c *responsesToolCompatibility) rewriteFunctionCall(call map[string]any) error {
	alias := stringField(call, "name")
	identity, exists := c.aliases[alias]
	if !exists {
		return nil
	}
	switch identity.Kind {
	case responsesFunctionTool:
		c.rewriteFunctionToolCall(call, alias, identity)
	case responsesCustomTool:
		call["type"] = "custom_tool_call"
		applyToolIdentityName(call, identity)
		call["input"] = decodeCustomToolInput(call["arguments"])
		delete(call, "arguments")
	case responsesToolSearch:
		call["type"] = "tool_search_call"
		call["execution"] = "client"
		call["arguments"] = decodeToolSearchArguments(call["arguments"])
		delete(call, "name")
		delete(call, "namespace")
	case responsesApplyPatchTool:
		operation, err := decodeApplyPatchArguments(call["arguments"], "response.output[].arguments")
		if err != nil {
			return fmt.Errorf("恢复 apply_patch_call: %w", err)
		}
		call["type"] = "apply_patch_call"
		call["operation"] = operation
		delete(call, "name")
		delete(call, "namespace")
		delete(call, "arguments")
	}
	return nil
}

// rewriteFunctionToolCall 按已登记的工具 schema 归一化 function_call 的 arguments，
// 并把别名恢复为下游可见的工具名与 namespace。
func (c *responsesToolCompatibility) rewriteFunctionToolCall(call map[string]any, alias string, identity responsesToolIdentity) {
	if schema := c.functionSchemas[alias]; schema != nil {
		if arguments, ok := call["arguments"].(string); ok {
			normalized, changed := normalizeFunctionArguments(arguments, schema)
			if changed {
				call["arguments"] = normalized
			}
		}
	}
	applyToolIdentityName(call, identity)
}

// applyToolIdentityName 把别名恢复为下游可见的工具名与 namespace。
func applyToolIdentityName(call map[string]any, identity responsesToolIdentity) {
	call["name"] = identity.Name
	if identity.Namespace != "" {
		call["namespace"] = identity.Namespace
	} else {
		delete(call, "namespace")
	}
}

func rewriteLegacyLocalShellCall(call map[string]any) {
	call["type"] = "local_shell_call"
	call["action"] = rewriteLegacyShellAction(call["action"])
	delete(call, "max_output_length")
}

func (c *responsesToolCompatibility) rewriteApplyPatchDoneEvent(payload, item map[string]any) ([]responsesStreamOutput, error) {
	done := cloneJSONObject(payload)
	if err := c.rewriteResponseValue(done); err != nil {
		return nil, err
	}
	doneItem, _ := done["item"].(map[string]any)
	var state *responsesStreamCall
	for _, key := range []string{stringField(item, "id"), stringField(item, "call_id")} {
		if candidate, exists := c.streamCalls[key]; exists {
			state = candidate
			break
		}
	}
	added := map[string]any{"type": "response.output_item.added"}
	if state != nil && state.addedPayload != nil {
		added = cloneJSONObject(state.addedPayload)
		added["type"] = "response.output_item.added"
	}
	for _, key := range []string{"output_index", "sequence_number"} {
		if value, exists := done[key]; exists && added[key] == nil {
			added[key] = cloneJSONValue(value)
		}
	}
	addedItem := cloneJSONObject(doneItem)
	addedItem["status"] = "in_progress"
	added["item"] = addedItem
	return []responsesStreamOutput{
		{Event: "response.output_item.added", Payload: added},
		{Event: "response.output_item.done", Payload: done},
	}, nil
}

func customToolStreamPayload(source map[string]any, kind, valueKey, value string) map[string]any {
	result := map[string]any{"type": kind, valueKey: value}
	for _, key := range []string{"item_id", "output_index", "sequence_number"} {
		if item, exists := source[key]; exists {
			result[key] = item
		}
	}
	return result
}

func isCompatibleResponsesEvent(kind string) bool {
	return kind == "" || kind == "error" || strings.HasPrefix(kind, "response.")
}

func decodeToolSearchArguments(value any) any {
	text, ok := value.(string)
	if !ok {
		return value
	}
	if strings.TrimSpace(text) == "" {
		return map[string]any{}
	}
	var decoded any
	if json.Unmarshal([]byte(text), &decoded) == nil {
		return decoded
	}
	return map[string]any{"input": text}
}

func (c *responsesToolCompatibility) restoreVisibleTools(response map[string]any) {
	if _, exists := response["tools"]; !exists {
		return
	}
	response["tools"] = cloneJSONArray(c.visibleTools)
}
