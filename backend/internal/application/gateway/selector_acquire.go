package gateway

import (
	"context"
	"errors"
	"fmt"
	"time"

	sha256 "crypto/sha256"
	hex "encoding/hex"
	account "github.com/chenyme/grok2api/backend/internal/domain/account"
	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
)

func (s *Selector) Acquire(ctx context.Context, provider account.Provider, modelRouteID uint64, upstreamModel, quotaMode, affinityKey string, excluded map[uint64]bool, allowQuotaProbe bool) (*accountLease, error) {
	return s.acquire(ctx, provider, modelRouteID, upstreamModel, quotaMode, affinityKey, excluded, allowQuotaProbe, clientkeydomain.AccountScope{}, 0)
}

func (s *Selector) AcquireForKey(ctx context.Context, provider account.Provider, modelRouteID uint64, upstreamModel, quotaMode, affinityKey string, excluded map[uint64]bool, allowQuotaProbe bool, scope clientkeydomain.AccountScope) (*accountLease, error) {
	return s.acquire(ctx, provider, modelRouteID, upstreamModel, quotaMode, affinityKey, excluded, allowQuotaProbe, scope, 0)
}

// AcquireForKeyOnEgressNode is reserved for administrator probes. It prefers a
// credential bound to the requested node, then borrows any schedulable
// credential when the node's own accounts are unavailable. The request layer
// still forces the physical call through nodeID.
func (s *Selector) AcquireForKeyOnEgressNode(ctx context.Context, provider account.Provider, modelRouteID uint64, upstreamModel, quotaMode, affinityKey string, excluded map[uint64]bool, allowQuotaProbe bool, scope clientkeydomain.AccountScope, nodeID uint64) (*accountLease, error) {
	if nodeID == 0 {
		return nil, &SelectionUnavailableError{Reason: SelectionNoAccounts, Scope: scope}
	}
	lease, err := s.acquire(ctx, provider, modelRouteID, upstreamModel, quotaMode, affinityKey, excluded, allowQuotaProbe, scope, nodeID)
	if err == nil {
		return lease, nil
	}
	var unavailable *SelectionUnavailableError
	if !errors.As(err, &unavailable) {
		return nil, err
	}
	// Probe borrowing must not create or reuse ordinary sticky affinity.
	return s.acquire(ctx, provider, modelRouteID, upstreamModel, quotaMode, "", excluded, allowQuotaProbe, scope, 0)
}

func (s *Selector) acquire(ctx context.Context, provider account.Provider, modelRouteID uint64, upstreamModel, quotaMode, affinityKey string, excluded map[uint64]bool, allowQuotaProbe bool, requestedScope clientkeydomain.AccountScope, forcedEgressNodeID uint64) (lease *accountLease, err error) {
	accountScope, scopeValid := clientkeydomain.NormalizeAccountScope(requestedScope)
	defer annotateSelectionAccountScope(&err, accountScope)
	if !scopeValid || !accountScope.AllowsProvider(provider) {
		return nil, &SelectionUnavailableError{Reason: SelectionNoAccounts, Scope: accountScope}
	}
	now := time.Now().UTC()
	stickyKey := stickySessionKey(affinityKey)
	values, err := s.loadCandidates(ctx, provider, modelRouteID, upstreamModel, quotaMode, now, false)
	if err != nil {
		return nil, err
	}
	partition := s.partitionRoutingCandidates(provider, values, accountScope, forcedEgressNodeID, excluded, upstreamModel, quotaMode, allowQuotaProbe, now)
	if len(partition.normal) == 0 && len(partition.probe) == 0 {
		return nil, selectionUnavailableFromPartition(partition, now)
	}
	materialFailures := credentialMaterialFailureTracker{}
	if len(partition.probe) > 0 {
		probeLease, probeErr := s.claimProbeCandidates(ctx, values, partition, provider, upstreamModel, quotaMode, now, &materialFailures)
		if probeErr != nil || probeLease != nil {
			return probeLease, probeErr
		}
	}
	stickyLease, saturatedStickyID, stickyErr := s.acquireStickyLease(ctx, stickyKey, values, partition.normal, quotaMode, now, &materialFailures)
	if stickyErr != nil || stickyLease != nil {
		return stickyLease, stickyErr
	}
	if saturatedStickyID != 0 {
		return s.acquireBorrowedLease(ctx, values, partition.normal, saturatedStickyID, provider, upstreamModel, quotaMode, &materialFailures)
	}
	if segmentedLease, handled, segmentedErr := s.acquireSegmentedLease(ctx, values, partition.normal, stickyKey, provider, upstreamModel, quotaMode, &materialFailures); handled {
		return segmentedLease, segmentedErr
	}
	return s.acquireWithCapacityWait(ctx, values, partition.normal, stickyKey, provider, upstreamModel, quotaMode, &materialFailures)
}

