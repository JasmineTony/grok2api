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
	run, ok := s.startVideoJobRun(parent, job, route)
	if !ok {
		return
	}
	defer run.cancel()
	defer run.releaseInputSlot()
	if !s.prepareVideoJobInputs(run) {
		return
	}
	if !s.initVideoJobPolicy(run) {
		return
	}
	if run.runAttempts() {
		return
	}
	if run.lease == nil {
		s.failVideoJob(run.parent, run.job, "account_unavailable", ErrNoAvailableAccount, 0, run.failureAttempts.snapshot())
		return
	}
	defer run.lease.Release()
	s.finishVideoJob(run)
}

// finishVideoJob 写入成功终态，并按顺序推进账号状态、额度结算与审计。
func (s *Service) finishVideoJob(run *videoJobRun) {
	// Provider 已消费请求体，尽早释放 Base64 物化名额和大字符串。
	run.referenceURLs = nil
	run.releaseInputSlot()
	if !s.persistCompletedVideoJob(run) {
		return
	}
	s.selector.MarkSuccess(context.Background(), run.lease.Credential)
	refreshMode, decrementMode, availabilityMode := quotaFinalizationModes(run.lease.QuotaMode, run.quotaRefreshGroup)
	if decrementMode != "" && decrementMode != "weekly" {
		s.decrementVideoQuotaOnSuccess(run, decrementMode)
	}
	if err := s.recordVideoAudit(context.Background(), run.job, time.Since(run.startedAt).Milliseconds(), http.StatusOK, run.failureAttempts.snapshot()); err != nil {
		s.logger.Error("video_usage_record_failed", "job_id", run.job.ID, "event_id", "video_usage_"+run.job.ID, "error", err)
	}
	if quotaKind, _ := s.providers.QuotaKind(run.route.Provider); quotaKind == provider.QuotaRemoteWindow && refreshMode != "" {
		s.refreshVideoQuotaWindowOnSuccess(run, refreshMode, availabilityMode)
	}
	// 输入回收放在账号状态、计费和审计收尾之后，存储抖动不得延迟关键终态逻辑。
	s.releaseVideoInputs(run.job)
}

// persistCompletedVideoJob 写入成功终态；写入失败时保留任务供恢复路径重试。
func (s *Service) persistCompletedVideoJob(run *videoJobRun) bool {
	now := time.Now().UTC()
	run.job.Status, run.job.Progress, run.job.UpstreamURL, run.job.ContentType = media.StatusCompleted, 100, run.result.URL, run.result.ContentType
	// 成功终态必须清空历史错误字段，避免管理端/恢复路径把中间失败文案当成最终结果。
	run.job.ErrorCode, run.job.ErrorMessage = "", ""
	if run.result.AssetID != "" {
		run.job.ResultAssetID = run.result.AssetID
	}
	applyMediaJobEgress(&run.job, run.egressTrace, run.route.Provider)
	run.job.LeaseUntil, run.job.UpdatedAt, run.job.CompletedAt = nil, now, &now
	if err := s.persistVideoJobWithRetry(run.parent, run.job); err != nil {
		s.logger.Error("video_job_terminal_write_failed", "job_id", run.job.ID, "error", err)
		return false
	}
	return true
}

// decrementVideoQuotaOnSuccess 扣减账号额度窗口并同步本地计数。
func (s *Service) decrementVideoQuotaOnSuccess(run *videoJobRun, decrementMode string) {
	quotaCtx, quotaCancel := context.WithTimeout(context.Background(), accountStateWriteTimeout)
	updated, quotaErr := s.accounts.DecrementQuota(quotaCtx, run.job.AccountID, decrementMode, 1)
	quotaCancel()
	if quotaErr != nil {
		s.logger.Warn("video_quota_decrement_failed", "provider", run.route.Provider, "account_id", run.job.AccountID, "mode", decrementMode, "error", quotaErr)
	} else if updated {
		s.selector.ConsumeQuota(run.route.Provider, run.job.AccountID, decrementMode, 1)
	}
}

// refreshVideoQuotaWindowOnSuccess 推进远端额度窗口刷新。
func (s *Service) refreshVideoQuotaWindowOnSuccess(run *videoJobRun, refreshMode, availabilityMode string) {
	s.accounts.QueueQuotaRefresh(run.job.AccountID, refreshMode)
	if availabilityMode != "" && availabilityMode != refreshMode {
		s.accounts.QueueQuotaRefresh(run.job.AccountID, availabilityMode)
	}
}
