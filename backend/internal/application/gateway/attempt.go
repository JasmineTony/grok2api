package gateway

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"reflect"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	neterrorpkg "github.com/chenyme/grok2api/backend/internal/pkg/neterror"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

type failureAttemptRecorder struct {
	method              string
	path                string
	remainingBodyBudget int
	attempts            []audit.Attempt
}

func newFailureAttemptRecorder(method, path string) *failureAttemptRecorder {
	return &failureAttemptRecorder{method: method, path: sanitizeRequestPath(path), remainingBodyBudget: diagnosticTotalBodyLimit}
}

const (
	diagnosticBodyLimit        = 64 << 10
	diagnosticTotalBodyLimit   = 256 << 10
	diagnosticTextLimit        = 2048
	diagnosticHeadersLimit     = 4 << 10
	diagnosticHeaderValueLimit = 512
	diagnosticErrorFrameLimit  = 8
)

var (
	diagnosticAuthorizationPattern = regexp.MustCompile(`(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+`)
	diagnosticCookiePattern        = regexp.MustCompile(`(?i)\b(cookie|set-cookie)\b\s*[:=]\s*[^\r\n]+`)
	diagnosticSecretPattern        = regexp.MustCompile(`(?i)(["']?(?:authorization|proxy-authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token)["']?\s*[:=]\s*["']?)[^"'\s,;}]+`)
	diagnosticOpaqueFieldPattern   = regexp.MustCompile(`(?i)(["'](?:encrypted[_-]?content|compaction[_-]?(?:blob|state)|opaque[_-]?(?:state|data))["']\s*[:=]\s*["'])((?:\\.|[^"'\\])*)(["']|$)`)
	diagnosticURLPattern           = regexp.MustCompile(`https?://[^\s"'<>]+`)
)

func (r *failureAttemptRecorder) captureCredentialFailure(credential accountdomain.Credential, startedAt time.Time, force bool, err error) {
	if err == nil {
		return
	}
	stage := "credential_validation"
	if force {
		stage = "credential_refresh"
	}
	r.append(audit.Attempt{
		Source:         audit.AttemptSourceCredential,
		Stage:          stage,
		AccountID:      auditAccountID(credential.ID),
		AccountName:    credential.Name,
		StartedAt:      startedAt.UTC(),
		DurationMS:     time.Since(startedAt).Milliseconds(),
		TransportError: sanitizeDiagnosticText(err.Error(), diagnosticTextLimit),
		ErrorChain:     errorFrames(err),
	})
}

// httpAttemptFields 描述一次上游 HTTP 或传输尝试的审计字段。
type httpAttemptFields struct {
	source         audit.AttemptSource
	stage          string
	statusCode     *int
	status         string
	headers        map[string][]string
	upstreamURL    string
	body           []byte
	bodyTruncated  bool
	transportError string
	errorChain     []audit.ErrorFrame
	startedAt      time.Time
	durationMS     int64
}

// buildAttempt 生成一条上游 HTTP/传输尝试的审计记录，统一字段口径。
func (r *failureAttemptRecorder) buildAttempt(credential accountdomain.Credential, fields httpAttemptFields) audit.Attempt {
	return audit.Attempt{
		Source:                fields.source,
		Stage:                 fields.stage,
		AccountID:             auditAccountID(credential.ID),
		AccountName:           credential.Name,
		Method:                r.method,
		RequestPath:           r.path,
		UpstreamURL:           sanitizeUpstreamURL(fields.upstreamURL),
		StartedAt:             fields.startedAt.UTC(),
		DurationMS:            time.Since(fields.startedAt).Milliseconds(),
		UpstreamStatusCode:    fields.statusCode,
		UpstreamStatus:        fields.status,
		ResponseHeaders:       fields.headers,
		ResponseBody:          fields.body,
		ResponseBodyTruncated: fields.bodyTruncated,
		TransportError:        fields.transportError,
		ErrorChain:            fields.errorChain,
	}
}

// responseFailureFields 描述失败响应的诊断状态、响应头与保留正文。
type responseFailureFields struct {
	statusCode    int
	status        string
	headers       map[string][]string
	body          []byte
	bodyTruncated bool
}

