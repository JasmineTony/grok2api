package media

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	mediadomain "github.com/chenyme/grok2api/backend/internal/domain/media"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// SaveImage 校验并保存一份不可变图片，文件写入失败或元数据落库失败时不会留下半成品。
func (s *Service) SaveImage(ctx context.Context, data []byte) (mediadomain.Asset, error) {
	return s.saveImage(ctx, data, nil, "img_")
}

func (s *Service) saveImage(ctx context.Context, data []byte, expiresAt *time.Time, idPrefix string) (mediadomain.Asset, error) {
	cfg := s.runtimeConfig()
	if len(data) == 0 || int64(len(data)) > cfg.MaxImageBytes {
		return mediadomain.Asset{}, ErrInvalidImage
	}
	mimeType := http.DetectContentType(data)
	if !supportedImageMIME(mimeType) {
		return mediadomain.Asset{}, ErrInvalidImage
	}
	id, err := newAssetID(idPrefix)
	if err != nil {
		return mediadomain.Asset{}, err
	}
	digest := sha256.Sum256(data)
	createdAt := time.Now().UTC()
	storageKey, err := s.objects.SaveImage(ctx, id, mimeType, data)
	if err != nil {
		return mediadomain.Asset{}, err
	}
	asset := mediadomain.Asset{
		ID: id, Kind: "image", StorageKey: storageKey, MIMEType: mimeType,
		SizeBytes: int64(len(data)), SHA256: hex.EncodeToString(digest[:]), ExpiresAt: expiresAt, CreatedAt: createdAt,
	}
	if err := s.assets.CreateMediaAsset(ctx, asset); err != nil {
		_ = s.objects.Delete(context.WithoutCancel(ctx), storageKey)
		return mediadomain.Asset{}, err
	}
	if s.totalBytes.Add(asset.SizeBytes) > cleanupThresholdBytes(cfg) {
		select {
		case s.cleanupSignal <- struct{}{}:
		default:
		}
	}
	return asset, nil
}

// PublicImageURL 返回可直接用于图片展示的公开资源地址。
func (s *Service) PublicImageURL(id string) string {
	return s.runtimeConfig().PublicBaseURL + "/v1/media/images/" + id
}

// OpenImage 读取图片元数据和正文，不向调用方暴露实际文件路径。
func (s *Service) OpenImage(ctx context.Context, id string) (mediadomain.Asset, io.ReadCloser, error) {
	asset, err := s.assets.GetMediaAsset(ctx, strings.TrimSpace(id))
	if errors.Is(err, repository.ErrNotFound) {
		return mediadomain.Asset{}, nil, ErrAssetNotFound
	}
	if err != nil {
		return mediadomain.Asset{}, nil, err
	}
	if asset.Kind != "image" || asset.ExpiresAt != nil {
		return mediadomain.Asset{}, nil, ErrAssetNotFound
	}
	body, err := s.objects.Open(ctx, asset.StorageKey)
	if errors.Is(err, os.ErrNotExist) {
		return mediadomain.Asset{}, nil, ErrAssetNotFound
	}
	if err != nil {
		return mediadomain.Asset{}, nil, err
	}
	return asset, body, nil
}

func supportedImageMIME(value string) bool {
	switch value {
	case "image/jpeg", "image/png", "image/webp", "image/gif":
		return true
	default:
		return false
	}
}
