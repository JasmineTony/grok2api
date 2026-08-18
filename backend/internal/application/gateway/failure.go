package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	"github.com/chenyme/grok2api/backend/internal/infra/provider"
	neterrorpkg "github.com/chenyme/grok2api/backend/internal/pkg/neterror"
)

// FailureCategory 描述 Provider 失败的稳定分类。
type FailureCategory string

const (
	FailureCredential FailureCategory = "credential"
	FailureQuota      FailureCategory = "quota"
	FailureRateLimit  FailureCategory = "rate_limit"
	FailurePolicy     FailureCategory = "policy"
	FailureNetwork    FailureCategory = "network"
	FailureTimeout    FailureCategory = "timeout"
	FailureUpstream   FailureCategory = "upstream"
	FailureProtocol   FailureCategory = "protocol"
	FailureInternal   FailureCategory = "internal"
)

type FailureImpact string

const (
	ImpactNone     FailureImpact = "none"
	ImpactDegraded FailureImpact = "degraded"
	ImpactCooldown FailureImpact = "cooldown"
	ImpactQuota    FailureImpact = "quota_exhausted"
	ImpactReauth   FailureImpact = "reauth_required"
)

// UpstreamFailure 保存可安全暴露给下游和审计的上游失败分类，不包含响应正文或凭据。
type UpstreamFailure struct {
	Category               FailureCategory
	Stage                  string
	Provider               string
	Retryable              bool
	AccountImpact          FailureImpact
	SanitizedDetail        string
	HTTPStatus             int
	Code                   string
	PublicMessage          string
	UpstreamCode           string
	AccountID              uint64
	AccountName            string
	AccountScoped          bool
	AccountBlocked         bool
	PermanentAccountDenial bool
	// SafetyRejection marks a request-level content safety denial. It must not
	// refresh OAuth, retry, switch accounts, cool down, or invalidate credentials.
	SafetyRejection bool
	// RequestScopedForbidden marks deterministic request/policy rejection.
	RequestScopedForbidden bool
	QuotaExhausted         bool
	FreeQuotaExhausted     bool
	ModelQuotaExhausted    bool
	// SpendingLimitBlocked marks paid-account spending-limit denial.
	SpendingLimitBlocked bool
	CredentialRejected   bool
	Fingerprint          string
	RetryAfter           time.Duration
	Cause                error
}

func (e *UpstreamFailure) Error() string {
	if e == nil {
		return "上游请求失败"
	}
	if e.UpstreamCode != "" {
		return fmt.Sprintf("%s: %s", e.Code, e.UpstreamCode)
	}
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Code, e.Cause)
	}
	return e.Code
}

func (e *UpstreamFailure) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func (e *UpstreamFailure) AuditCode() string {
	if e == nil {
		return "upstream_error"
	}
	if suffix := normalizeFailureCode(e.UpstreamCode); suffix != "" {
		return truncateFailureCode(e.Code + "_" + suffix)
	}
	return truncateFailureCode(e.Code)
}

// ClientCredentialErrorCode 返回允许暴露给客户端的账号类上游错误码。
// HTTP 状态和错误文案仍由传输层统一脱敏；这里只放行稳定、无凭据内容的机器码。
func (e *UpstreamFailure) ClientCredentialErrorCode() string {
	if e == nil {
		return "upstream_unavailable"
	}
	return clientCredentialErrorCode(e.HTTPStatus, e.UpstreamCode)
}

// ClientCredentialErrorCodeFromBody 从账号类上游错误正文中提取允许公开的机器码。
// 用于上游响应已直接交给传输层、尚未构造 UpstreamFailure 的路径。
func ClientCredentialErrorCodeFromBody(status int, body []byte) string {
	upstreamCode, _, _ := extractUpstreamErrorMetadata(body)
	return clientCredentialErrorCode(status, upstreamCode)
}

func clientCredentialErrorCode(status int, upstreamCode string) string {
	if status == http.StatusForbidden && normalizeFailureCode(upstreamCode) == "permission_denied" {
		return "permission-denied"
	}
	return "upstream_unavailable"
}

