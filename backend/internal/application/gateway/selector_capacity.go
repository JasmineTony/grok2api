package gateway

import (
	"context"
	"fmt"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

func (s *Selector) claimAccountSlot(ctx context.Context, value account.Credential) (*accountLease, error) {
	return s.claimAccountSlotTracked(ctx, value, nil)
}

func (s *Selector) claimAccountSlotTracked(ctx context.Context, value account.Credential, materialFailures *credentialMaterialFailureTracker) (*accountLease, error) {
	now := time.Now().UTC()
	value = s.applyRoutingHealth(value, now)
	if value.CooldownUntil != nil && now.Before(*value.CooldownUntil) {
		return nil, nil
	}
	limit := value.MaxConcurrent
	if limit <= 0 {
		limit = account.DefaultMaxConcurrent
	}
	release, acquired, err := s.concurrency.Acquire(ctx, accountConcurrencyKey(value.ID), limit)
	if err != nil {
		return nil, fmt.Errorf("获取账号并发租约: %w", err)
	}
	if !acquired {
		return nil, nil
	}
	releaseSlot := func() {
		release()
		s.announceLeaseReturn()
	}
	if s.accounts != nil {
		material, loadErr := s.accounts.GetCredentialMaterial(ctx, value.ID, value.Provider)
		if loadErr != nil {
			releaseSlot()
			return nil, s.skipUnusableCredentialMaterial(ctx, value, loadErr, materialFailures)
		}
		materialFailures.reset()
		hydrated, matched := material.ApplyTo(value)
		if !matched {
			releaseSlot()
			s.ApplyInvalidation(repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged, Provider: value.Provider, AccountID: value.ID})
			return nil, errRoutingCredentialStale
		}
		value = hydrated
	}
	s.selectionMu.Lock()
	s.lastSelectedAt[value.ID] = time.Now().UTC()
	s.selectionMu.Unlock()
	return &accountLease{Credential: value, release: func() {
		releaseSlot()
	}}, nil
}

func (s *Selector) acquirePinnedCapacity(ctx context.Context, value account.Credential, materialFailures *credentialMaterialFailureTracker) (*accountLease, error) {
	_, _, _, capacityWait := s.routingConfig()
	deadline := time.Now().Add(capacityWait)
	for {
		lease, err := s.claimAccountSlotTracked(ctx, value, materialFailures)
		if err != nil || lease != nil {
			return lease, err
		}
		if capacityWait <= 0 {
			return nil, &SelectionUnavailableError{Reason: SelectionSaturated, RetryAfter: time.Second}
		}
		retry, err := s.awaitLeaseRetry(ctx, deadline)
		if err != nil {
			return nil, err
		}
		if !retry {
			return nil, &SelectionUnavailableError{Reason: SelectionSaturated, RetryAfter: time.Second}
		}
	}
}

func (s *Selector) leaseReturnNotice() <-chan struct{} {
	s.leaseWakeMu.Lock()
	defer s.leaseWakeMu.Unlock()
	if s.leaseWake == nil {
		s.leaseWake = make(chan struct{})
	}
	return s.leaseWake
}

func (s *Selector) announceLeaseReturn() {
	s.leaseWakeMu.Lock()
	if s.leaseWake != nil {
		close(s.leaseWake)
	}
	s.leaseWake = make(chan struct{})
	s.leaseWakeMu.Unlock()
}

// awaitLeaseRetry 在本实例归还租约时立即重试；短轮询用于感知其他实例释放的共享并发名额。
func (s *Selector) awaitLeaseRetry(ctx context.Context, deadline time.Time) (bool, error) {
	remaining := time.Until(deadline)
	if remaining <= 0 {
		return false, nil
	}
	notice := s.leaseReturnNotice()
	timer := time.NewTimer(min(remaining, 100*time.Millisecond))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false, ctx.Err()
	case <-notice:
		return true, nil
	case <-timer.C:
		return time.Now().Before(deadline), nil
	}
}

func earlierFuture(current, candidate, now time.Time) time.Time {
	if candidate.IsZero() || !now.Before(candidate) {
		return current
	}
	if current.IsZero() || candidate.Before(current) {
		return candidate
	}
	return current
}

func retryDelay(now, retryAt time.Time) time.Duration {
	if retryAt.IsZero() || !now.Before(retryAt) {
		return 0
	}
	return retryAt.Sub(now)
}
