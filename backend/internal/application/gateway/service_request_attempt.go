package gateway

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	audit "github.com/chenyme/grok2api/backend/internal/domain/audit"
	inferencedomain "github.com/chenyme/grok2api/backend/internal/domain/inference"
	provider "github.com/chenyme/grok2api/backend/internal/ports/provider"
	http "net/http"
)

// qualityFallback 保存 fail_open 策略下暂存的成功流，等待后续尝试或最终交付。
// fail_open retains at most one successful no-thinking stream. The account
// lease is released immediately; the read pump applies upstream backpressure
// until this response is either delivered or replaced by a better one.
type qualityFallback struct {
	response          *provider.Response
	lease             *accountLease
	credential        accountdomain.Credential
	usage             Usage
	upstreamStartedAt time.Time
}

// runAttemptLoop 按尝试策略执行选号与转发；handedOff 表示已产出交付给下游的响应。
func (state *responseRequestState) runAttemptLoop() (*Result, bool) {
	for attempt := 0; state.attemptPolicy.allows(attempt); attempt++ {
		result, decision := state.runAttempt(attempt)
		switch decision {
		case attemptHandedOff:
			return result, true
		case attemptStop:
			return nil, false
		case attemptReuse:
			attempt--
		}
	}
	return nil, false
}

// runAttempt 执行一次尝试，直到产出响应、需要换号或结束尝试循环。
func (state *responseRequestState) runAttempt(attempt int) (*Result, attemptDecision) {
	if state.qualityHoldEnabled && state.qualityAccountAttempts >= state.holdCfg.MaxAttempts {
		return nil, attemptStop
	}
	lease, decision := state.acquireAttemptLease()
	if decision != attemptProceed {
		return nil, decision
	}
	if decision := state.handleActiveTeamModelRateLimit(lease); decision != attemptProceed {
		return nil, decision
	}
	if decision := state.applyQuotaProbeRecovery(lease); decision != attemptProceed {
		return nil, decision
	}
	credential, decision := state.ensureAttemptCredential(lease)
	if decision != attemptProceed {
		return nil, decision
	}
	response, decision := state.forwardAttemptResponse(lease, credential)
	if decision != attemptProceed {
		return nil, decision
	}
	return state.handleUpstreamResponse(attempt, lease, credential, response)
}

// acquireAttemptLease 按固定账号、Response 归属或账号池顺序取得一次上游账号租约。
func (state *responseRequestState) acquireAttemptLease() (*accountLease, attemptDecision) {
	var lease *accountLease
	var err error
	selectionStarted := time.Now()
	switch {
	case state.input.ForcedAccountID != 0:
		lease, err = state.acquireForcedAccountLease()
	case state.ownership != nil:
		lease, err = state.service.selector.AcquirePinnedForKey(state.ctx, state.route.Provider, state.ownership.AccountID, state.route.ID, state.route.UpstreamModel, state.quotaMode, true, state.accountScope)
	case state.input.ForcedEgressNodeID != 0:
		lease, err = state.service.selector.AcquireForKeyOnEgressNode(state.ctx, state.route.Provider, state.route.ID, state.route.UpstreamModel, state.quotaMode, state.affinityKey, state.excluded, !state.quotaProbeAttempted, state.accountScope, state.input.ForcedEgressNodeID)
	default:
		lease, err = state.acquirePooledLease()
	}
	state.timing.markSelection(time.Since(selectionStarted))
	if err != nil {
		state.recordSelectionFailure(err)
		return nil, attemptStop
	}
	state.excluded[lease.Credential.ID] = true
	return lease, attemptProceed
}