func newHTTPUpstreamFailure(status int, body []byte, accountID uint64, accountName string) *UpstreamFailure {
	upstreamCode, upstreamType, upstreamMessage := extractUpstreamErrorMetadata(body)
	failure := &UpstreamFailure{
		Category: FailureUpstream, Stage: "response", Retryable: status >= http.StatusInternalServerError, AccountImpact: ImpactNone,
		HTTPStatus: status, Code: "upstream_error", PublicMessage: "上游服务返回错误",
		UpstreamCode: upstreamCode, SanitizedDetail: firstNonEmptyFailure(upstreamCode, upstreamType),
		AccountID: accountID, AccountName: accountName,
	}
	if status < 400 || status > 599 {
		failure.HTTPStatus = http.StatusBadGateway
	}
	metadataText := strings.ToLower(strings.Join([]string{upstreamCode, upstreamType, upstreamMessage}, " "))
	switch status {
	case http.StatusUnauthorized:
		failure.Code = "upstream_unauthorized"
		failure.PublicMessage = "上游账号认证失败"
		failure.AccountScoped = true
		failure.CredentialRejected = true
		failure.AccountBlocked = isDefinitiveAccountBlock(metadataText)
		failure.Category, failure.AccountImpact, failure.Retryable = FailureCredential, ImpactReauth, false
	case http.StatusPaymentRequired:
		failure.Code = "upstream_payment_required"
		failure.PublicMessage = "上游账号额度不足"
		failure.AccountScoped = true
		failure.QuotaExhausted = true
		failure.FreeQuotaExhausted = isFreeQuotaExhaustion(metadataText)
		failure.SpendingLimitBlocked = isPaidQuotaExhaustion(metadataText)
		failure.Category, failure.AccountImpact, failure.Retryable = FailureQuota, ImpactQuota, false
	case http.StatusForbidden:
		failure.Code = "upstream_forbidden"
		failure.PublicMessage = "上游拒绝了该请求"
		// Console's DPoP requirement is an upstream auth-scheme rollout, not a
		// property of the selected SSO account. Rotating accounts or browser
		// egress cannot make the same Bearer-anonymous request valid.
		if isDPoPProofRequired(upstreamCode) {
			failure.RequestScopedForbidden = true
			break
		}
		// Safety denials are request-scoped: inspect both structured metadata and the raw body
		// so SAFETY_CHECK_TYPE_* markers still match when they only appear in nested text.
		if isSafetyRejection(metadataText) || isSafetyRejection(string(body)) {
			failure.SafetyRejection = true
			break
		}
		if isRequestScopedForbidden(upstreamCode, metadataText) {
			failure.RequestScopedForbidden = true
			break
		}
		failure.AccountBlocked = isDefinitiveAccountBlock(metadataText)
		failure.PermanentAccountDenial = isPermanentAccountDenial(upstreamMessage) || strings.Contains(metadataText, "access to the chat endpoint is denied")
		failure.ModelQuotaExhausted = isModelQuotaExhaustion(metadataText)
		failure.FreeQuotaExhausted = failure.ModelQuotaExhausted || isFreeQuotaExhaustion(metadataText)
		failure.QuotaExhausted = failure.FreeQuotaExhausted || isCreditQuotaExhaustion(metadataText)
		failure.SpendingLimitBlocked = isPaidQuotaExhaustion(metadataText)
		failure.CredentialRejected = !failure.QuotaExhausted && containsAny(metadataText, "authentication", "unauthorized", "invalid token", "token expired")
		failure.AccountScoped = failure.AccountBlocked || failure.PermanentAccountDenial || failure.QuotaExhausted || failure.CredentialRejected || isAccountScopedForbidden(metadataText)
		switch {
		case failure.CredentialRejected:
			failure.Category, failure.AccountImpact, failure.Retryable = FailureCredential, ImpactReauth, false
		case failure.QuotaExhausted:
			failure.Category, failure.AccountImpact, failure.Retryable = FailureQuota, ImpactQuota, false
		case failure.PermanentAccountDenial:
			failure.Category, failure.AccountImpact, failure.Retryable = FailurePolicy, ImpactDegraded, false
		default:
			failure.Category, failure.AccountImpact, failure.Retryable = FailureUpstream, ImpactDegraded, false
		}
	case http.StatusTooManyRequests:
		failure.Code = "upstream_rate_limited"
		failure.PublicMessage = "上游请求频率受限"
		failure.AccountScoped = true
		// Subscription-level free usage and explicit per-model free usage are
		// distinct so the gateway can preserve their different recovery scopes.
		failure.FreeQuotaExhausted = isFreeQuotaExhaustion(metadataText)
		failure.ModelQuotaExhausted = isModelQuotaExhaustion(metadataText)
		failure.QuotaExhausted = failure.FreeQuotaExhausted || isPaidQuotaExhaustion(metadataText)
		failure.SpendingLimitBlocked = isPaidQuotaExhaustion(metadataText)
		failure.Category, failure.AccountImpact, failure.Retryable = FailureRateLimit, ImpactCooldown, true
	default:
		failure.Code = "upstream_server_error"
		failure.PublicMessage = "上游服务暂时异常"
	}
	fingerprintPart := normalizeFailureCode(firstNonEmptyFailure(upstreamCode, upstreamType, upstreamMessage))
	if fingerprintPart == "" {
		fingerprintPart = "unknown"
	}
	failure.Fingerprint = fmt.Sprintf("%d:%s", status, fingerprintPart)
	return failure
}

