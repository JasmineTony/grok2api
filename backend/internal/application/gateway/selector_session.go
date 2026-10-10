package gateway

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
)

// selectionSession 保存一次下游请求的候选快照和计划。账号切换时复用它，
// 避免每次失败都重新加载整个账号池、读取并发快照并建堆。
type selectionSession struct {
	selector         *Selector
	provider         account.Provider
	modelRouteID     uint64
	upstreamModel    string
	quotaMode        string
	stickyKey        string
	values           []account.RoutingCandidate
	quotaConsumed    map[accountQuotaConsumptionKey]int
	normalCandidates []int
	probeCandidates  []int
	normalPlan       *candidatePlan
	probePlan        *candidatePlan
	retryAccountID   uint64
	stickyTried      bool
	staleCandidates  map[uint64]bool
	materialFailures credentialMaterialFailureTracker
}

func (s *Selector) beginSelectionSession(ctx context.Context, provider account.Provider, modelRouteID uint64, upstreamModel, quotaMode, affinityKey string, excluded map[uint64]bool, allowQuotaProbe bool) (*selectionSession, error) {
	return s.beginSelectionSessionForKey(ctx, provider, modelRouteID, upstreamModel, quotaMode, affinityKey, excluded, allowQuotaProbe, clientkeydomain.AccountScope{})
}

// candidateScreening 累计候选筛选过程中的排除原因计数与最早可重试时间。
type candidateScreening struct {
	considered      int
	supported       int
	cooling         int
	modelCooling    int
	quota           int
	earliestRetry   time.Time
	probeCandidates []int
}

func (screening *candidateScreening) observeCooling(cooldownUntil, now time.Time) {
	screening.cooling++
	screening.earliestRetry = earlierFuture(screening.earliestRetry, cooldownUntil, now)
}

func (screening *candidateScreening) observeModelCooling(cooldownUntil, now time.Time) {
	screening.modelCooling++
	screening.earliestRetry = earlierFuture(screening.earliestRetry, cooldownUntil, now)
}

// unavailableReason 在没有任何可尝试候选时给出下游可见的失败归因。
func (screening *candidateScreening) unavailableReason() SelectionUnavailableReason {
	switch {
	case screening.considered > 0 && screening.supported == 0:
		return SelectionUnsupportedModel
	case screening.modelCooling > 0:
		return SelectionModelCooling
	case screening.cooling > 0:
		return SelectionCooling
	case screening.quota > 0 || len(screening.probeCandidates) > 0:
		return SelectionQuotaExhausted
	}
	return SelectionNoAccounts
}

func (s *Selector) beginSelectionSessionForKey(ctx context.Context, provider account.Provider, modelRouteID uint64, upstreamModel, quotaMode, affinityKey string, excluded map[uint64]bool, allowQuotaProbe bool, requestedScope clientkeydomain.AccountScope) (session *selectionSession, err error) {
	accountScope, scopeValid := clientkeydomain.NormalizeAccountScope(requestedScope)
	defer annotateSelectionAccountScope(&err, accountScope)
	if !scopeValid || !accountScope.AllowsProvider(provider) {
		return nil, &SelectionUnavailableError{Reason: SelectionNoAccounts, Scope: accountScope}
	}
	now := time.Now().UTC()
	values, err := s.loadCandidates(ctx, provider, modelRouteID, upstreamModel, quotaMode, now)
	if err != nil {
		return nil, err
	}
	quotaConsumed := s.quotaConsumptionSnapshot(provider)
	healthOverrides := s.routingHealthSnapshot(provider, now)
	session = &selectionSession{
		selector:        s,
		provider:        provider,
		modelRouteID:    modelRouteID,
		upstreamModel:   upstreamModel,
		quotaMode:       quotaMode,
		stickyKey:       stickySessionKey(affinityKey),
		values:          values,
		quotaConsumed:   quotaConsumed,
		staleCandidates: make(map[uint64]bool),
	}
	screening := candidateScreening{}
	for index, candidate := range values {
		if screening.screenCandidate(s, provider, accountScope, upstreamModel, quotaMode, quotaConsumed, healthOverrides, candidate, index, excluded, now) {
			session.normalCandidates = append(session.normalCandidates, index)
		}
	}
	session.probeCandidates = screening.probeCandidates
	if len(session.normalCandidates) > 0 || (allowQuotaProbe && len(session.probeCandidates) > 0) {
		return session, nil
	}
	return nil, &SelectionUnavailableError{Reason: screening.unavailableReason(), RetryAfter: retryDelay(now, screening.earliestRetry), Scope: accountScope}
}

