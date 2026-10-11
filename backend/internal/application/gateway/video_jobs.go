package gateway

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	account "github.com/chenyme/grok2api/backend/internal/domain/account"
	audit "github.com/chenyme/grok2api/backend/internal/domain/audit"
	clientkey "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	media "github.com/chenyme/grok2api/backend/internal/domain/media"
	model "github.com/chenyme/grok2api/backend/internal/domain/model"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	provider "github.com/chenyme/grok2api/backend/internal/ports/provider"
	http "net/http"
)

func routesForVideoParameters(routes []model.Route, operation provider.VideoOperation, resolution string, hasImage bool, referenceCount, duration int) ([]model.Route, error) {
	if len(routes) == 0 {
		return routes, nil
	}
	compatible := make([]model.Route, 0, len(routes))
	var firstErr error
	for _, candidate := range routes {
		if err := validateVideoRouteParameters(candidate.Provider, operation, candidate.UpstreamModel, resolution, hasImage, referenceCount, duration); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		compatible = append(compatible, candidate)
	}
	if len(compatible) == 0 && firstErr != nil {
		return nil, firstErr
	}
	return compatible, nil
}

// Console 视频输入的上限与时长按「Provider + 入口字段 + 上游模型」分档。
// /v1/videos/generations 是异步接口，只在 adapter 层拦截会产出必然失败的任务；
// adapter 仍保留同一约束，作为最终出站边界的防御校验。
func validateVideoRouteParameters(providerValue account.Provider, operation provider.VideoOperation, upstreamModel, resolution string, hasImage bool, referenceCount, duration int) error {
	if operation != provider.VideoOperationGenerate {
		return nil
	}
	trimmedModel := strings.TrimSpace(upstreamModel)
	hasReferences := referenceCount > 0
	if providerValue == account.ProviderWeb && (hasImage || hasReferences) {
		return fmt.Errorf("%w: Grok Web 当前仅支持文本生视频；图片视频请使用 Build 或 Console Provider", ErrVideoOperationUnsupported)
	}
	if providerValue == account.ProviderConsole && (trimmedModel == "grok-imagine-video" || trimmedModel == "grok-imagine-video-1.5") {
		// 实测：8 张 reference_images 上游回 400
		// "Too many reference images: 8. Maximum allowed is 7."（两个视频模型一致）。
		if referenceCount > provider.ConsoleVideoMaxReferenceImages {
			return fmt.Errorf("%w: Console reference_images 最多 %d 张，当前为 %d 张", ErrVideoParameterInvalid, provider.ConsoleVideoMaxReferenceImages, referenceCount)
		}
		// 实测：grok-imagine-video 的 reference-to-video 上游回 400
		// "Duration 15s exceeds the maximum allowed for reference-to-video, which is 10s."；
		// 走 image 字段的 image-to-video 与 grok-imagine-video-1.5 都保持 15s。
		if trimmedModel == "grok-imagine-video" && hasReferences && duration > provider.ConsoleVideoMaxReferenceDurationSeconds {
			return fmt.Errorf("%w: Console %s 的参考图生视频最长 %d 秒，当前为 %d 秒", ErrVideoParameterInvalid, trimmedModel, provider.ConsoleVideoMaxReferenceDurationSeconds, duration)
		}
	}
	if !strings.EqualFold(strings.TrimSpace(resolution), "1080p") {
		return nil
	}
	if trimmedModel != "grok-imagine-video-1.5" {
		return fmt.Errorf("%w: %s 不支持 1080p", ErrVideoOperationUnsupported, upstreamModel)
	}
	if hasReferences {
		return fmt.Errorf("%w: reference_images 模式最高支持 720p", ErrVideoOperationUnsupported)
	}
	return nil
}

func routesForVideoOperation(routes []model.Route, operation provider.VideoOperation) ([]model.Route, error) {
	if operation == provider.VideoOperationGenerate {
		return routes, nil
	}
	compatible := make([]model.Route, 0, len(routes))
	for _, candidate := range routes {
		if candidate.Provider == account.ProviderConsole && strings.TrimSpace(candidate.UpstreamModel) == "grok-imagine-video" {
			compatible = append(compatible, candidate)
		}
	}
	if len(compatible) == 0 {
		return nil, ErrVideoOperationUnsupported
	}
	return compatible, nil
}

