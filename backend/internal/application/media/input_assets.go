package media

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"time"

	mediadomain "github.com/chenyme/grok2api/backend/internal/domain/media"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// InputAssetTTL 是临时输入的硬保留上限；无论任务状态如何，超过后都可回收。
const InputAssetTTL = 24 * time.Hour

// SaveInputImage 保存不会进入图库、不会公开读取并会自动过期的视频输入图片。
func (s *Service) SaveInputImage(ctx context.Context, data []byte) (mediadomain.Asset, error) {
	cfg := s.runtimeConfig()
	inputLimit := min(cfg.MaxImageBytes, int64(mediadomain.MaxInputAssetBytes))
	if len(data) == 0 || inputLimit <= 0 || int64(len(data)) > inputLimit {
		return mediadomain.Asset{}, ErrInvalidImage
	}
	s.inputSaveMu.Lock()
	defer s.inputSaveMu.Unlock()
	total, err := s.assets.TotalMediaAssetBytes(ctx)
	if err != nil {
		return mediadomain.Asset{}, err
	}
	capacityLimit := cleanupThresholdBytes(cfg)
	if capacityLimit <= 0 || capacityLimit > cfg.MaxTotalBytes {
		capacityLimit = cfg.MaxTotalBytes
	}
	if int64(len(data)) > capacityLimit || total > capacityLimit-int64(len(data)) {
		select {
		case s.cleanupSignal <- struct{}{}:
		default:
		}
		return mediadomain.Asset{}, ErrMediaCapacity
	}
	expiresAt := time.Now().UTC().Add(InputAssetTTL)
	return s.saveImage(ctx, data, &expiresAt, mediadomain.InputAssetIDPrefix)
}

// OpenInputAsset 读取未过期的临时输入；它从不通过公开媒体路由暴露。
func (s *Service) OpenInputAsset(ctx context.Context, id string) (mediadomain.Asset, io.ReadCloser, error) {
	id = strings.TrimSpace(id)
	if !mediadomain.IsInputAssetID(id) {
		return mediadomain.Asset{}, nil, ErrInputAssetNotFound
	}
	asset, err := s.assets.GetMediaAsset(ctx, id)
	if errors.Is(err, repository.ErrNotFound) {
		return mediadomain.Asset{}, nil, ErrInputAssetNotFound
	}
	if err != nil {
		return mediadomain.Asset{}, nil, err
	}
	if (asset.Kind != "image" && asset.Kind != "video") || asset.ExpiresAt == nil {
		return mediadomain.Asset{}, nil, ErrInputAssetNotFound
	}
	if !asset.ExpiresAt.After(time.Now().UTC()) {
		return mediadomain.Asset{}, nil, ErrInputAssetNotFound
	}
	body, err := s.objects.Open(ctx, asset.StorageKey)
	if errors.Is(err, os.ErrNotExist) {
		return mediadomain.Asset{}, nil, ErrInputAssetNotFound
	}
	if err != nil {
		return mediadomain.Asset{}, nil, err
	}
	return asset, body, nil
}

// ReleaseInputAssets 在任务进入终态后立即回收不再被其他活动任务引用的临时输入。
func (s *Service) ReleaseInputAssets(ctx context.Context, references []string) error {
	seen := make(map[string]struct{}, len(references))
	for _, reference := range references {
		id, ok := mediadomain.ParseInputReference(reference)
		if !ok {
			continue
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		expired, expireErr := s.assets.ExpireMediaInputIfUnreferenced(ctx, id, time.Now().UTC())
		if expireErr != nil {
			return expireErr
		}
		if !expired {
			continue
		}
		asset, getErr := s.assets.GetMediaAsset(ctx, id)
		if errors.Is(getErr, repository.ErrNotFound) {
			continue
		}
		if getErr != nil {
			return getErr
		}
		if asset.ExpiresAt == nil || (asset.Kind != "image" && asset.Kind != "video") {
			continue
		}
		if deleteErr := s.objects.Delete(ctx, asset.StorageKey); deleteErr != nil && !errors.Is(deleteErr, os.ErrNotExist) {
			return deleteErr
		}
		if deleteErr := s.assets.DeleteMediaAsset(ctx, id); deleteErr != nil && !errors.Is(deleteErr, repository.ErrNotFound) {
			return deleteErr
		}
	}
	if total, totalErr := s.assets.TotalMediaAssetBytes(ctx); totalErr == nil {
		s.totalBytes.Store(total)
	}
	return nil
}