// captureResponseFailureFields 收集失败响应的诊断字段。正文读取失败时返回错误，并已把已读前缀接回响应。
func (r *failureAttemptRecorder) captureResponseFailureFields(response *provider.Response) (responseFailureFields, error) {
	fields := responseFailureFields{
		statusCode: response.StatusCode, status: response.Status,
		headers: sanitizeDiagnosticHeaders(response.Header),
	}
	if response.Diagnostic != nil {
		fields.statusCode = response.Diagnostic.StatusCode
		fields.status = response.Diagnostic.Status
		fields.headers = sanitizeDiagnosticHeaders(response.Diagnostic.Header)
		fields.body, fields.bodyTruncated = r.captureBody(response.Diagnostic.Body, response.Diagnostic.BodyTruncated)
		return fields, nil
	}
	body, replay, truncated, err := readResponseBody(response.Body)
	response.Body = replay
	fields.body, fields.bodyTruncated = r.captureBody(body, truncated)
	return fields, err
}

func (r *failureAttemptRecorder) captureResponse(credential accountdomain.Credential, startedAt time.Time, response *provider.Response, requestErr error) error {
	if response != nil {
		r.captureRecoveredAttempts(credential, startedAt, response)
	}
	if requestErr != nil {
		r.append(r.buildAttempt(credential, httpAttemptFields{
			source: audit.AttemptSourceTransport, stage: transportStage(requestErr),
			upstreamURL: errorUpstreamURL(requestErr), startedAt: startedAt,
			transportError: sanitizeDiagnosticText(requestErr.Error(), diagnosticTextLimit),
			errorChain:     errorFrames(requestErr),
		}))
		return requestErr
	}
	if response == nil || (response.StatusCode >= 200 && response.StatusCode < 300) {
		return nil
	}
	fields, readErr := r.captureResponseFailureFields(response)
	statusCode := fields.statusCode
	if readErr != nil {
		r.append(r.buildAttempt(credential, httpAttemptFields{
			source: audit.AttemptSourceUpstreamHTTP, stage: "response_body",
			statusCode: &statusCode, status: fields.status, headers: fields.headers,
			upstreamURL: response.UpstreamURL, body: fields.body, bodyTruncated: fields.bodyTruncated, startedAt: startedAt,
			transportError: sanitizeDiagnosticText(readErr.Error(), diagnosticTextLimit),
			errorChain:     errorFrames(readErr),
		}))
		return readErr
	}
	r.append(r.buildAttempt(credential, httpAttemptFields{
		source: audit.AttemptSourceUpstreamHTTP, stage: "upstream_response",
		statusCode: &statusCode, status: fields.status, headers: fields.headers,
		upstreamURL: response.UpstreamURL, body: fields.body, bodyTruncated: fields.bodyTruncated, startedAt: startedAt,
	}))
	return nil
}

func (r *failureAttemptRecorder) captureStreamFailure(credential accountdomain.Credential, startedAt time.Time, response *provider.Response, diagnostic StreamFailureDiagnostic) {
	if response == nil {
		return
	}
	statusCode := response.StatusCode
	body, bodyTruncated := r.captureBody(diagnostic.Body, diagnostic.BodyTruncated)
	r.append(audit.Attempt{
		Source:                audit.AttemptSourceUpstreamHTTP,
		Stage:                 "response_stream",
		AccountID:             auditAccountID(credential.ID),
		AccountName:           credential.Name,
		Method:                r.method,
		RequestPath:           r.path,
		UpstreamURL:           sanitizeUpstreamURL(response.UpstreamURL),
		StartedAt:             startedAt.UTC(),
		DurationMS:            time.Since(startedAt).Milliseconds(),
		UpstreamStatusCode:    &statusCode,
		UpstreamStatus:        response.Status,
		ResponseHeaders:       sanitizeDiagnosticHeaders(response.Header),
		ResponseBody:          body,
		ResponseBodyTruncated: bodyTruncated,
	})
}