func resolveVideoPricing(operation provider.VideoOperation, upstreamModel, resolution string, duration, inputImages int) (audit.PricingResult, bool) {
	if operation == provider.VideoOperationGenerate {
		return audit.EstimateOfficialVideoCost(upstreamModel, resolution, duration, inputImages)
	}
	return audit.PricingResult{}, false
}

func (s *Service) getVideoJob(ctx context.Context, id string, key clientkey.Key) (media.Job, error) {
	if s.mediaJobs == nil {
		return media.Job{}, ErrResponseNotFound
	}
	job, err := s.mediaJobs.GetMediaJob(ctx, id, key.ID)
	if err != nil {
		return media.Job{}, ErrResponseNotFound
	}
	return job, nil
}

// GetVideo returns the client-facing job state. A result asset is exposed only
// while the local object can still be opened; completed assets are eligible for
// capacity cleanup, and a stale asset ID would otherwise produce a dead public URL.
func (s *Service) GetVideo(ctx context.Context, id string, key clientkey.Key) (media.Job, error) {
	job, err := s.getVideoJob(ctx, id, key)
	if err != nil {
		return media.Job{}, err
	}
	if job.Status != media.StatusCompleted || strings.TrimSpace(job.ResultAssetID) == "" {
		return job, nil
	}
	if s.mediaAssets == nil {
		job.ResultAssetID = ""
		return job, nil
	}
	_, body, openErr := s.mediaAssets.OpenVideo(ctx, job.ResultAssetID)
	if openErr != nil || body == nil {
		job.ResultAssetID = ""
		return job, nil
	}
	_ = body.Close()
	return job, nil
}

func (s *Service) OpenVideoContent(ctx context.Context, id string, key clientkey.Key) (io.ReadCloser, string, int64, error) {
	job, err := s.getVideoJob(ctx, id, key)
	if err != nil {
		return nil, "", 0, err
	}
	if job.Status != media.StatusCompleted {
		return nil, "", 0, fmt.Errorf("视频内容尚未可用")
	}
	// 本地资产优先：XAI ZDR 上传完成后不经公网回环下载。
	if job.ResultAssetID != "" && s.mediaAssets != nil {
		asset, body, openErr := s.mediaAssets.OpenVideo(ctx, job.ResultAssetID)
		if openErr == nil {
			return body, asset.MIMEType, asset.SizeBytes, nil
		}
	}
	if job.UpstreamURL == "" {
		return nil, "", 0, fmt.Errorf("视频内容尚未可用")
	}
	adapter, ok := s.providers.Videos(account.Provider(job.Provider))
	if !ok {
		return nil, "", 0, ErrResponseAccountUnavailable
	}
	downloader, ok := adapter.(provider.VideoContentDownloader)
	if !ok || s.selector == nil || s.selector.accounts == nil || s.accounts == nil {
		return nil, "", 0, ErrResponseAccountUnavailable
	}
	credential, err := s.selector.accounts.Get(ctx, job.AccountID)
	if err != nil {
		return nil, "", 0, ErrResponseAccountUnavailable
	}
	credential, err = s.accounts.EnsureCredential(ctx, credential, false)
	if err != nil {
		return nil, "", 0, ErrResponseAccountUnavailable
	}
	return downloader.DownloadVideo(ctx, credential, job.UpstreamURL)
}

func (s *Service) RecoverVideoJobs(ctx context.Context) error {
	if s.mediaJobs == nil {
		return nil
	}
	usageErr := s.reconcileVideoUsage(ctx)
	values, err := s.mediaJobs.ListRecoverableMediaJobs(ctx, 1000)
	if err != nil {
		return errors.Join(usageErr, err)
	}
	for _, job := range values {
		if !s.enqueueVideoJob(job.ID) {
			break
		}
	}
	return usageErr
}

