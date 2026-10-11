package gateway

import (
	"context"
	"errors"
	"time"

	clientkeyapp "github.com/chenyme/grok2api/backend/internal/application/clientkey"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	audit "github.com/chenyme/grok2api/backend/internal/domain/audit"
	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	inferencedomain "github.com/chenyme/grok2api/backend/internal/domain/inference"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	security "github.com/chenyme/grok2api/backend/internal/infra/security"
	requestmeta "github.com/chenyme/grok2api/backend/internal/pkg/requestmeta"
	provider "github.com/chenyme/grok2api/backend/internal/ports/provider"
	http "net/http"
)

func (s *Service) CreateResponse(ctx context.Context, input Input) (*Result, error) {
	input.Operation = audit.OperationResponses
	switch classifyResponsesCompactionRequest(input.Body) {
	case responsesCompactionTrigger:
		input.Operation = audit.OperationCompaction
	case responsesCompactionTUI:
		// Grok TUI compaction is still a normal Responses request. Keep its
		// routing, Provider normalization, and stored-response behavior intact;
		// only its audit classification and quality-hold policy differ.
		input.auditOperation = audit.OperationCompaction
		input.skipQualityHold = true
	}
	return s.createResponseAt(ctx, input, "/responses")
}

func (s *Service) CreateChatCompletion(ctx context.Context, input Input) (*Result, error) {
	input.Operation = audit.OperationChat
	return s.createResponseAt(ctx, input, "/responses")
}

// CreateMessage executes an Anthropic Messages request through the unified Responses upstream.
func (s *Service) CreateMessage(ctx context.Context, input Input) (*Result, error) {
	input.Operation = audit.OperationMessages
	return s.createResponseAt(ctx, input, "/responses")
}

func (s *Service) CompactResponse(ctx context.Context, input Input) (*Result, error) {
	input.Streaming = false
	input.Operation = audit.OperationCompaction
	return s.createResponseAt(ctx, input, "/responses/compact")
}

// attemptDecision 表示一次上游尝试结束后 attemptLoop 需要执行的控制流动作。
type attemptDecision int

const (
	// attemptProceed 继续处理当前尝试。
	attemptProceed attemptDecision = iota
	// attemptNext 放弃当前尝试，进入下一次 attemptLoop 迭代。
	attemptNext
	// attemptStop 结束 attemptLoop。
	attemptStop
	// attemptReuse 不消耗尝试次数，重新执行同一个 attempt。
	attemptReuse
	// attemptRehandledResponse 已用刷新后的凭据重新取得响应，需要重新分类该响应。
	attemptRehandledResponse
	// attemptHandedOff 已产出交付给下游的最终响应。
	attemptHandedOff
)

// responseRequestState 保存一次 Responses 请求在路由、选号、转发与失败分类阶段共享的状态。
// 显式字段取代原有闭包捕获，使每个阶段函数可以独立阅读和验证。
type responseRequestState struct {
	service *Service
	ctx     context.Context
	input   Input
	path    string

	// 请求分类、路由与会话身份
	operation               audit.Operation
	auditOperation          audit.Operation
	eventID                 string
	requestSessionScope     string
	startedAt               time.Time
	firstToken              *firstTokenTimer
	egressTrace             *infraegress.Trace
	routes                  []modeldomain.Route
	orderedRoutes           []modeldomain.Route
	aliasEffort             string
	route                   modeldomain.Route
	routeErr                error
	publicModel             string
	accountScope            clientkeydomain.AccountScope
	ownership               *inferencedomain.ResponseOwnership
	preselectedSession      *selectionSession
	affinityKey             string
	ownershipPromptCacheKey string
	reasoningReplayKey      string

	// 计时与审计基线
	timing          *generationTiming
	timingHandedOff bool
	usageSource     audit.UsageSource
	auditBase       audit.Record

	// 上游调用与尝试策略
	adapter                   provider.ResponseAdapter
	physicalCallCtx           context.Context
	supportsStoredResponses   bool
	holdCfg                   QualityRetryRuntime
	qualityHoldEnabled        bool
	qualityCrossAccountReplay bool
	attemptPolicy             routingAttemptPolicy
	idempotencyID             string
	pricingModel              string
	excluded                  map[uint64]bool
	failureFingerprints       map[string]int
	authRecoveryAttempted     map[uint64]bool
	qualityAccountAttempts    int
	quotaMode                 string
	quotaProbeAttempted       bool
	selection                 *selectionSession
	lastErr                   error
	lastFailure               *UpstreamFailure
	failureAttempts           *failureAttemptRecorder
	normalizedMetadata        *provider.NormalizedRequestMetadata
	responseStartedAt         time.Time
	fallback                  *qualityFallback
}

