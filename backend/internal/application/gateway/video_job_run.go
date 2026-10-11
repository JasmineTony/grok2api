package gateway

import (
	"context"
	"errors"
	"fmt"
	"time"

	account "github.com/chenyme/grok2api/backend/internal/domain/account"
	clientkey "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	media "github.com/chenyme/grok2api/backend/internal/domain/media"
	model "github.com/chenyme/grok2api/backend/internal/domain/model"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	provider "github.com/chenyme/grok2api/backend/internal/ports/provider"
	http "net/http"
)

// videoJobRun 承载一次视频任务运行的上下文与可变状态；各阶段共享同一份任务与租约。
type videoJobRun struct {
	service                *Service
	parent                 context.Context
	ctx                    context.Context
	cancel                 context.CancelFunc
	route                  model.Route
	job                    media.Job
	adapter                provider.VideoAdapter
	egressTrace            *infraegress.Trace
	startedAt              time.Time
	operation              provider.VideoOperation
	duration               int
	aspectRatio            string
	resolution             string
	imageURL               string
	referenceURLs          []string
	referenceAudios        []string
	videoURL               string
	quotaMode              string
	quotaRefreshGroup      string
	attemptPolicy          routingAttemptPolicy
	excluded               map[uint64]bool
	forbiddenEgressRetried map[uint64]bool
	retryPinnedAccountID   uint64
	failureAttempts        *failureAttemptRecorder
	accountScope           clientkey.AccountScope
	releaseInputSlot       func()
	selection              *selectionSession
	lease                  *accountLease
	result                 provider.VideoResult
	lastErr                error
}

// startVideoJobRun 初始化运行上下文、进度续租与输入物化名额；失败时按既有路径收尾。
func (s *Service) startVideoJobRun(parent context.Context, job media.Job, route model.Route) (*videoJobRun, bool) {
	ctx, cancel := context.WithTimeout(parent, videoJobTimeout)
	ctx, egressTrace := infraegress.WithTrace(ctx)
	run := &videoJobRun{
		service: s, parent: parent, ctx: ctx, cancel: cancel, route: route, job: job,
		egressTrace: egressTrace, startedAt: time.Now(),
	}
	run.job.Progress = max(run.job.Progress, 1)
	run.job.UpdatedAt = time.Now().UTC()
	if err := s.mediaJobs.UpdateMediaJob(ctx, run.job); err != nil {
		s.logger.Warn("video_job_progress_write_failed", "job_id", run.job.ID, "error", err)
	}
	releaseInputSlot, err := s.acquireVideoInputSlot(ctx, decodeVideoInput(run.job.InputJSON))
	if err != nil {
		s.deferVideoJob(parent, run.job)
		cancel()
		return nil, false
	}
	run.releaseInputSlot = releaseInputSlot
	return run, true
}

// prepareVideoJobInputs 解析上游适配器、操作类型与输入引用，并按操作修正时长/画幅/分辨率。
func (s *Service) prepareVideoJobInputs(run *videoJobRun) bool {
	adapter, ok := s.providers.Videos(run.route.Provider)
	if !ok {
		s.failVideoJob(run.parent, run.job, "provider_unavailable", ErrNoAvailableAccount, 0, nil)
		return false
	}
	run.adapter = adapter
	operation := provider.VideoOperation(run.job.Operation)
	if operation == "" {
		operation = decodeVideoOperation(run.job.InputJSON)
	}
	run.operation = operation
	imageURL, referenceURLs, referenceAudios, videoURL, err := s.resolveVideoJobInputs(run.ctx, operation, run.job.InputJSON)
	if err != nil {
		s.failVideoJob(run.parent, run.job, "input_unavailable", err, 0, nil)
		return false
	}
	run.imageURL, run.referenceURLs, run.referenceAudios, run.videoURL = imageURL, referenceURLs, referenceAudios, videoURL
	run.duration, run.aspectRatio, run.resolution = run.job.Seconds, run.job.Size, run.job.Quality
	switch operation {
	case provider.VideoOperationEdit:
		run.duration, run.aspectRatio, run.resolution = 0, "", ""
	case provider.VideoOperationExtend:
		run.aspectRatio, run.resolution = "", ""
	}
	return true
}

