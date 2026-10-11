package gateway

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	neterrorpkg "github.com/chenyme/grok2api/backend/internal/pkg/neterror"
	provider "github.com/chenyme/grok2api/backend/internal/ports/provider"
	http "net/http"
)

// handleUpstreamResponse 分类一次已取得的上游响应；换用刷新后的凭据后会重新分类该响应。
func (state *responseRequestState) handleUpstreamResponse(attempt int, lease *accountLease, credential accountdomain.Credential, response *provider.Response) (*Result, attemptDecision) {
	for {
		if response.ModelCatalogChanged {
			state.service.queueAccountModelSync(credential.ID)
		}
		authenticatedCredential, authenticatedResponse, decision := state.recoverUnauthorizedCredential(lease, credential, response)
		if decision != attemptProceed {
			return nil, decision
		}
		credential, response = authenticatedCredential, authenticatedResponse
		egressForbidden := state.service.providers.RetryForbiddenAsEgress(credential.Provider) && response.StatusCode == http.StatusForbidden
		finalEgressForbidden := egressForbidden && (attempt > 0 || !state.attemptPolicy.hasNext(attempt))
		// Classify 403 bodies before egress retry. Definitive blocked-account signals invalidate and rotate the account;
		// request-level safety rejections are returned as-is without account side effects;
		// all other 403 responses retain the egress retry path without penalizing the account.
		if decision := state.handleForbiddenResponse(lease, credential, response, egressForbidden, finalEgressForbidden); decision != attemptProceed {
			return nil, decision
		}
		if isTerminalRequestForbidden(credential.Provider, state.lastFailure) {
			// already prepared as a terminal 403 response for the client
		} else if isRetryableResponse(response, state.route.Provider) && !finalEgressForbidden {
			replayedCredential, replayedResponse, decision := state.handleRetryableResponseFailure(lease, credential, response)
			if decision == attemptRehandledResponse {
				credential, response = replayedCredential, replayedResponse
				continue
			}
			return nil, decision
		}
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			if decision := state.handleSuccessfulResponse(attempt, lease, credential, response); decision != attemptProceed {
				return nil, decision
			}
		}
		return state.handoffOrQualityFallback(lease, credential, response)
	}
}

// recoverUnauthorizedCredential 处理 401：先排除不可恢复的凭据，再刷新并重放一次请求。
func (state *responseRequestState) recoverUnauthorizedCredential(lease *accountLease, credential accountdomain.Credential, response *provider.Response) (accountdomain.Credential, *provider.Response, attemptDecision) {
	if response.StatusCode != http.StatusUnauthorized {
		return credential, response, attemptProceed
	}
	response.Body.Close()
	if decision := state.rejectUnauthorizedCredential(lease, credential); decision != attemptProceed {
		return credential, response, decision
	}
	state.authRecoveryAttempted[credential.ID] = true
	refreshed, refreshErr := state.ensureCredential(credential, true)
	var forwardErr error
	if refreshErr == nil {
		response, forwardErr = state.forwardResponse(lease, refreshed, lease.Billing)
		credential = refreshed
	}
	if refreshErr != nil || forwardErr != nil {
		return credential, response, state.handleUnauthorizedRefreshFailure(lease, credential, refreshErr, forwardErr)
	}
	if response.StatusCode == http.StatusUnauthorized {
		return credential, response, state.handlePostRefreshUnauthorized(lease, credential, response)
	}
	return credential, response, attemptProceed
}

// rejectUnauthorizedCredential 标记 SSO 失效或永久无法刷新的凭据并结束本次尝试。
func (state *responseRequestState) rejectUnauthorizedCredential(lease *accountLease, credential accountdomain.Credential) attemptDecision {
	if credential.AuthType == accountdomain.AuthTypeSSO {
		state.service.markSSOCredentialRejected(state.ctx, credential, fmt.Sprintf("%s SSO credential rejected", credential.Provider))
		lease.Release()
		state.lastErr = fmt.Errorf("%s SSO 凭据已失效", credential.Provider)
		state.lastFailure = newHTTPUpstreamFailure(http.StatusUnauthorized, nil, credential.ID, credential.Name)
		return attemptNext
	}
	if state.service.markPermanentlyUnrefreshableCredentialRejected(state.ctx, credential) {
		lease.Release()
		state.lastErr = accountapp.ErrCredentialRefreshPermanent
		state.lastFailure = newHTTPUpstreamFailure(http.StatusUnauthorized, nil, credential.ID, credential.Name)
		return attemptNext
	}
	return attemptProceed
}

