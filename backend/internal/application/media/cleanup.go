package media

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	mediadomain "github.com/chenyme/grok2api/backend/internal/domain/media"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// RunCleanup 响应容量阈值并按周期清理最旧媒体资源。
func (s *Service) RunCleanup(ctx context.Context, onError func(error)) {
	cfg := s.runtimeConfig()
	if total, err := s.assets.TotalMediaAssetBytes(ctx); err == nil {
		s.totalBytes.Store(total)
		if total > cleanupThresholdBytes(cfg) {
			if _, cleanupErr := s.Cleanup(ctx); cleanupErr != nil && onError != nil {
				onError(cleanupErr)
			}
		}
	} else if onError != nil {
		onError(err)
	}
	ticker := time.NewTicker(cfg.CleanupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.cleanupSignal:
		case <-s.configChanged:
			cfg = s.runtimeConfig()
			ticker.Reset(cfg.CleanupInterval)
		}
		cfg = s.runtimeConfig()
		cleanupCtx, cancel := context.WithTimeout(ctx, min(cfg.CleanupInterval, 5*time.Minute))
		_, err := s.Cleanup(cleanupCtx)
		cancel()
		if err != nil && onError != nil {
			onError(err)
		}
	}
}

const (
	cleanupAssetBatchSize  = 200
	cleanupTicketBatchSize = 200
	cleanupInputBatchSize  = 200
	// cleanupTicketMaxBatchesPerRun 限制单次 Cleanup 调用中过期票据的删除批次数。
	// 超出部分留给后续直接/后台清理继续回收，避免一次调用无界垄断。
	cleanupTicketMaxBatchesPerRun = 1
)

// Cleanup 在跨实例锁保护下删除最旧媒体资产，直到回落到自动清理阈值。
// 同时有界清理过期上传票据。受保护资产被跳过；通过 offset 前进避免整页受保护时死循环。
func (s *Service) Cleanup(ctx context.Context) (int, error) {
	cfg := s.runtimeConfig()
	if s.cleanupLock != nil {
		release, acquired, err := s.cleanupLock.Acquire(ctx, "media:cleanup", 30*time.Minute)
		if err != nil || !acquired {
			return 0, err
		}
		defer release()
	}
	return s.cleanupUnderLock(ctx, cfg)
}

// cleanupUnderLock 在已持有跨实例锁的前提下，依次回收过期临时输入、过期上传票据与超阈值容量。
func (s *Service) cleanupUnderLock(ctx context.Context, cfg Config) (int, error) {
	cleanupNow := time.Now().UTC()
	// 临时输入无论当前总容量或任务状态如何都按 24h 硬 TTL 回收。
	deleted, err := s.cleanupExpiredInputs(ctx, cleanupNow)
	if err != nil {
		return deleted, err
	}
	// 过期票据回收：不触碰未过期票据与已登记媒体资产；单次调用有批次数上限。
	if err := s.cleanupExpiredTickets(ctx); err != nil {
		return deleted, err
	}
	total, err := s.assets.TotalMediaAssetBytes(ctx)
	if err != nil {
		return deleted, err
	}
	s.totalBytes.Store(total)
	threshold := cleanupThresholdBytes(cfg)
	if total <= threshold {
		return deleted, nil
	}
	deletedByCapacity, total, err := s.cleanupOldestAssets(ctx, total, threshold, cleanupNow)
	deleted += deletedByCapacity
	if err != nil {
		return deleted, err
	}
	s.totalBytes.Store(total)
	return deleted, nil
}