// recoveredAttemptFields 收集单个恢复尝试的审计字段：保留正文、来源、状态码与脱敏错误链。
func (r *failureAttemptRecorder) recoveredAttemptFields(credential accountdomain.Credential, response *provider.Response, recovered provider.RecoveredAttempt, startedAt time.Time) httpAttemptFields {
	diagnostic := recovered.Diagnostic
	fields := httpAttemptFields{
		source: audit.AttemptSourceUpstreamHTTP, stage: recovered.Stage,
		status: diagnostic.Status, headers: sanitizeDiagnosticHeaders(diagnostic.Header),
		upstreamURL: recovered.UpstreamURL, startedAt: recovered.StartedAt,
		durationMS: recovered.DurationMS, transportError: recovered.Result,
	}
	fields.body, fields.bodyTruncated = r.captureBody(diagnostic.Body, diagnostic.BodyTruncated)
	if fields.stage == "" {
		fields.stage = "recovered_upstream"
	}
	if diagnostic.StatusCode != 0 {
		statusCode := diagnostic.StatusCode
		fields.statusCode = &statusCode
	} else {
		fields.source = audit.AttemptSourceTransport
	}
	if fields.upstreamURL == "" {
		fields.upstreamURL = response.UpstreamURL
	}
	if fields.startedAt.IsZero() {
		fields.startedAt = startedAt
		fields.durationMS = time.Since(startedAt).Milliseconds()
	}
	if fields.durationMS < 0 {
		fields.durationMS = 0
	}
	fields.errorChain = make([]audit.ErrorFrame, 0, 1)
	if recovered.Result != "" {
		fields.errorChain = append(fields.errorChain, audit.ErrorFrame{Type: fields.stage, Message: sanitizeDiagnosticText(recovered.Result, 512)})
	}
	if recovered.Failure != nil {
		failureText := sanitizeDiagnosticText(recovered.Failure.Error(), diagnosticTextLimit)
		if fields.transportError == "" {
			fields.transportError = failureText
		} else {
			fields.transportError = sanitizeDiagnosticText(fields.transportError+": "+failureText, diagnosticTextLimit)
		}
		fields.errorChain = append(fields.errorChain, errorFrames(recovered.Failure)...)
		if len(fields.errorChain) > diagnosticErrorFrameLimit {
			fields.errorChain = fields.errorChain[:diagnosticErrorFrameLimit]
		}
	}
	fields.transportError = sanitizeDiagnosticText(fields.transportError, diagnosticTextLimit)
	return fields
}

func (r *failureAttemptRecorder) captureRecoveredAttempts(credential accountdomain.Credential, startedAt time.Time, response *provider.Response) {
	if response == nil {
		return
	}
	for _, recovered := range response.RecoveredAttempts {
		fields := r.recoveredAttemptFields(credential, response, recovered, startedAt)
		attempt := r.buildAttempt(credential, fields)
		attempt.DurationMS = fields.durationMS
		r.append(attempt)
	}
}

func (r *failureAttemptRecorder) captureSelectionFailure(accountID uint64, accountName string, err error) {
	if err == nil {
		return
	}
	stage := "account_selection"
	id := accountID
	name := accountName
	var unavailable *SelectionUnavailableError
	if errors.As(err, &unavailable) && unavailable != nil {
		stage = string(unavailable.Reason)
		if unavailable.AccountID != 0 {
			id = unavailable.AccountID
		}
		if unavailable.AccountName != "" {
			name = unavailable.AccountName
		}
	}
	r.append(audit.Attempt{
		Source:         audit.AttemptSourceCredential,
		Stage:          stage,
		AccountID:      auditAccountID(id),
		AccountName:    name,
		Method:         r.method,
		RequestPath:    r.path,
		StartedAt:      time.Now().UTC(),
		TransportError: sanitizeDiagnosticText(err.Error(), diagnosticTextLimit),
		ErrorChain:     errorFrames(err),
	})
}

func (r *failureAttemptRecorder) hasStreamFailureFor(accountID uint64) bool {
	for _, attempt := range r.attempts {
		if attempt.Stage != "response_stream" || attempt.AccountID == nil || *attempt.AccountID != accountID {
			continue
		}
		return true
	}
	return false
}

// ensureStreamFailureAttempt 补记已完成 2xx 响应头握手、但随后失败的流式尝试。
// 既有 4xx 或传输失败记录不能屏蔽该尝试；同一账号已有 response_stream 时不重复追加。
func (r *failureAttemptRecorder) ensureStreamFailureAttempt(credential accountdomain.Credential, startedAt time.Time, response *provider.Response, errorCode string) {
	if response == nil || response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices || r.hasStreamFailureFor(credential.ID) {
		return
	}
	statusCode := response.StatusCode
	r.append(audit.Attempt{
		Source:             audit.AttemptSourceUpstreamHTTP,
		Stage:              "response_stream",
		AccountID:          auditAccountID(credential.ID),
		AccountName:        credential.Name,
		Method:             r.method,
		RequestPath:        r.path,
		UpstreamURL:        sanitizeUpstreamURL(response.UpstreamURL),
		StartedAt:          startedAt.UTC(),
		DurationMS:         time.Since(startedAt).Milliseconds(),
		UpstreamStatusCode: &statusCode,
		UpstreamStatus:     response.Status,
		ResponseHeaders:    sanitizeDiagnosticHeaders(response.Header),
		TransportError:     errorCode,
	})
}