// initVideoJobPolicy 初始化额度模式、尝试策略、排除集合与 client key 账号范围。
func (s *Service) initVideoJobPolicy(run *videoJobRun) bool {
	run.quotaMode = videoQuotaMode(run.route.Provider, s.providers.QuotaMode(run.route.Provider, run.route.UpstreamModel), run.job.Quality)
	run.quotaRefreshGroup = s.providers.QuotaRefreshGroup(run.route.Provider, run.route.UpstreamModel)
	run.attemptPolicy = s.videoAttemptPolicy()
	run.excluded = make(map[uint64]bool)
	run.forbiddenEgressRetried = make(map[uint64]bool)
	run.failureAttempts = newFailureAttemptRecorder(http.MethodPost, "/videos/generations")
	// 重试回退必须沿用创建阶段 client key 的 provider/tier 作用域，否则 pin 账号失败后的
	// 回退搜索会越过该 key 的账号范围。ClientKeyID==0 只可能来自升级前的历史任务。
	if run.job.ClientKeyID > 0 {
		clientKey, keyErr := s.clientKeys.Get(run.ctx, run.job.ClientKeyID)
		if keyErr != nil {
			s.failVideoJob(run.parent, run.job, "account_unavailable", keyErr, 0, nil)
			return false
		}
		run.accountScope = clientKey.AccountScope()
	}
	return true
}

// videoAttemptAction 表示一轮视频账号尝试结束后循环应采取的动作。
type videoAttemptAction int

const (
	videoAttemptProceed videoAttemptAction = iota
	videoAttemptRetry
	videoAttemptAbort
	videoAttemptSucceed
)

// runAttempts 按运行时尝试策略依次获取账号并执行视频上游请求；返回 true 表示已按失败路径收尾。
func (run *videoJobRun) runAttempts() bool {
	for attempt := 0; run.attemptPolicy.allows(attempt); attempt++ {
		switch run.attemptOnce(attempt) {
		case videoAttemptAbort:
			return true
		case videoAttemptSucceed:
			return false
		}
	}
	return false
}

// attemptOnce 执行一轮账号获取、凭证刷新与上游调用，并返回本轮之后的循环动作。
func (run *videoJobRun) attemptOnce(attempt int) videoAttemptAction {
	s := run.service
	attemptStarted := time.Now()
	if run.lease != nil {
		run.lease.Release()
		run.lease = nil
	}
	if action := s.acquireVideoAttemptLease(run, attempt); action != videoAttemptProceed {
		return action
	}
	run.excluded[run.lease.Credential.ID] = true
	if action := s.refreshVideoAttemptCredential(run, attempt, attemptStarted); action != videoAttemptProceed {
		return action
	}
	if err := s.callVideoUpstream(run); err != nil {
		return s.handleVideoAttemptFailure(run, err, attempt, attemptStarted)
	}
	return videoAttemptSucceed
}

// acquireVideoAttemptLease 获取本轮账号租约：优先固定账号，其次通过选择会话回退。
func (s *Service) acquireVideoAttemptLease(run *videoJobRun, attempt int) videoAttemptAction {
	pinnedAccountID := run.retryPinnedAccountID
	run.retryPinnedAccountID = 0
	if attempt == 0 {
		pinnedAccountID = run.job.AccountID
	}
	var err error
	if pinnedAccountID > 0 && !run.excluded[pinnedAccountID] {
		// 固定账号（首轮为本任务创建时选中的账号，其后为 403 出口重试的同一账号）获取失败时
		// 只排除该账号；错误不能写回 err，否则下面的 selection.Acquire 回退会被跳过，把仍有
		// 健康账号的账号池误判为 account_unavailable。
		pinnedLease, pinnedErr := s.selector.AcquirePinnedForKey(run.ctx, run.route.Provider, pinnedAccountID, run.route.ID, run.route.UpstreamModel, run.quotaMode, true, run.accountScope)
		if pinnedErr != nil {
			run.excluded[pinnedAccountID] = true
		} else {
			run.lease = pinnedLease
		}
	}
	if run.lease == nil {
		if run.selection == nil {
			run.selection, err = s.selector.beginSelectionSessionForKey(run.ctx, run.route.Provider, run.route.ID, run.route.UpstreamModel, run.quotaMode, "", run.excluded, false, run.accountScope)
		}
		if err == nil {
			run.lease, err = run.selection.Acquire(run.ctx, run.excluded, false)
		}
	}
	if err == nil {
		return videoAttemptProceed
	}
	if run.parent.Err() != nil {
		s.deferVideoJob(run.parent, run.job)
		return videoAttemptAbort
	}
	if run.lastErr == nil {
		run.lastErr = err
	}
	s.failVideoJob(run.parent, run.job, "account_unavailable", run.lastErr, 0, run.failureAttempts.snapshot())
	return videoAttemptAbort
}