// cleanupExpiredInputs 按硬 TTL 分页回收已过期临时输入，返回删除数量。
func (s *Service) cleanupExpiredInputs(ctx context.Context, cleanupNow time.Time) (int, error) {
	deleted := 0
	expiredOffset := 0
	for {
		expired, listErr := s.assets.ListExpiredMediaAssets(ctx, cleanupNow, expiredOffset, cleanupInputBatchSize)
		if listErr != nil {
			return deleted, listErr
		}
		if len(expired) == 0 {
			break
		}
		deletedInBatch := 0
		for _, asset := range expired {
			if err := s.objects.Delete(ctx, asset.StorageKey); err != nil && !errors.Is(err, os.ErrNotExist) {
				return deleted, err
			}
			if err := s.assets.DeleteMediaAsset(ctx, asset.ID); err != nil && !errors.Is(err, repository.ErrNotFound) {
				return deleted, err
			}
			deleted++
			deletedInBatch++
		}
		if deletedInBatch > 0 {
			// 删除后分页顺序前移，从头重新扫描避免跳过记录。
			expiredOffset = 0
			continue
		}
		if len(expired) < cleanupInputBatchSize {
			break
		}
		expiredOffset += len(expired)
	}
	return deleted, nil
}

// cleanupExpiredTickets 有界清理过期上传票据，不触碰未过期票据与已登记媒体资产。
func (s *Service) cleanupExpiredTickets(ctx context.Context) error {
	if s.tickets == nil {
		return nil
	}
	for batch := 0; batch < cleanupTicketMaxBatchesPerRun; batch++ {
		n, err := s.tickets.DeleteExpiredUploadTickets(ctx, time.Now().UTC(), cleanupTicketBatchSize)
		if err != nil {
			return err
		}
		if n < int64(cleanupTicketBatchSize) {
			break
		}
	}
	return nil
}

// cleanupOldestAssets 从最旧资产开始回收直到总容量回落到阈值，返回删除数与剩余容量。
func (s *Service) cleanupOldestAssets(ctx context.Context, total, threshold int64, cleanupNow time.Time) (int, int64, error) {
	deleted := 0
	offset := 0
	for total > threshold {
		values, err := s.assets.ListOldestMediaAssets(ctx, offset, cleanupAssetBatchSize)
		if err != nil {
			return deleted, total, err
		}
		if len(values) == 0 {
			break
		}
		protected, protErr := s.assets.ListProtectedMediaAssetIDs(ctx)
		if protErr != nil {
			return deleted, total, protErr
		}
		deletedInBatch, remaining, err := s.deleteOldestAssetBatch(ctx, values, protected, total, threshold, cleanupNow)
		deleted += deletedInBatch
		total = remaining
		if err != nil {
			return deleted, total, err
		}
		if deletedInBatch == 0 {
			// 本页无可删资产：前进 offset 以越过受保护前缀，避免无限循环。
			if len(values) < cleanupAssetBatchSize {
				break
			}
			offset += len(values)
			continue
		}
		// 删除后最旧顺序变化，从头部重新扫描。
		offset = 0
	}
	return deleted, total, nil
}

// deleteOldestAssetBatch 删除一页中最旧的可回收资产，返回本批删除数与剩余总容量。
func (s *Service) deleteOldestAssetBatch(ctx context.Context, values []mediadomain.Asset, protected map[string]struct{}, total, threshold int64, cleanupNow time.Time) (int, int64, error) {
	deleted := 0
	for _, asset := range values {
		if total <= threshold {
			break
		}
		// 未过期的临时输入有明确 TTL，容量清理不得提前删除。
		if asset.ExpiresAt != nil && asset.ExpiresAt.After(cleanupNow) {
			continue
		}
		if _, skip := protected[asset.ID]; skip {
			continue
		}
		if err := s.objects.Delete(ctx, asset.StorageKey); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return deleted, total, fmt.Errorf("媒体对象缺失，已保留共享元数据: %s: %w", asset.StorageKey, err)
			}
			return deleted, total, err
		}
		if err := s.assets.DeleteMediaAsset(ctx, asset.ID); err != nil && !errors.Is(err, repository.ErrNotFound) {
			return deleted, total, err
		}
		total = max(0, total-asset.SizeBytes)
		deleted++
	}
	return deleted, total, nil
}
