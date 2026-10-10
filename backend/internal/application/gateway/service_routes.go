package gateway

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"sort"
	"strconv"
	"strings"

	clientkeyapp "github.com/chenyme/grok2api/backend/internal/application/clientkey"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	inferencedomain "github.com/chenyme/grok2api/backend/internal/domain/inference"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// 路由解析与候选选择：把公开模型名解析为可路由目标，并按账号范围、状态化 Response
// 归属、媒体能力与代理支持筛选候选。此文件不获取账号租约，也不发起上游调用。

// resolvePublicModelRoutes supports both unprefixed downstream model names and explicitly sourced compatibility names.
// Registered Provider aliases are stable compatibility contracts. allowModelAliases gates only dynamically generated
// reasoning-effort aliases so existing clients keep working after the per-key discovery switch is introduced.
func (s *Service) resolvePublicModelRoutes(ctx context.Context, publicModel string, allowModelAliases bool) ([]modeldomain.Route, string, error) {
	routes, err := s.models.GetByPublicIDCandidates(ctx, publicModel)
	if err == nil {
		return routes, "", nil
	}
	if s.providers != nil {
		if alias, ok := s.providers.ResolveModelAlias(publicModel); ok {
			if alias.Provider != "" && alias.UpstreamModel != "" {
				route, routeErr := s.models.GetByProviderUpstream(ctx, alias.Provider, alias.UpstreamModel)
				if routeErr != nil {
					return nil, "", routeErr
				}
				return []modeldomain.Route{route}, alias.ReasoningEffort, nil
			}
			routes, resolveErr := s.models.GetByPublicIDCandidates(ctx, alias.PublicModel)
			return routes, alias.ReasoningEffort, resolveErr
		}
	}
	// Dynamic effort-suffix aliases (e.g. grok-4.5-low) for any Provider that
	// exposes the base model. Fixed-reasoning Providers may compatibility-accept
	// an alias while their wire normalizer drops the unsupported effort.
	if base, effort, ok := modeldomain.ParseReasoningModelAlias(publicModel); ok {
		if !allowModelAliases {
			return nil, "", err
		}
		routes, resolveErr := s.models.GetByPublicIDCandidates(ctx, base)
		if resolveErr != nil {
			return nil, "", resolveErr
		}
		eligible := make([]modeldomain.Route, 0, len(routes))
		for _, route := range routes {
			if modeldomain.SupportsReasoningEffortForProvider(route.Provider, route.PublicID, effort) ||
				modeldomain.IsFixedReasoningForProvider(route.Provider, route.PublicID) {
				eligible = append(eligible, route)
			}
		}
		if len(eligible) == 0 {
			return nil, "", repository.ErrNotFound
		}
		return eligible, effort, nil
	}
	return nil, "", err
}

// conversationRouteSelection 汇总同名目标筛选的命中标记，用于区分失败原因并保留代表目标。
type conversationRouteSelection struct {
	eligible                  []modeldomain.Route
	fallback                  modeldomain.Route
	accountScope              clientkey.AccountScope
	matchedOwnership          bool
	scopeMatched              bool
	allowed                   bool
	storedResponseUnsupported bool
}

// conversationRouteFilter 固定一次请求的筛选条件。
type conversationRouteFilter struct {
	key                   clientkey.Key
	operation             audit.Operation
	path                  string
	requireStoredResponse bool
	ownership             *inferencedomain.ResponseOwnership
}

// reason 返回全部候选被筛掉时的失败原因。会话能力不足与 compact 不支持使用同一错误，
// 因此无需再区分二者。
func (selection conversationRouteSelection) reason() error {
	switch {
	case !selection.matchedOwnership:
		return ErrResponseAccountUnavailable
	case !selection.scopeMatched:
		return &SelectionUnavailableError{Reason: SelectionNoAccounts, Scope: selection.accountScope}
	case !selection.allowed:
		return clientkeyapp.ErrModelNotAllowed
	case selection.storedResponseUnsupported:
		return ErrResponseStateUnsupported
	default:
		return ErrConversationUnsupported
	}
}

