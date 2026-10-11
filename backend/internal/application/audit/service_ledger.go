package audit

import (
	"time"

	"github.com/chenyme/grok2api/backend/internal/pkg/perfmetrics"
)

// LedgerSnapshot returns a bounded, identity-free view of the durable ledger state.
func (s *Service) LedgerSnapshot() LedgerSnapshot {
	now := s.now().UTC()
	queueDepth := len(s.queue)
	queueCapacity := cap(s.queue)

	s.ledgerMu.Lock()
	s.updateQueuePressureLocked(now, queueDepth, queueCapacity)
	dropped := s.dropped.Load()
	ready := dropped == 0 && s.ledgerReadyLocked(now)
	snapshot := LedgerSnapshot{
		Mode:                s.ledgerConfig.Mode,
		Ready:               ready,
		Irrecoverable:       dropped > 0,
		QueueDepth:          queueDepth,
		QueueCapacity:       queueCapacity,
		ConsecutiveFailures: s.ledgerFailures,
		Dropped:             dropped,
		LastSuccessAt:       s.ledgerLastSuccess,
		LastFailureAt:       s.ledgerLastFailure,
		UnhealthySince:      s.ledgerUnhealthySince,
	}
	s.ledgerMu.Unlock()

	perfmetrics.Default.SetGauge("audit_queue_depth", perfmetrics.Labels{Subsystem: "audit", Stage: "queue"}, int64(queueDepth))
	perfmetrics.Default.SetGauge("audit_queue_capacity", perfmetrics.Labels{Subsystem: "audit", Stage: "queue"}, int64(queueCapacity))
	return snapshot
}

// CheckLedgerReady always blocks after confirmed data loss. Observe mode only
// permits traffic while a recoverable writer or queue degradation is active.
func (s *Service) CheckLedgerReady() error {
	snapshot := s.LedgerSnapshot()
	if snapshot.Ready && !snapshot.Irrecoverable {
		return nil
	}
	if !snapshot.Irrecoverable && snapshot.Mode != LedgerModeEnforce {
		return nil
	}
	return ErrLedgerUnavailable
}

func (s *Service) recordLedgerSuccess() {
	now := s.now().UTC()
	s.ledgerMu.Lock()
	s.ledgerFailures = 0
	s.ledgerLastSuccess = now
	if s.dropped.Load() == 0 && s.ledgerQueueHighSince.IsZero() {
		s.ledgerUnhealthySince = time.Time{}
	}
	s.ledgerMu.Unlock()
}

func (s *Service) recordLedgerFailure() {
	now := s.now().UTC()
	s.ledgerMu.Lock()
	s.ledgerFailures++
	s.ledgerLastFailure = now
	if s.ledgerFailures >= s.ledgerConfig.FailureThreshold && s.ledgerUnhealthySince.IsZero() {
		s.ledgerUnhealthySince = now
	}
	s.warnLedgerIfNeededLocked(now, "durable_write_failed")
	s.ledgerMu.Unlock()
}

func (s *Service) recordLedgerDrop() {
	now := s.now().UTC()
	s.ledgerMu.Lock()
	s.ledgerLastDrop = now
	if s.ledgerUnhealthySince.IsZero() {
		s.ledgerUnhealthySince = now
	}
	s.warnLedgerIfNeededLocked(now, "audit_record_dropped")
	s.ledgerMu.Unlock()
}

func (s *Service) updateQueuePressureLocked(now time.Time, depth, capacity int) {
	if capacity <= 0 || depth*100 < capacity*s.ledgerConfig.QueueHighWatermarkPercent {
		wasHigh := !s.ledgerQueueHighSince.IsZero()
		s.ledgerQueueHighSince = time.Time{}
		if wasHigh && s.ledgerFailures == 0 && s.dropped.Load() == 0 {
			s.ledgerUnhealthySince = time.Time{}
		}
		return
	}
	if s.ledgerQueueHighSince.IsZero() {
		s.ledgerQueueHighSince = now
	}
	if s.ledgerUnhealthySince.IsZero() {
		s.ledgerUnhealthySince = s.ledgerQueueHighSince
	}
}

func (s *Service) ledgerReadyLocked(now time.Time) bool {
	degradedSince := s.ledgerUnhealthySince
	if !s.ledgerQueueHighSince.IsZero() && (degradedSince.IsZero() || s.ledgerQueueHighSince.Before(degradedSince)) {
		degradedSince = s.ledgerQueueHighSince
	}
	if degradedSince.IsZero() {
		return true
	}
	return now.Sub(degradedSince) < s.ledgerConfig.UnhealthyGrace
}

func (s *Service) warnLedgerIfNeededLocked(now time.Time, reason string) {
	if !s.ledgerLastWarning.IsZero() && now.Sub(s.ledgerLastWarning) < time.Minute {
		return
	}
	s.ledgerLastWarning = now
	s.logger.Warn("billing_ledger_degraded", "reason", reason, "mode", s.ledgerConfig.Mode, "consecutive_failures", s.ledgerFailures, "queue_depth", len(s.queue), "queue_capacity", cap(s.queue))
}
