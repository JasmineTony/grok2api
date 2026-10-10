package gateway

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// 候选快照与路由版本缓存：分层候选的读取、版本校验、陈旧快照回退与容量裁剪。
func (s *Selector) routingBaseVersion(provider account.Provider) routingLayerVersion {
	s.candidateMu.Lock()
	defer s.candidateMu.Unlock()
	return s.routingBaseVersionLocked(provider)
}

func (s *Selector) routingBaseVersionLocked(provider account.Provider) routingLayerVersion {
	return routingLayerVersion{global: s.baseGlobalVersion, provider: s.baseProviderVersion[provider]}
}

func (s *Selector) routingOverlayVersion(provider account.Provider) routingLayerVersion {
	s.candidateMu.Lock()
	defer s.candidateMu.Unlock()
	return s.routingOverlayVersionLocked(provider)
}

func (s *Selector) routingOverlayVersionLocked(provider account.Provider) routingLayerVersion {
	return routingLayerVersion{global: s.overlayGlobalVersion, provider: s.overlayProviderVersion[provider]}
}

func (s *Selector) routingVersionsStable(provider account.Provider, base, overlay routingLayerVersion) bool {
	s.candidateMu.Lock()
	defer s.candidateMu.Unlock()
	return base == s.routingBaseVersionLocked(provider) && overlay == s.routingOverlayVersionLocked(provider)
}

func (s *Selector) applyHealthInvalidation(event repository.InvalidationEvent) {
	updatedAt := event.PublishedAt.UTC()
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	expiresAt := updatedAt.Add(routingHealthOverrideTTL)
	if !time.Now().UTC().Before(expiresAt) {
		return
	}
	var cooldownUntil *time.Time
	if event.CooldownUntil != nil {
		value := event.CooldownUntil.UTC()
		cooldownUntil = &value
	}
	overrideLastError := account.NormalizeHealthMarker(event.HealthMarker)
	if overrideLastError == "" && (event.FailureCount > 0 || cooldownUntil != nil) {
		overrideLastError = "upstream failure"
	}
	value := routingHealthOverride{
		provider: event.Provider, failureCount: max(0, event.FailureCount), cooldownUntil: cooldownUntil,
		lastError: overrideLastError, updatedAt: updatedAt, revision: event.Revision, expiresAt: expiresAt,
	}
	s.healthMu.Lock()
	current, exists := s.healthOverrides[event.AccountID]
	if exists {
		if current.revision > 0 && value.revision > 0 && value.revision < current.revision {
			s.healthMu.Unlock()
			return
		}
		if (current.revision == 0 || value.revision == 0) && value.updatedAt.Before(current.updatedAt) {
			s.healthMu.Unlock()
			return
		}
	}
	s.healthOverrides[event.AccountID] = value
	s.healthMu.Unlock()
}

func (s *Selector) applyRoutingHealth(value account.Credential, now time.Time) account.Credential {
	s.healthMu.RLock()
	override, exists := s.healthOverrides[value.ID]
	s.healthMu.RUnlock()
	if !exists || override.provider != value.Provider {
		return value
	}
	if !now.Before(override.expiresAt) {
		s.healthMu.Lock()
		if current, ok := s.healthOverrides[value.ID]; ok && !now.Before(current.expiresAt) {
			delete(s.healthOverrides, value.ID)
		}
		s.healthMu.Unlock()
		return value
	}
	value.FailureCount = override.failureCount
	value.CooldownUntil = override.cooldownUntil
	value.LastError = override.lastError
	return value
}

func (s *Selector) routingHealthSnapshot(provider account.Provider, now time.Time) map[uint64]routingHealthOverride {
	var result map[uint64]routingHealthOverride
	expired := make([]uint64, 0)
	s.healthMu.RLock()
	for accountID, value := range s.healthOverrides {
		if !now.Before(value.expiresAt) {
			expired = append(expired, accountID)
			continue
		}
		if value.provider == provider {
			if result == nil {
				result = make(map[uint64]routingHealthOverride)
			}
			result[accountID] = value
		}
	}
	s.healthMu.RUnlock()
	if len(expired) > 0 {
		s.healthMu.Lock()
		for _, accountID := range expired {
			if value, ok := s.healthOverrides[accountID]; ok && !now.Before(value.expiresAt) {
				delete(s.healthOverrides, accountID)
			}
		}
		s.healthMu.Unlock()
	}
	return result
}