// handleUnauthorizedRefreshFailure 分类 401 之后的刷新失败或重放失败。
func (state *responseRequestState) handleUnauthorizedRefreshFailure(lease *accountLease, credential accountdomain.Credential, refreshErr, forwardErr error) attemptDecision {
	if errors.Is(refreshErr, accountapp.ErrCredentialRefreshPermanent) {
		state.service.markCredentialRejectedAfterPermanentRefresh(state.ctx, credential)
	}
	lease.Release()
	state.lastErr = firstError(refreshErr, forwardErr)
	if refreshErr != nil {
		state.lastFailure = newCredentialUpstreamFailure(refreshErr, credential.ID, credential.Name)
		return attemptNext
	}
	if state.ctx.Err() != nil || errors.Is(forwardErr, context.Canceled) {
		state.lastFailure = &UpstreamFailure{HTTPStatus: 499, Code: "request_canceled", PublicMessage: "请求已取消", AccountID: credential.ID, AccountName: credential.Name, Cause: firstError(state.ctx.Err(), forwardErr)}
		return attemptStop
	}
	state.lastFailure = newTransportUpstreamFailure(forwardErr, credential.ID, credential.Name)
	if !isRetryableTransportFailure(credential.Provider, forwardErr) {
		return attemptStop
	}
	if shouldStopForNonAccountFingerprint(state.failureFingerprints, state.lastFailure, credential.Provider) {
		return attemptStop
	}
	return attemptNext
}

// handlePostRefreshUnauthorized 处理刷新后仍返回 401 的上游。
func (state *responseRequestState) handlePostRefreshUnauthorized(lease *accountLease, credential accountdomain.Credential, response *provider.Response) attemptDecision {
	body, _ := readRetryableBody(response.Body)
	_ = state.service.accounts.MarkReauthRequired(state.ctx, credential.ID, "Grok Build OAuth credential rejected after refresh")
	state.service.selector.MarkQuotaStateChanged(credential.Provider, credential.ID)
	lease.Release()
	state.lastErr = fmt.Errorf("刷新后上游仍返回 401")
	state.lastFailure = newHTTPUpstreamFailure(http.StatusUnauthorized, body, credential.ID, credential.Name)
	return attemptNext
}

// handleForbiddenResponse 在出口重试之前分类 403 响应体。
func (state *responseRequestState) handleForbiddenResponse(lease *accountLease, credential accountdomain.Credential, response *provider.Response, egressForbidden, finalEgressForbidden bool) attemptDecision {
	if response.StatusCode != http.StatusForbidden {
		return attemptProceed
	}
	retryAfter := parseRetryAfter(response.Header.Get("Retry-After"), time.Now().UTC())
	body, _ := readRetryableBody(response.Body)
	state.lastFailure = newHTTPUpstreamFailure(response.StatusCode, body, credential.ID, credential.Name)
	switch {
	case isTerminalRequestForbidden(credential.Provider, state.lastFailure):
		return state.handleTerminalForbiddenResponse(lease, credential, response, body)
	case state.lastFailure.AccountBlocked:
		failureHandled := state.service.markReauthRequired(state.ctx, state.input.RequestID, credential, fmt.Sprintf("%s account is blocked", credential.Provider))
		if state.lastFailure.AccountScoped && !failureHandled {
			state.service.selector.MarkFailure(state.ctx, credential, response.StatusCode, retryAfter)
		}
		lease.Release()
		state.lastErr = fmt.Errorf("上游返回 %d", response.StatusCode)
		state.service.logger.Warn("upstream_request_failed", "request_id", state.input.RequestID, "account_id", credential.ID, "provider", credential.Provider, "status", response.StatusCode, "upstream_code", state.lastFailure.UpstreamCode, "account_scoped", state.lastFailure.AccountScoped, "account_blocked", true)
		return attemptNext
	case egressForbidden && !finalEgressForbidden:
		// A non-blocking 403 is an egress/browser-session failure and must not penalize the account.
		delete(state.excluded, credential.ID)
		if state.selection != nil {
			state.selection.RetryAccount(credential.ID)
		}
		lease.Release()
		state.lastErr = fmt.Errorf("上游出口会话被拒绝")
		return attemptNext
	default:
		// Restore the consumed final non-blocking 403 body for the common response path.
		response.Body = io.NopCloser(bytes.NewReader(body))
		return attemptProceed
	}
}

