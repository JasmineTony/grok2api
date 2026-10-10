package web

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/infra/provider/conversation"
	"github.com/chenyme/grok2api/backend/internal/infra/provider/searchresult"
)

func buildOpenAIResult(operation, responseID, model string, parsed parsedChat, streaming bool, responseOptions ...conversation.ResponseOptions) map[string]any {
	created := time.Now().Unix()
	options := conversation.ResponseOptions{}
	if len(responseOptions) > 0 {
		options = responseOptions[0]
	}
	inputTokens := parsed.InputTokens
	outputTokens := estimateTokens(parsed.Text.String()) + estimateTokens(parsed.Reasoning.String()) + estimateToolCallTokens(parsed.ToolCalls)
	switch {
	case operation == "chat":
		return buildOpenAIChatResult(responseID, model, &parsed, created, inputTokens, outputTokens)
	case operation == conversation.OperationMessages:
		return buildWebMessagesResult(responseID, model, &parsed, options, inputTokens, outputTokens)
	default:
		return buildWebResponsesResult(responseID, model, &parsed, created, inputTokens, outputTokens)
	}
}

// buildOpenAIChatResult 组装 Chat Completions 响应体。
func buildOpenAIChatResult(responseID, model string, parsed *parsedChat, created, inputTokens, outputTokens int64) map[string]any {
	finalizeXAIAnnotations(parsed)
	message := map[string]any{"role": "assistant", "content": parsed.Text.String(), "reasoning_content": parsed.Reasoning.String()}
	if len(parsed.Annotations) > 0 {
		message["annotations"] = chatAnnotations(parsed.Annotations)
	}
	finishReason := "stop"
	if len(parsed.ToolCalls) > 0 {
		finishReason = "tool_calls"
		if parsed.Text.Len() == 0 {
			message["content"] = nil
		}
		message["tool_calls"] = chatToolCalls(parsed.ToolCalls)
	}
	value := map[string]any{
		"id": strings.Replace(responseID, "resp_", "chatcmpl_", 1), "object": "chat.completion", "created": created, "model": model,
		"choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": finishReason}},
		"usage":   map[string]any{"prompt_tokens": inputTokens, "completion_tokens": outputTokens, "total_tokens": inputTokens + outputTokens},
	}
	// xAI: top-level citations = all source URLs encountered (always when present).
	if citations := xaiCitationURLs(*parsed); len(citations) > 0 {
		value["citations"] = citations
	}
	if usage := xaiServerSideToolUsage(*parsed); usage != nil {
		value["server_side_tool_usage"] = usage
	}
	return value
}

