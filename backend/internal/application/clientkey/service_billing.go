package clientkey

import (
	"context"
	"errors"
	"fmt"
	"time"

	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	"github.com/chenyme/grok2api/backend/internal/pkg/perfmetrics"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// ReserveBilling 为有限额 Key 原子预留本次请求的预计费用。
func (s *Service) ReserveBilling(ctx context.Context, key clientkeydomain.Key, eventID string, amount int64, ttl time.Duration) (bool, error) {
	if key.BillingLimitUSDTicks <= 0 || amount <= 0 {
		return false, nil
	}
	repo, ok := s.keys.(billingReservationRepository)
	if !ok {
		return false, fmt.Errorf("%w: 客户端 Key 仓储不支持计费预留", ErrRuntimeUnavailable)
	}
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	reserved, err := repo.ReserveBillingUsage(ctx, key.ID, eventID, amount, time.Now().UTC().Add(ttl))
	if errors.Is(err, repository.ErrLimitExceeded) {
		perfmetrics.Default.Inc("billing_reservation_total", perfmetrics.Labels{Subsystem: "billing", Operation: "reserve", Outcome: "limit_exceeded"})
		return false, ErrBillingLimit
	}
	if err != nil {
		perfmetrics.Default.Inc("billing_reservation_total", perfmetrics.Labels{Subsystem: "billing", Operation: "reserve", Outcome: "failed"})
		return false, fmt.Errorf("%w: 计费预留: %v", ErrRuntimeUnavailable, err)
	}
	if reserved {
		s.activeMu.Lock()
		s.activeBilling[eventID] = struct{}{}
		s.activeMu.Unlock()
	}
	perfmetrics.Default.Inc("billing_reservation_total", perfmetrics.Labels{Subsystem: "billing", Operation: "reserve", Outcome: "success"})
	return reserved, nil
}

// CancelBilling 释放未进入审计结算的计费预留。
func (s *Service) CancelBilling(ctx context.Context, eventID string) error {
	repo, ok := s.keys.(billingReservationRepository)
	if !ok {
		return nil
	}
	if err := repo.CancelBillingReservation(ctx, eventID); err != nil {
		perfmetrics.Default.Inc("billing_reservation_total", perfmetrics.Labels{Subsystem: "billing", Operation: "cancel", Outcome: "failed"})
		return fmt.Errorf("%w: 取消计费预留: %v", ErrRuntimeUnavailable, err)
	}
	s.CompleteBilling(eventID)
	perfmetrics.Default.Inc("billing_reservation_total", perfmetrics.Labels{Subsystem: "billing", Operation: "cancel", Outcome: "success"})
	return nil
}

// CompleteBilling removes the process-local active marker after the audit and
// billing transaction commits or the reservation is explicitly cancelled.
func (s *Service) CompleteBilling(eventID string) {
	if eventID == "" {
		return
	}
	s.CompleteBillingBatch([]string{eventID})
}

func (s *Service) CompleteBillingBatch(eventIDs []string) {
	s.ReleaseBillingProtectionBatch(eventIDs)
}

// ReleaseBillingProtectionBatch removes process-local activity markers. The
// durable reservation remains authoritative until commit, cancel, or expiry.
func (s *Service) ReleaseBillingProtectionBatch(eventIDs []string) {
	if len(eventIDs) == 0 {
		return
	}
	s.activeMu.Lock()
	for _, eventID := range eventIDs {
		delete(s.activeBilling, eventID)
	}
	s.activeMu.Unlock()
}

// CleanupExpiredBilling 释放进程异常遗留的过期预留。
func (s *Service) CleanupExpiredBilling(ctx context.Context, limit int) (int, error) {
	repo, ok := s.keys.(billingReservationRepository)
	if !ok {
		return 0, fmt.Errorf("%w: 客户端 Key 仓储不支持计费预留", ErrRuntimeUnavailable)
	}
	s.activeMu.RLock()
	protected := make([]string, 0, len(s.activeBilling))
	for eventID := range s.activeBilling {
		protected = append(protected, eventID)
	}
	s.activeMu.RUnlock()
	cleaned, err := repo.CleanupExpiredBillingReservations(ctx, time.Now().UTC(), limit, protected)
	outcome := "success"
	if err != nil {
		outcome = "failed"
	}
	perfmetrics.Default.Add("billing_reservation_cleanup_rows", perfmetrics.Labels{Subsystem: "billing", Operation: "cleanup", Outcome: outcome}, int64(cleaned))
	return cleaned, err
}
