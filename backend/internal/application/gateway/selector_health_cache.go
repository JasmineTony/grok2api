package gateway

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// 账号健康、额度与候选缓存：维护冷却/软失败/额度窗口与候选快照失效；
// 不改变候选选择算法本身（见 selector.go）。
func (s *Selector) MarkSuccess(ctx context.Context, credential account.Credential) {
	s.markSuccess(ctx, credential, true)
}

func isMissingThinkingStrike(lastError string) bool {
	return lastError == lastErrorMissingThinking || lastError == lastErrorMissingThinkingDisabled
}

type missingThinkingPenaltyResult string

const (
	missingThinkingPenaltyUnchanged missingThinkingPenaltyResult = "unchanged"
	missingThinkingPenaltyCooled    missingThinkingPenaltyResult = "cooled"
	missingThinkingPenaltyDisabled  missingThinkingPenaltyResult = "disabled"
)

func (s *Selector) markSuccess(ctx context.Context, credential account.Credential, quotaProbe bool) {
	now := time.Now().UTC()
	keepThinkingStrike := isMissingThinkingStrike(credential.LastError)
	healthChanged := credential.FailureCount > 0 || credential.CooldownUntil != nil || credential.LastError != ""
	touchLastUsed := healthChanged
	s.selectionMu.Lock()
	if last := s.lastSuccessAt[credential.ID]; last.IsZero() || now.Sub(last) >= successPersistInterval {
		touchLastUsed = true
	}
	if touchLastUsed {
		s.lastSuccessAt[credential.ID] = now
	}
	s.selectionMu.Unlock()
	if healthChanged {
		lastError := ""
		if keepThinkingStrike {
			lastError = lastErrorMissingThinking
		}
		if err := s.accounts.UpdateHealth(ctx, credential.ID, credential.Provider, 0, nil, lastError, true); err == nil {
			s.ApplyInvalidation(repository.InvalidationEvent{
				Kind: repository.InvalidationAccountHealthChanged, Provider: credential.Provider, AccountID: credential.ID,
				HealthMarker: account.NormalizeHealthMarker(lastError),
			})
		}
	} else if touchLastUsed {
		_ = s.accounts.TouchLastUsed(ctx, credential.ID, now)
	}
	if quotaProbe {
		_ = s.accounts.ClearQuotaRecovery(ctx, credential.ID)
	}
	if quotaProbe {
		s.evictCandidate(credential.Provider, credential.ID)
	}
}

func (s *Selector) MarkFreeQuotaExhausted(ctx context.Context, credential account.Credential, used, limit int64) {
	now := time.Now().UTC()
	nextProbeAt := now.Add(defaultFreeQuotaRecoveryPause)
	_ = s.markFreeQuotaExhaustedAt(ctx, credential, used, limit, now, nextProbeAt)
}

func (s *Selector) markFreeQuotaExhaustedAt(ctx context.Context, credential account.Credential, used, limit int64, now, nextProbeAt time.Time) error {
	if err := s.accounts.SaveQuotaRecovery(ctx, account.QuotaRecovery{
		AccountID: credential.ID, Kind: account.QuotaRecoveryKindFree, Status: account.QuotaRecoveryStatusExhausted,
		ConfirmedUsed: used, ConfirmedLimit: limit, ExhaustedAt: &now,
		NextProbeAt: &nextProbeAt, LastConfirmedAt: &now, UpdatedAt: now,
	}); err != nil {
		return err
	}
	_ = s.sticky.DeleteByAccount(ctx, credential.ID)
	s.invalidateCandidates(credential.Provider)
	return nil
}

func (s *Selector) MarkModelQuotaExhausted(ctx context.Context, credential account.Credential, billing *account.Billing, upstreamModel string, retryAfter time.Duration) {
	upstreamModel = strings.TrimSpace(upstreamModel)
	if upstreamModel == "" {
		s.MarkFreeQuotaExhausted(ctx, credential, 0, 0)
		return
	}
	knownFreeBuild := (account.RoutingCandidate{Credential: credential, Billing: billing}).IsKnownFreeBuild()
	if knownFreeBuild || retryAfter <= 0 {
		retryAfter = defaultFreeQuotaRecoveryPause
	}
	until := time.Now().UTC().Add(retryAfter)
	_ = s.accounts.UpsertModelQuotaBlock(ctx, account.ModelQuotaBlock{
		AccountID: credential.ID, UpstreamModel: upstreamModel, Reason: "model_quota_depleted", CooldownUntil: until, UpdatedAt: time.Now().UTC(),
	})
	// The model block makes affected bindings ineligible and they are rebound on
	// the next request. Preserve unrelated model/session affinity for this account.
	s.invalidateCandidates(credential.Provider)
}