// admitConversationRoute 按归属、账号范围、模型权限、会话能力与状态化存储支持判断单个候选。
func (s *Service) admitConversationRoute(selection *conversationRouteSelection, filter conversationRouteFilter, route modeldomain.Route) {
	if filter.ownership != nil {
		if filter.ownership.ModelRouteID != 0 {
			if route.ID != filter.ownership.ModelRouteID {
				return
			}
		} else if route.Provider != filter.ownership.Provider {
			// Backward compatibility for ownership rows created before route IDs
			// were persisted: retain the original Provider-scoped pin.
			return
		}
	}
	selection.matchedOwnership = true
	selection.fallback = route
	if !selection.accountScope.AllowsProvider(route.Provider) {
		return
	}
	selection.scopeMatched = true
	if !s.clientKeys.CanUseModel(filter.key, route.ID) {
		return
	}
	selection.allowed = true
	if !s.providers.SupportsConversation(route.Provider, string(filter.operation)) {
		return
	}
	if filter.path == "/responses/compact" && !s.providers.SupportsResponseCompaction(route.Provider) {
		return
	}
	if filter.requireStoredResponse && !s.providers.SupportsStoredResponses(route.Provider) {
		selection.storedResponseUnsupported = true
		return
	}
	selection.eligible = append(selection.eligible, route)
}

// eligibleConversationRoutes filters route targets without choosing one. Keeping
// this separate from ordering lets one public name form a schedulable target pool.
func (s *Service) eligibleConversationRoutes(routes []modeldomain.Route, key clientkey.Key, operation audit.Operation, path string, requireStoredResponse bool, ownership *inferencedomain.ResponseOwnership) ([]modeldomain.Route, modeldomain.Route, error) {
	if len(routes) == 0 || s.providers == nil {
		return nil, modeldomain.Route{}, ErrModelNotFound
	}
	filter := conversationRouteFilter{key: key, operation: operation, path: path, requireStoredResponse: requireStoredResponse, ownership: ownership}
	selection := conversationRouteSelection{
		eligible: make([]modeldomain.Route, 0, len(routes)), fallback: routes[0],
		accountScope: key.AccountScope(), matchedOwnership: ownership == nil,
	}
	for _, route := range routes {
		s.admitConversationRoute(&selection, filter, route)
	}
	if len(selection.eligible) > 0 {
		return selection.eligible, selection.fallback, nil
	}
	return nil, selection.fallback, selection.reason()
}

// selectConversationRoute retains the legacy single-target helper for callers
// that do not need target-pool ordering.
func (s *Service) selectConversationRoute(routes []modeldomain.Route, key clientkey.Key, operation audit.Operation, path string, requireStoredResponse bool, ownership *inferencedomain.ResponseOwnership) (modeldomain.Route, error) {
	eligible, fallback, err := s.eligibleConversationRoutes(routes, key, operation, path, requireStoredResponse, ownership)
	if err != nil {
		return fallback, err
	}
	return eligible[0], nil
}

// orderConversationRouteTargets randomizes targets within the same Provider by
// rendezvous score. Provider priority remains stable, while a session seed keeps
// Codex/Claude continuations on the same target without global mutable state.
func orderConversationRouteTargets(routes []modeldomain.Route, seed string) []modeldomain.Route {
	ordered := append([]modeldomain.Route(nil), routes...)
	sort.SliceStable(ordered, func(left, right int) bool {
		leftPriority := routeProviderPriority(ordered[left].Provider)
		rightPriority := routeProviderPriority(ordered[right].Provider)
		if leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		leftScore := routeTargetScore(seed, ordered[left].ID)
		rightScore := routeTargetScore(seed, ordered[right].ID)
		if leftScore != rightScore {
			return leftScore > rightScore
		}
		return ordered[left].ID < ordered[right].ID
	})
	return ordered
}

func routeTargetScore(seed string, routeID uint64) uint64 {
	digest := sha256.Sum256([]byte(seed + ":" + strconv.FormatUint(routeID, 10)))
	return binary.BigEndian.Uint64(digest[:8])
}

func routeProviderPriority(providerValue accountdomain.Provider) int {
	switch providerValue {
	case accountdomain.ProviderBuild:
		return 0
	case accountdomain.ProviderWeb:
		return 1
	case accountdomain.ProviderConsole:
		return 2
	default:
		return 3
	}
}

func routeTargetSeed(input Input) string {
	// Match the Build account-affinity precedence so Codex and Claude Code keep
	// both the route target and account stable across one logical session.
	anchor := strings.TrimSpace(input.PromptCacheSeed)
	if anchor == "" {
		anchor = strings.TrimSpace(input.PromptCacheKey)
	}
	if anchor == "" {
		system, firstUser, _ := extractMessageAnchors(input.Body)
		system = truncateAnchor(system, 100)
		firstUser = truncateAnchor(firstUser, 200)
		if firstUser != "" {
			anchor = "soft:" + system + ":" + firstUser
		}
	}
	if anchor == "" {
		anchor = strings.TrimSpace(input.RequestID)
	}
	return strconv.FormatUint(input.ClientKey.ID, 10) + ":" + anchor
}