// handleTerminalForbiddenResponse 原样返回确定性的请求级 403，不刷新、不换号、不冷却。
func (state *responseRequestState) handleTerminalForbiddenResponse(lease *accountLease, credential accountdomain.Credential, response *provider.Response, body []byte) attemptDecision {
	// Deterministic request-scoped 403: restore the original body and return it
	// without OAuth refresh, account rotation, cooldown, or invalidation.
	response.Body = io.NopCloser(bytes.NewReader(body))
	lease.completeSelectorObservation(false)
	lease.Release()
	if state.lastFailure.SafetyRejection {
		state.service.logger.Warn("upstream_safety_rejection", "request_id", state.input.RequestID, "account_id", credential.ID, "provider", credential.Provider, "status", response.StatusCode, "upstream_code", state.lastFailure.UpstreamCode)
	} else {
		state.service.logger.Warn("upstream_request_scoped_forbidden", "request_id", state.input.RequestID, "account_id", credential.ID, "provider", credential.Provider, "status", response.StatusCode, "upstream_code", state.lastFailure.UpstreamCode)
	}
	// Fall through to the common success/error response path so the client receives the original 403.
	return attemptProceed
}

// handleRetryableResponseFailure 分类可重试的上游失败响应，并决定换号、重放或终止。
func (state *responseRequestState) handleRetryableResponseFailure(lease *accountLease, credential accountdomain.Credential, response *provider.Response) (accountdomain.Credential, *provider.Response, attemptDecision) {
	retryAfter := parseRetryAfter(response.Header.Get("Retry-After"), time.Now().UTC())
	body, _ := readRetryableBody(response.Body)
	state.lastFailure = newHTTPUpstreamFailure(response.StatusCode, body, credential.ID, credential.Name)
	if response.StatusCode == http.StatusTooManyRequests && response.RateLimit == nil {
		if metadata := provider.ParseRateLimitMetadata(body); metadata != nil {
			response.RateLimit = metadata
			if retryAfter <= 0 && metadata.RetryAfter > 0 {
				retryAfter = metadata.RetryAfter
			}
		}
	}
	buildForbiddenReauth := credential.Provider == accountdomain.ProviderBuild && state.service.shouldInvalidateBuildForbidden(state.lastFailure)
	if decision := state.applyTeamModelRateLimit(lease, credential, response); decision != attemptProceed {
		return credential, response, decision
	}
	// Grok Build treats only HTTP 401 as an OAuth authentication failure.
	// A 403 is already authenticated and must not trigger token rotation or
	// replay the same request with freshly issued credentials.
	if credential.Provider != accountdomain.ProviderBuild && state.service.providers.SupportsCredentialRefresh(credential.Provider) && !state.authRecoveryAttempted[credential.ID] && credential.EncryptedRefreshToken != "" && !state.lastFailure.AccountBlocked && !buildForbiddenReauth && (state.lastFailure.PermanentAccountDenial || state.lastFailure.CredentialRejected) {
		state.authRecoveryAttempted[credential.ID] = true
		return state.refreshAndReplayResponse(lease, credential)
	}
	return credential, response, state.applyRetryableFailureHandling(lease, credential, response, retryAfter, body, buildForbiddenReauth)
}