// routingCandidateClass 表示候选账号在分区阶段的归类。
type routingCandidateClass int

const (
	routingCandidateUnsupported routingCandidateClass = iota
	routingCandidateNormal
	routingCandidateProbe
	routingCandidateModelCooling
	routingCandidateEgressCooling
	routingCandidateAccountCooling
	routingCandidateQuota
)

// routingCandidateDecision 是单个候选账号的归类结果；retryAt 仅对冷却与额度类原因有效。
type routingCandidateDecision struct {
	class   routingCandidateClass
	retryAt time.Time
}

// routingCandidatePartition 汇总候选账号的分区下标与不可调度原因计数。
type routingCandidatePartition struct {
	normal        []int
	probe         []int
	supported     int
	considered    int
	cooling       int
	modelCooling  int
	quota         int
	earliestRetry time.Time
}

// partitionRoutingCandidates 遍历候选账号，按模型支持、冷却与额度状态分区为可调度、可探测与不可调度。
func (s *Selector) partitionRoutingCandidates(provider account.Provider, values []account.RoutingCandidate, accountScope clientkeydomain.AccountScope, forcedEgressNodeID uint64, excluded map[uint64]bool, upstreamModel, quotaMode string, allowQuotaProbe bool, now time.Time) routingCandidatePartition {
	quotaConsumed := s.quotaConsumptionSnapshot(provider)
	healthOverrides := s.routingHealthSnapshot(provider, now)
	// 仅保留候选下标，避免每个请求复制包含凭据、计费和额度结构的完整账号切片。
	partition := routingCandidatePartition{normal: make([]int, 0, len(values)), probe: make([]int, 0, len(values))}
	for index, candidate := range values {
		value := applyHealthSnapshot(candidate.Credential, healthOverrides)
		if forcedEgressNodeID != 0 && value.EgressNodeID != forcedEgressNodeID {
			continue
		}
		if !accountScopeAllowsCandidate(provider, accountScope, candidate) {
			continue
		}
		if excluded[value.ID] || value.AuthStatus != account.AuthStatusActive {
			continue
		}
		partition.considered++
		decision := s.classifyRoutingCandidate(provider, candidate, value, upstreamModel, quotaMode, quotaConsumed, allowQuotaProbe, now)
		if decision.class == routingCandidateUnsupported {
			continue
		}
		partition.supported++
		partition.recordCandidate(index, decision, now)
	}
	return partition
}