// selectMediaRoute selects a same-name route that satisfies media capability, key permissions, and Provider support.
func (s *Service) selectMediaRoute(routes []modeldomain.Route, key clientkey.Key, capability modeldomain.Capability, providerSupported func(accountdomain.Provider) bool) (modeldomain.Route, error) {
	eligible, fallback, err := s.eligibleMediaRoutes(routes, key, capability, providerSupported)
	if err != nil {
		return fallback, err
	}
	return eligible[0], nil
}

func (s *Service) eligibleMediaRoutes(routes []modeldomain.Route, key clientkey.Key, capability modeldomain.Capability, providerSupported func(accountdomain.Provider) bool) ([]modeldomain.Route, modeldomain.Route, error) {
	if len(routes) == 0 {
		return nil, modeldomain.Route{}, ErrModelNotFound
	}
	fallback := routes[0]
	eligible := make([]modeldomain.Route, 0, len(routes))
	accountScope := key.AccountScope()
	capabilityMatched := false
	scopeMatched := false
	allowed := false
	for _, route := range routes {
		if route.Capability != capability {
			continue
		}
		fallback = route
		capabilityMatched = true
		if !accountScope.AllowsProvider(route.Provider) {
			continue
		}
		scopeMatched = true
		if !s.clientKeys.CanUseModel(key, route.ID) {
			continue
		}
		allowed = true
		if providerSupported(route.Provider) {
			eligible = append(eligible, route)
		}
	}
	if len(eligible) > 0 {
		return eligible, fallback, nil
	}
	if !capabilityMatched {
		return nil, fallback, ErrModelNotFound
	}
	if !scopeMatched {
		return nil, fallback, &SelectionUnavailableError{Reason: SelectionNoAccounts, Scope: accountScope}
	}
	if !allowed {
		return nil, fallback, clientkeyapp.ErrModelNotAllowed
	}
	return nil, fallback, ErrNoAvailableAccount
}

// selectSchedulableMediaRoute resolves a concrete same-name media target and
// its immutable account plan together. A cooling or exhausted first target
// therefore cannot hide a healthy target from another Provider.
func (s *Service) selectSchedulableMediaRoute(ctx context.Context, routes []modeldomain.Route, key clientkey.Key, capability modeldomain.Capability, consumesQuota bool, providerSupported func(accountdomain.Provider) bool) (modeldomain.Route, *selectionSession, error) {
	return s.selectSchedulableMediaRouteWithQuotaMode(ctx, routes, key, capability, consumesQuota, providerSupported, nil)
}

func (s *Service) selectSchedulableMediaRouteWithQuotaMode(ctx context.Context, routes []modeldomain.Route, key clientkey.Key, capability modeldomain.Capability, consumesQuota bool, providerSupported func(accountdomain.Provider) bool, resolveQuotaMode func(modeldomain.Route) string) (modeldomain.Route, *selectionSession, error) {
	eligible, fallback, err := s.eligibleMediaRoutes(routes, key, capability, providerSupported)
	if err != nil {
		return fallback, nil, err
	}
	return s.selectSchedulableEligibleMediaRouteWithQuotaMode(ctx, eligible, key, consumesQuota, resolveQuotaMode)
}

// selectSchedulableEligibleMediaRouteWithQuotaMode selects an account plan
// from routes that already passed capability, client-key, and Provider support
// checks. Callers may apply request-specific route constraints between the
// eligibility and scheduling phases without evaluating disallowed routes.
func (s *Service) selectSchedulableEligibleMediaRouteWithQuotaMode(ctx context.Context, eligible []modeldomain.Route, key clientkey.Key, consumesQuota bool, resolveQuotaMode func(modeldomain.Route) string) (modeldomain.Route, *selectionSession, error) {
	if len(eligible) == 0 {
		return modeldomain.Route{}, nil, ErrNoAvailableAccount
	}
	var firstSelectionErr error
	for _, route := range eligible {
		quotaMode := ""
		if consumesQuota {
			if resolveQuotaMode != nil {
				quotaMode = resolveQuotaMode(route)
			} else {
				quotaMode = s.providers.QuotaMode(route.Provider, route.UpstreamModel)
			}
		}
		session, selectionErr := s.selector.beginSelectionSessionForKey(
			ctx,
			route.Provider,
			route.ID,
			route.UpstreamModel,
			quotaMode,
			"",
			nil,
			false,
			key.AccountScope(),
		)
		if selectionErr == nil {
			return route, session, nil
		}
		if firstSelectionErr == nil {
			firstSelectionErr = selectionErr
		}
	}
	if firstSelectionErr == nil {
		firstSelectionErr = ErrNoAvailableAccount
	}
	return eligible[0], nil, firstSelectionErr
}