// buildWebMessagesResult 组装 Anthropic Messages 响应体。
func buildWebMessagesResult(responseID, model string, parsed *parsedChat, options conversation.ResponseOptions, inputTokens, outputTokens int64) map[string]any {
	visibleText, stopSequence := applyWebStopSequences(parsed.Text.String(), options.StopSequences)
	emitWebSearch := shouldEmitWebMessagesSearch(*parsed, options)
	// Zero initial capacity: tool/search counts come from untrusted upstream.
	content := make([]any, 0)
	if options.AnthropicThinking && parsed.Reasoning.Len() > 0 {
		content = append(content, map[string]any{"type": "thinking", "thinking": parsed.Reasoning.String()})
	}
	if emitWebSearch {
		content = append(content, webMessagesSearchBlocks(newWebID("srvtoolu"), *parsed, options)...)
	}
	if visibleText != "" || len(parsed.ToolCalls) == 0 {
		content = append(content, map[string]any{"type": "text", "text": visibleText})
	}
	for _, call := range parsed.ToolCalls {
		var input any = map[string]any{}
		if json.Unmarshal([]byte(call.Arguments), &input) != nil {
			input = map[string]any{}
		}
		content = append(content, map[string]any{"type": "tool_use", "id": webAnthropicToolID(call.ID), "name": call.Name, "input": input})
	}
	stopReason := "end_turn"
	if len(parsed.ToolCalls) > 0 {
		stopReason = "tool_use"
	} else if stopSequence != "" {
		stopReason = "stop_sequence"
	}
	usage := map[string]any{"input_tokens": inputTokens, "output_tokens": outputTokens, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
	if emitWebSearch {
		usage["server_tool_use"] = map[string]any{"web_search_requests": webMessagesSearchRequests(*parsed)}
	}
	return map[string]any{
		"id": strings.Replace(responseID, "resp_", "msg_", 1), "type": "message", "role": "assistant", "model": model,
		"content": content, "stop_reason": stopReason, "stop_sequence": nullableWebString(stopSequence),
		"usage": usage,
	}
}

// buildWebResponsesResult 组装 xAI/OpenAI Responses 响应体。
func buildWebResponsesResult(responseID, model string, parsed *parsedChat, created, inputTokens, outputTokens int64) map[string]any {
	finalizeXAIAnnotations(parsed)
	tools := parsed.Tools
	if tools == nil {
		tools = []any{}
	}
	toolChoice := parsed.ToolChoice
	if toolChoice == nil {
		toolChoice = "auto"
	}
	value := map[string]any{
		"id": responseID, "object": "response", "created_at": created, "completed_at": created, "status": "completed", "model": model,
		"output": webResponsesOutput(parsed), "parallel_tool_calls": parsed.ParallelTools, "tools": tools, "tool_choice": toolChoice, "store": true,
		"usage": map[string]any{
			"input_tokens": inputTokens, "output_tokens": outputTokens, "total_tokens": inputTokens + outputTokens,
			"input_tokens_details":  map[string]any{"cached_tokens": 0},
			"output_tokens_details": map[string]any{"reasoning_tokens": estimateTokens(parsed.Reasoning.String())},
			"num_sources_used":      int64(len(parsed.SearchSources)), "num_server_side_tools_used": parsed.ServerTools,
		},
	}
	// xAI Citations docs: response.citations is the full URL list from tool research.
	if citations := xaiCitationURLs(*parsed); len(citations) > 0 {
		value["citations"] = citations
	}
	if usage := xaiServerSideToolUsage(*parsed); usage != nil {
		value["server_side_tool_usage"] = usage
	}
	return value
}

// webResponsesOutput 构造 Responses 的输出条目序列，已是最终输出的会话直接复用。
func webResponsesOutput(parsed *parsedChat) []any {
	output := parsed.ResponseOutput
	if output != nil {
		return output
	}
	output = make([]any, 0, 2)
	if parsed.Reasoning.Len() > 0 {
		output = append(output, map[string]any{"id": newWebID("rs"), "type": "reasoning", "status": "completed", "summary": []any{map[string]any{"type": "summary_text", "text": parsed.Reasoning.String()}}})
	}
	// xAI Tool Usage Details: web_search_call / x_search_call precede the assistant message.
	output = append(output, xaiHostedSearchOutputItems(*parsed)...)
	if parsed.Text.Len() > 0 || len(parsed.ToolCalls) == 0 {
		annotations := responsesAnnotations(parsed.Annotations)
		if annotations == nil {
			annotations = []any{}
		}
		message := map[string]any{"id": newWebID("msg"), "type": "message", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": parsed.Text.String(), "annotations": annotations, "logprobs": []any{}}}}
		output = append(output, message)
	}
	for _, call := range parsed.ToolCalls {
		output = append(output, map[string]any{
			"id": newWebID("fc"), "type": "function_call", "status": "completed",
			"call_id": call.ID, "name": call.Name, "arguments": call.Arguments,
		})
	}
	return output
}

func applyWebStopSequences(text string, sequences []string) (string, string) {
	matchAt := -1
	matched := ""
	for _, sequence := range sequences {
		if sequence == "" {
			continue
		}
		if index := strings.Index(text, sequence); index >= 0 && (matchAt < 0 || index < matchAt) {
			matchAt = index
			matched = sequence
		}
	}
	if matchAt < 0 {
		return text, ""
	}
	return text[:matchAt], matched
}

func nullableWebString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func webAnthropicToolID(value string) string {
	if strings.HasPrefix(value, "toolu_") {
		return value
	}
	return "toolu_" + value
}

func webMessagesSearchBlocks(id string, parsed parsedChat, options conversation.ResponseOptions) []any {
	use := map[string]any{
		"type": "server_tool_use", "id": id, "name": "web_search",
		"input": map[string]any{"query": options.AnthropicWebSearchQuery},
	}
	hits := make([]any, 0, searchresult.MaxResults)
	seen := make(map[string]struct{}, searchresult.MaxResults)
	for _, source := range parsed.SearchSources {
		if len(hits) >= searchresult.MaxResults {
			break
		}
		rawURL, _ := source["url"].(string)
		rawURL, valid := searchresult.NormalizeURL(rawURL)
		if !valid {
			continue
		}
		if _, exists := seen[rawURL]; exists {
			continue
		}
		seen[rawURL] = struct{}{}
		title, _ := source["title"].(string)
		title = searchresult.NormalizeTitle(title, rawURL)
		hits = append(hits, map[string]any{"type": "web_search_result", "title": title, "url": rawURL})
	}
	var content any = hits
	if parsed.WebSearchTools == 0 && len(hits) == 0 {
		content = map[string]any{"type": "web_search_tool_result_error", "error_code": "unavailable"}
	}
	result := map[string]any{"type": "web_search_tool_result", "tool_use_id": id, "content": content}
	return []any{use, result}
}

func shouldEmitWebMessagesSearch(parsed parsedChat, options conversation.ResponseOptions) bool {
	return options.AnthropicWebSearch && (options.AnthropicWebSearchRequired || parsed.WebSearchTools > 0 || len(parsed.SearchSources) > 0)
}

func webMessagesSearchRequests(parsed parsedChat) int64 {
	if parsed.WebSearchTools > 0 {
		return parsed.WebSearchTools
	}
	return 1
}

func chatToolCalls(calls []parsedToolCall) []any {
	values := make([]any, 0, len(calls))
	for _, call := range calls {
		values = append(values, map[string]any{
			"id": call.ID, "type": "function",
			"function": map[string]any{"name": call.Name, "arguments": call.Arguments},
		})
	}
	return values
}

func chatAnnotations(annotations []map[string]any) []any {
	values := make([]any, 0, len(annotations))
	for _, annotation := range annotations {
		values = append(values, chatURLCitation(annotation))
	}
	return values
}

// chatURLCitation is Chat Completions nested url_citation (OpenAI-compatible wire).
// OpenAI Chat Completions uses the page title; fall back to the numeric label.
func chatURLCitation(annotation map[string]any) map[string]any {
	title := annotation["title"]
	if sourceTitle, _ := annotation["source_title"].(string); sourceTitle != "" {
		title = sourceTitle
	}
	inner := map[string]any{
		"url": annotation["url"], "title": title,
	}
	if _, ok := annotation["start_index"]; ok {
		inner["start_index"] = annotation["start_index"]
		inner["end_index"] = annotation["end_index"]
	}
	return map[string]any{"type": "url_citation", "url_citation": inner}
}

// responsesURLCitation is the xAI/OpenAI Responses flat url_citation on output_text.
func responsesURLCitation(annotation map[string]any) map[string]any {
	out := map[string]any{
		"type":  "url_citation",
		"url":   annotation["url"],
		"title": annotation["title"],
	}
	if _, ok := annotation["start_index"]; ok {
		out["start_index"] = annotation["start_index"]
		out["end_index"] = annotation["end_index"]
	}
	return out
}

func responsesAnnotations(annotations []map[string]any) []any {
	values := make([]any, 0, len(annotations))
	for _, annotation := range annotations {
		values = append(values, responsesURLCitation(annotation))
	}
	return values
}

// xaiCitationURLs builds response.citations: all source URLs from search tool results.
func xaiCitationURLs(parsed parsedChat) []string {
	out := make([]string, 0, len(parsed.SearchSources)+len(parsed.Annotations))
	seen := make(map[string]struct{}, cap(out))
	appendURL := func(u string) {
		if u == "" {
			return
		}
		if _, exists := seen[u]; exists {
			return
		}
		seen[u] = struct{}{}
		out = append(out, u)
	}
	for _, source := range parsed.SearchSources {
		u, _ := source["url"].(string)
		appendURL(u)
	}
	// render_citation can arrive for a source missing from tool_result (for
	// example a truncated result pool); it must not disappear from citations.
	for _, annotation := range parsed.Annotations {
		u, _ := annotation["url"].(string)
		appendURL(u)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// finalizeXAIAnnotations ensures annotations exist for no_inline mode from search pool
// when render_citation did not emit per-hit markers.
func finalizeXAIAnnotations(parsed *parsedChat) {
	if parsed == nil {
		return
	}
	if !parsed.DisableInlineCitations {
		return
	}
	if len(parsed.Annotations) > 0 {
		// Strip any accidental positional fields.
		for _, ann := range parsed.Annotations {
			delete(ann, "start_index")
			delete(ann, "end_index")
		}
		return
	}
	if len(parsed.SearchSources) == 0 {
		return
	}
	n := 0
	for _, source := range parsed.SearchSources {
		u, _ := source["url"].(string)
		if u == "" {
			continue
		}
		n++
		annotation := map[string]any{
			"type":  "url_citation",
			"url":   u,
			"title": fmt.Sprintf("%d", n),
		}
		if sourceTitle, _ := source["title"].(string); sourceTitle != "" {
			annotation["source_title"] = sourceTitle
		}
		parsed.Annotations = append(parsed.Annotations, annotation)
	}
}

func estimateToolCallTokens(calls []parsedToolCall) int64 {
	var total int64
	for _, call := range calls {
		total += estimateTokens(call.Name) + estimateTokens(call.Arguments)
	}
	return total
}
