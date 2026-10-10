package gateway

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// voiceExecutionPlan 固定一次语音请求在账号尝试阶段不变的数据流。
type voiceExecutionPlan struct {
	key         clientkey.Key
	route       modeldomain.Route
	quotaMode   string
	preselected *selectionSession
	policy      routingAttemptPolicy
	execute     func(context.Context, accountdomain.Provider, accountdomain.Credential, string) (voiceExecutionResult, error)
}

// voiceAttemptState 承载语音账号尝试循环的可变状态；excluded 与 selection 只在循环内使用。
type voiceAttemptState struct {
	outcome               voiceAttemptOutcome
	excluded              map[uint64]bool
	selection             *selectionSession
	completedPricing      audit.PricingResult
	responseRequestScoped bool
}

// voiceAttemptOutcome 汇总语音账号尝试循环的结果，供调用方决定结算或失败审计。
type voiceAttemptOutcome struct {
	response              *provider.Response
	lease                 *accountLease
	credential            accountdomain.Credential
	lastCredentialFailure *accountdomain.Credential
	lastCredentialError   error
	failureStatus         int
	failureCode           string
	failureCredential     *accountdomain.Credential
}

// voiceFinalization 承载一次语音响应的一次性结算与审计落库。除 sync.Once 闸门外，
// 字段在构造后不再变化。
type voiceFinalization struct {
	service          *Service
	once             sync.Once
	auditCtx         mediaAuditContext
	operation        audit.Operation
	route            modeldomain.Route
	credential       accountdomain.Credential
	response         *provider.Response
	lease            *accountLease
	accountID        uint64
	completedPricing audit.PricingResult
	quotaMode        string
}

// 语音请求执行：账号选择、上游转发与用量/审计结算（TTS/STT 四个入口共用）。
func (s *Service) executeVoice(
	ctx context.Context,
	requestID string,
	key clientkey.Key,
	publicModel string,
	operation audit.Operation,
	capability modeldomain.Capability,
	consumesQuota bool,
	reservation audit.PricingResult,
	method string,
	path string,
	headers map[string][]string,
	supports voiceProviderSupport,
	execute func(context.Context, accountdomain.Provider, accountdomain.Credential, string) (voiceExecutionResult, error),
) (*Result, error) {
	ctx, egressTrace := infraegress.WithTrace(ctx)
	startedAt := time.Now()
	eventID := newAuditEventID()
	route, preselectedSession, err := s.resolveSchedulableMediaRoute(ctx, publicModel, key, capability, consumesQuota, supports)
	if err != nil {
		return nil, err
	}
	externalModel := modeldomain.ExternalPublicID(route.Provider, route.PublicID)
	auditCtx := mediaAuditContext{
		base: newMediaAuditRecord(ctx, mediaAuditIdentity{
			eventID: eventID, requestID: requestID, key: key, route: route, publicID: externalModel,
			operation: operation, method: method, path: path, headers: headers,
		}),
		provider: route.Provider, trace: egressTrace, startedAt: startedAt, requestID: requestID,
	}
	if err := s.checkLedgerReady(); err != nil {
		return nil, err
	}
	if reservation.CostInUSDTicks > 0 {
		if _, err := s.clientKeys.ReserveBilling(ctx, key, eventID, reservation.CostInUSDTicks, mediaBillingReservationTTL); err != nil {
			return nil, err
		}
	}
	quotaMode := ""
	if consumesQuota {
		quotaMode = s.providers.QuotaMode(route.Provider, route.UpstreamModel)
	}
	state, err := s.runVoiceAttempts(ctx, voiceExecutionPlan{
		key: key, route: route, quotaMode: quotaMode, preselected: preselectedSession,
		policy: newRoutingAttemptPolicy(int(s.maxAttempts.Load())), execute: execute,
	})
	if err != nil {
		s.writeMediaFailureAudit(auditCtx, state.outcome.failureStatus, state.outcome.failureCode, state.outcome.failureCredential)
		return nil, err
	}
	if state.outcome.response == nil {
		return nil, s.reportVoiceSelectionFailure(auditCtx, state.outcome)
	}
	finalization := &voiceFinalization{
		service: s, auditCtx: auditCtx, operation: operation, route: route,
		credential: state.outcome.credential, response: state.outcome.response, lease: state.outcome.lease,
		accountID: state.outcome.credential.ID, completedPricing: state.completedPricing, quotaMode: quotaMode,
	}
	return &Result{
		StatusCode: finalization.response.StatusCode, Status: finalization.response.Status, Header: finalization.response.Header,
		Body:     &finalizingBody{ReadCloser: finalization.response.Body, finalize: func() { finalization.finalize(Usage{}, "", "stream_closed") }},
		Finalize: finalization.finalize,
	}, nil
}