// classifyRoutingCandidate 归类单个候选账号：模型不支持、冷却、额度耗尽、可探测或可调度。
func (s *Selector) classifyRoutingCandidate(provider account.Provider, candidate account.RoutingCandidate, value account.Credential, upstreamModel, quotaMode string, quotaConsumed map[accountQuotaConsumptionKey]int, allowQuotaProbe bool, now time.Time) routingCandidateDecision {
	if !s.candidateSupportsModel(provider, upstreamModel, quotaMode, candidate) {
		return routingCandidateDecision{class: routingCandidateUnsupported}
	}
	if candidate.ModelQuotaBlock != nil && now.Before(candidate.ModelQuotaBlock.CooldownUntil) {
		return routingCandidateDecision{class: routingCandidateModelCooling, retryAt: candidate.ModelQuotaBlock.CooldownUntil}
	}
	if candidateEgressLeaseCooling(candidate, value, now) {
		return routingCandidateDecision{class: routingCandidateEgressCooling, retryAt: candidate.EgressLeaseBlock.CooldownUntil}
	}
	if value.CooldownUntil != nil && now.Before(*value.CooldownUntil) {
		return routingCandidateDecision{class: routingCandidateAccountCooling, retryAt: *value.CooldownUntil}
	}
	if recovery := candidate.QuotaRecovery; recovery != nil && recovery.Status != account.QuotaRecoveryStatusActive {
		if allowQuotaProbe && recovery.NextProbeAt != nil && !now.Before(*recovery.NextProbeAt) {
			return routingCandidateDecision{class: routingCandidateProbe}
		}
		decision := routingCandidateDecision{class: routingCandidateQuota}
		if recovery.NextProbeAt != nil {
			decision.retryAt = *recovery.NextProbeAt
		}
		return decision
	}
	if candidate.Billing != nil && candidate.Billing.IsExhausted(value.MinimumRemaining) {
		return routingCandidateDecision{class: routingCandidateQuota}
	}
	if quotaWindowExhausted(candidate, quotaConsumed) {
		decision := routingCandidateDecision{class: routingCandidateQuota}
		if candidate.QuotaWindow.ResetAt != nil {
			decision.retryAt = *candidate.QuotaWindow.ResetAt
		}
		return decision
	}
	return routingCandidateDecision{class: routingCandidateNormal}
}

// recordCandidate 按归类结果累计计数、记录最早可重试时间，并把可调度/可探测候选按下标归入分区。
func (partition *routingCandidatePartition) recordCandidate(index int, decision routingCandidateDecision, now time.Time) {
	switch decision.class {
	case routingCandidateNormal:
		partition.normal = append(partition.normal, index)
	case routingCandidateProbe:
		partition.probe = append(partition.probe, index)
	case routingCandidateModelCooling:
		partition.modelCooling++
	case routingCandidateEgressCooling, routingCandidateAccountCooling:
		partition.cooling++
	case routingCandidateQuota:
		partition.quota++
	default:
		return
	}
	partition.earliestRetry = earlierFuture(partition.earliestRetry, decision.retryAt, now)
}

// selectionUnavailableFromPartition 依据分区计数给出账号池不可用的原因与最早重试时间。
func selectionUnavailableFromPartition(partition routingCandidatePartition, now time.Time) *SelectionUnavailableError {
	reason := SelectionNoAccounts
	switch {
	case partition.considered > 0 && partition.supported == 0:
		reason = SelectionUnsupportedModel
	case partition.modelCooling > 0:
		reason = SelectionModelCooling
	case partition.cooling > 0:
		reason = SelectionCooling
	case partition.quota > 0:
		reason = SelectionQuotaExhausted
	}
	return &SelectionUnavailableError{Reason: reason, RetryAfter: retryDelay(now, partition.earliestRetry)}
}

// claimProbeCandidates 依次抢占探测候选的账号容量与额度探测名额；返回租约、错误或 nil 表示本轮无探测结果。
func (s *Selector) claimProbeCandidates(ctx context.Context, values []account.RoutingCandidate, partition routingCandidatePartition, provider account.Provider, upstreamModel, quotaMode string, now time.Time, materialFailures *credentialMaterialFailureTracker) (*accountLease, error) {
	staleClaims := 0
	capacityMisses := 0
	plan, err := s.planCandidateIndexes(ctx, values, partition.probe, now, s.resolveTierOrder(provider, upstreamModel, quotaMode))
	if err != nil {
		return nil, err
	}
	for candidate, ok := plan.Next(); ok; candidate, ok = plan.Next() {
		lease, claimErr := s.claimAccountSlotTracked(ctx, candidate.Credential, materialFailures)
		if claimErr != nil {
			if errors.Is(claimErr, errRoutingCredentialStale) {
				staleClaims++
				continue
			}
			return nil, claimErr
		}
		if lease == nil {
			capacityMisses++
			continue
		}
		claimed, claimErr := s.accounts.ClaimQuotaProbe(ctx, candidate.Credential.ID, now, now.Add(quotaProbeLease))
		if claimErr != nil {
			lease.Release()
			return nil, claimErr
		}
		if !claimed {
			lease.Release()
			continue
		}
		lease.QuotaProbe = true
		lease.QuotaProbeKind = candidate.QuotaRecovery.Kind
		lease.Billing = candidate.Billing
		return lease, nil
	}
	if len(partition.normal) == 0 && staleClaims > 0 && capacityMisses == 0 {
		return nil, &SelectionUnavailableError{Reason: SelectionNoAccounts}
	}
	return nil, nil
}