func (s *Service) runVideoJob(parent context.Context, job media.Job, route model.Route) {
	ctx, cancel := context.WithTimeout(parent, videoJobTimeout)
	defer cancel()
	ctx, egressTrace := infraegress.WithTrace(ctx)
	startedAt := time.Now()
	job.Progress = max(job.Progress, 1)
	job.UpdatedAt = time.Now().UTC()
	if err := s.mediaJobs.UpdateMediaJob(ctx, job); err != nil {
		s.logger.Warn("video_job_progress_write_failed", "job_id", job.ID, "error", err)
	}
	inputReferences := decodeVideoInput(job.InputJSON)
	releaseInputSlot, err := s.acquireVideoInputSlot(ctx, inputReferences)
	if err != nil {
		s.deferVideoJob(parent, job)
		return
	}
	defer releaseInputSlot()
	adapter, ok := s.providers.Videos(route.Provider)
	if !ok {
		s.failVideoJob(parent, job, "provider_unavailable", ErrNoAvailableAccount, 0, nil)
		return
	}
	operation := provider.VideoOperation(job.Operation)
	if operation == "" {
		operation = decodeVideoOperation(job.InputJSON)
	}
	imageURL, referenceURLs, referenceAudios, videoURL, err := s.resolveVideoJobInputs(ctx, operation, job.InputJSON)
	if err != nil {
		s.failVideoJob(parent, job, "input_unavailable", err, 0, nil)
		return
	}
	duration := job.Seconds
	aspectRatio := job.Size
	resolution := job.Quality
	switch operation {
	case provider.VideoOperationEdit:
		duration, aspectRatio, resolution = 0, "", ""
	case provider.VideoOperationExtend:
		aspectRatio, resolution = "", ""
	}

	quotaMode := videoQuotaMode(route.Provider, s.providers.QuotaMode(route.Provider, route.UpstreamModel), job.Quality)
	quotaRefreshGroup := s.providers.QuotaRefreshGroup(route.Provider, route.UpstreamModel)
	attemptPolicy := s.videoAttemptPolicy()
	excluded := make(map[uint64]bool)
	forbiddenEgressRetried := make(map[uint64]bool)
	var retryPinnedAccountID uint64
	failureAttempts := newFailureAttemptRecorder(http.MethodPost, "/videos/generations")
	// 重试回退必须沿用创建阶段 client key 的 provider/tier 作用域，否则 pin 账号失败后的
	// 回退搜索会越过该 key 的账号范围。ClientKeyID==0 只可能来自升级前的历史任务。
	accountScope := clientkey.AccountScope{}
	if job.ClientKeyID > 0 {
		clientKey, keyErr := s.clientKeys.Get(ctx, job.ClientKeyID)
		if keyErr != nil {
			s.failVideoJob(parent, job, "account_unavailable", keyErr, 0, nil)
			return
		}
		accountScope = clientKey.AccountScope()
	}
	var selection *selectionSession
	var lease *accountLease
	var result provider.VideoResult
	var lastErr error

	for attempt := 0; attemptPolicy.allows(attempt); attempt++ {
		attemptStarted := time.Now()
		err = nil
		if lease != nil {
			lease.Release()
			lease = nil
		}
		// First try stays on the account chosen when the local job was created.
		// Create-stage failures may switch accounts; poll failures never reach here as retries.
		pinnedAccountID := retryPinnedAccountID
		retryPinnedAccountID = 0
		if attempt == 0 {
			pinnedAccountID = job.AccountID
		}
		if pinnedAccountID > 0 && !excluded[pinnedAccountID] {
			// 固定账号（首轮为本任务创建时选中的账号，其后为 403 出口重试的同一账号）获取失败时
			// 只排除该账号；错误不能写回 err，否则下面的 selection.Acquire 回退会被跳过，把仍有
			// 健康账号的账号池误判为 account_unavailable。
			pinnedLease, pinnedErr := s.selector.AcquirePinnedForKey(ctx, route.Provider, pinnedAccountID, route.ID, route.UpstreamModel, quotaMode, true, accountScope)
			if pinnedErr != nil {
				excluded[pinnedAccountID] = true
			} else {
				lease = pinnedLease
			}
		}
		if lease == nil {
			if selection == nil {
				selection, err = s.selector.beginSelectionSessionForKey(ctx, route.Provider, route.ID, route.UpstreamModel, quotaMode, "", excluded, false, accountScope)
			}
			if err == nil {
				lease, err = selection.Acquire(ctx, excluded, false)
			}
		}
		if err != nil {
			if parent.Err() != nil {
				s.deferVideoJob(parent, job)
				return
			}
			if lastErr == nil {
				lastErr = err
			}
			s.failVideoJob(parent, job, "account_unavailable", lastErr, 0, failureAttempts.snapshot())
			return
		}
		excluded[lease.Credential.ID] = true
		credential, credErr := s.accounts.EnsureCredential(ctx, lease.Credential, false)
		if credErr != nil {
			failureAttempts.captureCredentialFailure(lease.Credential, attemptStarted, false, credErr)
			lastErr = credErr
			if attemptPolicy.hasNext(attempt) {
				continue
			}
			s.failVideoJob(parent, job, "account_unavailable", credErr, 0, failureAttempts.snapshot())
			return
		}
		lease.Credential = credential
		if job.AccountID != credential.ID || job.AccountName != credential.Name {
			job.AccountID, job.AccountName = credential.ID, credential.Name
			job.UpdatedAt = time.Now().UTC()
			_ = s.mediaJobs.UpdateMediaJob(ctx, job)
		}

		lastProgress := job.Progress
		result, err = adapter.GenerateVideo(ctx, provider.VideoRequest{
			Credential: lease.Credential, Billing: lease.Billing, JobID: job.ID, Model: route.UpstreamModel,
			Operation: operation,
			Prompt:    job.Prompt, Duration: duration, AspectRatio: aspectRatio, Resolution: resolution,
			ImageURL: imageURL, ReferenceURLs: referenceURLs, ReferenceAudios: referenceAudios, VideoURL: videoURL,
			Progress: func(value int) {
				value = min(99, max(1, value))
				if value-lastProgress < 5 {
					return
				}
				lastProgress = value
				job.Progress, job.UpdatedAt = value, time.Now().UTC()
				leaseUntil := job.UpdatedAt.Add(videoJobLease)
				job.LeaseUntil = &leaseUntil
				updateCtx, updateCancel := context.WithTimeout(context.Background(), 3*time.Second)
				_ = s.mediaJobs.UpdateMediaJob(updateCtx, job)
				updateCancel()
			},
		})
		if err == nil && result.AssetID == "" && result.URL != "" {
			result, err = s.persistRemoteVideo(ctx, job.ID, adapter, lease.Credential, result)
		}
		if err == nil {
			break
		}
		lastErr = err
		captureVideoAttempt(failureAttempts, lease.Credential, attemptStarted, err)
		if parent.Err() != nil {
			s.deferVideoJob(parent, job)
			return
		}

		failureCtx, failureCancel := context.WithTimeout(context.Background(), finalizationTimeout)
		failureHandled := false
		retriableCreate := false
		stage, hasStage := provider.VideoErrorStage(err)
		safeCreateFailure := hasStage && stage == provider.VideoStageCreate
		status, hasStatus := provider.ErrorHTTPStatus(err)
		if errors.Is(err, provider.ErrUnauthorized) {
			if lease.Credential.AuthType == account.AuthTypeSSO {
				s.markSSOCredentialRejected(failureCtx, lease.Credential, fmt.Sprintf("%s SSO credential rejected", lease.Credential.Provider))
			}
			failureHandled = true
			retriableCreate = safeCreateFailure
		} else if hasStatus {
			switch {
			case status == http.StatusUnauthorized && lease.Credential.AuthType == account.AuthTypeSSO:
				s.markSSOCredentialRejected(failureCtx, lease.Credential, fmt.Sprintf("%s SSO credential rejected", lease.Credential.Provider))
				failureHandled = true
				retriableCreate = safeCreateFailure
			case status == http.StatusForbidden && s.providers.RetryForbiddenAsEgress(lease.Credential.Provider):
				// Web anti-bot 403 is egress-scoped. Retry the same account once so
				// egress invalidation can rebuild the route, then move on normally.
				failureHandled = true
				if safeCreateFailure {
					if !forbiddenEgressRetried[lease.Credential.ID] {
						forbiddenEgressRetried[lease.Credential.ID] = true
						retryPinnedAccountID = lease.Credential.ID
						delete(excluded, lease.Credential.ID)
					}
					retriableCreate = true
				}
			case status == http.StatusForbidden && lease.Credential.Provider == account.ProviderBuild:
				if !account.IsBuildSuper(lease.Credential, lease.Billing) {
					s.selector.MarkFailure(failureCtx, lease.Credential, status, 0)
				}
				failureHandled = true
				retriableCreate = safeCreateFailure && !account.IsBuildSuper(lease.Credential, lease.Billing)
			case (status == http.StatusPaymentRequired || status == http.StatusTooManyRequests) && lease.QuotaMode != "":
				state, reconcileErr := s.accounts.ReconcileRateLimit(failureCtx, lease.Credential.ID, lease.QuotaMode, 0)
				s.applyRateLimitReconciliation(failureCtx, lease.Credential, status, 0, state, reconcileErr)
				failureHandled = true
				retriableCreate = safeCreateFailure
			case status == http.StatusTooManyRequests || status == http.StatusPaymentRequired:
				s.selector.MarkFailure(failureCtx, lease.Credential, status, 0)
				failureHandled = true
				retriableCreate = safeCreateFailure
			case status >= http.StatusInternalServerError:
				// A 5xx may be returned after the upstream accepted the job. Never
				// switch accounts without an idempotency guarantee.
				failureHandled = true
				retriableCreate = false
			default:
				s.selector.MarkFailure(failureCtx, lease.Credential, status, 0)
				failureHandled = true
				retriableCreate = false
			}
		}
		if !failureHandled && !provider.IsMediaPostProcessingError(err) {
			s.selector.MarkFailure(failureCtx, lease.Credential, 0, 0)
			retriableCreate = safeCreateFailure
		}
		failureCancel()
		applyMediaJobEgress(&job, egressTrace, route.Provider)
		s.logVideoGenerationFailure(job, lease.Credential, err)

		// Poll/post-processing failures are bound to the already-created upstream job.
		if provider.IsMediaPostProcessingError(err) || (hasStage && stage == provider.VideoStagePoll) || !retriableCreate || !attemptPolicy.hasNext(attempt) {
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
			s.failVideoJob(parent, job, failureCode, publicErr, upstreamStatus, failureAttempts.snapshot())
			return
		}
		// Create-stage failure: switch account according to runtime attempt policy.
		continue
	}
	if lease == nil {
		s.failVideoJob(parent, job, "account_unavailable", ErrNoAvailableAccount, 0, failureAttempts.snapshot())
		return
	}
	defer lease.Release()

	// Provider 已消费请求体，尽早释放 Base64 物化名额和大字符串。
	referenceURLs = nil
	releaseInputSlot()

	now := time.Now().UTC()
	job.Status, job.Progress, job.UpstreamURL, job.ContentType = media.StatusCompleted, 100, result.URL, result.ContentType
	// 成功终态必须清空历史错误字段，避免管理端/恢复路径把中间失败文案当成最终结果。
	job.ErrorCode, job.ErrorMessage = "", ""
	if result.AssetID != "" {
		job.ResultAssetID = result.AssetID
	}
	applyMediaJobEgress(&job, egressTrace, route.Provider)
	job.LeaseUntil, job.UpdatedAt, job.CompletedAt = nil, now, &now
	if err := s.persistVideoJobWithRetry(parent, job); err != nil {
		s.logger.Error("video_job_terminal_write_failed", "job_id", job.ID, "error", err)
		return
	}
	s.selector.MarkSuccess(context.Background(), lease.Credential)
	refreshMode, decrementMode, availabilityMode := quotaFinalizationModes(lease.QuotaMode, quotaRefreshGroup)
	if decrementMode != "" && decrementMode != "weekly" {
		quotaCtx, quotaCancel := context.WithTimeout(context.Background(), accountStateWriteTimeout)
		updated, quotaErr := s.accounts.DecrementQuota(quotaCtx, job.AccountID, decrementMode, 1)
		quotaCancel()
		if quotaErr != nil {
			s.logger.Warn("video_quota_decrement_failed", "provider", route.Provider, "account_id", job.AccountID, "mode", decrementMode, "error", quotaErr)
		} else if updated {
			s.selector.ConsumeQuota(route.Provider, job.AccountID, decrementMode, 1)
		}
	}
	if err := s.recordVideoAudit(context.Background(), job, time.Since(startedAt).Milliseconds(), http.StatusOK, failureAttempts.snapshot()); err != nil {
		s.logger.Error("video_usage_record_failed", "job_id", job.ID, "event_id", "video_usage_"+job.ID, "error", err)
	}
	if quotaKind, _ := s.providers.QuotaKind(route.Provider); quotaKind == provider.QuotaRemoteWindow && refreshMode != "" {
		s.accounts.QueueQuotaRefresh(job.AccountID, refreshMode)
		if availabilityMode != "" && availabilityMode != refreshMode {
			s.accounts.QueueQuotaRefresh(job.AccountID, availabilityMode)
		}
	}
	// 输入回收放在账号状态、计费和审计收尾之后，存储抖动不得延迟关键终态逻辑。
	s.releaseVideoInputs(job)
}
