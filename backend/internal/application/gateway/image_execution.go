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

// imageExecutionPlan 固定一次图片请求在账号尝试阶段不变的数据流。
type imageExecutionPlan struct {
	requestID     string
	eventID       string
	externalModel string
	key           clientkey.Key
	route         modeldomain.Route
	quotaMode     string
	preselected   *selectionSession
	policy        routingAttemptPolicy
	execute       imageExecution
}

// imageAttemptState 承载图片账号尝试循环的可变状态；excluded 与 selection 只在循环内使用。
type imageAttemptState struct {
	outcome   imageAttemptOutcome
	excluded  map[uint64]bool
	selection *selectionSession
}

// imageAttemptOutcome 汇总图片账号尝试循环的结果，供调用方决定结算或失败审计。
type imageAttemptOutcome struct {
	response              *provider.Response
	lease                 *accountLease
	credential            accountdomain.Credential
	lastCredentialFailure *accountdomain.Credential
	lastCredentialError   error
	failureStatus         int
	failureCode           string
	failureCredential     *accountdomain.Credential
}

// imageFinalization 承载一次图片响应的一次性结算与审计落库。除 sync.Once 闸门外，
// 字段在构造后不再变化。
type imageFinalization struct {
	service           *Service
	once              sync.Once
	auditCtx          mediaAuditContext
	operation         audit.Operation
	route             modeldomain.Route
	credential        accountdomain.Credential
	response          *provider.Response
	lease             *accountLease
	accountID         uint64
	pricingModel      string
	pricingResolution string
	pricingQuality    string
	requestedCount    int
	inputImageCount   int
	quotaMode         string
	quotaRefreshGroup string
}

// 图片用例执行：路由选择、账号租约、上游转发与用量/审计结算。
func (s *Service) executeImage(
	ctx context.Context,
	requestID string,
	key clientkey.Key,
	publicModel string,
	operation audit.Operation,
	capability modeldomain.Capability,
	supports imageProviderSupport,
	execute imageExecution,
	streaming bool,
	resolution string,
	quality string,
	requestedCount int,
	inputImageCount int,
	method string,
	path string,
	headers map[string][]string,
) (*Result, error) {
	ctx, egressTrace := infraegress.WithTrace(ctx)
	startedAt := time.Now()
	eventID := newAuditEventID()
	route, preselectedSession, err := s.resolveSchedulableMediaRoute(ctx, publicModel, key, capability, true, supports)
	if err != nil {
		return nil, err
	}
	externalModel := modeldomain.ExternalPublicID(route.Provider, route.PublicID)
	auditCtx := newMediaAuditContext(ctx, mediaAuditIdentity{
		eventID: eventID, requestID: requestID, key: key, route: route, publicID: externalModel,
		operation: operation, streaming: streaming, method: method, path: path, headers: headers,
		mediaInputImages: int64(max(0, inputImageCount)),
	}, egressTrace, startedAt)
	if err := s.checkLedgerReady(); err != nil {
		return nil, err
	}
	pricingModel := s.providers.PricingModel(route.Provider, route.UpstreamModel)
	pricingResolution, pricingQuality := imagePricingTiers(route.Provider, operation, resolution, quality)
	reservation, priced := estimateImagePricing(operation, pricingModel, pricingResolution, pricingQuality, requestedCount, inputImageCount)
	reserved, err := s.reserveImageBilling(ctx, key, eventID, reservation, priced)
	if err != nil {
		return nil, err
	}
	billing := imageBillingReservation{service: s, eventID: eventID, reserved: reserved}
	defer billing.cancelUnlessOwned()
	outcome, err := s.runImageAttempts(ctx, imageExecutionPlan{
		requestID: requestID, eventID: eventID, externalModel: externalModel, key: key, route: route,
		quotaMode: s.providers.QuotaMode(route.Provider, route.UpstreamModel), preselected: preselectedSession,
		policy: newRoutingAttemptPolicy(int(s.maxAttempts.Load())), execute: execute,
	})
	if err != nil {
		s.writeMediaFailureAudit(auditCtx, outcome.failureStatus, outcome.failureCode, outcome.failureCredential)
		return nil, err
	}
	if outcome.response == nil {
		return nil, s.reportImageSelectionFailure(auditCtx, outcome)
	}
	billing.owned = true
	finalization := newImageFinalization(s, auditCtx, operation, route, outcome, imageSettlementFields{
		pricingModel: pricingModel, pricingResolution: pricingResolution, pricingQuality: pricingQuality,
		requestedCount: requestedCount, inputImageCount: inputImageCount,
		quotaRefreshGroup: s.providers.QuotaRefreshGroup(route.Provider, route.UpstreamModel),
	})
	return buildImageResult(finalization), nil
}