// screenCandidate 判断单个候选能否进入普通选号池，并累计排除原因；返回 true 表示可尝试。
func (screening *candidateScreening) screenCandidate(s *Selector, provider account.Provider, accountScope clientkeydomain.AccountScope, upstreamModel, quotaMode string, quotaConsumed map[accountQuotaConsumptionKey]int, healthOverrides map[uint64]routingHealthOverride, candidate account.RoutingCandidate, index int, excluded map[uint64]bool, now time.Time) bool {
	value := applyHealthSnapshot(candidate.Credential, healthOverrides)
	if !accountScopeAllowsCandidate(provider, accountScope, candidate) {
		return false
	}
	if excluded[value.ID] || value.AuthStatus != account.AuthStatusActive {
		return false
	}
	screening.considered++
	if !s.candidateSupportsModel(provider, upstreamModel, quotaMode, candidate) {
		return false
	}
	screening.supported++
	if candidate.ModelQuotaBlock != nil && now.Before(candidate.ModelQuotaBlock.CooldownUntil) {
		screening.observeModelCooling(candidate.ModelQuotaBlock.CooldownUntil, now)
		return false
	}
	if candidateEgressLeaseCooling(candidate, value, now) {
		screening.observeCooling(candidate.EgressLeaseBlock.CooldownUntil, now)
		return false
	}
	if value.CooldownUntil != nil && now.Before(*value.CooldownUntil) {
		screening.observeCooling(*value.CooldownUntil, now)
		return false
	}
	if recovery := candidate.QuotaRecovery; recovery != nil && recovery.Status != account.QuotaRecoveryStatusActive {
		if recovery.NextProbeAt != nil && !now.Before(*recovery.NextProbeAt) {
			screening.probeCandidates = append(screening.probeCandidates, index)
		} else {
			screening.quota++
			if recovery.NextProbeAt != nil {
				screening.earliestRetry = earlierFuture(screening.earliestRetry, *recovery.NextProbeAt, now)
			}
		}
		return false
	}
	if candidate.Billing != nil && candidate.Billing.IsExhausted(value.MinimumRemaining) {
		screening.quota++
		return false
	}
	if quotaWindowExhausted(candidate, quotaConsumed) {
		screening.quota++
		if candidate.QuotaWindow.ResetAt != nil {
			screening.earliestRetry = earlierFuture(screening.earliestRetry, *candidate.QuotaWindow.ResetAt, now)
		}
		return false
	}
	return true
}

// Acquire 从请求级候选计划中获取下一个账号。被 excluded 的账号不会重新入选。
func (session *selectionSession) Acquire(ctx context.Context, excluded map[uint64]bool, allowQuotaProbe bool) (*accountLease, error) {
	if session.retryAccountID != 0 {
		accountID := session.retryAccountID
		session.retryAccountID = 0
		if !session.candidateExcluded(excluded, accountID) {
			if candidate, ok := routingCandidateByID(session.values, session.normalCandidates, accountID); ok {
				lease, err := session.selector.claimAccountSlotTracked(ctx, candidate.Credential, &session.materialFailures)
				if err != nil {
					if errors.Is(err, errRoutingCredentialStale) {
						session.markCandidateStale(accountID)
					} else {
						return nil, err
					}
				} else if lease != nil {
					return session.completeNormalLease(ctx, lease, candidate, excluded)
				}
			}
		}
	}
	if allowQuotaProbe {
		lease, err := session.acquireQuotaProbe(ctx, excluded)
		if err != nil || lease != nil {
			return lease, err
		}
	}
	return session.acquireNormal(ctx, excluded)
}