// acquireStickyLease 复用会话粘滞账号；粘滞账号仅因并发满载不可用时返回其 ID 供调用方等待。
func (s *Selector) acquireStickyLease(ctx context.Context, stickyKey string, values []account.RoutingCandidate, normalCandidates []int, quotaMode string, now time.Time, materialFailures *credentialMaterialFailureTracker) (*accountLease, uint64, error) {
	if stickyKey == "" {
		return nil, 0, nil
	}
	stickyID, ok, err := s.sticky.Get(ctx, stickyKey, now)
	if err != nil {
		return nil, 0, fmt.Errorf("读取会话粘滞状态: %w", err)
	}
	if !ok {
		return nil, 0, nil
	}
	candidate, eligible := routingCandidateByID(values, normalCandidates, stickyID)
	if !eligible {
		return nil, 0, nil
	}
	stickyTTL, _, _, _ := s.routingConfig()
	boundID, bindErr := s.sticky.Bind(ctx, stickyKey, stickyID, now, now.Add(stickyTTL))
	if bindErr != nil {
		return nil, 0, fmt.Errorf("刷新会话粘滞状态: %w", bindErr)
	}
	if boundID != stickyID {
		candidate, eligible = routingCandidateByID(values, normalCandidates, boundID)
		stickyID = boundID
	}
	if !eligible {
		return nil, 0, nil
	}
	return s.claimStickyCandidate(ctx, candidate, quotaMode, stickyID, materialFailures)
}

// claimStickyCandidate 抢占粘滞账号容量；仅因并发满载不可用时返回该账号 ID。
func (s *Selector) claimStickyCandidate(ctx context.Context, candidate account.RoutingCandidate, quotaMode string, stickyID uint64, materialFailures *credentialMaterialFailureTracker) (*accountLease, uint64, error) {
	lease, acquireErr := s.acquirePinnedCapacity(ctx, candidate.Credential, materialFailures)
	if acquireErr == nil {
		lease.Billing = candidate.Billing
		lease.QuotaMode = effectiveQuotaMode(candidate, quotaMode)
		return lease, 0, nil
	}
	if errors.Is(acquireErr, errRoutingCredentialStale) {
		_ = s.sticky.DeleteByAccount(ctx, stickyID)
		return nil, 0, nil
	}
	if !isSelectionUnavailable(acquireErr, SelectionSaturated) {
		return nil, 0, acquireErr
	}
	return nil, stickyID, nil
}

// acquireBorrowedLease 在粘滞账号并发满载超时后借用其他账号容量。
// 粘性账号仅因并发满载而暂时不可用时，先等待该账号；超时后允许本次请求临时借用
// 其他账号，但不覆盖原绑定，避免并行请求让活跃会话在账号池中来回抖动。
func (s *Selector) acquireBorrowedLease(ctx context.Context, values []account.RoutingCandidate, normalCandidates []int, saturatedStickyID uint64, provider account.Provider, upstreamModel, quotaMode string, materialFailures *credentialMaterialFailureTracker) (*accountLease, error) {
	plan, err := s.planCandidateIndexes(ctx, values, normalCandidates, time.Now().UTC(), s.resolveTierOrder(provider, upstreamModel, quotaMode))
	if err != nil {
		return nil, err
	}
	for candidate, ok := plan.Next(); ok; candidate, ok = plan.Next() {
		if candidate.Credential.ID == saturatedStickyID {
			continue
		}
		lease, claimErr := s.claimAccountSlotTracked(ctx, candidate.Credential, materialFailures)
		if claimErr != nil {
			if errors.Is(claimErr, errRoutingCredentialStale) {
				continue
			}
			return nil, claimErr
		}
		if lease == nil {
			continue
		}
		lease.Billing = candidate.Billing
		lease.QuotaMode = effectiveQuotaMode(candidate, quotaMode)
		return lease, nil
	}
	return nil, &SelectionUnavailableError{Reason: SelectionSaturated, RetryAfter: time.Second}
}