// acquireForcedAccountLease 取得管理员探测固定的账号租约，并拒绝与强制出口冲突的绑定。
func (state *responseRequestState) acquireForcedAccountLease() (*accountLease, error) {
	if state.input.ForcedEgressNodeID == 0 {
		return nil, &SelectionUnavailableError{Reason: SelectionNoAccounts}
	}
	lease, err := state.service.selector.AcquirePinnedForQualityProbe(state.ctx, state.route.Provider, state.input.ForcedAccountID, state.route.ID, state.route.UpstreamModel, state.quotaMode, state.accountScope)
	// An unbound account can still have reached the observed node through
	// runtime pool selection. The Provider request below carries the forced
	// node explicitly; only a conflicting concrete binding is invalid.
	if err == nil && lease.Credential.EgressNodeID != 0 && lease.Credential.EgressNodeID != state.input.ForcedEgressNodeID {
		lease.Release()
		lease = nil
		err = &SelectionUnavailableError{Reason: SelectionNoAccounts}
	}
	return lease, err
}

// acquirePooledLease 复用候选快照并在账号池内取得下一个可用租约。
func (state *responseRequestState) acquirePooledLease() (*accountLease, error) {
	var err error
	if state.selection == nil {
		state.selection, err = state.service.selector.beginSelectionSessionForKey(state.ctx, state.route.Provider, state.route.ID, state.route.UpstreamModel, state.quotaMode, state.affinityKey, state.excluded, !state.quotaProbeAttempted, state.accountScope)
	}
	if err != nil {
		return nil, err
	}
	return state.selection.Acquire(state.ctx, state.excluded, !state.quotaProbeAttempted)
}

// recordSelectionFailure 记录选号失败，并在尚无上游失败时保留原始错误。
func (state *responseRequestState) recordSelectionFailure(err error) {
	if state.lastFailure == nil {
		state.lastErr = err
	}
	pinnedID := uint64(0)
	if state.ownership != nil {
		pinnedID = state.ownership.AccountID
	} else if state.input.ForcedAccountID != 0 {
		pinnedID = state.input.ForcedAccountID
	}
	state.failureAttempts.captureSelectionFailure(pinnedID, "", err)
}

// handleActiveTeamModelRateLimit 直接返回已缓存的 Team 与模型限流，避免空转或同号重放。
func (state *responseRequestState) handleActiveTeamModelRateLimit(lease *accountLease) attemptDecision {
	limited, ok := state.service.activeTeamModelRateLimit(lease.Credential, state.route.UpstreamModel, time.Now().UTC())
	if !ok {
		return attemptProceed
	}
	lease.Release()
	state.lastFailure = &UpstreamFailure{
		HTTPStatus: http.StatusTooManyRequests, Code: "upstream_rate_limited", PublicMessage: "上游请求频率受限",
		AccountID: lease.Credential.ID, AccountName: lease.Credential.Name,
		Fingerprint: "429:team_model_rate_limit", RetryAfter: time.Until(limited.Until),
	}
	state.lastErr = fmt.Errorf("上游 Team 与模型请求频率受限")
	state.service.logger.Warn("upstream_team_model_rate_limit_active", "request_id", state.input.RequestID, "account_id", lease.Credential.ID, "provider", state.route.Provider, "model", state.route.UpstreamModel, "team_fingerprint", limited.TeamFingerprint, "retry_after", state.lastFailure.RetryAfter.Round(time.Second))
	// Stored Responses are pinned to one account. Return the cached 429
	// immediately instead of spinning until the cooldown expires or
	// replaying the request on the same account.
	if state.ownership != nil || state.input.ForcedAccountID != 0 {
		return attemptStop
	}
	return attemptReuse
}