// applyTeamModelRateLimit 按响应中的 Team 与模型限流信息屏蔽整个 Team，命中时结束本次尝试。
func (state *responseRequestState) applyTeamModelRateLimit(lease *accountLease, credential accountdomain.Credential, response *provider.Response) attemptDecision {
	if response.StatusCode != http.StatusTooManyRequests || response.RateLimit == nil || response.RateLimit.Model != state.route.UpstreamModel {
		return attemptProceed
	}
	rateLimitMeta := *response.RateLimit
	if strings.TrimSpace(rateLimitMeta.TeamID) == "" {
		rateLimitMeta.TeamID = strings.TrimSpace(credential.TeamID)
	}
	if rateLimitMeta.TeamID == "" {
		// Team+Model shielding requires a team identity; fall through to account-scoped 429 handling.
		return attemptProceed
	}
	limited := state.service.markTeamModelRateLimit(credential, state.route.UpstreamModel, rateLimitMeta, time.Now().UTC())
	state.lastFailure.AccountScoped = false
	state.lastFailure.Fingerprint = "429:team_model_rate_limit"
	state.lastFailure.RetryAfter = time.Until(limited.Until)
	lease.Release()
	state.lastErr = fmt.Errorf("上游 Team 与模型请求频率受限")
	state.service.logger.Warn("upstream_team_model_rate_limited", "request_id", state.input.RequestID, "provider", credential.Provider, "model", state.route.UpstreamModel, "team_fingerprint", limited.TeamFingerprint, "scope", rateLimitMeta.Scope, "actual", rateLimitMeta.Actual, "limit", rateLimitMeta.Limit, "retry_after", state.lastFailure.RetryAfter)
	return attemptNext
}

// refreshAndReplayResponse 强制刷新凭据并重放请求，成功后要求调用方重新分类响应。
func (state *responseRequestState) refreshAndReplayResponse(lease *accountLease, credential accountdomain.Credential) (accountdomain.Credential, *provider.Response, attemptDecision) {
	refreshed, refreshErr := state.ensureCredential(credential, true)
	if refreshErr != nil {
		lease.Release()
		state.lastErr = refreshErr
		state.lastFailure = newCredentialUpstreamFailure(refreshErr, credential.ID, credential.Name)
		return credential, nil, attemptNext
	}
	response, err := state.forwardResponse(lease, refreshed, lease.Billing)
	credential = refreshed
	if err != nil {
		lease.Release()
		state.lastErr = err
		if state.ctx.Err() != nil || errors.Is(err, context.Canceled) {
			state.lastFailure = &UpstreamFailure{HTTPStatus: 499, Code: "request_canceled", PublicMessage: "请求已取消", AccountID: credential.ID, AccountName: credential.Name, Cause: firstError(state.ctx.Err(), err)}
			return credential, response, attemptStop
		}
		state.lastFailure = newTransportUpstreamFailure(err, credential.ID, credential.Name)
		if !isRetryableTransportFailure(credential.Provider, err) {
			return credential, response, attemptStop
		}
		if shouldStopForNonAccountFingerprint(state.failureFingerprints, state.lastFailure, credential.Provider) {
			return credential, response, attemptStop
		}
		return credential, response, attemptNext
	}
	return credential, response, attemptRehandledResponse
}

// applyRetryableFailureHandling 标记账号状态并按指纹决定是否继续换号。
func (state *responseRequestState) applyRetryableFailureHandling(lease *accountLease, credential accountdomain.Credential, response *provider.Response, retryAfter time.Duration, body []byte, buildForbiddenReauth bool) attemptDecision {
	failureHandled := state.markRetryableAccountState(lease, credential, response, retryAfter, body, buildForbiddenReauth)
	if state.lastFailure.AccountScoped && !failureHandled {
		state.service.selector.MarkFailure(state.ctx, credential, response.StatusCode, retryAfter)
	} else if !state.lastFailure.AccountScoped && response.StatusCode >= http.StatusInternalServerError {
		// Provider-wide 5xx responses should rotate this request and briefly
		// isolate the account across requests, but must not grow the durable
		// account failure count exponentially. Preserve the real status in
		// health diagnostics while applying the explicit soft policy.
		if markErr := state.service.selector.markSoftFailure(state.ctx, credential, response.StatusCode, retryAfter); markErr != nil {
			state.service.logger.Warn("upstream_soft_cooldown_failed", "request_id", state.input.RequestID, "account_id", credential.ID, "provider", credential.Provider, "status", response.StatusCode, "error", markErr)
		}
	}
	lease.Release()
	state.lastErr = fmt.Errorf("上游返回 %d", response.StatusCode)
	state.service.logger.Warn("upstream_request_failed", "request_id", state.input.RequestID, "account_id", credential.ID, "provider", credential.Provider, "status", response.StatusCode, "upstream_code", state.lastFailure.UpstreamCode, "account_scoped", state.lastFailure.AccountScoped)
	if shouldStopForNonAccountFingerprint(state.failureFingerprints, state.lastFailure, credential.Provider) {
		return attemptStop
	}
	return attemptNext
}