func newTransportUpstreamFailure(err error, accountID uint64, accountName string) *UpstreamFailure {
	status, code, message := http.StatusBadGateway, "upstream_network_error", "连接上游服务失败"
	category := FailureNetwork
	if neterrorpkg.IsResponseHeaderTimeout(err) {
		status, code, message = http.StatusGatewayTimeout, "upstream_header_timeout", "等待上游响应头超时"
		category = FailureTimeout
	} else if neterrorpkg.IsUpstreamStreamIdleTimeout(err) {
		status, code, message = http.StatusGatewayTimeout, "upstream_stream_idle_timeout", "上游流式响应长时间无数据"
		category = FailureTimeout
	} else if errors.Is(err, context.DeadlineExceeded) {
		code, message = "upstream_timeout", "连接上游服务失败"
		category = FailureTimeout
	}
	return &UpstreamFailure{
		Category: category, Stage: "transport", Retryable: true, AccountImpact: ImpactCooldown,
		HTTPStatus: status, Code: code, PublicMessage: message,
		AccountID: accountID, AccountName: accountName, Fingerprint: code, Cause: err,
	}
}

func newProviderRequestFailure(err error, accountID uint64, accountName string) *UpstreamFailure {
	if accountapp.IsCredentialStorageError(err) {
		return newCredentialUpstreamFailure(err, accountID, accountName)
	}
	return newTransportUpstreamFailure(err, accountID, accountName)
}

func newCredentialUpstreamFailure(err error, accountID uint64, accountName string) *UpstreamFailure {
	code := "upstream_credential_unavailable"
	publicMessage := "上游账号凭据不可用"
	if accountapp.IsCredentialStorageError(err) {
		code = "credential_decryption_failed"
		publicMessage = "上游账号凭据无法解密"
	}
	return &UpstreamFailure{
		Category: FailureCredential, Stage: "credential", Retryable: true, AccountImpact: ImpactDegraded,
		HTTPStatus: http.StatusServiceUnavailable, Code: code, PublicMessage: publicMessage,
		AccountID: accountID, AccountName: accountName, AccountScoped: true, Fingerprint: code, Cause: err,
	}
}

func newCanceledUpstreamFailure(err error, accountID uint64, accountName string) *UpstreamFailure {
	return &UpstreamFailure{
		Category: FailureInternal, Stage: "request", Retryable: false, AccountImpact: ImpactNone,
		HTTPStatus: 499, Code: "request_canceled", PublicMessage: "请求已取消",
		AccountID: accountID, AccountName: accountName, Fingerprint: "request_canceled", Cause: err,
	}
}

// StateReason returns a bounded, credential-free reason suitable for state history.
func (e *UpstreamFailure) StateReason() string {
	if e == nil {
		return "failure_unknown"
	}
	parts := []string{e.AuditCode()}
	if e.Category != "" {
		parts = append(parts, "category="+string(e.Category))
	}
	if e.Stage != "" {
		parts = append(parts, "stage="+normalizeFailureCode(e.Stage))
	}
	if detail := normalizeFailureCode(e.SanitizedDetail); detail != "" {
		parts = append(parts, "detail="+detail)
	}
	return truncateFailureCode(strings.Join(parts, " "))
}

// Normalized 返回可记录且不包含敏感信息的结构化失败。
func (e *UpstreamFailure) Normalized() map[string]any {
	if e == nil {
		return map[string]any{"category": string(FailureInternal), "code": "unknown"}
	}
	return map[string]any{
		"category": string(e.Category), "stage": e.Stage, "code": e.AuditCode(),
		"http_status": e.HTTPStatus, "retryable": e.Retryable,
		"account_impact": string(e.AccountImpact),
		"detail":         truncateFailureCode(normalizeFailureCode(e.SanitizedDetail)),
	}
}