// imageBillingReservation 跟踪图片请求的计费预留；未移交给结算时在函数退出时取消。
type imageBillingReservation struct {
	service  *Service
	eventID  string
	reserved bool
	owned    bool
}

// cancelUnlessOwned 只取消尚未交给响应结算的预留。
func (reservation *imageBillingReservation) cancelUnlessOwned() {
	if reservation.reserved && !reservation.owned {
		reservation.service.cancelBillingReservation(reservation.eventID)
	}
}

// imageSettlementFields 固定图片响应结算所需的报价与额度输入。
type imageSettlementFields struct {
	pricingModel      string
	pricingResolution string
	pricingQuality    string
	requestedCount    int
	inputImageCount   int
	quotaRefreshGroup string
}

// newImageFinalization 组装一次图片响应的一次性结算载体。
func newImageFinalization(service *Service, auditCtx mediaAuditContext, operation audit.Operation, route modeldomain.Route, outcome imageAttemptOutcome, fields imageSettlementFields) *imageFinalization {
	return &imageFinalization{
		service: service, auditCtx: auditCtx, operation: operation, route: route,
		credential: outcome.credential, response: outcome.response, lease: outcome.lease, accountID: outcome.credential.ID,
		pricingModel: fields.pricingModel, pricingResolution: fields.pricingResolution, pricingQuality: fields.pricingQuality,
		requestedCount: fields.requestedCount, inputImageCount: fields.inputImageCount,
		quotaMode: outcome.lease.QuotaMode, quotaRefreshGroup: fields.quotaRefreshGroup,
	}
}

// buildImageResult 基于结算载体构造客户端可见结果。
func buildImageResult(finalization *imageFinalization) *Result {
	return &Result{
		StatusCode: finalization.response.StatusCode, Status: finalization.response.Status, Header: finalization.response.Header,
		Body:     &finalizingBody{ReadCloser: finalization.response.Body, finalize: func() { finalization.finalize(Usage{}, "", "stream_closed") }},
		Finalize: finalization.finalize,
	}
}

// reserveImageBilling 预留图片请求的计费额度；未定价时不做预留。
func (s *Service) reserveImageBilling(ctx context.Context, key clientkey.Key, eventID string, reservation audit.PricingResult, priced bool) (bool, error) {
	if !priced {
		return false, nil
	}
	return s.clientKeys.ReserveBilling(ctx, key, eventID, reservation.CostInUSDTicks, mediaBillingReservationTTL)
}

// reportImageSelectionFailure 落库账号选择失败的审计并返回统一错误。
func (s *Service) reportImageSelectionFailure(auditCtx mediaAuditContext, outcome imageAttemptOutcome) error {
	s.writeMediaFailureAudit(auditCtx, http.StatusServiceUnavailable, "upstream_unavailable", outcome.lastCredentialFailure)
	lastCredentialError := outcome.lastCredentialError
	if lastCredentialError == nil {
		lastCredentialError = ErrNoAvailableAccount
	}
	return fmt.Errorf("%w: %w", ErrNoAvailableAccount, lastCredentialError)
}

// imagePricingTiers 规范化图片请求用于官方报价的档位。Grok Web Imagine 通过目录模型
// 选择产品并只转发 aspect_ratio/n，因此不采用 Console 专有的 resolution/quality 兼容字段。
func imagePricingTiers(providerValue accountdomain.Provider, operation audit.Operation, resolution, quality string) (string, string) {
	if providerValue == accountdomain.ProviderWeb && operation == audit.OperationImage {
		return "", ""
	}
	return resolution, quality
}

// estimateImagePricing 计算图片生成/编辑的官方报价；未定价时返回 false。
func estimateImagePricing(operation audit.Operation, pricingModel, resolution, quality string, requestedCount, inputImageCount int) (audit.PricingResult, bool) {
	switch operation {
	case audit.OperationImage:
		return audit.EstimateOfficialImageCost(pricingModel, resolution, quality, requestedCount)
	case audit.OperationImageEdit:
		return audit.EstimateOfficialImageEditCost(pricingModel, resolution, quality, requestedCount, inputImageCount)
	default:
		return audit.PricingResult{}, false
	}
}

