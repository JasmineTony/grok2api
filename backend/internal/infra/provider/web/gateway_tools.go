package web

import (
	"fmt"
	"net/url"

	"github.com/chenyme/grok2api/backend/internal/infra/provider/searchresult"
)

// collectGatewayToolUsageCard records mgw tool_usage_card starts (web_search / x_search)
// and maps them to xAI web_search_call / x_search_call skeletons.
func collectGatewayToolUsageCard(parsed *parsedChat, card map[string]any) {
	if parsed == nil || card == nil {
		return
	}
	id := firstString(card, "tool_usage_card_id", "id")
	if id == "" {
		id = fmt.Sprintf("card:%d", parsed.ServerTools+1)
	}
	if web, _ := card["web_search"].(map[string]any); web != nil {
		recordGatewaySearchTool(parsed, id, "web_search")
		query := nestedSearchQuery(web)
		upsertHostedSearchCall(parsed, id, "web_search", query, "in_progress")
		return
	}
	if xSearch, _ := card["x_search"].(map[string]any); xSearch != nil {
		recordGatewaySearchTool(parsed, id, "x_search")
		query := nestedSearchQuery(xSearch)
		upsertHostedSearchCall(parsed, id, "x_search", query, "in_progress")
		return
	}
	recordGatewaySearchTool(parsed, id, "")
}

func recordGatewaySearchTool(parsed *parsedChat, id, kind string) {
	if parsed == nil || id == "" {
		return
	}
	if parsed.serverToolKeys == nil {
		parsed.serverToolKeys = make(map[string]struct{})
	}
	if _, exists := parsed.serverToolKeys[id]; !exists {
		if len(parsed.serverToolKeys) >= maxTrackedServerTools {
			return
		}
		parsed.serverToolKeys[id] = struct{}{}
		parsed.ServerTools++
	}
	var keys *map[string]struct{}
	var count *int64
	switch kind {
	case "web_search":
		keys, count = &parsed.webSearchKeys, &parsed.WebSearchTools
	case "x_search":
		keys, count = &parsed.xSearchKeys, &parsed.XSearchTools
	default:
		return
	}
	if *keys == nil {
		*keys = make(map[string]struct{})
	}
	if _, exists := (*keys)[id]; exists || len(*keys) >= maxTrackedServerTools {
		return
	}
	(*keys)[id] = struct{}{}
	*count++
}

func nestedSearchQuery(tool map[string]any) string {
	if tool == nil {
		return ""
	}
	if q := firstString(tool, "query"); q != "" {
		return q
	}
	if args, _ := tool["args"].(map[string]any); args != nil {
		return firstString(args, "query")
	}
	return ""
}

// gatewayActionSource 构造 OpenAPI 搜索 sources 条目：type 固定为 url，
// title 作为不影响协议的 UI 扩展保留。
func gatewayActionSource(rawURL, title string) (map[string]any, bool) {
	normalized, ok := searchresult.NormalizeURL(rawURL)
	if !ok {
		return nil, false
	}
	return map[string]any{
		"type": "url", "url": normalized, "title": searchresult.NormalizeTitle(title, normalized),
	}, true
}

// collectGatewayWebSearchResult 把 mgw tool_result.web_search 折叠为 web 搜索来源并完成宿主调用。
func collectGatewayWebSearchResult(parsed *parsedChat, callID string, web map[string]any) {
	var sources []map[string]any
	pages, _ := web["webpages"].([]any)
	for _, raw := range pages {
		item, _ := raw.(map[string]any)
		if item == nil {
			continue
		}
		u := firstString(item, "url")
		title := firstString(item, "title")
		appendSearchSource(parsed, u, title, "web")
		if source, ok := gatewayActionSource(u, title); ok {
			sources = append(sources, source)
		}
	}
	call := upsertHostedSearchCall(parsed, callID, "web_search", nestedSearchQuery(web), "completed")
	appendHostedSearchSources(call, sources)
	if call != nil {
		call.Status = "completed"
		recordGatewaySearchTool(parsed, call.ID, "web_search")
	}
}

// gatewayXPostTitle 复刻 mgw x_post 的标题拼接规则：作者名在前，正文追加在后。
func gatewayXPostTitle(item map[string]any) string {
	title := firstString(item, "name", "userhandle", "username")
	text, _ := item["text"].(string)
	if text == "" {
		return title
	}
	if title != "" {
		return title + ": " + text
	}
	return text
}

// collectGatewayXPostResult 把 mgw tool_result.x_post 折叠为 X 搜索来源并完成宿主调用。
func collectGatewayXPostResult(parsed *parsedChat, callID string, xPost map[string]any) {
	var sources []map[string]any
	posts, _ := xPost["posts"].([]any)
	for _, raw := range posts {
		item, _ := raw.(map[string]any)
		if item == nil {
			continue
		}
		handle := firstString(item, "userhandle", "username")
		postID := firstString(item, "post_id", "postId")
		if handle == "" || postID == "" {
			continue
		}
		rawURL := "https://x.com/" + url.PathEscape(handle) + "/status/" + url.PathEscape(postID)
		title := gatewayXPostTitle(item)
		appendSearchSource(parsed, rawURL, title, "x_post")
		if source, ok := gatewayActionSource(rawURL, title); ok {
			sources = append(sources, source)
		}
	}
	call := upsertHostedSearchCall(parsed, callID, "x_search", "", "completed")
	appendHostedSearchSources(call, sources)
	if call != nil {
		call.Status = "completed"
		if call.Kind == "" {
			call.Kind = "x_search"
		}
		recordGatewaySearchTool(parsed, call.ID, "x_search")
	}
}

// collectGatewayToolResult folds mgw tool_result into SearchSources and completes hosted calls.
func collectGatewayToolResult(parsed *parsedChat, result map[string]any) {
	if parsed == nil || result == nil {
		return
	}
	callID := firstString(result, "tool_call_id", "tool_usage_card_id", "id")
	if web, _ := result["web_search"].(map[string]any); web != nil {
		collectGatewayWebSearchResult(parsed, callID, web)
	}
	if xPost, _ := result["x_post"].(map[string]any); xPost != nil {
		collectGatewayXPostResult(parsed, callID, xPost)
	}
}