func (r *failureAttemptRecorder) captureQualityDegraded(credential accountdomain.Credential, startedAt time.Time) {
	status := http.StatusOK
	r.append(audit.Attempt{
		Source:             audit.AttemptSourceUpstreamHTTP,
		Stage:              "quality_hold",
		AccountID:          auditAccountID(credential.ID),
		AccountName:        credential.Name,
		Method:             r.method,
		RequestPath:        r.path,
		StartedAt:          startedAt.UTC(),
		DurationMS:         time.Since(startedAt).Milliseconds(),
		UpstreamStatusCode: &status,
		UpstreamStatus:     "200 OK",
		TransportError:     ErrorQualityDegraded,
	})
}

func (r *failureAttemptRecorder) append(attempt audit.Attempt) {
	attempt.Number = len(r.attempts) + 1
	r.attempts = append(r.attempts, attempt)
}

// captureBody 在单次和单请求预算内保留可读的脱敏正文片段。
func (r *failureAttemptRecorder) captureBody(body []byte, alreadyTruncated bool) ([]byte, bool) {
	if len(body) == 0 {
		return nil, alreadyTruncated
	}
	if !utf8.Valid(body) {
		return nil, true
	}
	body = redactSensitiveDiagnosticJSON(body)
	limit := min(diagnosticBodyLimit, r.remainingBodyBudget)
	if limit <= 0 {
		return nil, true
	}
	truncated := alreadyTruncated || len(body) > limit
	if len(body) > limit {
		body = body[:limit]
	}
	result := []byte(sanitizeDiagnosticText(string(body), limit))
	r.remainingBodyBudget -= len(result)
	return result, truncated
}

// redactSensitiveDiagnosticJSON 递归替换诊断 JSON 中的密文与 opaque 会话状态。
func redactSensitiveDiagnosticJSON(body []byte) []byte {
	var payload any
	if json.Unmarshal(body, &payload) != nil || !redactSensitiveDiagnosticValue(payload) {
		return body
	}
	redacted, err := json.Marshal(payload)
	if err != nil {
		return body
	}
	return redacted
}

// redactSensitiveDiagnosticValue 遍历 JSON 容器，避免嵌套敏感字段绕过顶层脱敏。
func redactSensitiveDiagnosticValue(value any) bool {
	changed := false
	switch typed := value.(type) {
	case map[string]any:
		for key, nested := range typed {
			if isSensitiveDiagnosticField(key) {
				typed[key] = "[REDACTED]"
				changed = true
				continue
			}
			changed = redactSensitiveDiagnosticValue(nested) || changed
		}
	case []any:
		for _, nested := range typed {
			changed = redactSensitiveDiagnosticValue(nested) || changed
		}
	}
	return changed
}

// isSensitiveDiagnosticField 统一识别上游可能使用的密文与压缩状态字段名。
func isSensitiveDiagnosticField(value string) bool {
	value = strings.ReplaceAll(strings.ToLower(strings.TrimSpace(value)), "-", "_")
	value = strings.ReplaceAll(value, "_", "")
	switch value {
	case "encryptedcontent", "compactionblob", "compactionstate", "opaquestate", "opaquedata":
		return true
	default:
		return false
	}
}

func (r *failureAttemptRecorder) snapshot() []audit.Attempt {
	return append([]audit.Attempt(nil), r.attempts...)
}

func auditAccountID(id uint64) *uint64 {
	if id == 0 {
		return nil
	}
	return &id
}

type replayReadCloser struct {
	io.Reader
	source io.Closer
}

func (r *replayReadCloser) Close() error { return r.source.Close() }

// readResponseBody 只读取诊断上限，同时把已读取前缀接回原始响应供后续错误处理。
func readResponseBody(body io.ReadCloser) ([]byte, io.ReadCloser, bool, error) {
	if body == nil {
		return nil, io.NopCloser(bytes.NewReader(nil)), false, nil
	}
	data, err := io.ReadAll(io.LimitReader(body, diagnosticBodyLimit+1))
	truncated := len(data) > diagnosticBodyLimit
	if truncated || err != nil {
		captured := data
		if len(captured) > diagnosticBodyLimit {
			captured = captured[:diagnosticBodyLimit]
		}
		replay := &replayReadCloser{Reader: io.MultiReader(bytes.NewReader(data), body), source: body}
		return captured, replay, truncated, err
	}
	closeErr := body.Close()
	return data, io.NopCloser(bytes.NewReader(data)), false, closeErr
}