// runImageAttempts 按运行时尝试策略依次获取账号并执行图片上游请求。
func (s *Service) runImageAttempts(ctx context.Context, plan imageExecutionPlan) (imageAttemptOutcome, error) {
	state := imageAttemptState{excluded: make(map[uint64]bool), selection: plan.preselected}
	var err error
	for attempt := 0; plan.policy.allows(attempt); attempt++ {
		if state.selection == nil {
			state.selection, err = s.selector.beginSelectionSessionForKey(ctx, plan.route.Provider, plan.route.ID, plan.route.UpstreamModel, plan.quotaMode, "", state.excluded, false, plan.key.AccountScope())
		}
		if err == nil {
			state.outcome.lease, err = state.selection.Acquire(ctx, state.excluded, false)
		}
		if err != nil {
			return state.outcome, s.abortImageAttempts(&state, err)
		}
		state.excluded[state.outcome.lease.Credential.ID] = true
		if !s.ensureImageAttemptCredential(ctx, plan, &state) {
			continue
		}
		state.outcome.lease.markSelectorUpstreamStarted()
		state.outcome.response, err = plan.execute(ctx, plan.route.Provider, state.outcome.credential, plan.route.UpstreamModel)
		if err != nil {
			retry, fatalErr := s.handleImageExecutionFailure(ctx, plan, &state, err)
			if fatalErr != nil {
				return state.outcome, fatalErr
			}
			if retry {
				continue
			}
		}
		if s.retryImageAttemptAfterResponse(ctx, plan, &state, attempt) {
			continue
		}
		break
	}
	return state.outcome, nil
}

// abortImageAttempts 记录账号选择失败的审计字段，并返回既有错误包装。
func (s *Service) abortImageAttempts(state *imageAttemptState, err error) error {
	state.outcome.failureStatus = http.StatusServiceUnavailable
	state.outcome.failureCode = selectionFailureCode(err)
	state.outcome.failureCredential = state.outcome.lastCredentialFailure
	return fmt.Errorf("%w: %w", ErrNoAvailableAccount, err)
}

// ensureImageAttemptCredential 校验/刷新所选账号凭证；凭证不可用时释放租约并交由调用方换号。
func (s *Service) ensureImageAttemptCredential(ctx context.Context, plan imageExecutionPlan, state *imageAttemptState) bool {
	credential, err := s.accounts.EnsureCredential(ctx, state.outcome.lease.Credential, false)
	if err != nil {
		s.logger.Error("image_credential_failed", "event_id", plan.eventID, "request_id", plan.requestID, "model", plan.externalModel, "provider", plan.route.Provider, "account_id", state.outcome.lease.Credential.ID, "error", err)
		failedCredential := state.outcome.lease.Credential
		state.outcome.lastCredentialFailure = &failedCredential
		state.outcome.lastCredentialError = err
		state.outcome.lease.Release()
		return false
	}
	state.outcome.credential = credential
	return true
}

// handleImageExecutionFailure 处理上游转发错误。返回 retry 表示换号重试，返回 error 表示终态失败
// （调用方负责落库 502 审计并返回该错误）。
func (s *Service) handleImageExecutionFailure(ctx context.Context, plan imageExecutionPlan, state *imageAttemptState, executionErr error) (bool, error) {
	s.logger.Error("image_upstream_failed", "event_id", plan.eventID, "request_id", plan.requestID, "model", plan.externalModel, "provider", plan.route.Provider, "account_id", state.outcome.credential.ID, "error", executionErr)
	if isSSOCredentialRejected(executionErr, state.outcome.credential) {
		s.markSSOCredentialRejected(ctx, state.outcome.credential, fmt.Sprintf("%s SSO credential rejected", state.outcome.credential.Provider))
		failedCredential := state.outcome.credential
		state.outcome.lastCredentialFailure = &failedCredential
		state.outcome.lastCredentialError = provider.ErrUnauthorized
		state.outcome.lease.Release()
		return true, nil
	}
	if !provider.IsMediaPostProcessingError(executionErr) {
		s.selector.MarkFailure(ctx, state.outcome.credential, 0, 0)
	}
	state.outcome.lease.Release()
	errorCode := "upstream_unavailable"
	if provider.IsMediaPostProcessingError(executionErr) {
		errorCode = "media_postprocessing_failed"
	}
	state.outcome.failureStatus, state.outcome.failureCode, state.outcome.failureCredential = http.StatusBadGateway, errorCode, &state.outcome.credential
	return false, executionErr
}