// RetryAccount 将一个已被本请求取出的普通账号放回下一次选号的最前面。
// 仅用于出口重建后的无账号归因重试，不能用于账号级失败。
func (session *selectionSession) RetryAccount(accountID uint64) {
	if accountID == 0 {
		return
	}
	for _, index := range session.normalCandidates {
		if session.values[index].Credential.ID == accountID {
			session.retryAccountID = accountID
			return
		}
	}
}

func (session *selectionSession) acquireQuotaProbe(ctx context.Context, excluded map[uint64]bool) (*accountLease, error) {
	if len(session.probeCandidates) == 0 {
		return nil, nil
	}
	if session.probePlan == nil {
		plan, err := session.selector.planCandidateIndexes(ctx, session.values, session.probeCandidates, time.Now().UTC(), session.selector.resolveTierOrder(session.provider, session.upstreamModel, session.quotaMode))
		if err != nil {
			return nil, err
		}
		session.probePlan = plan
	}
	for candidate, ok := session.probePlan.Next(); ok; candidate, ok = session.probePlan.Next() {
		if session.candidateExcluded(excluded, candidate.Credential.ID) {
			continue
		}
		lease, err := session.selector.claimAccountSlotTracked(ctx, candidate.Credential, &session.materialFailures)
		if err != nil {
			if errors.Is(err, errRoutingCredentialStale) {
				session.markCandidateStale(candidate.Credential.ID)
				continue
			}
			return nil, err
		}
		if lease == nil {
			continue
		}
		now := time.Now().UTC()
		claimed, err := session.selector.accounts.ClaimQuotaProbe(ctx, candidate.Credential.ID, now, now.Add(quotaProbeLease))
		if err != nil || !claimed {
			lease.Release()
			if err != nil {
				return nil, err
			}
			continue
		}
		lease.QuotaProbe = true
		lease.QuotaProbeKind = candidate.QuotaRecovery.Kind
		lease.Billing = candidate.Billing
		return lease, nil
	}
	return nil, nil
}

func (session *selectionSession) acquireNormal(ctx context.Context, excluded map[uint64]bool) (*accountLease, error) {
	if len(session.normalCandidates) == 0 {
		return nil, &SelectionUnavailableError{Reason: SelectionNoAccounts}
	}
	_, _, _, capacityWait := session.selector.routingConfig()
	lease, err := session.acquireSticky(ctx, excluded, &capacityWait)
	if err != nil || lease != nil {
		return lease, err
	}
	indexes := session.unexcludedNormalIndexes(excluded)
	activeRequest := session.selector.nextSegmentedActiveRequest(session.provider, session.upstreamModel, session.quotaMode, len(indexes))
	if activeRequest != nil {
		return session.acquireSegmented(ctx, indexes, *activeRequest, excluded)
	}
	return session.acquireFromPlan(ctx, excluded, capacityWait)
}