func errorFrames(err error) []audit.ErrorFrame {
	frames := make([]audit.ErrorFrame, 0, 4)
	appendErrorFrames(&frames, err)
	return frames
}

func appendErrorFrames(frames *[]audit.ErrorFrame, err error) {
	if err == nil || len(*frames) >= diagnosticErrorFrameLimit {
		return
	}
	*frames = append(*frames, audit.ErrorFrame{Type: truncateDiagnosticText(reflect.TypeOf(err).String(), 256), Message: sanitizeDiagnosticText(err.Error(), 512)})
	if joined, ok := err.(interface{ Unwrap() []error }); ok {
		for _, nested := range joined.Unwrap() {
			appendErrorFrames(frames, nested)
		}
		return
	}
	appendErrorFrames(frames, errors.Unwrap(err))
}

func sanitizeDiagnosticHeaders(headers http.Header) map[string][]string {
	result := make(map[string][]string)
	remaining := diagnosticHeadersLimit
	for name, values := range headers {
		if remaining <= 0 {
			break
		}
		lowerName := strings.ToLower(name)
		if !isAllowedDiagnosticHeader(lowerName) {
			continue
		}
		cleanValues := make([]string, 0, min(len(values), 8))
		for _, value := range values {
			if len(cleanValues) == 8 || remaining <= len(name) {
				break
			}
			cleanValue := sanitizeDiagnosticText(value, min(diagnosticHeaderValueLimit, remaining-len(name)))
			cleanValues = append(cleanValues, cleanValue)
			remaining -= len(name) + len(cleanValue)
		}
		if len(cleanValues) > 0 {
			result[http.CanonicalHeaderKey(name)] = cleanValues
		}
	}
	return result
}

func isAllowedDiagnosticHeader(name string) bool {
	if strings.HasPrefix(name, "x-ratelimit-") || strings.HasPrefix(name, "ratelimit-") {
		return true
	}
	switch name {
	case "content-length", "content-type", "date", "retry-after", "server", "cf-ray", "request-id", "traceparent", "tracestate", "via", "x-correlation-id", "x-request-id", "x-grok2api-compatibility-warnings":
		return true
	default:
		return false
	}
}

func sanitizeDiagnosticText(value string, limit int) string {
	value = diagnosticCookiePattern.ReplaceAllString(value, "$1: [REDACTED]")
	value = diagnosticAuthorizationPattern.ReplaceAllString(value, "$1 [REDACTED]")
	value = diagnosticSecretPattern.ReplaceAllString(value, "$1[REDACTED]")
	value = diagnosticOpaqueFieldPattern.ReplaceAllString(value, "$1[REDACTED]$3")
	value = diagnosticURLPattern.ReplaceAllStringFunc(value, sanitizeUpstreamURL)
	return truncateDiagnosticText(value, limit)
}

func truncateDiagnosticText(value string, limit int) string {
	if limit <= 0 {
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

func sanitizeRequestPath(value string) string {
	parsed, err := url.ParseRequestURI(value)
	if err != nil {
		return truncateDiagnosticText(strings.SplitN(value, "?", 2)[0], 2048)
	}
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	parsed.Fragment = ""
	return truncateDiagnosticText(parsed.String(), 2048)
}

func sanitizeUpstreamURL(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	parsed.Fragment = ""
	parsed.RawFragment = ""
	return truncateDiagnosticText(parsed.String(), 4096)
}

func errorUpstreamURL(err error) string {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return urlErr.URL
	}
	return ""
}

func transportStage(err error) string {
	switch {
	case neterrorpkg.IsResponseHeaderTimeout(err):
		return "response_header_timeout"
	case errors.Is(err, context.Canceled):
		return "request_canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "request_timeout"
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return "dns_lookup"
	}
	var certificateError *tls.CertificateVerificationError
	if errors.As(err, &certificateError) {
		return "tls_verification"
	}
	var unknownAuthority x509.UnknownAuthorityError
	if errors.As(err, &unknownAuthority) {
		return "tls_verification"
	}
	var recordHeaderError tls.RecordHeaderError
	if errors.As(err, &recordHeaderError) {
		return "tls_handshake"
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return "network_timeout"
	}
	var operationError *net.OpError
	if errors.As(err, &operationError) && operationError.Op != "" {
		return operationError.Op
	}
	return "transport"
}