func (s *Service) createResponseAt(ctx context.Context, input Input, path string) (*Result, error) {
	state := &responseRequestState{service: s, input: input, path: path}
	if err := state.initializeRequest(ctx); err != nil {
		return nil, err
	}
	if err := state.applyResolvedRoute(); err != nil {
		return nil, err
	}
	state.prepareTimingAndAuditBase()
	defer state.finishTimingWhenNotHandedOff()
	if err := state.writeDisallowedModelAudit(); err != nil {
		return nil, err
	}
	state.prepareBuildSessionIdentity()
	if err := state.resolveResponseAdapter(); err != nil {
		return nil, err
	}
	if err := state.prepareAttemptPolicy(); err != nil {
		return nil, err
	}
	if result, handedOff := state.runAttemptLoop(); handedOff {
		return result, nil
	}
	if result, ok := state.drainQualityFallback(); ok {
		return result, nil
	}
	return nil, state.finalizeUnavailableRequest()
}

// initializeRequest 建立追踪上下文、请求分类、公开模型路由与 previous_response_id 归属。
func (state *responseRequestState) initializeRequest(ctx context.Context) error {
	ctx, egressTrace := infraegress.WithTrace(ctx)
	state.ctx = ctx
	state.egressTrace = egressTrace
	state.startedAt = time.Now()
	if state.input.Streaming {
		state.firstToken = newFirstTokenTimer(state.startedAt)
	}
	state.eventID = newAuditEventID()
	// Use a server-generated scope so repeated or absent client request IDs
	// cannot accidentally join independent Composer conversations.
	state.requestSessionScope = state.eventID
	state.operation = state.input.Operation
	if state.operation == "" {
		state.operation = audit.OperationResponses
	}
	state.auditOperation = state.operation
	if state.input.auditOperation != "" {
		state.auditOperation = state.input.auditOperation
	}
	if err := state.resolveRequestRoute(); err != nil {
		return err
	}
	state.selectEligibleConversationRoutes()
	state.prepareRouteSelection()
	return nil
}

// resolveRequestRoute 解析公开模型路由，并按已有 Response 链恢复 previous_response_id 归属。
func (state *responseRequestState) resolveRequestRoute() error {
	routes, aliasEffort, err := state.service.resolvePublicModelRoutes(state.ctx, state.input.PublicModel, state.input.ClientKey.AllowModelAliases)
	if err != nil {
		return ErrModelNotFound
	}
	state.routes = routes
	state.aliasEffort = aliasEffort
	// Select an initial route only to preserve the existing stateful/stateless
	// previous_response_id boundary. The actual target is chosen from the eligible
	// pool below after ownership and account availability are known.
	initialRoute, routeErr := state.service.selectConversationRoute(routes, state.input.ClientKey, state.operation, state.path, false, nil)
	var ownership *inferencedomain.ResponseOwnership
	if state.input.PreviousResponseID != "" && routeErr == nil {
		if state.service.providers.SupportsStoredResponses(initialRoute.Provider) {
			value, ownershipErr := state.service.responses.Get(state.ctx, state.input.PreviousResponseID, state.input.ClientKey.ID, time.Now().UTC())
			if ownershipErr != nil {
				return ErrResponseNotFound
			}
			ownership = &value
		} else if initialRoute.Provider == accountdomain.ProviderConsole {
			// Console does not retain Response state, so replay the history statelessly here;
			// Provider normalization removes stale Response IDs.
			state.input.PreviousResponseID = ""
		} else {
			return ErrResponseStateUnsupported
		}
	}
	state.ownership = ownership
	return nil
}

// selectEligibleConversationRoutes 在归属与账号可用性已知后确定候选目标与本次使用的路由。
func (state *responseRequestState) selectEligibleConversationRoutes() {
	eligibleRoutes, fallbackRoute, routeErr := state.service.eligibleConversationRoutes(state.routes, state.input.ClientKey, state.operation, state.path, state.ownership != nil, state.ownership)
	route := fallbackRoute
	orderedRoutes := eligibleRoutes
	if routeErr == nil {
		orderedRoutes = orderConversationRouteTargets(eligibleRoutes, routeTargetSeed(state.input))
		route = orderedRoutes[0]
	}
	state.route = route
	state.orderedRoutes = orderedRoutes
	state.routeErr = routeErr
	state.accountScope = state.input.ClientKey.AccountScope()
}