// applyQuotaProbeRecovery 在付费额度恢复探测成功后放开本号，失败则换号重试。
func (state *responseRequestState) applyQuotaProbeRecovery(lease *accountLease) attemptDecision {
	if lease.QuotaProbe {
		state.quotaProbeAttempted = true
	}
	if lease.QuotaProbeKind != accountdomain.QuotaRecoveryKindPaid {
		return attemptProceed
	}
	recovered, probeErr := state.service.accounts.ProbePaidQuota(state.ctx, lease.Credential)
	state.service.selector.MarkQuotaStateChanged(lease.Credential.Provider, lease.Credential.ID)
	if probeErr != nil || !recovered {
		lease.Release()
		state.lastErr = firstError(probeErr, fmt.Errorf("付费额度尚未恢复"))
		return attemptNext
	}
	lease.QuotaProbe = false
	lease.QuotaProbeKind = ""
	lease.Billing = nil
	return attemptProceed
}

// ensureAttemptCredential 校验并刷新本次尝试使用的凭据。
func (state *responseRequestState) ensureAttemptCredential(lease *accountLease) (accountdomain.Credential, attemptDecision) {
	credential, err := state.ensureCredential(lease.Credential, false)
	if err != nil {
		lease.Release()
		state.lastErr = err
		state.lastFailure = newCredentialUpstreamFailure(err, lease.Credential.ID, lease.Credential.Name)
		return accountdomain.Credential{}, attemptNext
	}
	if state.qualityHoldEnabled {
		state.qualityAccountAttempts++
	}
	return credential, attemptProceed
}

// forwardAttemptResponse 转发一次上游请求，并把传输层失败分类为可重试或终止。
func (state *responseRequestState) forwardAttemptResponse(lease *accountLease, credential accountdomain.Credential) (*provider.Response, attemptDecision) {
	response, err := state.forwardResponse(lease, credential, lease.Billing)
	if err == nil {
		return response, attemptProceed
	}
	lease.Release()
	state.lastErr = err
	if state.ctx.Err() != nil || errors.Is(err, context.Canceled) {
		state.lastFailure = &UpstreamFailure{HTTPStatus: 499, Code: "request_canceled", PublicMessage: "请求已取消", AccountID: credential.ID, AccountName: credential.Name, Cause: firstError(state.ctx.Err(), err)}
		return nil, attemptStop
	}
	if isSSOCredentialRejected(err, credential) {
		state.service.markSSOCredentialRejected(state.ctx, credential, fmt.Sprintf("%s SSO credential rejected", credential.Provider))
		state.lastFailure = newHTTPUpstreamFailure(http.StatusUnauthorized, nil, credential.ID, credential.Name)
		return nil, attemptNext
	}
	state.lastFailure = newTransportUpstreamFailure(err, credential.ID, credential.Name)
	if !isRetryableTransportFailure(credential.Provider, err) {
		return nil, attemptStop
	}
	// The failed response is safe to retry on another account only when
	// doing so cannot repeat an upstream-hosted tool side effect.
	if state.applyTransportFailureHealthPenalty(credential, err) && qualityRequestHasReplayUnsafeHostedTools(state.input.Body) {
		return nil, attemptStop
	}
	if shouldStopForNonAccountFingerprint(state.failureFingerprints, state.lastFailure, credential.Provider) {
		return nil, attemptStop
	}
	return nil, attemptNext
}

// applyTransportFailureHealthPenalty 记录传输层失败的账号健康状态，返回是否属于响应级失败。
func (state *responseRequestState) applyTransportFailureHealthPenalty(credential accountdomain.Credential, err error) bool {
	status, retryAfter, classified := upstreamResponseErrorHealthPenalty(err, state.holdCfg.IdleAccountCooldown)
	if !classified {
		state.service.selector.MarkFailure(state.ctx, credential, 0, 0)
		return false
	}
	writeCtx, writeCancel := context.WithTimeout(context.WithoutCancel(state.ctx), finalizationTimeout)
	markErr := state.service.selector.MarkFailureAfterSuccess(writeCtx, credential, status, retryAfter)
	writeCancel()
	if markErr != nil {
		state.service.logger.Warn("upstream_response_health_write_failed", "request_id", state.input.RequestID, "account_id", credential.ID, "error", markErr)
	} else {
		state.service.logger.Warn("upstream_response_health_retry", "request_id", state.input.RequestID, "account_id", credential.ID, "status", status, "minimum_cooldown", retryAfter)
	}
	return true
}