// reportVoiceSelectionFailure 落库账号选择失败的审计并返回统一错误。
func (s *Service) reportVoiceSelectionFailure(auditCtx mediaAuditContext, outcome voiceAttemptOutcome) error {
	s.writeMediaFailureAudit(auditCtx, http.StatusServiceUnavailable, "upstream_unavailable", outcome.lastCredentialFailure)
	lastCredentialError := outcome.lastCredentialError
	if lastCredentialError == nil {
		lastCredentialError = ErrNoAvailableAccount
	}
	return fmt.Errorf("%w: %w", ErrNoAvailableAccount, lastCredentialError)
}

// runVoiceAttempts 按运行时尝试策略依次获取账号并执行语音上游请求。
func (s *Service) runVoiceAttempts(ctx context.Context, plan voiceExecutionPlan) (voiceAttemptState, error) {
	state := voiceAttemptState{excluded: make(map[uint64]bool), selection: plan.preselected}
	var err error
	for attempt := 0; plan.policy.allows(attempt); attempt++ {
		if state.selection == nil {
			state.selection, err = s.selector.beginSelectionSessionForKey(ctx, plan.route.Provider, plan.route.ID, plan.route.UpstreamModel, plan.quotaMode, "", state.excluded, false, plan.key.AccountScope())
		}
		if err == nil {
			state.outcome.lease, err = state.selection.Acquire(ctx, state.excluded, false)
		}
		if err != nil {
			state.outcome.failureStatus = http.StatusServiceUnavailable
			state.outcome.failureCode = selectionFailureCode(err)
			state.outcome.failureCredential = state.outcome.lastCredentialFailure
			return state, fmt.Errorf("%w: %w", ErrNoAvailableAccount, err)
		}
		state.excluded[state.outcome.lease.Credential.ID] = true
		if !s.ensureVoiceAttemptCredential(ctx, &state) {
			continue
		}
		state.outcome.lease.markSelectorUpstreamStarted()
		state.responseRequestScoped = false
		execution, executionErr := plan.execute(ctx, plan.route.Provider, state.outcome.credential, plan.route.UpstreamModel)
		state.outcome.response, state.completedPricing, err = execution.response, execution.pricing, executionErr
		if err != nil {
			retry, carriedErr, fatalErr := s.applyVoiceExecutionError(ctx, plan, &state, executionErr, attempt)
			err = carriedErr
			if fatalErr != nil {
				return state, fatalErr
			}
			if retry {
				continue
			}
		}
		if s.retryVoiceAttemptAfterResponse(ctx, plan, &state, attempt) {
			continue
		}
		break
	}
	return state, nil
}

// ensureVoiceAttemptCredential 校验/刷新所选账号凭证；凭证不可用时释放租约并交由调用方换号。
func (s *Service) ensureVoiceAttemptCredential(ctx context.Context, state *voiceAttemptState) bool {
	credential, err := s.accounts.EnsureCredential(ctx, state.outcome.lease.Credential, false)
	if err != nil {
		failedCredential := state.outcome.lease.Credential
		state.outcome.lastCredentialFailure = &failedCredential
		state.outcome.lastCredentialError = err
		state.outcome.lease.Release()
		return false
	}
	state.outcome.credential = credential
	return true
}

