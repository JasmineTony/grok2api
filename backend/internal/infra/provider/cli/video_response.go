package cli

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

func parseVideoCreateResponse(body []byte) (string, error) {
	var root map[string]any
	if err := json.Unmarshal(body, &root); err != nil {
		return "", fmt.Errorf("解析 Build 视频创建响应: %w", err)
	}
	if message := firstNestedString(root, "error", "message"); message != "" {
		return "", fmt.Errorf("Build 视频创建失败: %s", safeVideoDiagnosticMessage(message))
	}
	if id := firstString(root, "request_id", "id"); id != "" {
		return id, nil
	}
	if data, ok := root["data"].(map[string]any); ok {
		if id := firstString(data, "request_id", "id"); id != "" {
			return id, nil
		}
	}
	return "", fmt.Errorf("Build 视频创建响应缺少 request_id")
}

func parseVideoStatusResponse(body []byte, progress func(int), allowMissingURL bool) (provider.VideoResult, bool, error) {
	var root map[string]any
	if err := json.Unmarshal(body, &root); err != nil {
		return provider.VideoResult{}, false, fmt.Errorf("解析 Build 视频状态响应: %w", err)
	}
	if message := firstNestedString(root, "error", "message"); message != "" {
		return provider.VideoResult{}, false, fmt.Errorf("Build 视频生成失败: %s", safeVideoDiagnosticMessage(message))
	}
	statusSource := root
	if data, ok := root["data"].(map[string]any); ok {
		statusSource = data
	}
	if value, ok := numberAsInt(firstValue(statusSource, "progress")); ok && progress != nil {
		progress(value)
	}
	status := strings.ToLower(strings.TrimSpace(firstString(statusSource, "status", "state")))
	switch status {
	case "failed", "error", "cancelled", "canceled":
		message := firstNestedString(statusSource, "error", "message")
		if message == "" {
			message = firstString(statusSource, "error_message", "message")
		}
		if message == "" {
			message = status
		}
		return provider.VideoResult{}, false, fmt.Errorf("Build 视频生成失败: %s", safeVideoDiagnosticMessage(message))
	case "completed", "succeeded", "success", "ready", "done":
		videoURL := extractBuildVideoURL(root)
		if videoURL == "" && !allowMissingURL {
			return provider.VideoResult{}, false, fmt.Errorf("视频生成完成但没有返回内容 URL")
		}
		return provider.VideoResult{URL: videoURL, ContentType: "video/mp4"}, true, nil
	default:
		if videoURL := extractBuildVideoURL(root); videoURL != "" {
			return provider.VideoResult{URL: videoURL, ContentType: "video/mp4"}, true, nil
		}
		return provider.VideoResult{}, false, nil
	}
}

func asVideoUpstreamError(err error, target **videoUpstreamError) bool {
	if err == nil {
		return false
	}
	if v, ok := err.(*videoUpstreamError); ok {
		*target = v
		return true
	}
	return false
}

func extractBuildVideoURL(root map[string]any) string {
	candidates := []string{
		firstString(root, "video_url", "url"),
		firstNestedString(root, "video", "url"),
		firstNestedString(root, "output", "url"),
		firstNestedString(root, "result", "url"),
	}
	if data, ok := root["data"].(map[string]any); ok {
		candidates = append(candidates,
			firstString(data, "video_url", "url"),
			firstNestedString(data, "video", "url"),
			firstNestedString(data, "output", "url"),
		)
		if items, ok := data["data"].([]any); ok {
			for _, item := range items {
				if m, ok := item.(map[string]any); ok {
					if u := firstString(m, "url", "video_url"); u != "" {
						candidates = append(candidates, u)
					}
				}
			}
		}
	}
	if items, ok := root["data"].([]any); ok {
		for _, item := range items {
			if m, ok := item.(map[string]any); ok {
				if u := firstString(m, "url", "video_url"); u != "" {
					candidates = append(candidates, u)
				}
			}
		}
	}
	for _, value := range candidates {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func trustedBuildVideoAssetHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return false
	}
	trusted := []string{
		"x.ai", "grok.com", "assets.grok.com", "cdn.x.ai", "videos.x.ai",
	}
	for _, suffix := range trusted {
		if host == suffix || strings.HasSuffix(host, "."+suffix) {
			return true
		}
	}
	return false
}

func firstString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if text := strings.TrimSpace(stringValue(values[key])); text != "" {
			return text
		}
	}
	return ""
}

func firstNestedString(values map[string]any, objectKey, field string) string {
	nested, _ := values[objectKey].(map[string]any)
	if nested == nil {
		return ""
	}
	return strings.TrimSpace(stringValue(nested[field]))
}

func numberAsInt(value any) (int, bool) {
	switch typed := value.(type) {
	case float64:
		return int(typed), true
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case json.Number:
		n, err := typed.Int64()
		return int(n), err == nil
	default:
		return 0, false
	}
}
