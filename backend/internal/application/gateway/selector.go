package gateway

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	"github.com/chenyme/grok2api/backend/internal/pkg/resultcache"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"golang.org/x/sync/singleflight"
)

type accountLease struct {
	Credential          account.Credential
	Billing             *account.Billing
	QuotaProbe          bool
	QuotaProbeKind      account.QuotaRecoveryKind
	QuotaMode           string
	routingCandidate    *account.RoutingCandidate
	selectorObservation *selectorLeaseObservation
	release             func()
}

const quotaProbeLease = 5 * time.Minute
const successPersistInterval = 30 * time.Second

// Routing writes publish precise invalidation events, so the TTL is only a
// safety net for out-of-process database changes and missed notifications.
// Keeping a one-second TTL made large pools rebuild continuously under load.
const candidateCacheTTL = 30 * time.Second
const candidateCacheStaleTTL = 5 * time.Minute
const candidateCacheRetryTTL = 5 * time.Second
const candidateCacheStaleLogInterval = time.Minute
const maxCandidateCacheSnapshots = 64
const maxCandidateCacheValues = 100_000
const maxRoutingBaseSnapshots = 8
const maxRoutingBaseValues = 150_000
const maxRoutingOverlaySnapshots = 64
const maxRoutingOverlayValues = 250_000
const concurrencySnapshotTTL = 25 * time.Millisecond
const maxConcurrencySnapshots = 256

// Health overrides bridge precise request-path mutations until the immutable
// provider snapshot naturally refreshes. Keep them through the snapshot's
// normal and stale lifetimes so a transient database error cannot resurrect a
// cooled account from an older snapshot.
const routingHealthOverrideTTL = candidateCacheTTL + candidateCacheStaleTTL

const modelAccessDeniedCooldown = 5 * time.Minute

// softNetworkCooldown 网络/超时/5xx 仅短暂隔离本号，避免指数冷却掏空热池。
const softNetworkCooldown = 5 * time.Second

const defaultFreeQuotaRecoveryPause = 24 * time.Hour

var errRoutingCredentialStale = errors.New("routing credential is no longer available")

// credentialMaterialFailureSkipLimit 限制一次选号连续跳过的同类瞬态故障。
// 少量失败仍按单号隔离；超过上限时保留原始存储错误，避免大账号池放大系统性故障。
const credentialMaterialFailureSkipLimit = 8

type credentialMaterialFailureTracker struct {
	class string
	count int
}

func (tracker *credentialMaterialFailureTracker) record(class string) (int, bool) {
	if tracker == nil {
		return 1, true
	}
	if tracker.class != class {
		tracker.class = class
		tracker.count = 0
	}
	tracker.count++
	return tracker.count, tracker.count <= credentialMaterialFailureSkipLimit
}

func (tracker *credentialMaterialFailureTracker) reset() {
	if tracker == nil {
		return
	}
	tracker.class = ""
	tracker.count = 0
}

// skipUnusableCredentialMaterial 只把账号缺失或明确的瞬态存储故障转成可跳过的过期 claim。
// 请求取消、永久错误和无法分类的错误保留根因返回，不能伪装成整池无可用账号。
func (s *Selector) skipUnusableCredentialMaterial(ctx context.Context, value account.Credential, loadErr error, tracker *credentialMaterialFailureTracker) error {
	if ctx != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(loadErr, repository.ErrNotFound) {
		tracker.reset()
		s.ApplyInvalidation(repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged, Provider: value.Provider, AccountID: value.ID})
		return errRoutingCredentialStale
	}
	failureClass, transient := transientRoutingStoreFailureClass(loadErr)
	if !transient {
		return fmt.Errorf("加载账号 %d 的凭据材料: %w", value.ID, loadErr)
	}
	consecutiveFailures, allowed := tracker.record(failureClass)
	if !allowed {
		return fmt.Errorf("连续加载账号凭据材料失败（%s，%d 次）: %w", failureClass, consecutiveFailures, loadErr)
	}
	if s.logger != nil {
		s.logger.Warn(
			"routing_credential_material_skipped",
			"account_id", value.ID,
			"provider", value.Provider,
			"failure_class", failureClass,
			"consecutive_failures", consecutiveFailures,
			"error", loadErr,
		)
	}
	return errRoutingCredentialStale
}

type quotaRecoveryHints struct {
	Billing *account.Billing
}

type quotaConsumptionKey struct {
	provider  account.Provider
	accountID uint64
	mode      string
}

type accountQuotaConsumptionKey struct {
	accountID uint64
	mode      string
}

type routingHealthOverride struct {
	provider      account.Provider
	failureCount  int
	cooldownUntil *time.Time
	lastError     string
	updatedAt     time.Time
	revision      uint64
	expiresAt     time.Time
}