func applyHealthSnapshot(value account.Credential, overrides map[uint64]routingHealthOverride) account.Credential {
	if override, ok := overrides[value.ID]; ok && override.provider == value.Provider {
		value.FailureCount = override.failureCount
		value.CooldownUntil = override.cooldownUntil
		value.LastError = override.lastError
	}
	return value
}

func (s *Selector) clearHealthOverrides(provider account.Provider, accountID uint64) {
	s.healthMu.Lock()
	defer s.healthMu.Unlock()
	if accountID != 0 {
		delete(s.healthOverrides, accountID)
		return
	}
	if provider == "" {
		clear(s.healthOverrides)
		return
	}
	for id, value := range s.healthOverrides {
		if value.provider == provider {
			delete(s.healthOverrides, id)
		}
	}
}

// invalidationProvider 解析失效事件的作用 Provider；账号级事件回退到本地路由归属。
// 调用方必须已持有 candidateMu。
func (s *Selector) invalidationProvider(event repository.InvalidationEvent) account.Provider {
	if event.Provider != "" || event.AccountID == 0 {
		return event.Provider
	}
	if known := s.routingAccountProvider[event.AccountID]; known != "" {
		return known
	}
	for key, snapshot := range s.candidates {
		if _, ok := snapshot.byAccount[event.AccountID]; ok {
			return key.provider
		}
	}
	return ""
}

// invalidateBaseCandidates 推进基础层代际并清空对应候选，使后续请求重建缓存。
// 调用方必须已持有 candidateMu。
func (s *Selector) invalidateBaseCandidates(provider account.Provider) {
	s.clearQuotaConsumption(provider)
	if provider == "" {
		s.baseGlobalVersion++
		clearRoutingBases(s.routingBases, "")
		return
	}
	s.baseProviderVersion[provider]++
	clearRoutingBases(s.routingBases, provider)
}

// invalidateOverlayCandidates 推进覆盖层代际并清空对应候选。
// 调用方必须已持有 candidateMu。
func (s *Selector) invalidateOverlayCandidates(provider account.Provider) {
	if provider == "" {
		s.overlayGlobalVersion++
		clearRoutingOverlays(s.routingOverlays, "")
		return
	}
	s.overlayProviderVersion[provider]++
	clearRoutingOverlays(s.routingOverlays, provider)
}

// ApplyInvalidation advances local layer generations before any remote publish.
func (s *Selector) ApplyInvalidation(event repository.InvalidationEvent) {
	if !event.Valid() {
		return
	}
	if event.Kind == repository.InvalidationAccountHealthChanged {
		s.applyHealthInvalidation(event)
		return
	}
	s.clearHealthOverrides(event.Provider, event.AccountID)
	layer := event.Layer()
	if layer != repository.InvalidationLayerRoute && layer != repository.InvalidationLayerBase && layer != repository.InvalidationLayerOverlay {
		return
	}
	s.candidateMu.Lock()
	provider := s.invalidationProvider(event)
	if layer == repository.InvalidationLayerBase {
		s.invalidateBaseCandidates(provider)
	}
	if layer == repository.InvalidationLayerOverlay || layer == repository.InvalidationLayerRoute {
		s.invalidateOverlayCandidates(provider)
	}
	for key := range s.candidates {
		if provider == "" || key.provider == provider {
			delete(s.candidates, key)
		}
	}
	s.candidateMu.Unlock()
}

func clearRoutingBases(values map[routingBaseCacheKey]routingBaseSnapshot, provider account.Provider) {
	for key := range values {
		if provider == "" || key.provider == provider {
			delete(values, key)
		}
	}
}

func clearRoutingOverlays(values map[routingOverlayCacheKey]routingOverlaySnapshot, provider account.Provider) {
	for key := range values {
		if provider == "" || key.provider == provider {
			delete(values, key)
		}
	}
}

