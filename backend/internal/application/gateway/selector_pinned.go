package gateway

import (
	"context"
	"errors"
	"fmt"
	"time"

	account "github.com/chenyme/grok2api/backend/internal/domain/account"
	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
)

func pinnedCandidateAccessError(provider account.Provider, accountScope clientkeydomain.AccountScope, accountID uint64, candidate account.RoutingCandidate, value account.Credential) error {
	if !accountScopeAllowsCandidate(provider, accountScope, candidate) {
		if accountScope.IsRestricted() {
			return &SelectionUnavailableError{Reason: SelectionNoAccounts, Scope: accountScope, AccountID: accountID, AccountName: value.Name}
		}
		return pinnedUnavailableError(accountID, value.Name)
	}
	if !value.Enabled || value.AuthStatus != account.AuthStatusActive {
		return pinnedUnavailableError(accountID, value.Name)
	}
	return nil
}

// pinnedInferenceCooldownError 校验固定账号在 inference 语义下的模型支持与冷却门禁。
func (s *Selector) pinnedInferenceCooldownError(provider account.Provider, upstreamModel, quotaMode string, candidate account.RoutingCandidate, value account.Credential, now time.Time, ignoreEgressLeaseBlock bool) error {
	if !s.candidateSupportsModel(provider, upstreamModel, quotaMode, candidate) {
		return &SelectionUnavailableError{Reason: SelectionUnsupportedModel}
	}
	if candidate.ModelQuotaBlock != nil && now.Before(candidate.ModelQuotaBlock.CooldownUntil) {
		return &SelectionUnavailableError{Reason: SelectionModelCooling, RetryAfter: retryDelay(now, candidate.ModelQuotaBlock.CooldownUntil)}
	}
	if !ignoreEgressLeaseBlock && candidateEgressLeaseCooling(candidate, value, now) {
		return &SelectionUnavailableError{Reason: SelectionCooling, RetryAfter: retryDelay(now, candidate.EgressLeaseBlock.CooldownUntil)}
	}
	if value.CooldownUntil != nil && now.Before(*value.CooldownUntil) {
		return &SelectionUnavailableError{Reason: SelectionCooling, RetryAfter: retryDelay(now, *value.CooldownUntil)}
	}
	return nil
}

// acquirePinnedRecoveryProbe 在额度恢复探测窗口内获取固定账号的探测租约。
// probing=false 表示账号不处于待探测的恢复状态，调用方继续常规额度校验。
func (s *Selector) acquirePinnedRecoveryProbe(ctx context.Context, candidate account.RoutingCandidate, value account.Credential, now time.Time) (*accountLease, bool, error) {
	recovery := candidate.QuotaRecovery
	if recovery == nil || recovery.Status == account.QuotaRecoveryStatusActive {
		return nil, false, nil
	}
	if recovery.NextProbeAt == nil || now.Before(*recovery.NextProbeAt) {
		var retryAfter time.Duration
		if recovery.NextProbeAt != nil {
			retryAfter = retryDelay(now, *recovery.NextProbeAt)
		}
		return nil, false, &SelectionUnavailableError{Reason: SelectionQuotaExhausted, RetryAfter: retryAfter}
	}
	lease, err := s.acquirePinnedCapacity(ctx, value, nil)
	if err != nil {
		if errors.Is(err, errRoutingCredentialStale) {
			return nil, false, pinnedUnavailableError(value.ID, value.Name)
		}
		return nil, false, err
	}
	claimed, err := s.accounts.ClaimQuotaProbe(ctx, value.ID, now, now.Add(quotaProbeLease))
	if err != nil || !claimed {
		lease.Release()
		if err != nil {
			return nil, false, err
		}
		return nil, false, fmt.Errorf("绑定的上游账号恢复探测已被占用")
	}
	lease.QuotaProbe = true
	lease.QuotaProbeKind = recovery.Kind
	lease.Billing = candidate.Billing
	return lease, true, nil
}

// pinnedQuotaError 校验固定账号的账单与额度窗口是否已耗尽。
func pinnedQuotaError(candidate account.RoutingCandidate, value account.Credential, quotaConsumed map[accountQuotaConsumptionKey]int, now time.Time) error {
	if candidate.Billing != nil && candidate.Billing.IsExhausted(value.MinimumRemaining) {
		return &SelectionUnavailableError{Reason: SelectionQuotaExhausted}
	}
	if quotaWindowExhausted(candidate, quotaConsumed) {
		var retryAfter time.Duration
		if candidate.QuotaWindow.ResetAt != nil {
			retryAfter = retryDelay(now, *candidate.QuotaWindow.ResetAt)
		}
		return &SelectionUnavailableError{Reason: SelectionQuotaExhausted, RetryAfter: retryAfter}
	}
	return nil
}

// acquirePinnedCapacityLease 获取固定账号的常规容量租约，并写入账单与额度模式。
func (s *Selector) acquirePinnedCapacityLease(ctx context.Context, accountID uint64, value account.Credential, candidate account.RoutingCandidate, quotaMode string) (*accountLease, error) {
	lease, err := s.acquirePinnedCapacity(ctx, value, nil)
	if err != nil {
		if errors.Is(err, errRoutingCredentialStale) {
			return nil, pinnedUnavailableError(accountID, value.Name)
		}
		return nil, err
	}
	lease.Billing = candidate.Billing
	lease.QuotaMode = effectiveQuotaMode(candidate, quotaMode)
	return lease, nil
}