// applyVoiceExecutionError 归类上游执行错误。返回的 carriedErr 是既有循环变量 err 在该分支后的值，
// 决定下一次迭代是否仍能获取租约；fatalErr 非空表示终态失败并已填好审计字段。
func (s *Service) applyVoiceExecutionError(ctx context.Context, plan voiceExecutionPlan, state *voiceAttemptState, executionErr error, attempt int) (bool, error, error) {
	if _, ok := provider.ErrorHTTPStatus(executionErr); ok {
		// 上游返回可映射的 HTTP 状态：转为客户端可见的错误响应，err 随之被清除。
		state.responseRequestScoped = provider.IsRequestScopedError(executionErr)
		response, err := voiceErrorResponse(executionErr)
		if err != nil {
			state.outcome.lease.Release()
			state.outcome.failureStatus, state.outcome.failureCode, state.outcome.failureCredential = http.StatusBadGateway, "upstream_unavailable", &state.outcome.credential
			return false, executionErr, err
		}
		state.outcome.response = response
		return false, nil, nil
	}
	if isSSOCredentialRejected(executionErr, state.outcome.credential) {
		s.markSSOCredentialRejected(ctx, state.outcome.credential, fmt.Sprintf("%s SSO credential rejected", state.outcome.credential.Provider))
		failedCredential := state.outcome.credential
		state.outcome.lastCredentialFailure = &failedCredential
		state.outcome.lastCredentialError = provider.ErrUnauthorized
		state.outcome.lease.Release()
		return true, executionErr, nil
	}
	failure := newTransportUpstreamFailure(executionErr, state.outcome.credential.ID, state.outcome.credential.Name)
	state.outcome.lastCredentialError = failure
	if ctx.Err() == nil && isRetryableTransportFailure(state.outcome.credential.Provider, executionErr) && plan.policy.hasNext(attempt) {
		// Transport failures are normally tied to the selected egress. Retry the
		// same account after the adapter has invalidated/rebuilt that transport,
		// without cooling an otherwise healthy credential.
		retryExcludedAccount(state.excluded, state.selection, state.outcome.credential.ID)
		state.outcome.lease.Release()
		return true, executionErr, nil
	}
	state.outcome.lease.Release()
	state.outcome.failureStatus, state.outcome.failureCode, state.outcome.failureCredential = failure.HTTPStatus, failure.AuditCode(), &state.outcome.credential
	return false, executionErr, failure
}

// retryVoiceAttemptAfterResponse 处理已收到上游响应的可重试状态码，返回是否需要换号重试。
func (s *Service) retryVoiceAttemptAfterResponse(ctx context.Context, plan voiceExecutionPlan, state *voiceAttemptState, attempt int) bool {
	if s.retryVoiceSSORejection(ctx, state) {
		return true
	}
	if s.retryVoiceEgressForbidden(plan, state, attempt) {
		return true
	}
	if s.retryVoiceRateLimit(ctx, plan, state, attempt) {
		return true
	}
	return s.retryVoiceServerError(plan, state, attempt)
}

// retryVoiceSSORejection 处理 SSO 凭证被上游拒绝的 401 响应。
func (s *Service) retryVoiceSSORejection(ctx context.Context, state *voiceAttemptState) bool {
	if state.outcome.response.StatusCode != http.StatusUnauthorized || state.outcome.credential.AuthType != accountdomain.AuthTypeSSO {
		return false
	}
	_, _ = readRetryableBody(state.outcome.response.Body)
	s.markSSOCredentialRejected(ctx, state.outcome.credential, fmt.Sprintf("%s SSO credential rejected", state.outcome.credential.Provider))
	failedCredential := state.outcome.credential
	state.outcome.lastCredentialFailure = &failedCredential
	state.outcome.lastCredentialError = provider.ErrUnauthorized
	state.outcome.response = nil
	state.outcome.lease.Release()
	return true
}

// retryVoiceEgressForbidden 对出口会话被拒的首次 403 在同一账号上重试。
func (s *Service) retryVoiceEgressForbidden(plan voiceExecutionPlan, state *voiceAttemptState, attempt int) bool {
	if !s.providers.RetryForbiddenAsEgress(state.outcome.credential.Provider) || state.outcome.response.StatusCode != http.StatusForbidden {
		return false
	}
	if state.responseRequestScoped || attempt != 0 || !plan.policy.hasNext(attempt) {
		return false
	}
	_, _ = readRetryableBody(state.outcome.response.Body)
	retryExcludedAccount(state.excluded, state.selection, state.outcome.credential.ID)
	state.outcome.lease.Release()
	return true
}