// forwardResponse 通过适配器转发一次 Responses 请求，并记录上游耗时与首次响应头。
func (state *responseRequestState) forwardResponse(lease *accountLease, credential accountdomain.Credential, billing *accountdomain.Billing) (*provider.Response, error) {
	started := time.Now()
	state.responseStartedAt = started
	lease.markSelectorUpstreamStarted()
	response, err := state.adapter.ForwardResponse(state.physicalCallCtx, provider.ResponseResourceRequest{Credential: credential, ForcedEgressNodeID: state.input.ForcedEgressNodeID, Billing: billing, Method: http.MethodPost, Path: state.path, Model: state.route.UpstreamModel, PromptCacheKey: state.input.PromptCacheKey, ReasoningReplayKey: state.reasoningReplayKey, AllowClientToolCacheRoute: state.input.AllowClientToolCacheRoute, GrokTurnIndex: state.input.GrokTurnIndex, IdempotencyID: state.idempotencyID, Body: state.input.Body, Streaming: state.input.Streaming, NormalizeBody: true, Operation: string(state.operation), NormalizedMetadata: state.normalizedMetadata})
	state.auditBase.ReasoningEffort = state.normalizedMetadata.ReasoningEffort
	err = state.failureAttempts.captureResponse(credential, started, response, err)
	state.timing.markUpstream(time.Since(started))
	return response, err
}

// ensureCredential 校验或强制刷新凭据，并记录凭据阶段耗时。
func (state *responseRequestState) ensureCredential(credential accountdomain.Credential, force bool) (accountdomain.Credential, error) {
	started := time.Now()
	result, err := state.service.accounts.EnsureCredential(state.ctx, credential, force)
	state.failureAttempts.captureCredentialFailure(credential, started, force, err)
	state.timing.markCredential(time.Since(started))
	return result, err
}

// handoffResponse 包装上游响应为下游可消费的结果，并把收尾动作绑定到同一个 once。
func (state *responseRequestState) handoffResponse(response *provider.Response, lease *accountLease, credential accountdomain.Credential, upstreamStartedAt time.Time) *Result {
	accountID := credential.ID
	var once sync.Once
	finalize := func(usage Usage, responseID, errorCode string) {
		once.Do(func() {
			state.finalizeResponse(response, lease, credential, accountID, upstreamStartedAt, usage, responseID, errorCode)
		})
	}
	response.Body = &firstByteReadCloser{ReadCloser: response.Body, mark: state.timing.markFirstBody}
	recordStreamFailure := func(diagnostic StreamFailureDiagnostic) {
		state.failureAttempts.captureStreamFailure(credential, upstreamStartedAt, response, diagnostic)
	}
	var markFirstToken func()
	if state.firstToken != nil {
		markFirstToken = state.firstToken.mark
	}
	state.timingHandedOff = true
	return &Result{StatusCode: response.StatusCode, Status: response.Status, Header: response.Header, Body: &finalizingBody{ReadCloser: response.Body, finalize: func() { finalize(Usage{}, "", "stream_closed") }}, MarkFirstToken: markFirstToken, RecordStreamFailure: recordStreamFailure, Finalize: finalize}
}