type candidateSnapshot struct {
	values     []account.RoutingCandidate
	byAccount  map[uint64]int
	expiresAt  time.Time
	staleUntil time.Time
	lastAccess time.Time
}

func newCandidateSnapshot(values []account.RoutingCandidate, expiresAt time.Time) candidateSnapshot {
	byAccount := make(map[uint64]int, len(values))
	for index, value := range values {
		if _, exists := byAccount[value.Credential.ID]; !exists {
			byAccount[value.Credential.ID] = index
		}
	}
	now := time.Now().UTC()
	return candidateSnapshot{values: values, byAccount: byAccount, expiresAt: expiresAt, staleUntil: expiresAt.Add(candidateCacheStaleTTL), lastAccess: now}
}

type candidateCacheKey struct {
	provider          account.Provider
	modelRouteID      uint64
	upstreamModel     string
	quotaMode         string
	includeBotFlagged bool
}

type routingBaseCacheKey struct {
	provider  account.Provider
	quotaMode string
}

type routingOverlayCacheKey struct {
	provider      account.Provider
	modelRouteID  uint64
	upstreamModel string
}

type routingLayerVersion struct {
	global   uint64
	provider uint64
}

type routingBaseSnapshot struct {
	values     []account.RoutingAccountBase
	version    routingLayerVersion
	expiresAt  time.Time
	staleUntil time.Time
	lastAccess time.Time
}

type routingOverlaySnapshot struct {
	value      account.RoutingOverlaySnapshot
	version    routingLayerVersion
	expiresAt  time.Time
	staleUntil time.Time
	lastAccess time.Time
}

type SelectionUnavailableReason string

const (
	SelectionNoAccounts        SelectionUnavailableReason = "no_accounts"
	SelectionUnsupportedModel  SelectionUnavailableReason = "unsupported_model"
	SelectionCooling           SelectionUnavailableReason = "cooling"
	SelectionModelCooling      SelectionUnavailableReason = "model_cooling"
	SelectionQuotaExhausted    SelectionUnavailableReason = "quota_exhausted"
	SelectionSaturated         SelectionUnavailableReason = "saturated"
	SelectionPinnedUnavailable SelectionUnavailableReason = "pinned_unavailable"
)

// SelectionUnavailableError 保留选号失败的真实原因，避免所有情况都退化成模糊的 503。
type SelectionUnavailableError struct {
	Reason      SelectionUnavailableReason
	RetryAfter  time.Duration
	Scope       clientkeydomain.AccountScope
	AccountID   uint64
	AccountName string
}

func (e *SelectionUnavailableError) Error() string {
	if e == nil {
		return "没有可用上游账号"
	}
	prefix := ""
	if e.Scope.IsRestricted() {
		prefix = "Client Key 限定范围"
	}
	switch e.Reason {
	case SelectionUnsupportedModel:
		if prefix != "" {
			return prefix + "不支持该模型"
		}
		return "当前账号池不支持该模型"
	case SelectionCooling:
		if prefix != "" {
			return prefix + "中的可用账号正在冷却"
		}
		return "可用上游账号正在冷却"
	case SelectionModelCooling:
		if prefix != "" {
			return prefix + "中可用账号的目标模型正在冷却"
		}
		return "可用上游账号的目标模型正在冷却"
	case SelectionQuotaExhausted:
		if prefix != "" {
			return prefix + "中的可用账号额度等待恢复"
		}
		return "可用上游账号额度等待恢复"
	case SelectionSaturated:
		if prefix != "" {
			return prefix + "中的可用账号均达到并发上限"
		}
		return "可用上游账号均达到并发上限"
	case SelectionPinnedUnavailable:
		if prefix != "" {
			return prefix + "中绑定的上游账号当前不可用"
		}
		return "绑定的上游账号当前不可用"
	default:
		if prefix != "" {
			return prefix + "当前没有可用上游账号"
		}
		return "没有可用上游账号"
	}
}

// HTTPStatus returns the client-facing status for a routing refusal.
func (e *SelectionUnavailableError) HTTPStatus() int {
	if e != nil {
		switch e.Reason {
		case SelectionCooling, SelectionModelCooling, SelectionQuotaExhausted:
			return http.StatusTooManyRequests
		}
	}
	return http.StatusServiceUnavailable
}

