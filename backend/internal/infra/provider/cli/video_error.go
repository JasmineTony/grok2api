package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// mediaUploadSecretPattern 匹配上传路径及其中的 64-hex 一次性 token（含完整 URL 前缀）。
var mediaUploadSecretPattern = regexp.MustCompile(`(?i)(?:https?://[^\s"'\\<>]+)?/v1/media/uploads/[0-9a-f]{64}`)

// bareUploadTokenPattern 匹配无路径前缀的 64-hex 上传 token（上游可能仅回显 token 本身）。
var bareUploadTokenPattern = regexp.MustCompile(`(?i)\b[0-9a-f]{64}\b`)

// videoUpstreamError 是上游非 2xx 的可分类错误：保留 HTTP 状态，摘要经密钥脱敏且长度有界。
// 不得将原始响应体写入 Error()，避免 upload_url / token 泄漏到 media_jobs.error_message、日志或审计。
type videoUpstreamError struct {
	status  int
	summary string
}

func (e *videoUpstreamError) Error() string {
	if e == nil {
		return ""
	}
	return e.summary
}

func (e *videoUpstreamError) HTTPStatusCode() int {
	if e == nil {
		return 0
	}
	return e.status
}

// newVideoUpstreamError 从上游响应构造密钥安全、有界的错误摘要。
func newVideoUpstreamError(status int, body []byte) *videoUpstreamError {
	return &videoUpstreamError{status: status, summary: summarizeVideoUpstreamError(status, body)}
}

func summarizeVideoUpstreamError(status int, body []byte) string {
	code, message := extractVideoUpstreamErrorFields(body)
	parts := []string{fmt.Sprintf("Build 视频上游返回 %d", status)}
	if code != "" {
		parts = append(parts, code)
	}
	if message != "" {
		parts = append(parts, message)
	} else if code == "" {
		// 非结构化正文：仅作有界、脱敏片段，避免整包原文进入错误链。
		if snippet := redactVideoUploadSecrets(strings.TrimSpace(string(body))); snippet != "" {
			parts = append(parts, boundDiagnosticText(snippet, buildVideoErrorMessageLimit))
		}
	}
	return boundDiagnosticText(strings.Join(parts, ": "), buildVideoErrorSummaryLimit)
}

func extractVideoUpstreamErrorFields(body []byte) (code, message string) {
	body = bytes.TrimSpace(body)
	if len(body) == 0 || body[0] != '{' {
		return "", ""
	}
	var root map[string]any
	if err := json.Unmarshal(body, &root); err != nil {
		return "", ""
	}
	if errObj, ok := root["error"].(map[string]any); ok {
		code = firstString(errObj, "code", "type", "error")
		message = firstString(errObj, "message", "error", "detail")
	}
	if code == "" {
		code = firstString(root, "code", "error_code", "type")
	}
	if message == "" {
		message = firstString(root, "message", "error_message", "detail")
	}
	if code != "" {
		code = boundDiagnosticText(redactVideoUploadSecrets(strings.TrimSpace(code)), 64)
	}
	if message != "" {
		message = safeVideoDiagnosticMessage(message)
	}
	return code, message
}

func redactVideoUploadSecrets(value string) string {
	if value == "" {
		return value
	}
	// 先替换完整 upload 路径，再替换残留的裸 64-hex token。
	value = mediaUploadSecretPattern.ReplaceAllString(value, "/v1/media/uploads/[REDACTED]")
	value = bareUploadTokenPattern.ReplaceAllString(value, "[REDACTED]")
	return value
}

// safeVideoDiagnosticMessage 对上游派生的 code/message 做密钥脱敏与长度有界处理。
// 用于非 2xx 摘要以及 2xx JSON 中的 error.message 等字段，避免 upload token 进入错误链。
func safeVideoDiagnosticMessage(message string) string {
	return boundDiagnosticText(redactVideoUploadSecrets(strings.TrimSpace(message)), buildVideoErrorMessageLimit)
}

func boundDiagnosticText(value string, limit int) string {
	if limit <= 0 || value == "" {
		return ""
	}
	if len(value) <= limit {
		return value
	}
	for limit > 0 && !utf8.ValidString(value[:limit]) {
		limit--
	}
	return value[:limit]
}
