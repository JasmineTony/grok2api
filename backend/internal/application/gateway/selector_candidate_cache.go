package gateway

import (
	"context"
	"fmt"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

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