// Code returns the stable diagnostic code for a routing refusal.
func (e *SelectionUnavailableError) Code() string {
	if e != nil {
		switch e.Reason {
		case SelectionCooling:
			return "upstream_cooling"
		case SelectionModelCooling:
			return "upstream_model_cooling"
		case SelectionQuotaExhausted:
			return "upstream_quota_exhausted"
		case SelectionSaturated:
			return "upstream_saturated"
		case SelectionUnsupportedModel:
			return "upstream_model_unavailable"
		case SelectionPinnedUnavailable:
			return "upstream_pinned_account_unavailable"
		case SelectionNoAccounts:
			if e.Scope.IsRestricted() {
				return "client_key_account_scope_unavailable"
			}
		}
	}
	return "upstream_unavailable"
}

func (l *accountLease) Release() {
	if l == nil {
		return
	}
	if l.selectorObservation != nil {
		l.selectorObservation.completeRelease()
	}
	if l.release != nil {
		l.release()
		l.release = nil
	}
}

func (l *accountLease) markSelectorUpstreamStarted() {
	if l != nil && l.selectorObservation != nil {
		l.selectorObservation.upstreamStarted.Store(true)
	}
}

func (l *accountLease) completeSelectorObservation(success bool) {
	if l != nil && l.selectorObservation != nil {
		l.selectorObservation.complete(success)
	}
}

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
	quotaConsumed := s.quotaConsumptionSnapshot(provider)
	healthOverrides := s.routingHealthSnapshot(provider, now)
	// 仅保留候选下标，避免每个请求复制包含凭据、计费和额度结构的完整账号切片。
	normalCandidates := make([]int, 0, len(values))
	probeCandidates := make([]int, 0, len(values))
	supportedCandidates := 0
	consideredCandidates := 0
	coolingCandidates := 0
	modelCoolingCandidates := 0
	quotaCandidates := 0
	var earliestRetry time.Time
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
		consideredCandidates++
		if !s.candidateSupportsModel(provider, upstreamModel, quotaMode, candidate) {
			continue
		}
		supportedCandidates++
		if candidate.ModelQuotaBlock != nil && now.Before(candidate.ModelQuotaBlock.CooldownUntil) {
			modelCoolingCandidates++
			earliestRetry = earlierFuture(earliestRetry, candidate.ModelQuotaBlock.CooldownUntil, now)
			continue
		}
		if candidateEgressLeaseCooling(candidate, value, now) {
			coolingCandidates++
			earliestRetry = earlierFuture(earliestRetry, candidate.EgressLeaseBlock.CooldownUntil, now)
			continue
		}
		if value.CooldownUntil != nil && now.Before(*value.CooldownUntil) {
			coolingCandidates++
			earliestRetry = earlierFuture(earliestRetry, *value.CooldownUntil, now)
			continue
		}
		quotaRecovery := candidate.QuotaRecovery
		if quotaRecovery != nil && quotaRecovery.Status != account.QuotaRecoveryStatusActive {
			if allowQuotaProbe && quotaRecovery.NextProbeAt != nil && !now.Before(*quotaRecovery.NextProbeAt) {
				probeCandidates = append(probeCandidates, index)
			} else {
				quotaCandidates++
				if quotaRecovery.NextProbeAt != nil {
					earliestRetry = earlierFuture(earliestRetry, *quotaRecovery.NextProbeAt, now)
				}
			}
			continue
		}
		if candidate.Billing != nil && candidate.Billing.IsExhausted(value.MinimumRemaining) {
			quotaCandidates++
			continue
		}
		if quotaWindowExhausted(candidate, quotaConsumed) {
			quotaCandidates++
			if candidate.QuotaWindow.ResetAt != nil {
				earliestRetry = earlierFuture(earliestRetry, *candidate.QuotaWindow.ResetAt, now)
			}
			continue
		}
		normalCandidates = append(normalCandidates, index)
	}
	materialFailures := credentialMaterialFailureTracker{}
	if len(normalCandidates) == 0 && len(probeCandidates) == 0 {
		reason := SelectionNoAccounts
		switch {
		case consideredCandidates > 0 && supportedCandidates == 0:
			reason = SelectionUnsupportedModel
		case modelCoolingCandidates > 0:
			reason = SelectionModelCooling
		case coolingCandidates > 0:
			reason = SelectionCooling
		case quotaCandidates > 0:
			reason = SelectionQuotaExhausted
		}
		return nil, &SelectionUnavailableError{Reason: reason, RetryAfter: retryDelay(now, earliestRetry)}
	}
	if len(probeCandidates) > 0 {
		staleClaims := 0
		capacityMisses := 0
		plan, err := s.planCandidateIndexes(ctx, values, probeCandidates, now, s.resolveTierOrder(provider, upstreamModel, quotaMode))
		if err != nil {
			return nil, err
		}
		for candidate, ok := plan.Next(); ok; candidate, ok = plan.Next() {
			lease, err := s.claimAccountSlotTracked(ctx, candidate.Credential, &materialFailures)
			if err != nil {
				if errors.Is(err, errRoutingCredentialStale) {
					staleClaims++
					continue
				}
				return nil, err
			}
			if lease == nil {
				capacityMisses++
				continue
			}
			claimed, err := s.accounts.ClaimQuotaProbe(ctx, candidate.Credential.ID, now, now.Add(quotaProbeLease))
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
		if len(normalCandidates) == 0 && staleClaims > 0 && capacityMisses == 0 {
			return nil, &SelectionUnavailableError{Reason: SelectionNoAccounts}
		}
	}
	var saturatedStickyID uint64
	if stickyKey != "" {
		stickyID, ok, err := s.sticky.Get(ctx, stickyKey, now)
		if err != nil {
			return nil, fmt.Errorf("读取会话粘滞状态: %w", err)
		}
		if ok {
			candidate, eligible := routingCandidateByID(values, normalCandidates, stickyID)
			if eligible {
				stickyTTL, _, _, _ := s.routingConfig()
				boundID, bindErr := s.sticky.Bind(ctx, stickyKey, stickyID, now, now.Add(stickyTTL))
				if bindErr != nil {
					return nil, fmt.Errorf("刷新会话粘滞状态: %w", bindErr)
				}
				if boundID != stickyID {
					candidate, eligible = routingCandidateByID(values, normalCandidates, boundID)
					stickyID = boundID
				}
				if eligible {
					lease, acquireErr := s.acquirePinnedCapacity(ctx, candidate.Credential, &materialFailures)
					if acquireErr == nil {
						lease.Billing = candidate.Billing
						lease.QuotaMode = effectiveQuotaMode(candidate, quotaMode)
						return lease, nil
					}
					if errors.Is(acquireErr, errRoutingCredentialStale) {
						_ = s.sticky.DeleteByAccount(ctx, stickyID)
					} else if !isSelectionUnavailable(acquireErr, SelectionSaturated) {
						return nil, acquireErr
					} else {
						saturatedStickyID = stickyID
					}
				}
			}
		}
	}
	// 粘性账号仅因并发满载而暂时不可用时，先等待该账号；超时后允许本次请求临时借用
	// 其他账号，但不覆盖原绑定，避免并行请求让活跃会话在账号池中来回抖动。
	if saturatedStickyID != 0 {
		plan, err := s.planCandidateIndexes(ctx, values, normalCandidates, time.Now().UTC(), s.resolveTierOrder(provider, upstreamModel, quotaMode))
		if err != nil {
			return nil, err
		}
		for candidate, ok := plan.Next(); ok; candidate, ok = plan.Next() {
			if candidate.Credential.ID == saturatedStickyID {
				continue
			}
			lease, claimErr := s.claimAccountSlotTracked(ctx, candidate.Credential, &materialFailures)
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
	activeRequest := s.nextSegmentedActiveRequest(provider, upstreamModel, quotaMode, len(normalCandidates))
	if activeRequest != nil {
		lease, acquireErr := s.acquireSegmentedCandidates(ctx, values, normalCandidates, quotaMode, s.resolveTierOrder(provider, upstreamModel, quotaMode), *activeRequest, &materialFailures)
		if acquireErr != nil || lease == nil || stickyKey == "" {
			return lease, acquireErr
		}
		if lease.routingCandidate == nil {
			lease.Release()
			return nil, errors.New("分段选号缺少候选上下文")
		}
		return s.completeStickyLease(ctx, stickyKey, values, normalCandidates, *lease.routingCandidate, lease, quotaMode, &materialFailures)
	}
	_, _, _, capacityWait := s.routingConfig()
	waitDeadline := time.Now().Add(capacityWait)
	for {
		currentTime := time.Now().UTC()
		staleClaims := 0
		capacityMisses := 0
		plan, err := s.planCandidateIndexes(ctx, values, normalCandidates, currentTime, s.resolveTierOrder(provider, upstreamModel, quotaMode))
		if err != nil {
			return nil, err
		}
		for candidate, ok := plan.Next(); ok; candidate, ok = plan.Next() {
			lease, err := s.claimAccountSlotTracked(ctx, candidate.Credential, &materialFailures)
			if err != nil {
				if errors.Is(err, errRoutingCredentialStale) {
					staleClaims++
					continue
				}
				return nil, err
			}
			if lease == nil {
				capacityMisses++
				continue
			}
			return s.completeStickyLease(ctx, stickyKey, values, normalCandidates, candidate, lease, quotaMode, &materialFailures)
		}
		if staleClaims > 0 && capacityMisses == 0 {
			return nil, &SelectionUnavailableError{Reason: SelectionNoAccounts}
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