func cacheSnapshotAccess(lastAccess, expiresAt time.Time) time.Time {
	if !lastAccess.IsZero() {
		return lastAccess
	}
	return expiresAt
}

func staleRetryExpiry(now, staleUntil time.Time) time.Time {
	expiresAt := now.Add(candidateCacheRetryTTL)
	if !staleUntil.IsZero() && expiresAt.After(staleUntil) {
		return staleUntil
	}
	return expiresAt
}

// canUseStaleRoutingSnapshot deliberately accepts only errors that carry a
// transient signal. Serving stale data for cancellations, schema/query bugs,
// or repository validation failures would hide correctness problems.
func canUseStaleRoutingSnapshot(ctx context.Context, err error) bool {
	if err == nil || ctx != nil && ctx.Err() != nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	_, transient := transientRoutingStoreFailureClass(err)
	return transient
}

// transientRoutingStoreFailureClass 仅识别带有明确瞬态信号的存储错误，
// 同时返回不包含账号或错误正文的稳定分类，供单次选号的故障放大保护使用。
func transientRoutingStoreFailureClass(err error) (string, bool) {
	if err == nil || errors.Is(err, context.Canceled) {
		return "", false
	}
	if errors.Is(err, repository.ErrNotFound) || errors.Is(err, repository.ErrConflict) || errors.Is(err, repository.ErrLimitExceeded) || errors.Is(err, repository.ErrInvalidRecord) || errors.Is(err, repository.ErrAccountPoolMismatch) {
		return "", false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "deadline", true
	}
	if errors.Is(err, sql.ErrConnDone) || errors.Is(err, driver.ErrBadConn) {
		return "sql_connection", true
	}
	var networkError net.Error
	if errors.As(err, &networkError) && (networkError.Timeout() || networkError.Temporary()) {
		return fmt.Sprintf("network:%T", networkError), true
	}
	var temporary interface{ Temporary() bool }
	if errors.As(err, &temporary) && temporary.Temporary() {
		return fmt.Sprintf("temporary:%T", temporary), true
	}
	// modernc SQLite exposes the primary/extended result through Code().
	// SQLITE_BUSY (5) and SQLITE_LOCKED (6) are safe to retry.
	var sqliteError interface{ Code() int }
	if errors.As(err, &sqliteError) {
		primaryCode := sqliteError.Code() & 0xff
		switch primaryCode {
		case 5, 6:
			return fmt.Sprintf("sqlite:%d", primaryCode), true
		}
	}
	// pgx exposes SQLSTATE without requiring the application layer to depend on
	// a concrete PostgreSQL driver type.
	var postgresError interface{ SQLState() string }
	if errors.As(err, &postgresError) {
		state := postgresError.SQLState()
		switch {
		case strings.HasPrefix(state, "08"), strings.HasPrefix(state, "40"), state == "55P03", state == "57P01", state == "57P02", state == "57P03":
			return "postgres:" + state, true
		}
	}
	return "", false
}

func (s *Selector) logStaleRoutingFallback(layer string, provider account.Provider, now, staleUntil time.Time, err error) {
	key := layer + "\x00" + string(provider)
	s.staleLogMu.Lock()
	if s.staleFallbackLoggedAt == nil {
		s.staleFallbackLoggedAt = make(map[string]time.Time)
	}
	last := s.staleFallbackLoggedAt[key]
	if !last.IsZero() && now.Sub(last) < candidateCacheStaleLogInterval {
		s.staleLogMu.Unlock()
		return
	}
	s.staleFallbackLoggedAt[key] = now
	s.staleLogMu.Unlock()

	staleFor := now.Sub(staleUntil.Add(-candidateCacheStaleTTL))
	if staleFor < 0 {
		staleFor = 0
	}
	logger := s.logger
	if logger == nil {
		logger = slog.Default()
	}
	logger.Warn("routing_snapshot_stale_fallback",
		"provider", provider,
		"layer", layer,
		"stale_for_ms", staleFor.Milliseconds(),
		"retry_after_ms", candidateCacheRetryTTL.Milliseconds(),
		"error_type", fmt.Sprintf("%T", err),
	)
}

type snapshotCacheMetadata struct {
	values     int
	staleUntil time.Time
	accessedAt time.Time
}

