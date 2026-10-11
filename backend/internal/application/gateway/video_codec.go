package gateway

import (
	"context"
	"fmt"
	"strings"

	json "encoding/json"
	media "github.com/chenyme/grok2api/backend/internal/domain/media"
	provider "github.com/chenyme/grok2api/backend/internal/ports/provider"
)

func encodeVideoInput(imageURL string, referenceURLs []string) (string, error) {
	return encodeVideoInputFull(provider.VideoOperationGenerate, imageURL, referenceURLs, nil, "")
}

func encodeVideoInputFull(operation provider.VideoOperation, imageURL string, referenceURLs []string, referenceAudios []string, videoURL string) (string, error) {
	payload := map[string]any{}
	if operation == "" {
		operation = provider.VideoOperationGenerate
	}
	if operation != provider.VideoOperationGenerate {
		payload["operation"] = string(operation)
	}
	if value := strings.TrimSpace(imageURL); value != "" {
		payload["image_url"] = value
	}
	refs := make([]string, 0, len(referenceURLs))
	for _, raw := range referenceURLs {
		if value := strings.TrimSpace(raw); value != "" {
			refs = append(refs, value)
		}
	}
	if len(refs) > 0 {
		payload["reference_urls"] = refs
	}
	audios := normalizeVideoReferenceAudios(referenceAudios)
	if len(audios) > 0 {
		payload["reference_audios"] = audios
	}
	if value := strings.TrimSpace(videoURL); value != "" {
		payload["video_url"] = value
	}
	// Keep a combined image_urls field for older readers/tools that only
	// understand the pre-split shape. New workers prefer image_url/reference_urls.
	combined := videoInputReferences(imageURL, referenceURLs)
	if len(combined) > 0 {
		payload["image_urls"] = combined
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("编码视频输入: %w", err)
	}
	if len(data) > media.MaxInputJSONBytes {
		return "", ErrVideoInputTooLarge
	}
	return string(data), nil
}

func decodeVideoInput(value string) []string {
	imageURL, refs, videoURL := decodeVideoInputFull(value)
	values := videoInputReferences(imageURL, refs)
	if v := strings.TrimSpace(videoURL); v != "" {
		values = append(values, v)
	}
	return values
}

func decodeVideoInputParts(value string) (string, []string) {
	imageURL, refs, _ := decodeVideoInputFull(value)
	return imageURL, refs
}

func decodeVideoInputFull(value string) (string, []string, string) {
	imageURL, refs, _, videoURL := decodeVideoInputDetailed(value)
	return imageURL, refs, videoURL
}

func decodeVideoInputDetailed(value string) (string, []string, []string, string) {
	var input struct {
		Operation       string   `json:"operation"`
		ImageURL        string   `json:"image_url"`
		ReferenceURLs   []string `json:"reference_urls"`
		ReferenceAudios []string `json:"reference_audios"`
		ImageURLs       []string `json:"image_urls"`
		VideoURL        string   `json:"video_url"`
	}
	_ = json.Unmarshal([]byte(value), &input)
	videoURL := strings.TrimSpace(input.VideoURL)
	audios := normalizeVideoReferenceAudios(input.ReferenceAudios)
	if strings.TrimSpace(input.ImageURL) != "" || len(input.ReferenceURLs) > 0 || len(audios) > 0 || videoURL != "" || strings.TrimSpace(input.Operation) != "" {
		refs := make([]string, 0, len(input.ReferenceURLs))
		for _, raw := range input.ReferenceURLs {
			if v := strings.TrimSpace(raw); v != "" {
				refs = append(refs, v)
			}
		}
		return strings.TrimSpace(input.ImageURL), refs, audios, videoURL
	}
	// Legacy jobs stored a flat image_urls list. Preserve historical mapping:
	// one URL was treated as the first-frame image; multiple URLs were references.
	legacy := make([]string, 0, len(input.ImageURLs))
	for _, raw := range input.ImageURLs {
		if v := strings.TrimSpace(raw); v != "" {
			legacy = append(legacy, v)
		}
	}
	switch len(legacy) {
	case 0:
		return "", nil, nil, ""
	case 1:
		return legacy[0], nil, nil, ""
	default:
		return "", legacy, nil, ""
	}
}

func decodeVideoOperation(value string) provider.VideoOperation {
	var input struct {
		Operation string `json:"operation"`
	}
	_ = json.Unmarshal([]byte(value), &input)
	switch provider.VideoOperation(strings.TrimSpace(input.Operation)) {
	case provider.VideoOperationEdit:
		return provider.VideoOperationEdit
	case provider.VideoOperationExtend:
		return provider.VideoOperationExtend
	default:
		return provider.VideoOperationGenerate
	}
}

func (s *Service) resolveVideoJobInputs(ctx context.Context, operation provider.VideoOperation, inputJSON string) (string, []string, []string, string, error) {
	_, _, referenceAudios, videoURL := decodeVideoInputDetailed(inputJSON)
	resolvedImage, resolvedRefs, err := s.resolveVideoInputParts(ctx, inputJSON)
	if err != nil {
		return "", nil, nil, "", err
	}
	if strings.TrimSpace(videoURL) == "" {
		return resolvedImage, resolvedRefs, referenceAudios, "", nil
	}
	if operation == provider.VideoOperationGenerate {
		return "", nil, nil, "", ErrVideoInputUnavailable
	}
	resolvedVideos, err := s.resolveVideoInputReferences(ctx, []string{videoURL}, "video")
	if err != nil {
		return "", nil, nil, "", err
	}
	if len(resolvedVideos) == 0 {
		return "", nil, nil, "", ErrVideoInputUnavailable
	}
	return resolvedImage, resolvedRefs, referenceAudios, resolvedVideos[0], nil
}

func validateVideoReferenceAudios(values []string) error {
	if len(values) > 3 {
		return fmt.Errorf("reference_audios 最多 3 个")
	}
	for _, raw := range values {
		if strings.TrimSpace(raw) == "" {
			return fmt.Errorf("reference_audios.voice_id 不能为空")
		}
	}
	return nil
}

func normalizeVideoReferenceAudios(values []string) []string {
	out := make([]string, 0, len(values))
	for _, raw := range values {
		if value := strings.TrimSpace(raw); value != "" {
			out = append(out, value)
		}
	}
	return out
}

func videoInputReferences(imageURL string, referenceURLs []string) []string {
	values := make([]string, 0, 1+len(referenceURLs))
	if v := strings.TrimSpace(imageURL); v != "" {
		values = append(values, v)
	}
	for _, raw := range referenceURLs {
		if v := strings.TrimSpace(raw); v != "" {
			values = append(values, v)
		}
	}
	return values
}
