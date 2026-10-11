package gateway

import (
	"time"

	slog "log/slog"
)

func (s *Service) SetLogger(logger *slog.Logger) {
	if logger != nil {
		s.logger = logger
	}
}

func (s *Service) UpdateMaxAttempts(maxAttempts int) { s.maxAttempts.Store(int64(maxAttempts)) }

// UpdateVideoMaxAttempts configures create-phase account failover for video jobs.
// 0 is treated as the general default pool size for legacy configs.
func (s *Service) UpdateVideoMaxAttempts(maxAttempts int) {
	s.videoMaxAttempts.Store(int64(maxAttempts))
}

// UpdateMarkBuildChatDeniedAsReauth 热更新 Build chat 永久拒绝是否标 reauthRequired。
// 默认 false：仅模型级冷却；true 时按旧逻辑将账号标为失效并出池。
func (s *Service) UpdateMarkBuildChatDeniedAsReauth(enabled bool) {
	s.markBuildChatDeniedAsReauth.Store(enabled)
}

func (s *Service) UpdateRequestTimeout(value time.Duration) {
	if value <= 0 {
		value = minimumTextBillingReservationTTL
	}
	s.requestTimeout.Store(int64(value))
}

func (s *Service) textBillingReservationTTL() time.Duration {
	ttl := time.Duration(s.requestTimeout.Load()) + finalizationTimeout + billingReservationCrashGrace
	return max(minimumTextBillingReservationTTL, ttl)
}

func (s *Service) checkLedgerReady() error {
	checker, ok := s.audits.(ledgerReadinessChecker)
	if !ok {
		return nil
	}
	if err := checker.CheckLedgerReady(); err != nil {
		return ErrLedgerUnavailable
	}
	return nil
}