// prepareRouteSelection 预选一个已知可用的账号池目标，保留同名目标的故障转移语义。
func (state *responseRequestState) prepareRouteSelection() {
	// Skip targets whose account pool is already known to be unavailable. This
	// gives same-name targets failover before any physical upstream request while
	// preserving pinned Responses and forced administrator probes.
	if state.routeErr != nil || state.ownership != nil || state.input.ForcedEgressNodeID != 0 {
		return
	}
	for _, candidate := range state.orderedRoutes {
		affinityKey := ""
		if candidate.Provider == accountdomain.ProviderBuild {
			identity := resolveBuildSessionIdentity(
				state.input.ClientKey.ID,
				candidate.Provider,
				candidate.UpstreamModel,
				state.input.PromptCacheKey,
				state.input.PromptCacheSeed,
				state.input.Body,
			)
			identity = ensureBuildComposerSessionIdentity(identity, state.input.ClientKey.ID, candidate.Provider, candidate.UpstreamModel, state.requestSessionScope)
			affinityKey = identity.affinityKey
		}
		candidateSession, selectionErr := state.service.selector.beginSelectionSessionForKey(
			state.ctx,
			candidate.Provider,
			candidate.ID,
			candidate.UpstreamModel,
			state.service.providers.QuotaMode(candidate.Provider, candidate.UpstreamModel),
			affinityKey,
			nil,
			true,
			state.accountScope,
		)
		if selectionErr != nil {
			continue
		}
		state.route = candidate
		state.preselectedSession = candidateSession
		break
	}
}

// applyResolvedRoute 固定对外公开模型，并按别名重写请求体。
func (state *responseRequestState) applyResolvedRoute() error {
	state.publicModel = modeldomain.ExternalPublicID(state.route.Provider, state.route.PublicID)
	state.input.PublicModel = state.publicModel
	if state.aliasEffort != "" {
		body, err := rewriteAliasedModel(state.input.Body, state.publicModel, state.aliasEffort, state.operation)
		if err != nil {
			return err
		}
		state.input.Body = body
	}
	if state.routeErr != nil && !errors.Is(state.routeErr, clientkeyapp.ErrModelNotAllowed) {
		return state.routeErr
	}
	return nil
}

// prepareTimingAndAuditBase 建立阶段计时与审计基线记录。
func (state *responseRequestState) prepareTimingAndAuditBase() {
	state.timing = newGenerationTiming(state.publicModel, state.route.Provider)
	state.usageSource = audit.UsageSourceUpstream
	if usageKind, _ := state.service.providers.UsageKind(state.route.Provider); usageKind == provider.UsageEstimated {
		state.usageSource = audit.UsageSourceEstimated
	}
	mediaSummary, _ := summarizeResponseMedia(state.input.Body)
	logResponseMediaSummary(state.service.logger, state.input.RequestID, mediaSummary)
	state.auditBase = audit.Record{
		EventID: state.eventID, RequestID: state.input.RequestID, ClientKeyID: state.input.ClientKey.ID, ClientKeyName: state.input.ClientKey.Name,
		ClientIP:     requestmeta.ClientIP(state.ctx),
		ModelRouteID: state.route.ID, ModelPublicID: state.publicModel, ModelUpstreamModel: modeldomain.DisplayUpstreamModel(state.route.Provider, state.route.UpstreamModel),
		Provider: string(state.route.Provider), Operation: state.auditOperation, UsageSource: audit.UsageSourceNone, Streaming: state.input.Streaming,
		MediaInputImages: mediaSummary.InputImages,
		RequestMethod:    state.input.Method, RequestPath: state.input.Path, RequestHeaders: state.input.Headers,
	}
}

// finishTimingWhenNotHandedOff 在未交付响应时把本次请求记为失败耗时。
func (state *responseRequestState) finishTimingWhenNotHandedOff() {
	if !state.timingHandedOff {
		state.timing.finish(state.service.logger, "failed")
	}
}

// writeDisallowedModelAudit 在客户端密钥不允许该模型时写入 403 审计并返回路由错误。
func (state *responseRequestState) writeDisallowedModelAudit() error {
	if !errors.Is(state.routeErr, clientkeyapp.ErrModelNotAllowed) {
		return nil
	}
	record := state.auditBase
	record.StatusCode = http.StatusForbidden
	record.DurationMS = time.Since(state.startedAt).Milliseconds()
	record.ErrorCode = "model_not_allowed"
	record.CreatedAt = time.Now().UTC()
	applyAuditEgress(&record, state.egressTrace, state.route.Provider)
	if err := state.service.audits.Create(state.ctx, record); err != nil {
		state.service.logger.Error("request_usage_write_failed", "event_id", record.EventID, "request_id", state.input.RequestID, "error", err)
	}
	return clientkeyapp.ErrModelNotAllowed
}

