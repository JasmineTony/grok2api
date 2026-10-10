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

func (s *Selector) loadCandidates(ctx context.Context, provider account.Provider, modelRouteID uint64, upstreamModel, quotaMode string, now time.Time, includeBotFlagged ...bool) ([]account.RoutingCandidate, error) {
	include := false
	if len(includeBotFlagged) > 0 {
		include = includeBotFlagged[0]
	}
	if _, ok := s.accounts.(repository.RoutingLayerRepository); ok {
		return s.loadLayeredCandidates(ctx, provider, modelRouteID, upstreamModel, quotaMode, now, include)
	}
	return s.loadCombinedCandidates(ctx, provider, modelRouteID, upstreamModel, quotaMode, now, include)
}

// cachedCandidateValues 命中未过期的候选缓存时刷新访问时间并返回其值。
func (s *Selector) cachedCandidateValues(key candidateCacheKey, now time.Time) ([]account.RoutingCandidate, bool) {
	s.candidateMu.Lock()
	defer s.candidateMu.Unlock()
	snapshot, ok := s.candidates[key]
	if !ok || !now.Before(snapshot.expiresAt) {
		return nil, false
	}
	snapshot.lastAccess = now
	s.candidates[key] = snapshot
	return snapshot.values, true
}

// cacheCandidateValues 写入候选快照并刷新访问时间。
func (s *Selector) cacheCandidateValues(key candidateCacheKey, values []account.RoutingCandidate, checkTime time.Time) {
	s.candidateMu.Lock()
	defer s.candidateMu.Unlock()
	s.storeCandidateSnapshotLocked(key, newCandidateSnapshot(values, checkTime.Add(candidateCacheTTL)), checkTime)
}

// loadCombinedCandidatesUncached 在 singleflight 内重建候选缓存，必要时回退到过期快照。
func (s *Selector) loadCombinedCandidatesUncached(ctx context.Context, key candidateCacheKey) (any, error) {
	checkTime := time.Now().UTC()
	var stale candidateSnapshot
	hasStale := false
	s.candidateMu.Lock()
	if snapshot, ok := s.candidates[key]; ok {
		if checkTime.Before(snapshot.expiresAt) {
			snapshot.lastAccess = checkTime
			s.candidates[key] = snapshot
			s.candidateMu.Unlock()
			return snapshot.values, nil
		}
		if checkTime.Before(snapshot.staleUntil) {
			stale, hasStale = snapshot, true
		}
	}
	s.candidateMu.Unlock()
	values, err := s.accounts.ListRoutingCandidates(ctx, key.provider, key.modelRouteID, key.upstreamModel, key.quotaMode)
	if err != nil {
		if !hasStale || !canUseStaleRoutingSnapshot(ctx, err) {
			return nil, err
		}
		s.retainStaleCandidateSnapshot(key, &stale, checkTime)
		s.logStaleRoutingFallback("combined", key.provider, checkTime, stale.staleUntil, err)
		return stale.values, nil
	}
	values, err = s.maybeFilterBotFlagged(ctx, key.provider, values, key.includeBotFlagged)
	if err != nil {
		return nil, err
	}
	s.cacheCandidateValues(key, values, checkTime)
	return values, nil
}

// retainStaleCandidateSnapshot 延长过期候选快照的有效期，使后续请求在重试窗口内仍可降级服务。
func (s *Selector) retainStaleCandidateSnapshot(key candidateCacheKey, stale *candidateSnapshot, checkTime time.Time) {
	s.candidateMu.Lock()
	defer s.candidateMu.Unlock()
	stale.lastAccess = checkTime
	stale.expiresAt = staleRetryExpiry(checkTime, stale.staleUntil)
	s.storeCandidateSnapshotLocked(key, *stale, checkTime)
}

func (s *Selector) loadCombinedCandidates(ctx context.Context, provider account.Provider, modelRouteID uint64, upstreamModel, quotaMode string, now time.Time, includeBotFlagged bool) ([]account.RoutingCandidate, error) {
	key := candidateCacheKey{provider: provider, modelRouteID: modelRouteID, upstreamModel: upstreamModel, quotaMode: quotaMode, includeBotFlagged: includeBotFlagged}
	if values, ok := s.cachedCandidateValues(key, now); ok {
		return values, nil
	}
	loadKey := fmt.Sprintf("%s\x00%d\x00%s\x00%s\x00%t", provider, modelRouteID, upstreamModel, quotaMode, includeBotFlagged)
	loaded, err, _ := s.candidateLoads.Do(loadKey, func() (any, error) {
		return s.loadCombinedCandidatesUncached(ctx, key)
	})
	if err != nil {
		return nil, err
	}
	return loaded.([]account.RoutingCandidate), nil
}