// acquireSticky 先尝试本请求的粘滞账号。粘滞账号不可用或已耗尽容量等待时不返回错误，
// 由调用方继续普通选号；capacityWait 在耗尽时被清零以跳过重复等待。
func (session *selectionSession) acquireSticky(ctx context.Context, excluded map[uint64]bool, capacityWait *time.Duration) (*accountLease, error) {
	if session.stickyTried || session.stickyKey == "" || session.selector.sticky == nil {
		return nil, nil
	}
	session.stickyTried = true
	stickyID, ok, err := session.selector.sticky.Get(ctx, session.stickyKey, time.Now().UTC())
	if err != nil {
		return nil, fmt.Errorf("读取会话粘滞状态: %w", err)
	}
	if !ok || session.candidateExcluded(excluded, stickyID) {
		return nil, nil
	}
	for _, index := range session.normalCandidates {
		candidate := session.values[index]
		if candidate.Credential.ID != stickyID {
			continue
		}
		lease, err := session.selector.acquirePinnedCapacity(ctx, candidate.Credential, &session.materialFailures)
		if err != nil {
			if errors.Is(err, errRoutingCredentialStale) {
				session.markCandidateStale(stickyID)
				_ = session.selector.sticky.DeleteByAccount(ctx, stickyID)
				return nil, nil
			}
			if !isSelectionUnavailable(err, SelectionSaturated) {
				return nil, err
			}
			// The sticky account already consumed this request's bounded capacity wait.
			// Try an available fallback immediately without waiting for the whole pool again.
			*capacityWait = 0
			return nil, nil
		}
		return session.completeNormalLease(ctx, lease, candidate, excluded)
	}
	return nil, nil
}

func (session *selectionSession) acquireSegmented(ctx context.Context, indexes []int, activeRequest segmentedSelectorActiveRequest, excluded map[uint64]bool) (*accountLease, error) {
	lease, err := session.selector.acquireSegmentedCandidates(ctx, session.values, indexes, session.quotaMode, session.selector.resolveTierOrder(session.provider, session.upstreamModel, session.quotaMode), activeRequest, &session.materialFailures)
	if err != nil || lease == nil || session.stickyKey == "" {
		return lease, err
	}
	if lease.routingCandidate == nil {
		lease.Release()
		return nil, errors.New("分段选号缺少候选上下文")
	}
	return session.completeNormalLease(ctx, lease, *lease.routingCandidate, excluded)
}

// acquireFromPlan 在候选计划上按轮次取号；池内账号饱和时重建计划并重新等待。
func (session *selectionSession) acquireFromPlan(ctx context.Context, excluded map[uint64]bool, capacityWait time.Duration) (*accountLease, error) {
	deadline := time.Now().Add(capacityWait)
	for {
		if session.normalPlan == nil {
			plan, err := session.selector.planCandidateIndexes(ctx, session.values, session.normalCandidates, time.Now().UTC(), session.selector.resolveTierOrder(session.provider, session.upstreamModel, session.quotaMode))
			if err != nil {
				return nil, err
			}
			session.normalPlan = plan
		}
		lease, err := session.claimNormalPlan(ctx, excluded)
		if err != nil || lease != nil {
			return lease, err
		}
		if !session.hasUnexcludedNormal(excluded) {
			return nil, &SelectionUnavailableError{Reason: SelectionNoAccounts}
		}
		if capacityWait <= 0 {
			return nil, &SelectionUnavailableError{Reason: SelectionSaturated, RetryAfter: time.Second}
		}
		retry, err := session.selector.awaitLeaseRetry(ctx, deadline)
		if err != nil {
			return nil, err
		}
		if !retry {
			return nil, &SelectionUnavailableError{Reason: SelectionSaturated, RetryAfter: time.Second}
		}
		// 仅当池内账号都已饱和时重读剩余账号的动态并发状态；正常账号切换不会重建计划。
		session.normalPlan = nil
	}
}

func (session *selectionSession) claimNormalPlan(ctx context.Context, excluded map[uint64]bool) (*accountLease, error) {
	for candidate, ok := session.normalPlan.Next(); ok; candidate, ok = session.normalPlan.Next() {
		if session.candidateExcluded(excluded, candidate.Credential.ID) {
			continue
		}
		lease, err := session.selector.claimAccountSlotTracked(ctx, candidate.Credential, &session.materialFailures)
		if err != nil {
			if errors.Is(err, errRoutingCredentialStale) {
				session.markCandidateStale(candidate.Credential.ID)
				continue
			}
			return nil, err
		}
		if lease != nil {
			return session.completeNormalLease(ctx, lease, candidate, excluded)
		}
	}
	return nil, nil
}