// retryImageAttemptAfterResponse 处理已收到上游响应的可重试状态码，返回是否需要换号重试。
func (s *Service) retryImageAttemptAfterResponse(ctx context.Context, plan imageExecutionPlan, state *imageAttemptState, attempt int) bool {
	response := state.outcome.response
	credential := state.outcome.credential
	if response.StatusCode == http.StatusUnauthorized && credential.AuthType == accountdomain.AuthTypeSSO {
		_, _ = readRetryableBody(response.Body)
		s.markSSOCredentialRejected(ctx, credential, fmt.Sprintf("%s SSO credential rejected", credential.Provider))
		failedCredential := credential
		state.outcome.lastCredentialFailure = &failedCredential
		state.outcome.lastCredentialError = provider.ErrUnauthorized
		state.outcome.response = nil
		state.outcome.lease.Release()
		return true
	}
	if s.providers.RetryForbiddenAsEgress(credential.Provider) && response.StatusCode == http.StatusForbidden && attempt == 0 && plan.policy.hasNext(attempt) {
		_, _ = readRetryableBody(response.Body)
		retryExcludedAccount(state.excluded, state.selection, credential.ID)
		state.outcome.lease.Release()
		return true
	}
	if quotaKind, _ := s.providers.QuotaKind(credential.Provider); quotaKind == provider.QuotaRemoteWindow && response.StatusCode == http.StatusTooManyRequests && state.outcome.lease.QuotaMode != "" {
		retryAfter := parseRetryAfter(response.Header.Get("Retry-After"), time.Now().UTC())
		exhausted, reconcileErr := s.accounts.ReconcileWebRateLimit(ctx, credential.ID, state.outcome.lease.QuotaMode, retryAfter)
		s.selector.MarkQuotaStateChanged(credential.Provider, credential.ID)
		if reconcileErr != nil || !exhausted {
			s.selector.MarkFailure(ctx, credential, response.StatusCode, retryAfter)
		}
		if plan.policy.hasNext(attempt) {
			_, _ = readRetryableBody(response.Body)
			state.outcome.lease.Release()
			return true
		}
	}
	return false
}

// finalize 一次性完成图片响应的用量结算与审计落库。
func (f *imageFinalization) finalize(_ Usage, _ string, errorCode string) {
	f.once.Do(func() { f.service.settleImageResponse(f, errorCode) })
}

// settleImageResponse 结算图片响应：租约观测、额度围栏与审计落库各执行一次。
func (s *Service) settleImageResponse(finalization *imageFinalization, errorCode string) {
	successful := auditRequestSucceeded(finalization.response.StatusCode, errorCode)
	finalization.lease.completeSelectorObservation(successful)
	finalization.lease.Release()
	budget := newFinalizationBudget(string(finalization.operation), string(finalization.route.Provider))
	record := finalization.auditCtx.settleRecord(finalization.credential, finalization.response.StatusCode, errorCode)
	if successful {
		record.MediaOutputImages = int64(max(0, finalization.requestedCount))
		pricing, priced := estimateImagePricing(finalization.operation, finalization.pricingModel, finalization.pricingResolution, finalization.pricingQuality, finalization.requestedCount, finalization.inputImageCount)
		if priced {
			record.EstimatedCostInUSDTicks = pricing.CostInUSDTicks
			record.PricingModel = pricing.Model
			record.PricingVersion = audit.OfficialPricingAsOf
		}
	}
	s.settleImageQuota(budget, finalization, successful)
	s.persistFinalizationAudit(budget, record, finalization.auditCtx.requestID)
}

// settleImageQuota 推进 Web Imagine 的本地额度围栏与远端窗口刷新。
func (s *Service) settleImageQuota(budget finalizationBudget, finalization *imageFinalization, successful bool) {
	quotaKind, _ := s.providers.QuotaKind(finalization.route.Provider)
	refreshMode, decrementMode, availabilityMode := quotaFinalizationModes(finalization.quotaMode, finalization.quotaRefreshGroup)
	if !successful || quotaKind != provider.QuotaRemoteWindow || refreshMode == "" {
		return
	}
	if decrementMode != "" && decrementMode != "weekly" {
		s.decrementImageQuota(budget, finalization, decrementMode)
	}
	s.accounts.QueueQuotaRefresh(finalization.accountID, refreshMode)
	if availabilityMode != "" && availabilityMode != refreshMode {
		s.accounts.QueueQuotaRefresh(finalization.accountID, availabilityMode)
	}
}

// decrementImageQuota 在收尾预算内扣减 Web 账号的额度窗口并同步本地计数。
func (s *Service) decrementImageQuota(budget finalizationBudget, finalization *imageFinalization, decrementMode string) {
	units := max(1, finalization.response.QuotaUnits)
	var updated bool
	err := budget.run("quota_decrement", finalizationQuotaBudget, func(stageCtx context.Context) error {
		var decrementErr error
		updated, decrementErr = s.accounts.DecrementWebQuota(stageCtx, finalization.accountID, decrementMode, units)
		return decrementErr
	})
	if err != nil {
		s.logger.Warn("web_quota_decrement_failed", "account_id", finalization.accountID, "mode", decrementMode, "units", units, "error", err)
	} else if updated {
		s.selector.ConsumeQuota(finalization.route.Provider, finalization.accountID, decrementMode, units)
	}
}
