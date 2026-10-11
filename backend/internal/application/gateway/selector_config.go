package gateway

import (
	"context"
	"sync"
	"time"

	account "github.com/chenyme/grok2api/backend/internal/domain/account"
	resultcache "github.com/chenyme/grok2api/backend/internal/pkg/resultcache"
	repository "github.com/chenyme/grok2api/backend/internal/repository"
	singleflight "golang.org/x/sync/singleflight"
	slog "log/slog"
)

// Selector 实现可替换的 balanced 账号选择策略。
type Selector struct {
	accounts               repository.AccountRepository
	concurrency            repository.ConcurrencyLimiter
	sticky                 repository.StickySessionRepository
	stickyTTL              time.Duration
	cooldownBase           time.Duration
	cooldownMax            time.Duration
	capacityWait           time.Duration
	preferFreeBuild        bool
	excludeBuildBotFlagged bool
	segmentedConfig        segmentedSelectorConfig
	segmentedState         segmentedSelectorState
	configMu               sync.RWMutex
	candidateMu            sync.Mutex
	selectionMu            sync.RWMutex
	healthMu               sync.RWMutex
	quotaMu                sync.RWMutex
	staleLogMu             sync.Mutex
	logger                 *slog.Logger
	leaseWakeMu            sync.Mutex
	leaseWake              chan struct{}
	lastSelectedAt         map[uint64]time.Time
	lastSuccessAt          map[uint64]time.Time
	healthOverrides        map[uint64]routingHealthOverride
	quotaConsumed          map[quotaConsumptionKey]int
	staleFallbackLoggedAt  map[string]time.Time
	candidates             map[candidateCacheKey]candidateSnapshot
	routingBases           map[routingBaseCacheKey]routingBaseSnapshot
	routingOverlays        map[routingOverlayCacheKey]routingOverlaySnapshot
	routingAccountProvider map[uint64]account.Provider
	baseGlobalVersion      uint64
	overlayGlobalVersion   uint64
	baseProviderVersion    map[account.Provider]uint64
	overlayProviderVersion map[account.Provider]uint64
	candidateLoads         singleflight.Group
	concurrencySnapshots   *resultcache.Cache[[32]byte, map[string]int]
	tierOrders             interface {
		TierOrder(account.Provider, string) []account.WebTier
	}
}

func NewSelector(accounts repository.AccountRepository, concurrency repository.ConcurrencyLimiter, sticky repository.StickySessionRepository, tierOrders interface {
	TierOrder(account.Provider, string) []account.WebTier
}, stickyTTL, cooldownBase, cooldownMax time.Duration, capacityWait ...time.Duration) *Selector {
	wait := time.Duration(0)
	if len(capacityWait) > 0 && capacityWait[0] > 0 {
		wait = capacityWait[0]
	}
	return &Selector{accounts: accounts, concurrency: concurrency, sticky: sticky, tierOrders: tierOrders, stickyTTL: stickyTTL, cooldownBase: cooldownBase, cooldownMax: cooldownMax, capacityWait: wait, leaseWake: make(chan struct{}), logger: slog.Default(), lastSelectedAt: make(map[uint64]time.Time), lastSuccessAt: make(map[uint64]time.Time), healthOverrides: make(map[uint64]routingHealthOverride), quotaConsumed: make(map[quotaConsumptionKey]int), staleFallbackLoggedAt: make(map[string]time.Time), candidates: make(map[candidateCacheKey]candidateSnapshot), routingBases: make(map[routingBaseCacheKey]routingBaseSnapshot), routingOverlays: make(map[routingOverlayCacheKey]routingOverlaySnapshot), routingAccountProvider: make(map[uint64]account.Provider), baseProviderVersion: make(map[account.Provider]uint64), overlayProviderVersion: make(map[account.Provider]uint64), concurrencySnapshots: resultcache.New[[32]byte, map[string]int](maxConcurrencySnapshots, concurrencySnapshotTTL)}
}