func (session *selectionSession) completeNormalLease(ctx context.Context, lease *accountLease, candidate account.RoutingCandidate, excluded map[uint64]bool) (*accountLease, error) {
	if session.stickyKey != "" && session.selector.sticky != nil {
		stickyTTL, _, _, _ := session.selector.routingConfig()
		now := time.Now().UTC()
		boundID, err := session.selector.sticky.Bind(ctx, session.stickyKey, candidate.Credential.ID, now, now.Add(stickyTTL))
		if err != nil {
			lease.Release()
			return nil, fmt.Errorf("写入会话粘滞状态: %w", err)
		}
		if boundID != candidate.Credential.ID {
			if boundCandidate, eligible := routingCandidateByID(session.values, session.normalCandidates, boundID); eligible && !session.candidateExcluded(excluded, boundID) {
				boundLease, acquireErr := session.selector.claimAccountSlotTracked(ctx, boundCandidate.Credential, &session.materialFailures)
				if acquireErr != nil {
					if errors.Is(acquireErr, errRoutingCredentialStale) {
						session.markCandidateStale(boundID)
						_ = session.selector.sticky.DeleteByAccount(ctx, boundID)
						if err := session.selector.sticky.Set(ctx, session.stickyKey, candidate.Credential.ID, now.Add(stickyTTL)); err != nil {
							lease.Release()
							return nil, fmt.Errorf("重建会话粘滞状态: %w", err)
						}
					} else {
						lease.Release()
						return nil, acquireErr
					}
				} else if boundLease != nil {
					lease.Release()
					lease = boundLease
					candidate = boundCandidate
				}
			} else if err := session.selector.sticky.Set(ctx, session.stickyKey, candidate.Credential.ID, now.Add(stickyTTL)); err != nil {
				lease.Release()
				return nil, fmt.Errorf("重建会话粘滞状态: %w", err)
			}
		}
	}
	lease.Billing = candidate.Billing
	lease.QuotaMode = effectiveQuotaMode(candidate, session.quotaMode)
	return lease, nil
}

func (session *selectionSession) hasUnexcludedNormal(excluded map[uint64]bool) bool {
	for _, index := range session.normalCandidates {
		if !session.candidateExcluded(excluded, session.values[index].Credential.ID) {
			return true
		}
	}
	return false
}

// hasAvailableCandidate reports whether this request-level snapshot still has
// an account the quality retry is allowed to switch to. This is deliberately
// stronger than checking the routing attempt counter: a large attempt budget
// does not imply that another account exists.
func (session *selectionSession) hasAvailableCandidate(excluded map[uint64]bool, allowQuotaProbe bool) bool {
	if session == nil {
		return false
	}
	if session.hasUnexcludedNormal(excluded) {
		return true
	}
	if allowQuotaProbe {
		for _, index := range session.probeCandidates {
			if !session.candidateExcluded(excluded, session.values[index].Credential.ID) {
				return true
			}
		}
	}
	return false
}

func (session *selectionSession) unexcludedNormalIndexes(excluded map[uint64]bool) []int {
	if len(excluded) == 0 && len(session.staleCandidates) == 0 {
		return session.normalCandidates
	}
	indexes := make([]int, 0, len(session.normalCandidates))
	for _, index := range session.normalCandidates {
		if !session.candidateExcluded(excluded, session.values[index].Credential.ID) {
			indexes = append(indexes, index)
		}
	}
	return indexes
}

func (session *selectionSession) candidateExcluded(excluded map[uint64]bool, accountID uint64) bool {
	return excluded[accountID] || session.staleCandidates[accountID]
}

func (session *selectionSession) markCandidateStale(accountID uint64) {
	session.staleCandidates[accountID] = true
}