// finalizeResponse 在第一次收尾时落库用量、健康、归属与额度状态。
func (state *responseRequestState) finalizeResponse(response *provider.Response, lease *accountLease, credential accountdomain.Credential, accountID uint64, upstreamStartedAt time.Time, usage Usage, responseID, errorCode string) {
	// HTTP 状态码保留线上真实值；流在 2xx 响应头之后失败时由 errorCode
	// 决定最终结果，避免把协议状态与业务结果混为一谈。
	successful := auditRequestSucceeded(response.StatusCode, errorCode)
	lease.completeSelectorObservation(successful)
	budget := newFinalizationBudget(string(state.operation), string(state.route.Provider))
	if isUpstreamStreamFailure(errorCode) {
		status, retryAfter := streamFailureHealthPenalty(errorCode, usage, state.service.qualityRetryConfig().IdleAccountCooldown)
		if err := budget.run("account_health", finalizationHealthBudget, func(stageCtx context.Context) error {
			return state.service.selector.MarkFailureAfterSuccess(stageCtx, credential, status, retryAfter)
		}); err != nil {
			state.service.logger.Warn("stream_failure_health_write_failed", "account_id", credential.ID, "provider", credential.Provider, "error", err)
		}
	}
	lease.Release()
	now := time.Now().UTC()
	record := state.buildUsageAuditRecord(response, credential, accountID, upstreamStartedAt, usage, errorCode, successful, now)
	if state.supportsStoredResponses && state.operation == audit.OperationResponses && responseID != "" && successful {
		state.saveResponseOwnership(budget, responseID, accountID, now)
	}
	if successful && lease.QuotaMode != "" {
		state.decrementLeaseQuota(budget, lease, credential, response, accountID)
	}
	state.service.persistFinalizationAudit(budget, record, state.input.RequestID)
	if usage.ResponseModel != "" {
		_ = budget.run("observed_model", finalizationMetadataBudget, func(stageCtx context.Context) error {
			return state.service.accounts.ObserveResponseModel(stageCtx, accountID, usage.ResponseModel)
		})
	}
	if successful && lease.QuotaMode != "" {
		if quotaKind, _ := state.service.providers.QuotaKind(credential.Provider); quotaKind == provider.QuotaRemoteWindow {
			state.service.accounts.QueueQuotaRefresh(accountID, lease.QuotaMode)
		}
	}
	outcome := "failed"
	if successful {
		outcome = "success"
	}
	state.timing.finish(state.service.logger, outcome)
}

// buildUsageAuditRecord 组装本次上游响应对应的用量审计记录。
func (state *responseRequestState) buildUsageAuditRecord(response *provider.Response, credential accountdomain.Credential, accountID uint64, upstreamStartedAt time.Time, usage Usage, errorCode string, successful bool, now time.Time) audit.Record {
	record := state.auditBase
	if usage.Reported {
		record.UsageSource = state.usageSource
	}
	record.AccountID = &accountID
	record.AccountName = credential.Name
	record.StatusCode = response.StatusCode
	record.InputTokens = usage.InputTokens
	record.CachedInputTokens = usage.CachedInputTokens
	record.OutputTokens = usage.OutputTokens
	record.ReasoningTokens = usage.ReasoningTokens
	record.TotalTokens = usage.TotalTokens
	record.CostInUSDTicks = usage.CostInUSDTicks
	applyUsagePricing(&record, state.pricingModel, response, usage, successful)
	record.NumSourcesUsed = usage.NumSourcesUsed
	record.NumServerSideToolsUsed = usage.NumServerSideToolsUsed
	record.ContextInputTokens = usage.ContextInputTokens
	record.ContextOutputTokens = usage.ContextOutputTokens
	if successful && state.input.Streaming {
		record.FirstTokenMS = state.firstToken.milliseconds()
	}
	record.DurationMS = time.Since(state.startedAt).Milliseconds()
	record.ErrorCode = errorCode
	if !successful && response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices {
		state.failureAttempts.ensureStreamFailureAttempt(credential, upstreamStartedAt, response, errorCode)
	}
	attempts := state.failureAttempts.snapshot()
	if !successful || len(attempts) > 0 {
		record.Attempts = attempts
	}
	record.CreatedAt = now
	applyAuditEgress(&record, state.egressTrace, state.route.Provider)
	return record
}