func pruneSnapshotCache[K comparable, V any](values map[K]V, protected K, now time.Time, maxSnapshots, maxValues int, metadata func(V) snapshotCacheMetadata) {
	for key, value := range values {
		entry := metadata(value)
		if key != protected && !entry.staleUntil.IsZero() && !now.Before(entry.staleUntil) {
			delete(values, key)
		}
	}
	for {
		total := 0
		for _, value := range values {
			total += metadata(value).values
		}
		// A single oversized provider pool must remain usable. The budget becomes
		// a strict bound as soon as there is another evictable snapshot.
		if len(values) <= maxSnapshots && (total <= maxValues || len(values) == 1) {
			return
		}
		var oldestKey K
		var oldestAt time.Time
		found := false
		for key, value := range values {
			if key == protected {
				continue
			}
			accessedAt := metadata(value).accessedAt
			if !found || accessedAt.Before(oldestAt) {
				oldestKey, oldestAt, found = key, accessedAt, true
			}
		}
		if !found {
			return
		}
		delete(values, oldestKey)
	}
}

func (s *Selector) storeCandidateSnapshotLocked(key candidateCacheKey, snapshot candidateSnapshot, now time.Time) {
	snapshot.lastAccess = now
	if snapshot.staleUntil.IsZero() {
		snapshot.staleUntil = snapshot.expiresAt.Add(candidateCacheStaleTTL)
	}
	s.candidates[key] = snapshot
	pruneSnapshotCache(s.candidates, key, now, maxCandidateCacheSnapshots, maxCandidateCacheValues, func(value candidateSnapshot) snapshotCacheMetadata {
		return snapshotCacheMetadata{values: len(value.values), staleUntil: value.staleUntil, accessedAt: cacheSnapshotAccess(value.lastAccess, value.expiresAt)}
	})
}

func (s *Selector) storeRoutingBaseSnapshotLocked(key routingBaseCacheKey, snapshot routingBaseSnapshot, now time.Time) {
	snapshot.lastAccess = now
	if snapshot.staleUntil.IsZero() {
		snapshot.staleUntil = snapshot.expiresAt.Add(candidateCacheStaleTTL)
	}
	s.routingBases[key] = snapshot
	pruneSnapshotCache(s.routingBases, key, now, maxRoutingBaseSnapshots, maxRoutingBaseValues, func(value routingBaseSnapshot) snapshotCacheMetadata {
		return snapshotCacheMetadata{values: len(value.values), staleUntil: value.staleUntil, accessedAt: cacheSnapshotAccess(value.lastAccess, value.expiresAt)}
	})
}

func (s *Selector) storeRoutingOverlaySnapshotLocked(key routingOverlayCacheKey, snapshot routingOverlaySnapshot, now time.Time) {
	snapshot.lastAccess = now
	if snapshot.staleUntil.IsZero() {
		snapshot.staleUntil = snapshot.expiresAt.Add(candidateCacheStaleTTL)
	}
	s.routingOverlays[key] = snapshot
	pruneSnapshotCache(s.routingOverlays, key, now, maxRoutingOverlaySnapshots, maxRoutingOverlayValues, func(value routingOverlaySnapshot) snapshotCacheMetadata {
		return snapshotCacheMetadata{values: len(value.value.Values), staleUntil: value.staleUntil, accessedAt: cacheSnapshotAccess(value.lastAccess, value.expiresAt)}
	})
}

type routingBaseLoadResult struct {
	values  []account.RoutingAccountBase
	version routingLayerVersion
}

type routingOverlayLoadResult struct {
	value   account.RoutingOverlaySnapshot
	version routingLayerVersion
}