// assembleLayeredCandidatesOnce 组装一次分层候选；版本在读取期间变化时返回 stable=false 交由调用方重试。
func (s *Selector) assembleLayeredCandidatesOnce(ctx context.Context, layered repository.RoutingLayerRepository, key candidateCacheKey, checkTime time.Time) ([]account.RoutingCandidate, bool, error) {
	bases, baseVersion, loadErr := s.loadRoutingBases(ctx, layered, key.provider, key.quotaMode, checkTime)
	if loadErr != nil {
		return nil, false, loadErr
	}
	overlay, overlayVersion, loadErr := s.loadRoutingOverlay(ctx, layered, key.provider, key.modelRouteID, key.upstreamModel, checkTime)
	if loadErr != nil {
		return nil, false, loadErr
	}
	if !s.routingVersionsStable(key.provider, baseVersion, overlayVersion) {
		return nil, false, nil
	}
	values := assembleRoutingCandidates(key.provider, key.quotaMode, bases, overlay)
	values, filterErr := s.maybeFilterBotFlagged(ctx, key.provider, values, key.includeBotFlagged)
	if filterErr != nil {
		return nil, false, filterErr
	}
	s.candidateMu.Lock()
	stable := baseVersion == s.routingBaseVersionLocked(key.provider) && overlayVersion == s.routingOverlayVersionLocked(key.provider)
	if stable {
		s.storeCandidateSnapshotLocked(key, newCandidateSnapshot(values, checkTime.Add(candidateCacheTTL)), checkTime)
	}
	s.candidateMu.Unlock()
	if !stable {
		return nil, false, nil
	}
	return values, true, nil
}

// loadLayeredCandidatesUncached 在 singleflight 内按层组装候选并缓存，持续抖动时回退到权威合并查询。
func (s *Selector) loadLayeredCandidatesUncached(ctx context.Context, key candidateCacheKey) (any, error) {
	checkTime := time.Now().UTC()
	if values, ok := s.cachedCandidateValues(key, checkTime); ok {
		return values, nil
	}
	layered := s.accounts.(repository.RoutingLayerRepository)
	for attempt := 0; attempt < 4; attempt++ {
		values, stable, loadErr := s.assembleLayeredCandidatesOnce(ctx, layered, key, checkTime)
		if loadErr != nil {
			return nil, loadErr
		}
		if stable {
			return values, nil
		}
		checkTime = time.Now().UTC()
	}
	// Sustained account synchronization must not turn cache churn into user-facing
	// failures. Fall back to the established authoritative combined query.
	values, err := s.accounts.ListRoutingCandidates(ctx, key.provider, key.modelRouteID, key.upstreamModel, key.quotaMode)
	if err != nil {
		return nil, err
	}
	return s.maybeFilterBotFlagged(ctx, key.provider, values, key.includeBotFlagged)
}

func (s *Selector) loadLayeredCandidates(ctx context.Context, provider account.Provider, modelRouteID uint64, upstreamModel, quotaMode string, now time.Time, includeBotFlagged bool) ([]account.RoutingCandidate, error) {
	key := candidateCacheKey{provider: provider, modelRouteID: modelRouteID, upstreamModel: upstreamModel, quotaMode: quotaMode, includeBotFlagged: includeBotFlagged}
	if values, ok := s.cachedCandidateValues(key, now); ok {
		return values, nil
	}
	loadKey := fmt.Sprintf("assembled\x00%s\x00%d\x00%s\x00%s\x00%t", provider, modelRouteID, upstreamModel, quotaMode, includeBotFlagged)
	loaded, err, _ := s.candidateLoads.Do(loadKey, func() (any, error) {
		return s.loadLayeredCandidatesUncached(ctx, key)
	})
	if err != nil {
		return nil, err
	}
	return loaded.([]account.RoutingCandidate), nil
}

// cachedRoutingBase 命中未过期且版本一致的基础层缓存时刷新访问时间并返回值。
func (s *Selector) cachedRoutingBase(key routingBaseCacheKey, version routingLayerVersion, now time.Time) ([]account.RoutingAccountBase, bool) {
	s.candidateMu.Lock()
	defer s.candidateMu.Unlock()
	snapshot, ok := s.routingBases[key]
	if !ok || !now.Before(snapshot.expiresAt) || snapshot.version != version {
		return nil, false
	}
	snapshot.lastAccess = now
	s.routingBases[key] = snapshot
	return snapshot.values, true
}

