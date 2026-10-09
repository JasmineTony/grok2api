package provider

import (
	"errors"
	"strings"
	"time"
)

var (
	ErrAuthorizationPending = errors.New("authorization pending")
	ErrSlowDown             = errors.New("authorization polling too fast")
	ErrAuthorizationDenied  = errors.New("authorization denied")
	ErrCredentialLimit      = errors.New("credential count exceeds limit")
	ErrUnauthorized         = errors.New("upstream credential unauthorized")
	ErrBirthDateAlreadySet  = errors.New("upstream birth date is already set")
)

// HTTPStatusError preserves the upstream status when a streaming or asynchronous Provider cannot return a Response.
type HTTPStatusError interface {
	error
	HTTPStatusCode() int
}

// RetryAfterError preserves a safe upstream retry delay when an adapter cannot
// return a Response, for example when a WebSocket handshake is rejected.
type RetryAfterError interface {
	error
	RetryAfterDuration() time.Duration
}

// RequestScopedError marks an upstream rejection that retrying with another
// account or egress cannot resolve.
type RequestScopedError interface {
	error
	RequestScopedFailure() bool
}

// PublicMessageError exposes a deliberately sanitized message that may cross
// the public API boundary. Provider errors must opt in; arbitrary Error()
// strings can contain upstream response bodies, tokens, cookies, or request
// diagnostics and therefore are never returned to clients by default.
type PublicMessageError interface {
	error
	PublicErrorMessage() string
}

// ErrorHTTPStatus extracts the upstream HTTP status from a Provider error chain.
func ErrorHTTPStatus(err error) (int, bool) {
	var statusError HTTPStatusError
	if !errors.As(err, &statusError) {
		return 0, false
	}
	status := statusError.HTTPStatusCode()
	return status, status > 0
}

// ErrorHTTPStatusOrZero extracts an upstream status or returns 0.
func ErrorHTTPStatusOrZero(err error) int {
	status, ok := ErrorHTTPStatus(err)
	if !ok {
		return 0
	}
	return status
}

// ErrorRetryAfter extracts a positive retry delay from an error chain.
func ErrorRetryAfter(err error) time.Duration {
	var retryError RetryAfterError
	if !errors.As(err, &retryError) {
		return 0
	}
	return max(0, retryError.RetryAfterDuration())
}

// IsRequestScopedError reports whether the Provider has positively classified
// the failure as request-scoped.
func IsRequestScopedError(err error) bool {
	var requestError RequestScopedError
	return errors.As(err, &requestError) && requestError.RequestScopedFailure()
}

// ErrorPublicMessage extracts a message that the Provider has explicitly
// classified as safe for clients.
func ErrorPublicMessage(err error) (string, bool) {
	var publicError PublicMessageError
	if !errors.As(err, &publicError) {
		return "", false
	}
	message := strings.TrimSpace(publicError.PublicErrorMessage())
	return message, message != ""
}