// MarkModelAccessDenied isolates a permission failure to the rejected model.
// Build OAuth accounts may still have valid video access when a chat endpoint
// returns 403, so a model denial must not invalidate the whole credential.
func (s *Selector) MarkModelAccessDenied(ctx context.Context, credential account.Credential, upstreamModel string, retryAfter time.Duration) error {
	upstreamModel = strings.TrimSpace(upstreamModel)
	if upstreamModel == "" {
		return nil
	}
	if retryAfter <= 0 {
		retryAfter = modelAccessDeniedCooldown
	}
	now := time.Now().UTC()
	if err := s.accounts.UpsertModelQuotaBlock(ctx, account.ModelQuotaBlock{
		AccountID: credential.ID, UpstreamModel: upstreamModel, Reason: "model_access_denied",
		CooldownUntil: now.Add(retryAfter), UpdatedAt: now,
	}); err != nil {
		return err
	}
	s.evictCandidate(credential.Provider, credential.ID)
	return nil
}

// MarkPaymentQuotaExhausted removes a spending-limited account from routing.
// Paid accounts follow their upstream billing period; Free or unknown accounts
// use the fixed local recovery window.
func (s *Selector) MarkPaymentQuotaExhausted(ctx context.Context, credential account.Credential, hints quotaRecoveryHints) error {
	now := time.Now().UTC()
	if hints.Billing != nil && hints.Billing.IsPaid() {
		if periodEnd, ok := hints.Billing.PeriodEnd(); ok && periodEnd.After(now) {
			if err := s.accounts.SaveQuotaRecovery(ctx, account.QuotaRecovery{
				AccountID: credential.ID, Kind: account.QuotaRecoveryKindPaid, Status: account.QuotaRecoveryStatusExhausted,
				ExhaustedAt: &now, NextProbeAt: &periodEnd, LastConfirmedAt: &now, UpdatedAt: now,
			}); err != nil {
				return err
			}
			_ = s.sticky.DeleteByAccount(ctx, credential.ID)
			s.invalidateCandidates(credential.Provider)
			return nil
		}
	}
	return s.markFreeQuotaExhaustedAt(ctx, credential, 0, 0, now, now.Add(defaultFreeQuotaRecoveryPause))
}

// MarkQuotaStateChanged 在 Billing 探测改变持久化额度状态后更新对应账号的候选快照。
// 未提供账号 ID 时保留全量失效语义，供无法确定变更范围的调用方使用。
func (s *Selector) MarkQuotaStateChanged(provider account.Provider, accountIDs ...uint64) {
	if len(accountIDs) == 0 {
		s.invalidateCandidates(provider)
		return
	}
	for _, accountID := range accountIDs {
		s.clearQuotaConsumptionAccount(provider, accountID)
		s.evictCandidate(provider, accountID)
	}
}

// ConsumeQuota records a small local delta instead of Copy-on-Write cloning
// every cached candidate/base slice. Selection snapshots remain immutable for
// concurrent requests, while the next request observes the consumed amount.
func (s *Selector) ConsumeQuota(provider account.Provider, accountID uint64, mode string, amount int) {
	if accountID == 0 || mode == "" || mode == "weekly" || amount <= 0 {
		return
	}
	s.quotaMu.Lock()
	if s.quotaConsumed == nil {
		s.quotaConsumed = make(map[quotaConsumptionKey]int)
	}
	key := quotaConsumptionKey{provider: provider, accountID: accountID, mode: mode}
	s.quotaConsumed[key] += amount
	s.quotaMu.Unlock()
}

func (s *Selector) quotaConsumptionSnapshot(provider account.Provider) map[accountQuotaConsumptionKey]int {
	s.quotaMu.RLock()
	if len(s.quotaConsumed) == 0 {
		s.quotaMu.RUnlock()
		return nil
	}
	result := make(map[accountQuotaConsumptionKey]int)
	for key, amount := range s.quotaConsumed {
		if key.provider == provider {
			result[accountQuotaConsumptionKey{accountID: key.accountID, mode: key.mode}] = amount
		}
	}
	s.quotaMu.RUnlock()
	return result
}

func quotaWindowExhausted(candidate account.RoutingCandidate, consumed map[accountQuotaConsumptionKey]int) bool {
	if candidate.QuotaWindow == nil {
		return false
	}
	remaining := candidate.QuotaWindow.Remaining - consumed[accountQuotaConsumptionKey{accountID: candidate.Credential.ID, mode: candidate.QuotaWindow.Mode}]
	return remaining <= 0
}

func (s *Selector) clearQuotaConsumption(provider account.Provider) {
	s.quotaMu.Lock()
	if provider == "" {
		clear(s.quotaConsumed)
	} else {
		for key := range s.quotaConsumed {
			if key.provider == provider {
				delete(s.quotaConsumed, key)
			}
		}
	}
	s.quotaMu.Unlock()
}

func (s *Selector) clearQuotaConsumptionAccount(provider account.Provider, accountID uint64) {
	s.quotaMu.Lock()
	for key := range s.quotaConsumed {
		if key.provider == provider && key.accountID == accountID {
			delete(s.quotaConsumed, key)
		}
	}
	s.quotaMu.Unlock()
}