// cacheRoutingBases 在版本未变化时写入基础层缓存，并重建账号到 Provider 的归属索引。
func (s *Selector) cacheRoutingBases(key routingBaseCacheKey, checkVersion routingLayerVersion, values []account.RoutingAccountBase, checkTime time.Time) {
	s.candidateMu.Lock()
	defer s.candidateMu.Unlock()
	if s.routingBaseVersionLocked(key.provider) != checkVersion {
		return
	}
	s.clearQuotaConsumption(key.provider)
	s.storeRoutingBaseSnapshotLocked(key, routingBaseSnapshot{values: values, version: checkVersion, expiresAt: checkTime.Add(candidateCacheTTL)}, checkTime)
	for accountID, cachedProvider := range s.routingAccountProvider {
		if cachedProvider == key.provider {
			delete(s.routingAccountProvider, accountID)
		}
	}
	for _, value := range values {
		s.routingAccountProvider[value.Credential.ID] = key.provider
	}
}

// loadRoutingBasesUncached 在 singleflight 内重建基础层缓存，必要时回退到过期快照。
func (s *Selector) loadRoutingBasesUncached(ctx context.Context, layered repository.RoutingLayerRepository, key routingBaseCacheKey) (any, error) {
	checkTime := time.Now().UTC()
	checkVersion := s.routingBaseVersion(key.provider)
	var stale routingBaseSnapshot
	hasStale := false
	s.candidateMu.Lock()
	if snapshot, ok := s.routingBases[key]; ok && snapshot.version == checkVersion {
		if checkTime.Before(snapshot.expiresAt) {
			snapshot.lastAccess = checkTime
			s.routingBases[key] = snapshot
			values := snapshot.values
			s.candidateMu.Unlock()
			return routingBaseLoadResult{values: values, version: checkVersion}, nil
		}
		if checkTime.Before(snapshot.staleUntil) {
			stale, hasStale = snapshot, true
		}
	}
	s.candidateMu.Unlock()
	values, loadErr := layered.ListRoutingAccountBases(ctx, key.provider, key.quotaMode)
	if loadErr != nil {
		if !hasStale || !canUseStaleRoutingSnapshot(ctx, loadErr) {
			return nil, loadErr
		}
		s.retainStaleRoutingBaseSnapshot(key, &stale, checkTime)
		s.logStaleRoutingFallback("base", key.provider, checkTime, stale.staleUntil, loadErr)
		return routingBaseLoadResult{values: stale.values, version: checkVersion}, nil
	}
	s.cacheRoutingBases(key, checkVersion, values, checkTime)
	return routingBaseLoadResult{values: values, version: checkVersion}, nil
}

// retainStaleRoutingBaseSnapshot 延长过期基础层快照的有效期，使重试窗口内仍可降级服务。
func (s *Selector) retainStaleRoutingBaseSnapshot(key routingBaseCacheKey, stale *routingBaseSnapshot, checkTime time.Time) {
	s.candidateMu.Lock()
	defer s.candidateMu.Unlock()
	stale.lastAccess = checkTime
	stale.expiresAt = staleRetryExpiry(checkTime, stale.staleUntil)
	s.storeRoutingBaseSnapshotLocked(key, *stale, checkTime)
}

func (s *Selector) loadRoutingBases(ctx context.Context, layered repository.RoutingLayerRepository, provider account.Provider, quotaMode string, now time.Time) ([]account.RoutingAccountBase, routingLayerVersion, error) {
	key := routingBaseCacheKey{provider: provider, quotaMode: quotaMode}
	version := s.routingBaseVersion(provider)
	if values, ok := s.cachedRoutingBase(key, version, now); ok {
		return values, version, nil
	}
	loadKey := "base\x00" + string(provider) + "\x00" + quotaMode
	loaded, err, _ := s.candidateLoads.Do(loadKey, func() (any, error) {
		return s.loadRoutingBasesUncached(ctx, layered, key)
	})
	if err != nil {
		return nil, routingLayerVersion{}, err
	}
	result := loaded.(routingBaseLoadResult)
	return result.values, result.version, nil
}

