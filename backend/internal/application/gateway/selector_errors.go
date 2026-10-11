package gateway

import (
	"time"

	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	http "net/http"
)

type SelectionUnavailableReason string

const (
	SelectionNoAccounts        SelectionUnavailableReason = "no_accounts"
	SelectionUnsupportedModel  SelectionUnavailableReason = "unsupported_model"
	SelectionCooling           SelectionUnavailableReason = "cooling"
	SelectionModelCooling      SelectionUnavailableReason = "model_cooling"
	SelectionQuotaExhausted    SelectionUnavailableReason = "quota_exhausted"
	SelectionSaturated         SelectionUnavailableReason = "saturated"
	SelectionPinnedUnavailable SelectionUnavailableReason = "pinned_unavailable"
)

// SelectionUnavailableError 保留选号失败的真实原因，避免所有情况都退化成模糊的 503。
type SelectionUnavailableError struct {
	Reason      SelectionUnavailableReason
	RetryAfter  time.Duration
	Scope       clientkeydomain.AccountScope
	AccountID   uint64
	AccountName string
}

func (e *SelectionUnavailableError) Error() string {
	if e == nil {
		return "没有可用上游账号"
	}
	prefix := ""
	if e.Scope.IsRestricted() {
		prefix = "Client Key 限定范围"
	}
	switch e.Reason {
	case SelectionUnsupportedModel:
		if prefix != "" {
			return prefix + "不支持该模型"
		}
		return "当前账号池不支持该模型"
	case SelectionCooling:
		if prefix != "" {
			return prefix + "中的可用账号正在冷却"
		}
		return "可用上游账号正在冷却"
	case SelectionModelCooling:
		if prefix != "" {
			return prefix + "中可用账号的目标模型正在冷却"
		}
		return "可用上游账号的目标模型正在冷却"
	case SelectionQuotaExhausted:
		if prefix != "" {
			return prefix + "中的可用账号额度等待恢复"
		}
		return "可用上游账号额度等待恢复"
	case SelectionSaturated:
		if prefix != "" {
			return prefix + "中的可用账号均达到并发上限"
		}
		return "可用上游账号均达到并发上限"
	case SelectionPinnedUnavailable:
		if prefix != "" {
			return prefix + "中绑定的上游账号当前不可用"
		}
		return "绑定的上游账号当前不可用"
	default:
		if prefix != "" {
			return prefix + "当前没有可用上游账号"
		}
		return "没有可用上游账号"
	}
}

// HTTPStatus returns the client-facing status for a routing refusal.
func (e *SelectionUnavailableError) HTTPStatus() int {
	if e != nil {
		switch e.Reason {
		case SelectionCooling, SelectionModelCooling, SelectionQuotaExhausted:
			return http.StatusTooManyRequests
		}
	}
	return http.StatusServiceUnavailable
}

// Code returns the stable diagnostic code for a routing refusal.
func (e *SelectionUnavailableError) Code() string {
	if e != nil {
		switch e.Reason {
		case SelectionCooling:
			return "upstream_cooling"
		case SelectionModelCooling:
			return "upstream_model_cooling"
		case SelectionQuotaExhausted:
			return "upstream_quota_exhausted"
		case SelectionSaturated:
			return "upstream_saturated"
		case SelectionUnsupportedModel:
			return "upstream_model_unavailable"
		case SelectionPinnedUnavailable:
			return "upstream_pinned_account_unavailable"
		case SelectionNoAccounts:
			if e.Scope.IsRestricted() {
				return "client_key_account_scope_unavailable"
			}
		}
	}
	return "upstream_unavailable"
}

func (l *accountLease) Release() {
	if l == nil {
		return
	}
	if l.selectorObservation != nil {
		l.selectorObservation.completeRelease()
	}
	if l.release != nil {
		l.release()
		l.release = nil
	}
}

func (l *accountLease) markSelectorUpstreamStarted() {
	if l != nil && l.selectorObservation != nil {
		l.selectorObservation.upstreamStarted.Store(true)
	}
}

func (l *accountLease) completeSelectorObservation(success bool) {
	if l != nil && l.selectorObservation != nil {
		l.selectorObservation.complete(success)
	}
}