func extractUpstreamErrorMetadata(body []byte) (string, string, string) {
	if len(body) == 0 {
		return "", "", ""
	}
	var payload any
	if json.Unmarshal(body, &payload) != nil {
		return "", "", strings.TrimSpace(string(body))
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return "", "", ""
	}
	if nested, ok := root["error"].(map[string]any); ok {
		code := firstNonEmptyFailure(firstStringValue(nested, "code", "error_code"), firstStringValue(root, "code", "error_code"))
		errorType := firstNonEmptyFailure(firstStringValue(nested, "type", "error_type"), firstStringValue(root, "type", "error_type"))
		message := firstNonEmptyFailure(firstStringValue(nested, "message", "error"), firstStringValue(root, "message"))
		return code, errorType, message
	}
	message := firstNonEmptyFailure(firstStringValue(root, "error"), firstStringValue(root, "message"))
	return firstStringValue(root, "code", "error_code"), firstStringValue(root, "type", "error_type"), message
}

// isRequestScopedForbidden recognizes deterministic request-level failures.
func isRequestScopedForbidden(upstreamCode, text string) bool {
	switch normalizeFailureCode(upstreamCode) {
	case "invalid_argument", "invalid_arguments", "invalid_parameter", "invalid_parameters", "invalid_request", "bad_request", "invalid_params":
		return true
	}
	return containsAny(text, "request rejected by policy", "policy rejected request", "content policy", "content moderation", "zero data retention", "zdr-blocked", "zdr blocked", "zdr-gated", "zdr gated", "operation is unavailable under zdr", "operation unavailable under zdr")
}

func isAccountScopedForbidden(text string) bool {
	// Do not match bare "permission" / permission-denied alone: those codes are shared by
	// request-level policy denials. Account scope requires quota/billing/auth wording.
	return containsAny(text, "quota", "billing", "subscription", "entitlement", "unauthorized", "authentication", "invalid token", "token expired", "usage-exhausted", "insufficient", "spending-limit", "spending limit", "run out of credits", "out of credits", "usage balance exhausted", "usage limit reached")
}

// isPermanentAccountDenial requires explicit account/model permission text.
// A bare permission-denied code without access-denied wording is not enough:
// content safety rejections and other policy 403s share that code.
func isPermanentAccountDenial(text string) bool {
	text = strings.ToLower(strings.Trim(strings.TrimSpace(text), " .!\t\r\n"))
	return strings.Contains(text, "access to the chat endpoint is denied") || text == "access denied"
}

// isSafetyRejection identifies request-level content safety denials that must
// be returned to the client without account rotation or invalidation.
func isSafetyRejection(text string) bool {
	if text == "" {
		return false
	}
	lower := strings.ToLower(text)
	return strings.Contains(lower, "content violates usage guidelines") ||
		strings.Contains(lower, "safety_check_type_")
}

func isDPoPProofRequired(upstreamCode string) bool {
	return provider.IsDPoPProofRequiredText(upstreamCode)
}

func isDefinitiveAccountBlock(text string) bool {
	return provider.IsDefinitiveAccountBlockText(text)
}

func isPaidQuotaExhaustion(text string) bool {
	return strings.Contains(text, "personal-team-blocked:spending-limit")
}

func isCreditQuotaExhaustion(text string) bool {
	return isPaidQuotaExhaustion(text) || containsAny(text, "run out of credits", "out of credits", "usage balance exhausted", "usage limit reached")
}

func isFreeQuotaExhaustion(text string) bool {
	return containsAny(text, "subscription:free-usage-exhausted", "used all the included free usage for model")
}

func isModelQuotaExhaustion(text string) bool {
	return strings.Contains(text, "used all the included free usage for model")
}

func containsAny(text string, signals ...string) bool {
	for _, signal := range signals {
		if strings.Contains(text, signal) {
			return true
		}
	}
	return false
}

func firstStringValue(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := values[key].(string); ok {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstNonEmptyFailure(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func normalizeFailureCode(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	for _, current := range value {
		switch {
		case unicode.IsLetter(current), unicode.IsDigit(current):
			builder.WriteRune(current)
		case current == '-', current == '_', current == '.', current == ':':
			builder.WriteByte('_')
		}
		if builder.Len() >= 48 {
			break
		}
	}
	return strings.Trim(builder.String(), "_")
}

func truncateFailureCode(value string) string {
	if len(value) <= 100 {
		return value
	}
	return value[:100]
}
