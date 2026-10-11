package gateway

import (
	"context"
	"fmt"
	"io"
	"strings"
	"sync"

	base64 "encoding/base64"
	account "github.com/chenyme/grok2api/backend/internal/domain/account"
	media "github.com/chenyme/grok2api/backend/internal/domain/media"
)

func videoQuotaMode(providerValue account.Provider, catalogMode, resolution string) string {
	if providerValue == account.ProviderWeb && catalogMode == account.QuotaModeWebVideo {
		resolution = strings.ToLower(strings.TrimSpace(resolution))
		if resolution == "" || resolution == "720p" {
			return account.QuotaModeWebVideo720p
		}
	}
	return catalogMode
}

func (s *Service) acquireVideoInputSlot(ctx context.Context, references []string) (func(), error) {
	hasLocalInput := false
	for _, reference := range references {
		if strings.HasPrefix(reference, media.InputReferencePrefix) {
			hasLocalInput = true
			break
		}
	}
	if !hasLocalInput || s.mediaInputSlots == nil {
		return func() {}, nil
	}
	select {
	case s.mediaInputSlots <- struct{}{}:
		var once sync.Once
		return func() { once.Do(func() { <-s.mediaInputSlots }) }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *Service) validateVideoInputReferences(ctx context.Context, references []string, expectedKind string) error {
	estimatedBytes := videoInputJSONBaseBytes
	for _, reference := range references {
		fileID, local := media.ParseInputReference(reference)
		if !strings.HasPrefix(reference, media.InputReferencePrefix) {
			if !addVideoReferenceBytes(&estimatedBytes, int64(len(reference))) {
				return ErrVideoInputTooLarge
			}
			continue
		}
		if s.mediaAssets == nil || !local {
			return ErrVideoInputUnavailable
		}
		asset, body, err := s.mediaAssets.OpenInputAsset(ctx, fileID)
		if err != nil {
			return fmt.Errorf("%w: %v", ErrVideoInputUnavailable, err)
		}
		_ = body.Close()
		if asset.Kind != expectedKind {
			return fmt.Errorf("%w: file_id 必须引用%s", ErrVideoInputUnavailable, expectedKind)
		}
		if !addVideoReferenceBytes(&estimatedBytes, materializedVideoReferenceBytes(asset.MIMEType, asset.SizeBytes)) {
			return ErrVideoInputTooLarge
		}
	}
	return nil
}

func (s *Service) resolveVideoInputParts(ctx context.Context, inputJSON string) (string, []string, error) {
	imageURL, referenceURLs := decodeVideoInputParts(inputJSON)
	all := videoInputReferences(imageURL, referenceURLs)
	resolved, err := s.resolveVideoInputReferences(ctx, all, "image")
	if err != nil {
		return "", nil, err
	}
	// Map resolved URLs back while preserving empty/non-empty slots by original order.
	next := 0
	take := func(original string) string {
		original = strings.TrimSpace(original)
		if original == "" {
			return ""
		}
		if next >= len(resolved) {
			return original
		}
		value := resolved[next]
		next++
		return value
	}
	outImage := take(imageURL)
	outRefs := make([]string, 0, len(referenceURLs))
	for _, raw := range referenceURLs {
		if value := take(raw); value != "" {
			outRefs = append(outRefs, value)
		}
	}
	return outImage, outRefs, nil
}

func (s *Service) resolveVideoInputReferences(ctx context.Context, references []string, expectedKind string) ([]string, error) {
	resolved := make([]string, 0, len(references))
	estimatedBytes := videoInputJSONBaseBytes
	for _, reference := range references {
		fileID, local := media.ParseInputReference(reference)
		if !strings.HasPrefix(reference, media.InputReferencePrefix) {
			if !addVideoReferenceBytes(&estimatedBytes, int64(len(reference))) {
				return nil, ErrVideoInputTooLarge
			}
			resolved = append(resolved, reference)
			continue
		}
		if s.mediaAssets == nil || !local {
			return nil, ErrVideoInputUnavailable
		}
		asset, body, err := s.mediaAssets.OpenInputAsset(ctx, fileID)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrVideoInputUnavailable, err)
		}
		if asset.Kind != expectedKind {
			_ = body.Close()
			return nil, fmt.Errorf("%w: file_id 必须引用%s", ErrVideoInputUnavailable, expectedKind)
		}
		data, readErr := io.ReadAll(io.LimitReader(body, media.MaxInputJSONBytes+1))
		closeErr := body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("读取视频临时输入: %w", readErr)
		}
		if closeErr != nil {
			return nil, fmt.Errorf("关闭视频临时输入: %w", closeErr)
		}
		if len(data) == 0 || len(data) > media.MaxInputJSONBytes {
			return nil, ErrVideoInputTooLarge
		}
		if !addVideoReferenceBytes(&estimatedBytes, materializedVideoReferenceBytes(asset.MIMEType, int64(len(data)))) {
			return nil, ErrVideoInputTooLarge
		}
		resolved = append(resolved, "data:"+asset.MIMEType+";base64,"+base64.StdEncoding.EncodeToString(data))
	}
	return resolved, nil
}

func materializedVideoReferenceBytes(mimeType string, sizeBytes int64) int64 {
	if sizeBytes <= 0 || sizeBytes > int64(media.MaxInputJSONBytes) {
		return -1
	}
	return int64(len("data:")+len(mimeType)+len(";base64,")) + ((sizeBytes+2)/3)*4
}

func addVideoReferenceBytes(total *int64, referenceBytes int64) bool {
	// 两个引号加一个逗号是保守的单元 JSON 开销（首项不需要逗号）。
	const jsonElementOverhead = 3
	addition := referenceBytes + jsonElementOverhead
	limit := int64(media.MaxInputJSONBytes)
	if referenceBytes < 0 || addition < 0 || *total > limit-addition {
		return false
	}
	*total += addition
	return true
}