// applyUsagePricing 按官方价目估算本次响应的图片与 token 成本。
func applyUsagePricing(record *audit.Record, pricingModel string, response *provider.Response, usage Usage, successful bool) {
	imagePricing, imagePriced := audit.EstimateOfficialImageCost(pricingModel, "", "", response.QuotaUnits)
	if imagePriced {
		record.MediaOutputImages = int64(max(0, response.QuotaUnits))
	}
	tokenPricing, tokenPriced := audit.EstimateOfficialCost(pricingModel, usage.InputTokens, usage.CachedInputTokens, usage.OutputTokens, usage.ContextInputTokens)
	if successful && imagePriced {
		record.EstimatedCostInUSDTicks = imagePricing.CostInUSDTicks
		record.PricingModel = imagePricing.Model
		record.PricingVersion = audit.OfficialPricingAsOf
	} else if tokenPriced {
		record.EstimatedCostInUSDTicks = tokenPricing.CostInUSDTicks
		record.PricingModel = tokenPricing.Model
		record.PricingVersion = audit.OfficialPricingAsOf
	}
}

// saveResponseOwnership 保存 response_id 到账号的归属，便于后续轮次复用同一账号。
func (state *responseRequestState) saveResponseOwnership(budget finalizationBudget, responseID string, accountID uint64, now time.Time) {
	err := budget.run("response_ownership", finalizationOwnershipBudget, func(stageCtx context.Context) error {
		return state.service.responses.Save(stageCtx, inferencedomain.ResponseOwnership{ResponseID: responseID, AccountID: accountID, ClientKeyID: state.input.ClientKey.ID, ModelRouteID: state.route.ID, Provider: state.route.Provider, PromptCacheKey: state.ownershipPromptCacheKey, ReasoningReplayKey: state.reasoningReplayKey, ExpiresAt: now.Add(responseOwnershipTTL), CreatedAt: now, UpdatedAt: now})
	})
	if err != nil {
		state.service.logger.Error("response_ownership_save_failed", "response_id", responseID, "client_key_id", state.input.ClientKey.ID, "account_id", accountID, "provider", state.route.Provider, "error", err)
	}
}

// decrementLeaseQuota 在成功交付后扣减非周窗口账号的额度。
func (state *responseRequestState) decrementLeaseQuota(budget finalizationBudget, lease *accountLease, credential accountdomain.Credential, response *provider.Response, accountID uint64) {
	if lease.QuotaMode == "weekly" {
		return
	}
	units := max(1, response.QuotaUnits)
	var updated bool
	err := budget.run("quota_decrement", finalizationQuotaBudget, func(stageCtx context.Context) error {
		var decrementErr error
		updated, decrementErr = state.service.accounts.DecrementQuota(stageCtx, accountID, lease.QuotaMode, units)
		return decrementErr
	})
	if err != nil {
		state.service.logger.Warn("provider_quota_decrement_failed", "provider", credential.Provider, "account_id", accountID, "mode", lease.QuotaMode, "units", units, "error", err)
	} else if updated {
		state.service.selector.ConsumeQuota(credential.Provider, accountID, lease.QuotaMode, units)
	}
}

// discardQualityFallback 关闭并丢弃暂存的 fail_open 流。
func (state *responseRequestState) discardQualityFallback(recordDegraded bool) {
	if state.fallback == nil {
		return
	}
	if recordDegraded {
		state.service.recordQualityDegraded(state.ctx, state.auditBase, state.fallback.credential, state.fallback.usage, state.startedAt, state.egressTrace, state.route.Provider)
		state.failureAttempts.captureQualityDegraded(state.fallback.credential, state.fallback.upstreamStartedAt)
	}
	_ = state.fallback.response.Body.Close()
	state.fallback = nil
}