// markMissingThinking cools an account for the first no-thinking hit and
// disables it if missing thinking appears again after that cooldown.
func (s *Selector) markMissingThinking(ctx context.Context, credential account.Credential, cooldown time.Duration) (missingThinkingPenaltyResult, error) {
	if cooldown <= 0 {
		cooldown = defaultMissingThinkingCooldown
	}
	now := time.Now().UTC()
	inCooldown := credential.CooldownUntil != nil && now.Before(*credential.CooldownUntil)
	if isMissingThinkingStrike(credential.LastError) && !inCooldown {
		disabled := false
		if _, err := s.accounts.UpdateMany(ctx, credential.Provider, []uint64{credential.ID}, repository.AccountUpdates{Enabled: &disabled}); err != nil {
			return missingThinkingPenaltyUnchanged, err
		}
		healthErr := s.accounts.UpdateHealth(ctx, credential.ID, credential.Provider, credential.FailureCount, nil, lastErrorMissingThinkingDisabled, false)
		s.ApplyInvalidation(repository.InvalidationEvent{
			Kind: repository.InvalidationAccountStateChanged, Provider: credential.Provider, AccountID: credential.ID,
		})
		s.evictCandidate(credential.Provider, credential.ID)
		if s.sticky != nil {
			_ = s.sticky.DeleteByAccount(ctx, credential.ID)
		}
		return missingThinkingPenaltyDisabled, healthErr
	}
	if inCooldown {
		return missingThinkingPenaltyUnchanged, nil
	}
	until := now.Add(cooldown)
	if err := s.accounts.UpdateHealth(ctx, credential.ID, credential.Provider, credential.FailureCount, &until, lastErrorMissingThinking, false); err != nil {
		return missingThinkingPenaltyUnchanged, err
	}
	s.ApplyInvalidation(repository.InvalidationEvent{
		Kind: repository.InvalidationAccountHealthChanged, Provider: credential.Provider, AccountID: credential.ID,
		FailureCount: credential.FailureCount, CooldownUntil: &until, HealthMarker: account.LastErrorMissingThinking,
	})
	s.evictCandidate(credential.Provider, credential.ID)
	return missingThinkingPenaltyCooled, nil
}

func (s *Selector) MarkFailure(ctx context.Context, credential account.Credential, status int, retryAfter time.Duration) {
	retryAfter = s.boundUpstreamRetryAfter(retryAfter)
	_ = s.markFailure(ctx, credential, credential.FailureCount, credential.FailureCount+1, status, retryAfter, status == 0)
}

// MarkFailureAfterSuccess records a stream failure from a fresh health baseline.
// The upstream already returned a successful response header, so failures that
// preceded this request must not be carried into the new cooldown calculation.
func (s *Selector) MarkFailureAfterSuccess(ctx context.Context, credential account.Credential, status int, retryAfter time.Duration) error {
	return s.markFailure(ctx, credential, 0, 1, status, retryAfter, status == 0)
}

// markSoftFailure preserves the real upstream status for diagnostics while
// applying the bounded, non-accumulating health penalty used for transient
// network and provider-wide failures.
func (s *Selector) markSoftFailure(ctx context.Context, credential account.Credential, status int, retryAfter time.Duration) error {
	retryAfter = s.boundUpstreamRetryAfter(retryAfter)
	return s.markFailure(ctx, credential, credential.FailureCount, credential.FailureCount+1, status, retryAfter, true)
}

func (s *Selector) boundUpstreamRetryAfter(retryAfter time.Duration) time.Duration {
	if retryAfter <= 0 {
		return retryAfter
	}
	_, _, cooldownMax, _ := s.routingConfig()
	if cooldownMax > 0 && retryAfter > cooldownMax {
		return cooldownMax
	}
	return retryAfter
}

func (s *Selector) markFailure(ctx context.Context, credential account.Credential, baselineFailureCount, nextFailureCount, status int, retryAfter time.Duration, soft bool) error {
	_, cooldownBase, cooldownMax, _ := s.routingConfig()
	// Soft failures only isolate this account briefly and never accumulate the
	// durable failure count. Hard account-scoped 4xx responses retain the
	// exponential policy below.
	effectiveFailureCount := nextFailureCount
	cooldown := cooldownBase
	if soft {
		effectiveFailureCount = baselineFailureCount
		cooldown = softNetworkCooldown
		if retryAfter > cooldown {
			cooldown = retryAfter
		}
	} else {
		for i := 1; i < effectiveFailureCount && cooldown < cooldownMax; i++ {
			cooldown *= 2
		}
		if cooldown > cooldownMax {
			cooldown = cooldownMax
		}
		if retryAfter > cooldown {
			cooldown = retryAfter
		}
	}
	until := time.Now().UTC().Add(cooldown)
	lastError := fmt.Sprintf("upstream status %d", status)
	healthErr := s.accounts.UpdateHealth(ctx, credential.ID, credential.Provider, effectiveFailureCount, &until, lastError, false)
	if healthErr == nil {
		s.ApplyInvalidation(repository.InvalidationEvent{
			Kind: repository.InvalidationAccountHealthChanged, Provider: credential.Provider, AccountID: credential.ID,
			FailureCount: effectiveFailureCount, CooldownUntil: &until,
		})
	}
	if status == 401 || status == 402 || status == 403 || status == 429 {
		_ = s.sticky.DeleteByAccount(ctx, credential.ID)
	}
	return healthErr
}