// markRetryableAccountState 按额度、封禁与凭据失效信号更新账号状态，返回是否已处理。
func (state *responseRequestState) markRetryableAccountState(lease *accountLease, credential accountdomain.Credential, response *provider.Response, retryAfter time.Duration, body []byte, buildForbiddenReauth bool) bool {
	failureHandled := state.markRetryableQuotaState(lease, credential, response, retryAfter, body)
	if state.lastFailure.AccountBlocked {
		return state.service.markReauthRequired(state.ctx, state.input.RequestID, credential, fmt.Sprintf("%s account is blocked", credential.Provider))
	}
	if buildForbiddenReauth {
		return state.service.markReauthRequired(state.ctx, state.input.RequestID, credential, fmt.Sprintf("%s upstream error code %s matched the invalidation policy", credential.Provider, state.lastFailure.UpstreamCode))
	}
	if state.service.providers.SupportsCredentialRefresh(credential.Provider) && state.lastFailure.PermanentAccountDenial {
		return state.markDeniedAccountAccess(credential, retryAfter) || failureHandled
	}
	if state.service.providers.SupportsCredentialRefresh(credential.Provider) && state.lastFailure.CredentialRejected {
		return state.service.markReauthRequired(state.ctx, state.input.RequestID, credential, fmt.Sprintf("%s credential rejected", credential.Provider))
	}
	return failureHandled
}

// markRetryableQuotaState 处理账号级限流、Free 额度耗尽与付费额度耗尽信号。
func (state *responseRequestState) markRetryableQuotaState(lease *accountLease, credential accountdomain.Credential, response *provider.Response, retryAfter time.Duration, body []byte) bool {
	if lease.QuotaMode != "" && response.StatusCode == http.StatusTooManyRequests {
		reconcileState, reconcileErr := state.service.accounts.ReconcileRateLimit(state.ctx, credential.ID, lease.QuotaMode, retryAfter)
		state.service.applyRateLimitReconciliation(state.ctx, credential, response.StatusCode, retryAfter, reconcileState, reconcileErr)
		return true
	}
	if used, limit, exhausted := parseFreeQuotaExhaustion(body); exhausted {
		// The Free subscription signal is account-scoped, but its billing
		// period is not a reliable reset promise. Probe again after 24 hours.
		state.service.selector.MarkFreeQuotaExhausted(state.ctx, credential, used, limit)
		return true
	}
	if state.lastFailure.ModelQuotaExhausted {
		state.service.selector.MarkModelQuotaExhausted(state.ctx, credential, lease.Billing, state.route.UpstreamModel, retryAfter)
		return true
	}
	if state.lastFailure.FreeQuotaExhausted {
		state.service.selector.MarkFreeQuotaExhausted(state.ctx, credential, 0, 0)
		return true
	}
	if state.lastFailure.SpendingLimitBlocked || state.lastFailure.QuotaExhausted {
		err := state.service.selector.MarkPaymentQuotaExhausted(state.ctx, credential, quotaRecoveryHints{Billing: lease.Billing})
		if err != nil {
			state.service.logger.Error("account_quota_recovery_write_failed", "request_id", state.input.RequestID, "account_id", credential.ID, "provider", credential.Provider, "error", err)
			return false
		}
		return true
	}
	return false
}

// markDeniedAccountAccess 按 Provider 策略标记模型级拒绝或账号 reauth。
func (state *responseRequestState) markDeniedAccountAccess(credential accountdomain.Credential, retryAfter time.Duration) bool {
	if credential.Provider != accountdomain.ProviderBuild {
		return state.service.markReauthRequired(state.ctx, state.input.RequestID, credential, fmt.Sprintf("%s chat endpoint access denied", credential.Provider))
	}
	// 默认 model-scoped，视频拒绝时配额/OAuth 仍可能可用。
	// 开启 markBuildChatDeniedAsReauth 时再额外标 reauth，便于号池摘除。
	// 同时写入模型 block，避免在候选缓存窗口内本请求再次选中。
	modelErr := state.service.selector.MarkModelAccessDenied(state.ctx, credential, state.route.UpstreamModel, retryAfter)
	failureHandled := modelErr == nil
	if modelErr != nil {
		state.service.logger.Error("account_model_access_denied_write_failed", "request_id", state.input.RequestID, "account_id", credential.ID, "provider", credential.Provider, "model", state.route.UpstreamModel, "error", modelErr)
	}
	if state.service.markBuildChatDeniedAsReauth.Load() {
		reauthHandled := state.service.markReauthRequired(state.ctx, state.input.RequestID, credential, fmt.Sprintf("%s chat endpoint access denied", credential.Provider))
		failureHandled = failureHandled || reauthHandled
	}
	return failureHandled
}