// refreshVideoAttemptCredential 校验/刷新账号凭证并同步任务上的账号信息。
func (s *Service) refreshVideoAttemptCredential(run *videoJobRun, attempt int, attemptStarted time.Time) videoAttemptAction {
	credential, credErr := s.accounts.EnsureCredential(run.ctx, run.lease.Credential, false)
	if credErr != nil {
		run.failureAttempts.captureCredentialFailure(run.lease.Credential, attemptStarted, false, credErr)
		run.lastErr = credErr
		if run.attemptPolicy.hasNext(attempt) {
			return videoAttemptRetry
		}
		s.failVideoJob(run.parent, run.job, "account_unavailable", credErr, 0, run.failureAttempts.snapshot())
		return videoAttemptAbort
	}
	run.lease.Credential = credential
	if run.job.AccountID != credential.ID || run.job.AccountName != credential.Name {
		run.job.AccountID, run.job.AccountName = credential.ID, credential.Name
		run.job.UpdatedAt = time.Now().UTC()
		_ = s.mediaJobs.UpdateMediaJob(run.ctx, run.job)
	}
	return videoAttemptProceed
}

// callVideoUpstream 调用上游生成视频，并在需要时把远端结果物化到本地资产。
func (s *Service) callVideoUpstream(run *videoJobRun) error {
	lastProgress := run.job.Progress
	result, err := run.adapter.GenerateVideo(run.ctx, provider.VideoRequest{
		Credential: run.lease.Credential, Billing: run.lease.Billing, JobID: run.job.ID, Model: run.route.UpstreamModel,
		Operation: run.operation,
		Prompt:    run.job.Prompt, Duration: run.duration, AspectRatio: run.aspectRatio, Resolution: run.resolution,
		ImageURL: run.imageURL, ReferenceURLs: run.referenceURLs, ReferenceAudios: run.referenceAudios, VideoURL: run.videoURL,
		Progress: func(value int) {
			value = min(99, max(1, value))
			if value-lastProgress < 5 {
				return
			}
			lastProgress = value
			run.job.Progress, run.job.UpdatedAt = value, time.Now().UTC()
			leaseUntil := run.job.UpdatedAt.Add(videoJobLease)
			run.job.LeaseUntil = &leaseUntil
			updateCtx, updateCancel := context.WithTimeout(context.Background(), 3*time.Second)
			_ = s.mediaJobs.UpdateMediaJob(updateCtx, run.job)
			updateCancel()
		},
	})
	if err == nil && result.AssetID == "" && result.URL != "" {
		result, err = s.persistRemoteVideo(run.ctx, run.job.ID, run.adapter, run.lease.Credential, result)
	}
	run.result = result
	return err
}

// handleVideoAttemptFailure 记录失败尝试、分类上游错误，并决定换号重试还是终态收尾。
func (s *Service) handleVideoAttemptFailure(run *videoJobRun, err error, attempt int, attemptStarted time.Time) videoAttemptAction {
	run.lastErr = err
	captureVideoAttempt(run.failureAttempts, run.lease.Credential, attemptStarted, err)
	if run.parent.Err() != nil {
		s.deferVideoJob(run.parent, run.job)
		return videoAttemptAbort
	}
	failureCtx, failureCancel := context.WithTimeout(context.Background(), finalizationTimeout)
	stage, hasStage := provider.VideoErrorStage(err)
	safeCreateFailure := hasStage && stage == provider.VideoStageCreate
	status, hasStatus := provider.ErrorHTTPStatus(err)
	handled, retriableCreate := s.classifyVideoUpstreamFailure(run, failureCtx, err, status, hasStatus, safeCreateFailure)
	if !handled && !provider.IsMediaPostProcessingError(err) {
		s.selector.MarkFailure(failureCtx, run.lease.Credential, 0, 0)
		retriableCreate = safeCreateFailure
	}
	failureCancel()
	applyMediaJobEgress(&run.job, run.egressTrace, run.route.Provider)
	s.logVideoGenerationFailure(run.job, run.lease.Credential, err)
	// Poll/post-processing failures are bound to the already-created upstream job.
	if provider.IsMediaPostProcessingError(err) || (hasStage && stage == provider.VideoStagePoll) || !retriableCreate || !run.attemptPolicy.hasNext(attempt) {
		s.failVideoJobAttempt(run, err, status, hasStatus)
		return videoAttemptAbort
	}
	// Create-stage failure: switch account according to runtime attempt policy.
	return videoAttemptRetry
}