// acquireSegmentedLease 在有活跃分段选号计划时按分段候选获取租约并补齐粘滞绑定。
func (s *Selector) acquireSegmentedLease(ctx context.Context, values []account.RoutingCandidate, normalCandidates []int, stickyKey string, provider account.Provider, upstreamModel, quotaMode string, materialFailures *credentialMaterialFailureTracker) (*accountLease, bool, error) {
	activeRequest := s.nextSegmentedActiveRequest(provider, upstreamModel, quotaMode, len(normalCandidates))
	if activeRequest == nil {
		return nil, false, nil
	}
	lease, acquireErr := s.acquireSegmentedCandidates(ctx, values, normalCandidates, quotaMode, s.resolveTierOrder(provider, upstreamModel, quotaMode), *activeRequest, materialFailures)
	if acquireErr != nil || lease == nil || stickyKey == "" {
		return lease, true, acquireErr
	}
	if lease.routingCandidate == nil {
		lease.Release()
		return nil, true, errors.New("分段选号缺少候选上下文")
	}
	completedLease, completedErr := s.completeStickyLease(ctx, stickyKey, values, normalCandidates, *lease.routingCandidate, lease, quotaMode, materialFailures)
	return completedLease, true, completedErr
}

// acquireWithCapacityWait 在容量等待预算内轮询正常候选，直到拿到租约、账号池耗尽或预算用完。
func (s *Selector) acquireWithCapacityWait(ctx context.Context, values []account.RoutingCandidate, normalCandidates []int, stickyKey string, provider account.Provider, upstreamModel, quotaMode string, materialFailures *credentialMaterialFailureTracker) (*accountLease, error) {
	_, _, _, capacityWait := s.routingConfig()
	waitDeadline := time.Now().Add(capacityWait)
	for {
		lease, waitErr := s.claimNormalCandidates(ctx, values, normalCandidates, stickyKey, provider, upstreamModel, quotaMode, materialFailures)
		if waitErr != nil || lease != nil {
			return lease, waitErr
		}
		if capacityWait <= 0 {
			return nil, &SelectionUnavailableError{Reason: SelectionSaturated, RetryAfter: time.Second}
		}
		retry, err := s.awaitLeaseRetry(ctx, waitDeadline)
		if err != nil {
			return nil, err
		}
		if !retry {
			return nil, &SelectionUnavailableError{Reason: SelectionSaturated, RetryAfter: time.Second}
		}
	}
}

// claimNormalCandidates 对当前正常候选执行一轮抢占；返回租约、错误或 nil 表示需要继续等待容量。
func (s *Selector) claimNormalCandidates(ctx context.Context, values []account.RoutingCandidate, normalCandidates []int, stickyKey string, provider account.Provider, upstreamModel, quotaMode string, materialFailures *credentialMaterialFailureTracker) (*accountLease, error) {
	currentTime := time.Now().UTC()
	staleClaims := 0
	capacityMisses := 0
	plan, err := s.planCandidateIndexes(ctx, values, normalCandidates, currentTime, s.resolveTierOrder(provider, upstreamModel, quotaMode))
	if err != nil {
		return nil, err
	}
	for candidate, ok := plan.Next(); ok; candidate, ok = plan.Next() {
		lease, claimErr := s.claimAccountSlotTracked(ctx, candidate.Credential, materialFailures)
		if claimErr != nil {
			if errors.Is(claimErr, errRoutingCredentialStale) {
				staleClaims++
				continue
			}
			return nil, claimErr
		}
		if lease == nil {
			capacityMisses++
			continue
		}
		return s.completeStickyLease(ctx, stickyKey, values, normalCandidates, candidate, lease, quotaMode, materialFailures)
	}
	if staleClaims > 0 && capacityMisses == 0 {
		return nil, &SelectionUnavailableError{Reason: SelectionNoAccounts}
	}
	return nil, nil
}

