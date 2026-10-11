package gateway

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	http "net/http"
)

func (s *Service) applyRateLimitReconciliation(ctx context.Context, credential accountdomain.Credential, status int, retryAfter time.Duration, state accountapp.RateLimitReconcileState, reconcileErr error) {
	s.selector.MarkQuotaStateChanged(credential.Provider, credential.ID)
	if reconcileErr == nil && state == accountapp.RateLimitReconcileExhausted {
		return
	}
	if credential.Provider == accountdomain.ProviderConsole && status == http.StatusTooManyRequests {
		// A Console 429 with available quota, an in-progress cross-instance probe,
		// or an inconclusive /usage request is transient. Isolate the account for
		// this Retry-After window without growing its durable failure count.
		if err := s.selector.markSoftFailure(ctx, credential, status, retryAfter); err != nil {
			s.logger.Warn("console_rate_limit_soft_cooldown_failed", "account_id", credential.ID, "state", state, "error", err)
		}
		return
	}
	s.selector.MarkFailure(ctx, credential, status, retryAfter)
}

func parseRetryAfter(value string, now time.Time) time.Duration {
	value = strings.TrimSpace(value)
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	if parsed, err := http.ParseTime(value); err == nil && parsed.After(now) {
		return parsed.Sub(now)
	}
	return 0
}

func firstError(values ...error) error {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return errors.New("未知上游错误")
}