// classifyVideoUpstreamFailure 按状态码归类一次上游失败：标记账号/出口状态并决定能否换号重试。
func (s *Service) classifyVideoUpstreamFailure(run *videoJobRun, failureCtx context.Context, err error, status int, hasStatus, safeCreateFailure bool) (handled, retriableCreate bool) {
	if errors.Is(err, provider.ErrUnauthorized) {
		if run.lease.Credential.AuthType == account.AuthTypeSSO {
			s.markSSOCredentialRejected(failureCtx, run.lease.Credential, fmt.Sprintf("%s SSO credential rejected", run.lease.Credential.Provider))
		}
		return true, safeCreateFailure
	}
	if !hasStatus {
		return false, false
	}
	switch {
	case status == http.StatusUnauthorized && run.lease.Credential.AuthType == account.AuthTypeSSO:
		s.markSSOCredentialRejected(failureCtx, run.lease.Credential, fmt.Sprintf("%s SSO credential rejected", run.lease.Credential.Provider))
		return true, safeCreateFailure
	case status == http.StatusForbidden && s.providers.RetryForbiddenAsEgress(run.lease.Credential.Provider):
		// Web anti-bot 403 is egress-scoped. Retry the same account once so
		// egress invalidation can rebuild the route, then move on normally.
		return true, run.retryForbiddenOnEgress(safeCreateFailure)
	case status == http.StatusForbidden && run.lease.Credential.Provider == account.ProviderBuild:
		if !account.IsBuildSuper(run.lease.Credential, run.lease.Billing) {
			s.selector.MarkFailure(failureCtx, run.lease.Credential, status, 0)
		}
		return true, safeCreateFailure && !account.IsBuildSuper(run.lease.Credential, run.lease.Billing)
	case (status == http.StatusPaymentRequired || status == http.StatusTooManyRequests) && run.lease.QuotaMode != "":
		state, reconcileErr := s.accounts.ReconcileRateLimit(failureCtx, run.lease.Credential.ID, run.lease.QuotaMode, 0)
		s.applyRateLimitReconciliation(failureCtx, run.lease.Credential, status, 0, state, reconcileErr)
		return true, safeCreateFailure
	case status == http.StatusTooManyRequests || status == http.StatusPaymentRequired:
		s.selector.MarkFailure(failureCtx, run.lease.Credential, status, 0)
		return true, safeCreateFailure
	case status >= http.StatusInternalServerError:
		// A 5xx may be returned after the upstream accepted the job. Never
		// switch accounts without an idempotency guarantee.
		return true, false
	default:
		s.selector.MarkFailure(failureCtx, run.lease.Credential, status, 0)
		return true, false
	}
}

// retryForbiddenOnEgress 对出口作用域的 403 在同一账号上安排一次重试。
func (run *videoJobRun) retryForbiddenOnEgress(safeCreateFailure bool) bool {
	if !safeCreateFailure {
		return false
	}
	if !run.forbiddenEgressRetried[run.lease.Credential.ID] {
		run.forbiddenEgressRetried[run.lease.Credential.ID] = true
		run.retryPinnedAccountID = run.lease.Credential.ID
		delete(run.excluded, run.lease.Credential.ID)
	}
	return true
}

// failVideoJobAttempt 把一次终态上游失败映射为客户端可见的失败码并收尾任务。
func (s *Service) failVideoJobAttempt(run *videoJobRun, err error, status int, hasStatus bool) {
	failureCode, publicErr := "generation_failed", err
	upstreamStatus := 0
	if hasStatus {
		upstreamStatus = status
	}
	if errors.Is(err, provider.ErrUnauthorized) || (hasStatus && (status == http.StatusUnauthorized || status == http.StatusForbidden)) {
		failureCode, publicErr = "provider_unavailable", errors.New("上游服务暂不可用")
	} else if hasStatus && status == http.StatusTooManyRequests {
		failureCode = "rate_limited"
	}
	s.failVideoJob(run.parent, run.job, failureCode, publicErr, upstreamStatus, run.failureAttempts.snapshot())
}