// retryVoiceRateLimit 处理 402/429：先对账远端窗口，仍有尝试预算时换号重试。
func (s *Service) retryVoiceRateLimit(ctx context.Context, plan voiceExecutionPlan, state *voiceAttemptState, attempt int) bool {
	response := state.outcome.response
	if response.StatusCode != http.StatusPaymentRequired && response.StatusCode != http.StatusTooManyRequests {
		return false
	}
	retryAfter := parseRetryAfter(response.Header.Get("Retry-After"), time.Now().UTC())
	if quotaKind, _ := s.providers.QuotaKind(state.outcome.credential.Provider); quotaKind == provider.QuotaRemoteWindow && state.outcome.lease.QuotaMode != "" {
		rateLimitState, reconcileErr := s.accounts.ReconcileRateLimit(ctx, state.outcome.credential.ID, state.outcome.lease.QuotaMode, retryAfter)
		s.applyRateLimitReconciliation(ctx, state.outcome.credential, response.StatusCode, retryAfter, rateLimitState, reconcileErr)
	} else {
		s.selector.MarkFailure(ctx, state.outcome.credential, response.StatusCode, retryAfter)
	}
	if !plan.policy.hasNext(attempt) {
		return false
	}
	_, _ = readRetryableBody(response.Body)
	state.outcome.lease.Release()
	return true
}

// retryVoiceServerError 在仍有尝试预算时换号重试上游 5xx。
func (s *Service) retryVoiceServerError(plan voiceExecutionPlan, state *voiceAttemptState, attempt int) bool {
	if state.outcome.response.StatusCode < http.StatusInternalServerError || !plan.policy.hasNext(attempt) {
		return false
	}
	_, _ = readRetryableBody(state.outcome.response.Body)
	state.outcome.lease.Release()
	return true
}

// finalize 一次性完成语音响应的用量结算与审计落库。
func (f *voiceFinalization) finalize(_ Usage, _ string, errorCode string) {
	f.once.Do(func() { f.service.settleVoiceResponse(f, errorCode) })
}

// settleVoiceResponse 结算语音响应：租约观测、已确认定价、额度围栏与审计落库各执行一次。
func (s *Service) settleVoiceResponse(finalization *voiceFinalization, errorCode string) {
	successful := auditRequestSucceeded(finalization.response.StatusCode, errorCode)
	finalization.lease.completeSelectorObservation(successful)
	finalization.lease.Release()
	budget := newFinalizationBudget(string(finalization.operation), string(finalization.route.Provider))
	record := finalization.auditCtx.settleRecord(finalization.credential, finalization.response.StatusCode, errorCode)
	if successful && finalization.completedPricing.CostInUSDTicks > 0 {
		record.EstimatedCostInUSDTicks = finalization.completedPricing.CostInUSDTicks
		record.PricingModel = finalization.completedPricing.Model
		record.PricingVersion = audit.OfficialPricingAsOf
	}
	if successful && finalization.response.QuotaUnits > 0 && finalization.quotaMode != "" {
		s.settleVoiceQuota(budget, finalization)
	}
	s.persistFinalizationAudit(budget, record, finalization.auditCtx.requestID)
}

// settleVoiceQuota 扣减语音请求的额度窗口（非 weekly）并推进远端窗口刷新。
func (s *Service) settleVoiceQuota(budget finalizationBudget, finalization *voiceFinalization) {
	if finalization.quotaMode != "weekly" {
		s.decrementVoiceQuota(budget, finalization)
	}
	if quotaKind, _ := s.providers.QuotaKind(finalization.route.Provider); quotaKind == provider.QuotaRemoteWindow {
		s.accounts.QueueQuotaRefresh(finalization.accountID, finalization.quotaMode)
	}
}

// decrementVoiceQuota 在收尾预算内扣减账号额度并同步本地计数。
func (s *Service) decrementVoiceQuota(budget finalizationBudget, finalization *voiceFinalization) {
	units := finalization.response.QuotaUnits
	var updated bool
	err := budget.run("quota_decrement", finalizationQuotaBudget, func(stageCtx context.Context) error {
		var decrementErr error
		updated, decrementErr = s.accounts.DecrementQuota(stageCtx, finalization.accountID, finalization.quotaMode, units)
		return decrementErr
	})
	if err != nil {
		s.logger.Warn("voice_quota_decrement_failed", "provider", finalization.route.Provider, "account_id", finalization.accountID, "mode", finalization.quotaMode, "units", units, "error", err)
	} else if updated {
		s.selector.ConsumeQuota(finalization.route.Provider, finalization.accountID, finalization.quotaMode, units)
	}
}