// prepareBuildSessionIdentity 为 Grok Build 推导稳定的 prompt cache 会话身份。
func (state *responseRequestState) prepareBuildSessionIdentity() {
	if state.route.Provider != accountdomain.ProviderBuild {
		return
	}
	// Derive a stable identity from explicit session signals, message anchors,
	// and model. Composer replaces message-only fallback identities with an
	// isolated request identity that remains stable across retries.
	identity := buildSessionIdentity{}
	if state.ownership != nil && state.ownership.PromptCacheKey != "" {
		// previous_response_id belongs to an existing Response chain and must inherit the root session identity;
		// do not recompute the soft key from this turn's incremental input.
		identity.upstreamID = state.ownership.PromptCacheKey
		identity.replayKey = state.ownership.ReasoningReplayKey
	} else {
		identity = resolveBuildSessionIdentity(
			state.input.ClientKey.ID,
			state.route.Provider,
			state.route.UpstreamModel,
			state.input.PromptCacheKey,
			state.input.PromptCacheSeed,
			state.input.Body,
		)
	}
	identity = ensureBuildComposerSessionIdentity(identity, state.input.ClientKey.ID, state.route.Provider, state.route.UpstreamModel, state.requestSessionScope)
	state.input.PromptCacheKey = identity.upstreamID
	state.affinityKey = identity.affinityKey
	state.ownershipPromptCacheKey = identity.upstreamID
	state.reasoningReplayKey = identity.replayKey
	state.logBuildSessionIdentity(identity)
}

// logBuildSessionIdentity 只记录会话身份的有限枚举，不记录会话键本身。
func (state *responseRequestState) logBuildSessionIdentity(identity buildSessionIdentity) {
	if identity.upstreamID == "" {
		state.service.logger.Debug("prompt_cache_session_empty", "request_id", state.input.RequestID, "model", state.route.UpstreamModel, "provider", state.route.Provider)
	} else if identity.soft {
		state.service.logger.Debug("prompt_cache_session_soft", "request_id", state.input.RequestID, "model", state.route.UpstreamModel)
	} else if identity.isolated {
		state.service.logger.Debug("prompt_cache_session_isolated", "request_id", state.input.RequestID, "model", state.route.UpstreamModel)
	}
}

// resolveResponseAdapter 取得上游适配器并确定该 Provider 的 stored responses 能力。
func (state *responseRequestState) resolveResponseAdapter() error {
	adapter, ok := state.service.providers.Responses(state.route.Provider)
	if !ok {
		return ErrNoAvailableAccount
	}
	state.adapter = adapter
	state.physicalCallCtx = infraegress.WithPhysicalCallTrace(state.ctx, string(state.route.Provider), string(state.operation))
	state.supportsStoredResponses = state.service.providers.SupportsStoredResponses(state.route.Provider)
	if state.input.PreviousResponseID != "" && !state.supportsStoredResponses {
		return ErrResponseStateUnsupported
	}
	return nil
}

// prepareAttemptPolicy 解析质量保持策略、尝试策略与预扣费，并初始化尝试期共享状态。
func (state *responseRequestState) prepareAttemptPolicy() error {
	// A lease recovery probe stays on exactly one account and one rendered proxy
	// identity. Retrying the same pinned account would provide neither failover
	// nor new evidence and can multiply a slow/failing probe.
	state.holdCfg = state.service.qualityRetryConfig()
	state.qualityHoldEnabled = shouldHoldQualityStream(state.input, state.ownership, state.route, state.operation, state.holdCfg)
	state.qualityCrossAccountReplay = canReplayQualityHoldAcrossAccounts(state.input, state.ownership)
	state.attemptPolicy = newRequestRoutingAttemptPolicy(int(state.service.maxAttempts.Load()), state.ownership != nil || state.input.ForcedAccountID != 0)
	state.idempotencyID, _ = security.NewOpaqueToken(18)
	state.pricingModel = state.service.providers.PricingModel(state.route.Provider, state.route.UpstreamModel)
	if err := state.service.checkLedgerReady(); err != nil {
		return err
	}
	if reservation, priced := audit.EstimateOfficialTextReservation(state.pricingModel, state.input.Body); priced {
		if _, err := state.service.clientKeys.ReserveBilling(state.ctx, state.input.ClientKey, state.eventID, reservation.CostInUSDTicks, state.service.textBillingReservationTTL()); err != nil {
			return err
		}
	}
	state.excluded = make(map[uint64]bool)
	state.failureFingerprints = make(map[string]int)
	state.authRecoveryAttempted = make(map[uint64]bool)
	// Count accounts that actually reached the upstream. Credential-only skips
	// do not consume the quality retry budget; refreshes stay on the same account.
	state.quotaMode = state.service.providers.QuotaMode(state.route.Provider, state.route.UpstreamModel)
	state.selection = state.preselectedSession
	state.failureAttempts = newFailureAttemptRecorder(http.MethodPost, state.path)
	state.normalizedMetadata = &provider.NormalizedRequestMetadata{}
	state.responseStartedAt = state.startedAt
	return nil
}