// handoffOrQualityFallback 优先交付暂存的 fail_open 流，否则交付本次响应。
func (state *responseRequestState) handoffOrQualityFallback(lease *accountLease, credential accountdomain.Credential, response *provider.Response) (*Result, attemptDecision) {
	if state.fallback != nil && state.holdCfg.OnExhausted == qualityRetryFailOpen {
		_ = response.Body.Close()
		lease.completeSelectorObservation(false)
		lease.Release()
		selected := state.fallback
		state.fallback = nil
		state.service.logger.Info("quality_degraded_fallback", "request_id", state.input.RequestID, "account_id", selected.credential.ID, "quality_attempts", state.qualityAccountAttempts)
		return state.handoffResponse(selected.response, selected.lease, selected.credential, selected.upstreamStartedAt), attemptHandedOff
	}
	return state.handoffResponse(response, lease, credential, state.responseStartedAt), attemptHandedOff
}

// drainQualityFallback 在尝试循环结束后交付暂存的 fail_open 流。
func (state *responseRequestState) drainQualityFallback() (*Result, bool) {
	if state.fallback == nil {
		return nil, false
	}
	if state.ctx.Err() == nil && state.holdCfg.OnExhausted == qualityRetryFailOpen {
		selected := state.fallback
		state.fallback = nil
		state.service.logger.Info("quality_degraded_fallback", "request_id", state.input.RequestID, "account_id", selected.credential.ID, "quality_attempts", state.qualityAccountAttempts)
		return state.handoffResponse(selected.response, selected.lease, selected.credential, selected.upstreamStartedAt), true
	}
	state.discardQualityFallback(true)
	return nil, false
}

// finalizeUnavailableRequest 在尝试循环结束后落库失败审计并返回下游可见错误。
func (state *responseRequestState) finalizeUnavailableRequest() error {
	if state.lastFailure != nil {
		return state.persistLastFailureAudit()
	}
	if state.lastErr == nil {
		state.lastErr = ErrNoAvailableAccount
	}
	return state.persistUnavailableAudit()
}

// persistLastFailureAudit 落库最后一次上游失败审计，并原样返回该失败。
func (state *responseRequestState) persistLastFailureAudit() error {
	record := state.auditBase
	record.StatusCode = state.lastFailure.HTTPStatus
	record.DurationMS = time.Since(state.startedAt).Milliseconds()
	record.ErrorCode = state.lastFailure.AuditCode()
	record.Attempts = state.failureAttempts.snapshot()
	record.CreatedAt = time.Now().UTC()
	applyAuditEgress(&record, state.egressTrace, state.route.Provider)
	if state.lastFailure.AccountID != 0 {
		accountID := state.lastFailure.AccountID
		record.AccountID = &accountID
		record.AccountName = state.lastFailure.AccountName
	}
	state.service.persistFailureAudit(record, state.input.RequestID)
	return state.lastFailure
}

// persistUnavailableAudit 在没有上游失败分类时按选号不可用落库审计。
func (state *responseRequestState) persistUnavailableAudit() error {
	record := state.auditBase
	record.StatusCode = http.StatusServiceUnavailable
	record.DurationMS = time.Since(state.startedAt).Milliseconds()
	record.ErrorCode = "upstream_unavailable"
	var selectionFailure *SelectionUnavailableError
	if errors.As(state.lastErr, &selectionFailure) {
		record.StatusCode = selectionFailure.HTTPStatus()
		record.ErrorCode = selectionFailure.Code()
		if selectionFailure.AccountID != 0 {
			accountID := selectionFailure.AccountID
			record.AccountID = &accountID
			record.AccountName = selectionFailure.AccountName
		}
	}
	if record.AccountID == nil && state.ownership != nil {
		accountID := state.ownership.AccountID
		record.AccountID = &accountID
	}
	record.Attempts = state.failureAttempts.snapshot()
	record.CreatedAt = time.Now().UTC()
	applyAuditEgress(&record, state.egressTrace, state.route.Provider)
	state.service.persistFailureAudit(record, state.input.RequestID)
	return fmt.Errorf("%w: %w", ErrNoAvailableAccount, state.lastErr)
}