// cachedRoutingOverlay 命中未过期且版本一致的覆盖层缓存时刷新访问时间并返回值。
func (s *Selector) cachedRoutingOverlay(key routingOverlayCacheKey, version routingLayerVersion, now time.Time) (account.RoutingOverlaySnapshot, bool) {
	s.candidateMu.Lock()
	defer s.candidateMu.Unlock()
	snapshot, ok := s.routingOverlays[key]
	if !ok || !now.Before(snapshot.expiresAt) || snapshot.version != version {
		return account.RoutingOverlaySnapshot{}, false
	}
	snapshot.lastAccess = now
	s.routingOverlays[key] = snapshot
	return snapshot.value, true
}

// loadRoutingOverlayUncached 在 singleflight 内重建覆盖层缓存，必要时回退到过期快照。
func (s *Selector) loadRoutingOverlayUncached(ctx context.Context, layered repository.RoutingLayerRepository, key routingOverlayCacheKey) (any, error) {
	checkTime := time.Now().UTC()
	checkVersion := s.routingOverlayVersion(key.provider)
	var stale routingOverlaySnapshot
	hasStale := false
	s.candidateMu.Lock()
	if snapshot, ok := s.routingOverlays[key]; ok && snapshot.version == checkVersion {
		if checkTime.Before(snapshot.expiresAt) {
			snapshot.lastAccess = checkTime
			s.routingOverlays[key] = snapshot
			value := snapshot.value
			s.candidateMu.Unlock()
			return routingOverlayLoadResult{value: value, version: checkVersion}, nil
		}
		if checkTime.Before(snapshot.staleUntil) {
			stale, hasStale = snapshot, true
		}
	}
	s.candidateMu.Unlock()
	value, loadErr := layered.ListRoutingAccountOverlays(ctx, key.provider, key.modelRouteID, key.upstreamModel)
	if loadErr != nil {
		if !hasStale || !canUseStaleRoutingSnapshot(ctx, loadErr) {
			return nil, loadErr
		}
		s.retainStaleRoutingOverlaySnapshot(key, &stale, checkTime)
		s.logStaleRoutingFallback("overlay", key.provider, checkTime, stale.staleUntil, loadErr)
		return routingOverlayLoadResult{value: stale.value, version: checkVersion}, nil
	}
	s.cacheRoutingOverlays(key, checkVersion, value, checkTime)
	return routingOverlayLoadResult{value: value, version: checkVersion}, nil
}

// cacheRoutingOverlays 在版本未变化时写入覆盖层缓存。
func (s *Selector) cacheRoutingOverlays(key routingOverlayCacheKey, checkVersion routingLayerVersion, value account.RoutingOverlaySnapshot, checkTime time.Time) {
	s.candidateMu.Lock()
	defer s.candidateMu.Unlock()
	if s.routingOverlayVersionLocked(key.provider) != checkVersion {
		return
	}
	s.storeRoutingOverlaySnapshotLocked(key, routingOverlaySnapshot{value: value, version: checkVersion, expiresAt: checkTime.Add(candidateCacheTTL)}, checkTime)
}

// retainStaleRoutingOverlaySnapshot 延长过期覆盖层快照的有效期，使重试窗口内仍可降级服务。
func (s *Selector) retainStaleRoutingOverlaySnapshot(key routingOverlayCacheKey, stale *routingOverlaySnapshot, checkTime time.Time) {
	s.candidateMu.Lock()
	defer s.candidateMu.Unlock()
	stale.lastAccess = checkTime
	stale.expiresAt = staleRetryExpiry(checkTime, stale.staleUntil)
	s.storeRoutingOverlaySnapshotLocked(key, *stale, checkTime)
}

func (s *Selector) loadRoutingOverlay(ctx context.Context, layered repository.RoutingLayerRepository, provider account.Provider, modelRouteID uint64, upstreamModel string, now time.Time) (account.RoutingOverlaySnapshot, routingLayerVersion, error) {
	key := routingOverlayCacheKey{provider: provider, modelRouteID: modelRouteID, upstreamModel: upstreamModel}
	version := s.routingOverlayVersion(provider)
	if value, ok := s.cachedRoutingOverlay(key, version, now); ok {
		return value, version, nil
	}
	loadKey := fmt.Sprintf("overlay\x00%s\x00%d\x00%s", provider, modelRouteID, upstreamModel)
	loaded, err, _ := s.candidateLoads.Do(loadKey, func() (any, error) {
		return s.loadRoutingOverlayUncached(ctx, layered, key)
	})
	if err != nil {
		return account.RoutingOverlaySnapshot{}, routingLayerVersion{}, err
	}
	result := loaded.(routingOverlayLoadResult)
	return result.value, result.version, nil
}
