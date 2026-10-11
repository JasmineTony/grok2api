package media

import (
	"context"
	"errors"
	"os"
	"strings"

	mediadomain "github.com/chenyme/grok2api/backend/internal/domain/media"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// AdminListImages 分页返回图片资源列表。
func (s *Service) AdminListImages(ctx context.Context, page, pageSize int, search string) ([]mediadomain.Asset, int64, error) {
	return s.assets.ListMediaAssets(ctx, repository.MediaAssetListQuery{Page: mediaPageQuery(page, pageSize, search, repository.SortQuery{})})
}

// AdminListVideoJobs 分页返回视频任务列表。
func (s *Service) AdminListVideoJobs(ctx context.Context, page, pageSize int, search, status string, sort repository.SortQuery) ([]mediadomain.Job, int64, error) {
	if s.jobs == nil {
		return nil, 0, ErrMediaJobsUnavailable
	}
	status = strings.TrimSpace(status)
	if !validMediaStatus(status) || !repository.IsValidSort(sort, "prompt", "model", "status", "progress", "spec", "account", "createdAt", "completedAt") {
		return nil, 0, ErrInvalidFilter
	}
	return s.jobs.ListMediaJobs(ctx, repository.MediaJobListQuery{
		Page:   mediaPageQuery(page, pageSize, search, sort),
		Filter: repository.MediaJobListFilter{Status: status},
	})
}

// AdminImageStats 返回图片统计信息。
func (s *Service) AdminImageStats(ctx context.Context) (ImageStats, error) {
	stats, err := s.assets.SummarizeMediaAssets(ctx)
	if err != nil {
		return ImageStats{}, err
	}
	return ImageStats{TotalImages: stats.TotalImages, TotalBytes: stats.TotalBytes}, nil
}

// AdminDeleteImages 删除管理员明确选择的图片对象及其元数据。
// 不存在或已被并发清理的图片按幂等成功处理；非图片资产不会被删除。
func (s *Service) AdminDeleteImages(ctx context.Context, ids []string) (int, error) {
	if len(ids) == 0 || len(ids) > 100 {
		return 0, ErrInvalidImageSelection
	}
	unique := make(map[string]struct{}, len(ids))
	assets := make([]mediadomain.Asset, 0, len(ids))
	for _, rawID := range ids {
		id := strings.TrimSpace(rawID)
		if id == "" {
			return 0, ErrInvalidImageSelection
		}
		if _, exists := unique[id]; exists {
			continue
		}
		unique[id] = struct{}{}
		asset, err := s.assets.GetMediaAsset(ctx, id)
		if errors.Is(err, repository.ErrNotFound) {
			continue
		}
		if err != nil {
			return 0, err
		}
		if asset.Kind == "image" {
			assets = append(assets, asset)
		}
	}

	deleted := 0
	for _, asset := range assets {
		if err := s.objects.Delete(ctx, asset.StorageKey); err != nil && !errors.Is(err, os.ErrNotExist) {
			return deleted, err
		}
		if err := s.assets.DeleteMediaAsset(ctx, asset.ID); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				continue
			}
			return deleted, err
		}
		deleted++
	}
	if total, err := s.assets.TotalMediaAssetBytes(ctx); err == nil {
		s.totalBytes.Store(total)
	}
	return deleted, nil
}

// AdminVideoStats 返回视频任务统计信息。
func (s *Service) AdminVideoStats(ctx context.Context) (VideoStats, error) {
	if s.jobs == nil {
		return VideoStats{}, ErrMediaJobsUnavailable
	}
	stats, err := s.jobs.SummarizeMediaJobs(ctx)
	if err != nil {
		return VideoStats{}, err
	}
	return VideoStats{
		TotalJobs: stats.TotalJobs, Completed: stats.Completed, Failed: stats.Failed,
		InProgress: stats.InProgress, Queued: stats.Queued,
	}, nil
}