func (s *Selector) acquirePinned(ctx context.Context, provider account.Provider, accountID, modelRouteID uint64, upstreamModel, quotaMode string, inference, ignoreEgressLeaseBlock bool, requestedScope clientkeydomain.AccountScope) (lease *accountLease, err error) {
	accountScope, scopeValid := clientkeydomain.NormalizeAccountScope(requestedScope)
	defer annotateSelectionAccountScope(&err, accountScope)
	if !scopeValid || !accountScope.AllowsProvider(provider) {
		return nil, &SelectionUnavailableError{Reason: SelectionNoAccounts, Scope: accountScope}
	}
	now := time.Now().UTC()
	values, err := s.loadCandidates(ctx, provider, modelRouteID, upstreamModel, quotaMode, now, true)
	if err != nil {
		return nil, err
	}
	quotaConsumed := s.quotaConsumptionSnapshot(provider)
	healthOverrides := s.routingHealthSnapshot(provider, now)
	for _, candidate := range values {
		value := applyHealthSnapshot(candidate.Credential, healthOverrides)
		if value.ID != accountID {
			continue
		}
		if err := pinnedCandidateAccessError(provider, accountScope, accountID, candidate, value); err != nil {
			return nil, err
		}
		if inference {
			if err := s.pinnedInferenceCooldownError(provider, upstreamModel, quotaMode, candidate, value, now, ignoreEgressLeaseBlock); err != nil {
				return nil, err
			}
			probeLease, probing, probeErr := s.acquirePinnedRecoveryProbe(ctx, candidate, value, now)
			if probeErr != nil {
				return nil, probeErr
			}
			if probing {
				return probeLease, nil
			}
			if err := pinnedQuotaError(candidate, value, quotaConsumed, now); err != nil {
				return nil, err
			}
		}
		return s.acquirePinnedCapacityLease(ctx, accountID, value, candidate, quotaMode)
	}
	return nil, pinnedUnavailableError(accountID, "")
}

func pinnedUnavailableError(accountID uint64, name string) *SelectionUnavailableError {
	return &SelectionUnavailableError{Reason: SelectionPinnedUnavailable, AccountID: accountID, AccountName: name}
}

func accountScopeAllowsCandidate(provider account.Provider, scope clientkeydomain.AccountScope, candidate account.RoutingCandidate) bool {
	if provider == account.ProviderConsole {
		return true
	}
	tier := clientkeydomain.AccountTierUnknown
	switch provider {
	case account.ProviderBuild:
		if candidate.IsKnownFreeBuild() {
			tier = clientkeydomain.AccountTierFree
		} else if account.IsBuildSuper(candidate.Credential, candidate.Billing) {
			tier = clientkeydomain.AccountTierSuper
		}
	case account.ProviderWeb:
		switch candidate.Credential.WebTier {
		case account.WebTierBasic:
			tier = clientkeydomain.AccountTierFree
		case account.WebTierSuper, account.WebTierHeavy:
			tier = clientkeydomain.AccountTierSuper
		}
	}
	switch tier {
	case clientkeydomain.AccountTierFree:
		return scope.Tiers&clientkeydomain.TierScopeFree != 0
	case clientkeydomain.AccountTierSuper:
		return scope.Tiers&clientkeydomain.TierScopeSuper != 0
	default:
		return scope.Tiers&clientkeydomain.TierScopeUnknown != 0
	}
}

func annotateSelectionAccountScope(err *error, scope clientkeydomain.AccountScope) {
	if err == nil || *err == nil || !scope.IsRestricted() {
		return
	}
	var unavailable *SelectionUnavailableError
	if errors.As(*err, &unavailable) {
		unavailable.Scope = scope
	}
}

func effectiveQuotaMode(candidate account.RoutingCandidate, fallback string) string {
	if candidate.QuotaWindow != nil && candidate.QuotaWindow.Mode != "" {
		return candidate.QuotaWindow.Mode
	}
	if candidate.Credential.Provider == account.ProviderWeb && fallback == account.QuotaModeWebImageEdit {
		switch candidate.Credential.WebTier {
		case account.WebTierSuper, account.WebTierHeavy:
			return account.QuotaModeWebImageEdit
		default:
			return account.QuotaModeWebImagePro
		}
	}
	return fallback
}

func candidateEgressLeaseCooling(candidate account.RoutingCandidate, credential account.Credential, now time.Time) bool {
	block := candidate.EgressLeaseBlock
	return block != nil && block.AccountID == credential.ID && block.NodeID != 0 &&
		(credential.EgressNodeID == 0 || credential.EgressNodeID == block.NodeID) && now.Before(block.CooldownUntil)
}

// candidateSupportsModel treats a recognized Web catalog entry as an
// effective capability for tiers that the adapter explicitly allows. This
// prevents a historical capability snapshot from blocking a newly enabled
// catalog feature, while unknown/manual Web routes and all other providers
// retain the persisted snapshot semantics.
func (s *Selector) candidateSupportsModel(provider account.Provider, upstreamModel, quotaMode string, candidate account.RoutingCandidate) bool {
	if provider == account.ProviderWeb {
		order := s.resolveTierOrder(provider, upstreamModel, quotaMode)
		if len(order) > 0 {
			return webTierInOrder(order, candidate.Credential.WebTier)
		}
	}
	return !candidate.ModelCapabilityKnown || candidate.SupportsModel
}