// handleSuccessfulResponse 处理 2xx 响应：质量保持、主端点降级回收与交付。
func (state *responseRequestState) handleSuccessfulResponse(attempt int, lease *accountLease, credential accountdomain.Credential, response *provider.Response) attemptDecision {
	state.service.selector.markSuccess(state.ctx, credential, lease.QuotaProbe)
	if state.qualityHoldEnabled {
		if decision := state.applyQualityHold(attempt, lease, credential, response); decision != attemptProceed {
			return decision
		}
	}
	if diagnostic := response.RecoveredPrimaryFailure; diagnostic != nil {
		recoveredFailure := newHTTPUpstreamFailure(diagnostic.StatusCode, diagnostic.Body, credential.ID, credential.Name)
		if recoveredFailure.AccountBlocked || (credential.Provider == accountdomain.ProviderBuild && state.service.shouldInvalidateBuildForbidden(recoveredFailure)) {
			reason := fmt.Sprintf("%s primary endpoint denied account access", credential.Provider)
			if !state.service.markReauthRequired(state.ctx, state.input.RequestID, credential, reason) {
				state.service.selector.MarkModelAccessDenied(state.ctx, credential, state.route.UpstreamModel, 0)
			}
		}
	}
	return attemptProceed
}

// applyQualityHold 侦测降智流并按策略决定重试、拒绝或交付。
func (state *responseRequestState) applyQualityHold(attempt int, lease *accountLease, credential accountdomain.Credential, response *provider.Response) attemptDecision {
	replay, verdict, peekUsage, _, peekErr := peekQualityStream(state.ctx, response.Body, qualityProtocolForOperation(state.operation), state.holdCfg)
	if peekErr != nil {
		return state.handleQualityPeekFailure(lease, credential, response, replay, peekErr)
	}
	response.Body = replay
	hasNextAccount := state.qualityCrossAccountReplay && state.attemptPolicy.hasNext(attempt) && state.qualityAccountAttempts < state.holdCfg.MaxAttempts
	if hasNextAccount {
		hasNextAccount = state.selection != nil && state.selection.hasAvailableCandidate(state.excluded, !state.quotaProbeAttempted)
	}
	commit := CommitQualityHold(verdict, state.qualityAccountAttempts-1, state.holdCfg.MaxAttempts, hasNextAccount, state.holdCfg.OnExhausted)
	if verdict == QualityWithhold {
		state.service.applyMissingThinkingPenalty(state.ctx, state.input.RequestID, credential, state.holdCfg.AccountCooldown)
	}
	deferFailOpenAudit := commit.Action == QualityActionRetry && state.holdCfg.OnExhausted == qualityRetryFailOpen
	if commit.Audit && !deferFailOpenAudit {
		state.service.recordQualityDegraded(state.ctx, state.auditBase, credential, peekUsage, state.startedAt, state.egressTrace, state.route.Provider)
		state.failureAttempts.captureQualityDegraded(credential, state.responseStartedAt)
	}
	if decision := state.applyQualityCommitAction(commit, lease, credential, response, peekUsage, deferFailOpenAudit); decision != attemptProceed {
		return decision
	}
	if !commit.KeepBody {
		_ = response.Body.Close()
		lease.Release()
		return attemptStop
	}
	return attemptProceed
}

