package gateway

import (
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