// AdminDeleteVideoJobs 删除管理员明确选择的终态视频任务。
// 成功任务若已归档本地视频，则同步撤销上传票据并删除对象和媒体元数据；审计记录独立保留。
func (s *Service) AdminDeleteVideoJobs(ctx context.Context, ids []string) (int, error) {
	if s.jobs == nil {
		return 0, ErrMediaJobsUnavailable
	}
	normalized, err := normalizeVideoJobSelection(ids)
	if err != nil {
		return 0, err
	}
	jobs, err := s.jobs.GetMediaJobsByIDs(ctx, normalized)
	if err != nil {
		return 0, err
	}
	for _, job := range jobs {
		if job.Status != mediadomain.StatusCompleted && job.Status != mediadomain.StatusFailed {
			return 0, ErrActiveVideoSelection
		}
	}
	deleted, err := s.deleteVideoJobs(ctx, jobs)
	if err != nil {
		return deleted, err
	}
	if total, err := s.assets.TotalMediaAssetBytes(ctx); err == nil {
		s.totalBytes.Store(total)
	}
	return deleted, nil
}

// normalizeVideoJobSelection 校验选择数量上限，并去除空白、去重后返回任务 ID 列表。
func normalizeVideoJobSelection(ids []string) ([]string, error) {
	if len(ids) == 0 || len(ids) > 100 {
		return nil, ErrInvalidVideoSelection
	}
	unique := make(map[string]struct{}, len(ids))
	normalized := make([]string, 0, len(ids))
	for _, rawID := range ids {
		id := strings.TrimSpace(rawID)
		if id == "" {
			return nil, ErrInvalidVideoSelection
		}
		if _, exists := unique[id]; exists {
			continue
		}
		unique[id] = struct{}{}
		normalized = append(normalized, id)
	}
	return normalized, nil
}

// deleteVideoJobs 按顺序撤销上传票据、删除本地视频资产与任务记录，返回已完成的删除数。
func (s *Service) deleteVideoJobs(ctx context.Context, jobs []mediadomain.Job) (int, error) {
	deleted := 0
	for _, job := range jobs {
		if s.tickets != nil {
			if err := s.tickets.DeleteUploadTicketsByJobID(ctx, job.ID); err != nil {
				return deleted, err
			}
		}
		if err := s.deleteVideoAsset(ctx, job.ResultAssetID); err != nil {
			return deleted, err
		}
		if err := s.jobs.DeleteMediaJob(ctx, job.ID); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				continue
			}
			return deleted, err
		}
		deleted++
	}
	return deleted, nil
}

// deleteVideoAsset 删除任务绑定的本地视频对象与元数据；缺失对象按幂等成功处理。
func (s *Service) deleteVideoAsset(ctx context.Context, assetID string) error {
	assetID = strings.TrimSpace(assetID)
	if assetID == "" {
		return nil
	}
	asset, err := s.assets.GetMediaAsset(ctx, assetID)
	if errors.Is(err, repository.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if asset.Kind != "video" {
		return nil
	}
	if err := s.objects.Delete(ctx, asset.StorageKey); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := s.assets.DeleteMediaAsset(ctx, asset.ID); err != nil && !errors.Is(err, repository.ErrNotFound) {
		return err
	}
	return nil
}

func mediaPageQuery(page, pageSize int, search string, sort repository.SortQuery) repository.PageQuery {
	page, pageSize = repository.NormalizePage(page, pageSize, repository.DefaultPageSize)
	return repository.PageQuery{Offset: (page - 1) * pageSize, Limit: pageSize, Search: strings.TrimSpace(search), Sort: sort}
}

func validMediaStatus(status string) bool {
	switch mediadomain.Status(status) {
	case "", mediadomain.StatusQueued, mediadomain.StatusInProgress, mediadomain.StatusCompleted, mediadomain.StatusFailed:
		return true
	default:
		return false
	}
}
