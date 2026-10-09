package provider

import (
	"net/http"
	"strings"
	"time"
)

// CredentialRefreshError distinguishes permanent OAuth errors requiring reauthorization from temporary errors that can retry with backoff.
type CredentialRefreshError struct {
	Status  int
	Code    string
	Message string
	// Response is a bounded, redacted representation of the upstream OAuth
	// response. It is diagnostic only and must never contain credentials.
	Response   string
	Permanent  bool
	RetryAfter time.Duration
	Cause      error
}

func (e *CredentialRefreshError) Error() string {
	if e == nil {
		return "credential refresh failed"
	}
	if e.Code != "" {
		if e.Message != "" {
			return "credential refresh failed: " + e.Code + ": " + e.Message
		}
		return "credential refresh failed: " + e.Code
	}
	if e.Message != "" {
		return "credential refresh failed: " + e.Message
	}
	if e.Cause != nil {
		return "credential refresh failed: " + e.Cause.Error()
	}
	return "credential refresh failed"
}

func (e *CredentialRefreshError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

// IsPermanentCredentialRefreshErrorCode reports credential-specific terminal
// failures. HTTP status alone is intentionally insufficient: OAuth gateways
// also use 400/401 for temporary policy, client, and infrastructure errors.
func IsPermanentCredentialRefreshErrorCode(code string) bool {
	switch normalizeCredentialRefreshErrorCode(code) {
	case "invalid_grant",
		"invalid_refresh_token",
		"refresh_token_invalid",
		"refresh_token_expired",
		"refresh_token_revoked",
		"refresh_token_reused",
		"refresh_token_reuse",
		"token_reused",
		"token_reuse_detected",
		"expired_token",
		"revoked_token",
		"token_revoked",
		"missing_refresh_token":
		return true
	default:
		return false
	}
}

// IsCredentialRefreshConfigurationErrorCode reports OAuth failures caused by
// this gateway's client/request configuration rather than by one account's
// refresh token. These errors should be retried conservatively and surfaced to
// operators, but must not mark an individual account reauthRequired.
func IsCredentialRefreshConfigurationErrorCode(code string) bool {
	switch normalizeCredentialRefreshErrorCode(code) {
	case "invalid_client", "unauthorized_client", "invalid_request", "invalid_scope", "unsupported_grant_type":
		return true
	default:
		return false
	}
}

// IsUnclassifiedCredentialAuthRejection reports a 400/401 response that is
// neither a known terminal refresh-token error, a known client configuration
// error, nor an explicitly retryable OAuth condition. Repeated occurrences can
// eventually require operator reauthorization without claiming the refresh
// token was definitively revoked.
func IsUnclassifiedCredentialAuthRejection(status int, code string) bool {
	if status != http.StatusBadRequest && status != http.StatusUnauthorized {
		return false
	}
	if IsPermanentCredentialRefreshErrorCode(code) || IsCredentialRefreshConfigurationErrorCode(code) {
		return false
	}
	switch normalizeCredentialRefreshErrorCode(code) {
	case "authorization_pending", "slow_down", "temporarily_unavailable", "server_error",
		"rate_limited", "rate_limit_exceeded", "too_many_requests", "oauth_timeout",
		"oauth_transport_error", "oauth_unavailable":
		return false
	default:
		return true
	}
}

func normalizeCredentialRefreshErrorCode(code string) string {
	normalized := strings.ToLower(strings.TrimSpace(code))
	return strings.ReplaceAll(normalized, "-", "_")
}