// SetLogger wires the application logger into routing degradation diagnostics.
// It is intended to be called during startup before the selector serves traffic.
func (s *Selector) SetLogger(logger *slog.Logger) {
	if logger != nil {
		s.logger = logger
	}
}

func (s *Selector) UpdateConfig(stickyTTL, cooldownBase, cooldownMax time.Duration, capacityWait ...time.Duration) {
	s.configMu.Lock()
	s.stickyTTL = stickyTTL
	s.cooldownBase = cooldownBase
	s.cooldownMax = cooldownMax
	if len(capacityWait) > 0 {
		s.capacityWait = max(time.Duration(0), capacityWait[0])
	}
	s.configMu.Unlock()
}

// UpdatePreferFreeBuild 热更新 Build Free 账号优先策略。
func (s *Selector) UpdatePreferFreeBuild(value bool) {
	s.configMu.Lock()
	s.preferFreeBuild = value
	s.configMu.Unlock()
}

// UpdateSegmentedSelector changes the large-pool bounded planner policy.
func (s *Selector) UpdateSegmentedSelector(enabled bool, minCandidates, windowSize int) {
	s.configMu.Lock()
	s.segmentedConfig = normalizeSegmentedSelectorConfig(segmentedSelectorConfig{
		enabled: enabled, minCandidates: minCandidates, windowSize: windowSize,
	})
	s.configMu.Unlock()
}

func (s *Selector) routingConfig() (time.Duration, time.Duration, time.Duration, time.Duration) {
	s.configMu.RLock()
	defer s.configMu.RUnlock()
	return s.stickyTTL, s.cooldownBase, s.cooldownMax, s.capacityWait
}

// UpdateExcludeBuildBotFlaggedFromScheduling toggles Build bot-risk exclusion from
// scheduling and invalidates Build candidate caches when the value changes.
func (s *Selector) UpdateExcludeBuildBotFlaggedFromScheduling(value bool) {
	s.configMu.Lock()
	changed := s.excludeBuildBotFlagged != value
	s.excludeBuildBotFlagged = value
	s.configMu.Unlock()
	if changed {
		s.invalidateProviderCandidateCache(account.ProviderBuild)
	}
}

func (s *Selector) preferFreeBuildEnabled() bool {
	s.configMu.RLock()
	defer s.configMu.RUnlock()
	return s.preferFreeBuild
}

func (s *Selector) excludeBuildBotFlaggedEnabled() bool {
	s.configMu.RLock()
	defer s.configMu.RUnlock()
	return s.excludeBuildBotFlagged
}

func (s *Selector) invalidateProviderCandidateCache(provider account.Provider) {
	s.candidateMu.Lock()
	defer s.candidateMu.Unlock()
	for key := range s.candidates {
		if key.provider == provider {
			delete(s.candidates, key)
		}
	}
	clearRoutingBases(s.routingBases, provider)
	clearRoutingOverlays(s.routingOverlays, provider)
	if provider != "" {
		s.baseProviderVersion[provider]++
		s.overlayProviderVersion[provider]++
	}
}

func (s *Selector) maybeFilterBotFlagged(ctx context.Context, provider account.Provider, values []account.RoutingCandidate, includeBotFlagged bool) ([]account.RoutingCandidate, error) {
	if includeBotFlagged {
		return values, nil
	}
	return s.applyBuildBotFlaggedFilter(ctx, provider, values)
}

func (s *Selector) applyBuildBotFlaggedFilter(_ context.Context, provider account.Provider, values []account.RoutingCandidate) ([]account.RoutingCandidate, error) {
	if provider != account.ProviderBuild || len(values) == 0 {
		return values, nil
	}
	if !s.excludeBuildBotFlaggedEnabled() {
		return values, nil
	}
	filtered := make([]account.RoutingCandidate, 0, len(values))
	for _, candidate := range values {
		if source := candidate.Credential.BuildBotFlagSource; source == 1 || source == 2 {
			continue
		}
		filtered = append(filtered, candidate)
	}
	return filtered, nil
}