func (s *Selector) completeStickyLease(ctx context.Context, stickyKey string, values []account.RoutingCandidate, normalCandidates []int, candidate account.RoutingCandidate, lease *accountLease, quotaMode string, materialFailures *credentialMaterialFailureTracker) (*accountLease, error) {
	if stickyKey != "" {
		stickyTTL, _, _, _ := s.routingConfig()
		now := time.Now().UTC()
		boundID, err := s.sticky.Bind(ctx, stickyKey, candidate.Credential.ID, now, now.Add(stickyTTL))
		if err != nil {
			lease.Release()
			return nil, fmt.Errorf("写入会话粘滞状态: %w", err)
		}
		if boundID != candidate.Credential.ID {
			if boundCandidate, eligible := routingCandidateByID(values, normalCandidates, boundID); eligible {
				boundLease, acquireErr := s.acquirePinnedCapacity(ctx, boundCandidate.Credential, materialFailures)
				if acquireErr == nil {
					lease.Release()
					lease = boundLease
					candidate = boundCandidate
				} else if errors.Is(acquireErr, errRoutingCredentialStale) {
					_ = s.sticky.DeleteByAccount(ctx, boundID)
					if err := s.sticky.Set(ctx, stickyKey, candidate.Credential.ID, now.Add(stickyTTL)); err != nil {
						lease.Release()
						return nil, fmt.Errorf("重建会话粘滞状态: %w", err)
					}
				} else if !isSelectionUnavailable(acquireErr, SelectionSaturated) {
					lease.Release()
					return nil, acquireErr
				}
				// 已绑定账号满载时保留原绑定，本次请求使用已获取的临时账号。
			} else if err := s.sticky.Set(ctx, stickyKey, candidate.Credential.ID, now.Add(stickyTTL)); err != nil {
				lease.Release()
				return nil, fmt.Errorf("重建会话粘滞状态: %w", err)
			}
		}
	}
	lease.Billing = candidate.Billing
	lease.QuotaMode = effectiveQuotaMode(candidate, quotaMode)
	return lease, nil
}

// stickySessionKey 将调用方粘滞 identity 压缩为固定长度，仅用于账号粘滞索引。
func stickySessionKey(value string) string {
	if value == "" {
		return ""
	}
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func routingCandidateByID(values []account.RoutingCandidate, indexes []int, accountID uint64) (account.RoutingCandidate, bool) {
	for _, index := range indexes {
		candidate := values[index]
		if candidate.Credential.ID == accountID {
			return candidate, true
		}
	}
	return account.RoutingCandidate{}, false
}

func isSelectionUnavailable(err error, reason SelectionUnavailableReason) bool {
	var unavailable *SelectionUnavailableError
	return errors.As(err, &unavailable) && unavailable.Reason == reason
}

// AcquirePinned 为 previous_response_id 等账号归属请求获取指定账号租约。
func (s *Selector) AcquirePinned(ctx context.Context, provider account.Provider, accountID, modelRouteID uint64, upstreamModel, quotaMode string, inference bool) (*accountLease, error) {
	return s.acquirePinned(ctx, provider, accountID, modelRouteID, upstreamModel, quotaMode, inference, false, clientkeydomain.AccountScope{})
}

func (s *Selector) AcquirePinnedForKey(ctx context.Context, provider account.Provider, accountID, modelRouteID uint64, upstreamModel, quotaMode string, inference bool, scope clientkeydomain.AccountScope) (*accountLease, error) {
	return s.acquirePinned(ctx, provider, accountID, modelRouteID, upstreamModel, quotaMode, inference, false, scope)
}

// AcquirePinnedForQualityProbe keeps every ordinary eligibility check while
// bypassing only the exact account+node lease block being recovery-tested.
func (s *Selector) AcquirePinnedForQualityProbe(ctx context.Context, provider account.Provider, accountID, modelRouteID uint64, upstreamModel, quotaMode string, scope clientkeydomain.AccountScope) (*accountLease, error) {
	return s.acquirePinned(ctx, provider, accountID, modelRouteID, upstreamModel, quotaMode, true, true, scope)
}

// pinnedCandidateAccessError 校验固定账号是否落在 key 的账号范围内并处于可用状态。
