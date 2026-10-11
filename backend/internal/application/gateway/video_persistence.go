package gateway

import (
	"context"
	"errors"
	"fmt"
	"time"

	account "github.com/chenyme/grok2api/backend/internal/domain/account"
	audit "github.com/chenyme/grok2api/backend/internal/domain/audit"
	media "github.com/chenyme/grok2api/backend/internal/domain/media"
	provider "github.com/chenyme/grok2api/backend/internal/ports/provider"
	http "net/http"
)

// persistRemoteVideo 只重试已经生成的视频结果下载与本地归档，不重新调用生成接口，
// 且所有尝试固定使用创建任务的同一凭据。
func (s *Service) persistRemoteVideo(ctx context.Context, jobID string, adapter provider.VideoAdapter, credential account.Credential, result provider.VideoResult) (provider.VideoResult, error) {
	if s.mediaAssets == nil {
		return result, provider.NewMediaPostProcessingError(provider.MediaPostProcessingStorage, errors.New("视频媒体存储未配置"))
	}
	downloader, ok := adapter.(provider.VideoContentDownloader)
	if !ok {
		return result, provider.NewMediaPostProcessingError(provider.MediaPostProcessingDownload, errors.New("Provider 不支持视频内容下载"))
	}
	var lastErr error
	for attempt := 0; attempt < videoOutputAttempts; attempt++ {
		body, contentType, _, downloadErr := downloader.DownloadVideo(ctx, credential, result.URL)
		if downloadErr != nil {
			lastErr = provider.NewMediaPostProcessingError(provider.MediaPostProcessingDownload, downloadErr)
		} else {
			asset, saveErr := s.mediaAssets.SaveVideo(ctx, jobID, contentType, body)
			_ = body.Close()
			if saveErr == nil {
				result.AssetID = asset.ID
				result.ContentType = asset.MIMEType
				return result, nil
			}
			lastErr = provider.NewMediaPostProcessingError(provider.MediaPostProcessingStorage, saveErr)
		}
		if ctx.Err() != nil || attempt+1 >= videoOutputAttempts {
			break
		}
		if waitErr := waitVideoOutputRetry(ctx, attempt); waitErr != nil {
			return result, waitErr
		}
	}
	return result, lastErr
}

func waitVideoOutputRetry(ctx context.Context, attempt int) error {
	delays := [...]time.Duration{200 * time.Millisecond, 750 * time.Millisecond}
	timer := time.NewTimer(delays[min(attempt, len(delays)-1)])
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *Service) reconcileVideoUsage(ctx context.Context) error {
	jobs, err := s.mediaJobs.ListUnrecordedTerminalMediaJobs(ctx, 200)
	if err != nil {
		return err
	}
	var result error
	for _, job := range jobs {
		durationMS := int64(0)
		if job.CompletedAt != nil {
			durationMS = max(int64(0), job.CompletedAt.Sub(job.CreatedAt).Milliseconds())
		}
		if err := s.recordVideoAudit(ctx, job, durationMS, 0, nil); err != nil {
			result = firstError(result, fmt.Errorf("任务 %s: %w", job.ID, err))
		}
	}
	return result
}

func (s *Service) recordVideoAudit(ctx context.Context, job media.Job, durationMS int64, upstreamStatus int, attempts []audit.Attempt) error {
	var accountID *uint64
	if job.AccountID > 0 {
		value := job.AccountID
		accountID = &value
	}
	createdAt := time.Now().UTC()
	if job.CompletedAt != nil && !job.CompletedAt.IsZero() {
		createdAt = job.CompletedAt.UTC()
	}
	statusCode := resolveVideoAuditStatusCode(job, upstreamStatus, attempts)
	record := audit.Record{
		EventID: "video_usage_" + job.ID, RequestID: job.RequestID, ClientKeyID: job.ClientKeyID, ClientKeyName: job.ClientKeyName,
		ClientIP:     job.ClientIP,
		ModelRouteID: job.ModelRouteID, ModelPublicID: job.Model, ModelUpstreamModel: job.UpstreamModel,
		Provider: job.Provider, Operation: audit.OperationVideo, UsageSource: audit.UsageSourceNone,
		AccountID: accountID, AccountName: job.AccountName, StatusCode: statusCode, ErrorCode: job.ErrorCode,
		EgressNodeID: job.EgressNodeID, EgressNodeName: job.EgressNodeName, EgressScope: job.EgressScope, EgressMode: audit.EgressMode(job.EgressMode),
		MediaInputImages: int64(job.InputImageCount),
		DurationMS:       durationMS, AttemptCount: len(attempts), Attempts: append([]audit.Attempt(nil), attempts...), CreatedAt: createdAt,
		RequestMethod: http.MethodPost, RequestPath: "/v1/videos/generations",
	}
	if job.Status == media.StatusCompleted && job.Seconds > 0 {
		record.MediaOutputSeconds = int64(max(0, job.Seconds))
	}
	operation := provider.VideoOperation(job.Operation)
	if operation == "" {
		operation = provider.VideoOperationGenerate
	}
	if pricing, ok := audit.EstimateOfficialVideoCost(job.UpstreamModel, job.Quality, job.Seconds, job.InputImageCount); ok && job.Status == media.StatusCompleted && operation == provider.VideoOperationGenerate {
		record.EstimatedCostInUSDTicks = pricing.CostInUSDTicks
		record.PricingModel = pricing.Model
		record.PricingVersion = audit.OfficialPricingAsOf
	}
	if durable, ok := s.audits.(interface {
		CreateDurable(context.Context, audit.Record) error
	}); ok {
		if err := durable.CreateDurable(ctx, record); err != nil {
			return err
		}
	} else if err := s.audits.Create(ctx, record); err != nil {
		return err
	}
	markCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	return s.mediaJobs.MarkMediaJobUsageRecorded(markCtx, job.ID, time.Now().UTC())
}