func assembleRoutingCandidates(provider account.Provider, quotaMode string, bases []account.RoutingAccountBase, overlay account.RoutingOverlaySnapshot) []account.RoutingCandidate {
	byAccount := make(map[uint64]account.RoutingAccountOverlay, len(overlay.Values))
	for _, value := range overlay.Values {
		byAccount[value.AccountID] = value
	}
	sharedSuperBuildModel := false
	if provider == account.ProviderBuild && !overlay.HasBindings {
		for _, base := range bases {
			value, exists := byAccount[base.Credential.ID]
			if exists && value.SupportsModel && account.IsBuildSuper(base.Credential, base.Billing) {
				sharedSuperBuildModel = true
				break
			}
		}
	}
	result := make([]account.RoutingCandidate, 0, len(bases))
	staticProviderModel := (provider == account.ProviderConsole && strings.TrimSpace(quotaMode) != "") ||
		(provider == account.ProviderWeb && account.IsWebImagineQuotaMode(quotaMode))
	for _, base := range bases {
		overlayValue := byAccount[base.Credential.ID]
		if overlay.HasBindings && !overlayValue.Bound {
			continue
		}
		known, supports := overlayValue.ModelCapabilityKnown, overlayValue.SupportsModel
		if staticProviderModel {
			known, supports = true, true
		} else if overlay.HasBindings {
			known, supports = true, true
		} else if sharedSuperBuildModel && account.IsBuildSuper(base.Credential, base.Billing) {
			known, supports = true, true
		}
		result = append(result, account.RoutingCandidate{
			Credential: base.Credential, Billing: base.Billing, QuotaWindow: base.QuotaWindow, QuotaRecovery: base.QuotaRecovery,
			EgressLeaseBlock: base.EgressLeaseBlock, ModelQuotaBlock: overlayValue.ModelQuotaBlock, ModelCapabilityKnown: known, SupportsModel: supports,
		})
	}
	return result
}

func (s *Selector) invalidateCandidates(provider account.Provider) {
	s.ApplyInvalidation(repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged, Provider: provider})
	s.ApplyInvalidation(repository.InvalidationEvent{Kind: repository.InvalidationAccountCapabilityChanged, Provider: provider})
}

// evictCandidate 从当前进程的候选快照中移除一个账号。持久化状态仍由调用方先写入；
// 下一个缓存周期会以数据库中的新状态重新加载该账号，不会因单账号变化清空整个 Provider。
func (s *Selector) evictCandidate(provider account.Provider, accountID uint64) {
	if accountID == 0 {
		return
	}
	s.candidateMu.Lock()
	defer s.candidateMu.Unlock()
	for key, snapshot := range s.candidates {
		if key.provider != provider {
			continue
		}
		// 候选快照会被并发请求的 selectionSession 只读复用；必须 copy-on-write，
		// 不能复用底层数组，否则会改写正在执行的请求视图。
		values := make([]account.RoutingCandidate, 0, len(snapshot.values))
		removed := false
		for _, candidate := range snapshot.values {
			if candidate.Credential.ID == accountID {
				removed = true
				continue
			}
			values = append(values, candidate)
		}
		if removed {
			// also update byAccount index if present
			if snapshot.byAccount != nil {
				byAccount := make(map[uint64]int, len(values))
				for idx, candidate := range values {
					byAccount[candidate.Credential.ID] = idx
				}
				snapshot.byAccount = byAccount
			}
			snapshot.values = values
			s.candidates[key] = snapshot
		}
	}
}

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

func (s *Selector) resolveTierOrder(provider account.Provider, upstreamModel, quotaMode string) []account.WebTier {
	if s.tierOrders == nil {
		return nil
	}
	if resolver, ok := s.tierOrders.(interface {
		TierOrderForQuotaMode(account.Provider, string, string) []account.WebTier
	}); ok {
		return resolver.TierOrderForQuotaMode(provider, upstreamModel, quotaMode)
	}
	return s.tierOrders.TierOrder(provider, upstreamModel)
}

func tierOrderRank(order []account.WebTier, tier account.WebTier) int {
	tier = normalizedRoutingWebTier(tier)
	for index, value := range order {
		if value == tier {
			return index
		}
	}
	return len(order)
}

func normalizedRoutingWebTier(tier account.WebTier) account.WebTier {
	if tier == "" || tier == account.WebTierAuto {
		return account.WebTierBasic
	}
	return tier
}

func webTierInOrder(order []account.WebTier, tier account.WebTier) bool {
	tier = normalizedRoutingWebTier(tier)
	for _, allowed := range order {
		if allowed == tier {
			return true
		}
	}
	return false
}