// handleQualityPeekFailure 处理质量侦测阶段的读取失败。
func (state *responseRequestState) handleQualityPeekFailure(lease *accountLease, credential accountdomain.Credential, response *provider.Response, replay io.ReadCloser, peekErr error) attemptDecision {
	if replay != nil {
		_ = replay.Close()
	} else {
		_ = response.Body.Close()
	}
	lease.Release()
	state.lastErr = peekErr
	if isClientRequestCancel(state.ctx, peekErr) {
		state.lastFailure = &UpstreamFailure{HTTPStatus: 499, Code: "request_canceled", PublicMessage: "请求已取消", AccountID: credential.ID, AccountName: credential.Name, Cause: firstError(state.ctx.Err(), peekErr)}
		return attemptStop
	}
	state.lastFailure = newTransportUpstreamFailure(peekErr, credential.ID, credential.Name)
	if neterrorpkg.IsUpstreamStreamIdleTimeout(peekErr) || neterrorpkg.IsUpstreamStreamIdleTimeout(context.Cause(state.ctx)) || errors.Is(peekErr, errQualityEmptyStream) {
		state.markIdleQualityPeekPenalty(credential, peekErr)
	}
	if !state.qualityCrossAccountReplay || shouldStopForNonAccountFingerprint(state.failureFingerprints, state.lastFailure, credential.Provider) {
		return attemptStop
	}
	return attemptNext
}

// markIdleQualityPeekPenalty 对空流或空闲超时的账号施加短暂冷却。
func (state *responseRequestState) markIdleQualityPeekPenalty(credential accountdomain.Credential, peekErr error) {
	logPrefix := "quality_peek_idle"
	if errors.Is(peekErr, errQualityEmptyStream) {
		logPrefix = "quality_peek_empty"
	}
	writeCtx, writeCancel := context.WithTimeout(context.WithoutCancel(state.ctx), finalizationTimeout)
	if markErr := state.service.selector.MarkFailureAfterSuccess(writeCtx, credential, http.StatusGatewayTimeout, state.holdCfg.IdleAccountCooldown); markErr != nil {
		state.service.logger.Warn(logPrefix+"_cooldown_failed", "request_id", state.input.RequestID, "account_id", credential.ID, "error", markErr)
	} else {
		state.service.logger.Warn(logPrefix+"_retry", "request_id", state.input.RequestID, "account_id", credential.ID, "cooldown", state.holdCfg.IdleAccountCooldown)
	}
	writeCancel()
}

// applyQualityCommitAction 执行质量保持决策对应的账号与暂存流处理。
func (state *responseRequestState) applyQualityCommitAction(commit QualityCommit, lease *accountLease, credential accountdomain.Credential, response *provider.Response, peekUsage Usage, deferFailOpenAudit bool) attemptDecision {
	switch commit.Action {
	case QualityActionRetry:
		if deferFailOpenAudit {
			state.discardQualityFallback(true)
			state.fallback = &qualityFallback{response: response, lease: lease, credential: credential, usage: peekUsage, upstreamStartedAt: state.responseStartedAt}
			lease.completeSelectorObservation(true)
			lease.Release()
		} else {
			_ = response.Body.Close()
			lease.Release()
		}
		state.lastErr = errQualityDegraded
		state.lastFailure = &UpstreamFailure{
			HTTPStatus: http.StatusServiceUnavailable, Code: ErrorQualityDegraded,
			PublicMessage: "上游响应缺少推理", AccountID: credential.ID, AccountName: credential.Name,
			Cause: errQualityDegraded,
		}
		state.service.logger.Info("quality_degraded_retry", "request_id", state.input.RequestID, "account_id", credential.ID, "quality_attempt", state.qualityAccountAttempts, "output_tokens", peekUsage.OutputTokens)
		return attemptNext
	case QualityActionReject:
		_ = response.Body.Close()
		lease.Release()
		state.lastErr = errQualityDegraded
		state.lastFailure = &UpstreamFailure{
			HTTPStatus: http.StatusServiceUnavailable, Code: ErrorQualityDegraded,
			PublicMessage: "上游响应缺少推理", AccountID: credential.ID, AccountName: credential.Name,
			Cause: errQualityDegraded,
		}
		state.service.logger.Info("quality_degraded_rejected", "request_id", state.input.RequestID, "account_id", credential.ID)
		return attemptStop
	case QualityActionDeliverLast:
		state.discardQualityFallback(true)
		state.service.logger.Info("quality_degraded_deliver_last", "request_id", state.input.RequestID, "account_id", credential.ID, "quality_attempt", state.qualityAccountAttempts, "output_tokens", peekUsage.OutputTokens)
	case QualityActionDeliver:
		state.discardQualityFallback(true)
	}
	return attemptProceed
}
