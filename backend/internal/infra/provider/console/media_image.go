package console

import (
	"context"
	"errors"
	"strings"

	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// consoleImageRequestOptions 保存 Console 图片接口在生成与编辑路径间共享的归一化参数。
type consoleImageRequestOptions struct {
	count       int
	format      string
	aspectRatio string
	resolution  string
	quality     string
}

func (a *Adapter) GenerateImage(ctx context.Context, request provider.ImageGenerationRequest) (*provider.Response, error) {
	if !ResolveMedia(request.Model, modeldomain.CapabilityImage) {
		return invalidConsoleMediaRequest("模型不支持 Console 图片生成"), nil
	}
	if request.Streaming || request.PartialImages != 0 {
		return invalidConsoleMediaRequest("Grok Console 标准图片接口不支持 stream 或 partial_images"), nil
	}
	options, err := normalizeConsoleImageRequestOptions(request.Model, request.ResponseFormat, request.AspectRatio, request.Size, request.Resolution, request.Quality, request.Count)
	if err != nil {
		return invalidConsoleMediaRequest(err.Error()), nil
	}
	payload := map[string]any{"model": request.Model, "prompt": request.Prompt, "n": options.count, "response_format": options.format}
	applyConsoleImagePayloadOptions(payload, options)
	return a.forwardConsoleMedia(ctx, request.Credential, "/images/generations", payload, options.format, options.count)
}

func (a *Adapter) EditImage(ctx context.Context, request provider.ImageEditRequest) (*provider.Response, error) {
	if !ResolveMedia(request.Model, modeldomain.CapabilityImageEdit) {
		return invalidConsoleMediaRequest("模型不支持 Console 图片编辑"), nil
	}
	if request.Streaming || request.PartialImages != 0 {
		return invalidConsoleMediaRequest("Grok Console 标准图片接口不支持 stream 或 partial_images"), nil
	}
	if len(request.ImageURLs) == 0 || len(request.ImageURLs) > consoleMaxEditImages {
		return invalidConsoleMediaRequest("Console 图片编辑必须提供 1 到 3 张图片"), nil
	}
	options, err := normalizeConsoleImageRequestOptions(request.Model, request.ResponseFormat, request.AspectRatio, request.Size, request.Resolution, request.Quality, request.Count)
	if err != nil {
		return invalidConsoleMediaRequest(err.Error()), nil
	}
	images, err := consoleEditImageInputs(request.ImageURLs)
	if err != nil {
		return invalidConsoleMediaRequest(err.Error()), nil
	}
	payload := map[string]any{"model": request.Model, "prompt": request.Prompt, "n": options.count, "response_format": options.format}
	if len(images) == 1 {
		payload["image"] = images[0]
	} else {
		payload["images"] = images
	}
	applyConsoleImagePayloadOptions(payload, options)
	return a.forwardConsoleMedia(ctx, request.Credential, "/images/edits", payload, options.format, options.count)
}

// normalizeConsoleImageRequestOptions 按原顺序归一化图片数量、格式、比例、分辨率与质量。
func normalizeConsoleImageRequestOptions(model, responseFormat, aspectRatio, size, resolution, quality string, count int) (consoleImageRequestOptions, error) {
	options := consoleImageRequestOptions{count: count}
	if options.count <= 0 {
		options.count = 1
	}
	if options.count > 10 {
		return consoleImageRequestOptions{}, errors.New("n 必须在 1 到 10 之间")
	}
	format, err := normalizeConsoleImageFormat(responseFormat)
	if err != nil {
		return consoleImageRequestOptions{}, err
	}
	options.format = format
	ratio, err := resolveConsoleImageAspectRatio(aspectRatio, size)
	if err != nil {
		return consoleImageRequestOptions{}, err
	}
	options.aspectRatio = ratio
	resolutionValue, err := normalizeConsoleImageResolution(resolution)
	if err != nil {
		return consoleImageRequestOptions{}, err
	}
	options.resolution = resolutionValue
	qualityValue, err := normalizeConsoleImageQuality(model, quality)
	if err != nil {
		return consoleImageRequestOptions{}, err
	}
	options.quality = qualityValue
	return options, nil
}

// applyConsoleImagePayloadOptions 把已归一化的可选参数写入图片请求负载。
func applyConsoleImagePayloadOptions(payload map[string]any, options consoleImageRequestOptions) {
	if options.aspectRatio != "" {
		payload["aspect_ratio"] = options.aspectRatio
	}
	if options.resolution != "" {
		payload["resolution"] = options.resolution
	}
	if options.quality != "" {
		payload["quality"] = options.quality
	}
}

// consoleEditImageInputs 校验并构造图片编辑输入，保持逐张校验的原始顺序。
func consoleEditImageInputs(rawURLs []string) ([]map[string]any, error) {
	images := make([]map[string]any, 0, len(rawURLs))
	for _, rawURL := range rawURLs {
		value := strings.TrimSpace(rawURL)
		if !validConsoleMediaInputURL(value, "image") {
			return nil, errors.New("每张编辑图片都必须是 HTTPS URL 或 image data URL")
		}
		images = append(images, map[string]any{"type": "image_url", "url": value})
	}
	return images, nil
}

func normalizeConsoleImageFormat(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "url", nil
	}
	if value != "url" && value != "b64_json" {
		return "", errors.New("response_format 必须是 url 或 b64_json")
	}
	return value, nil
}

func normalizeConsoleImageResolution(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "", nil
	}
	if value != "1k" && value != "2k" {
		return "", errors.New("resolution 必须是 1k 或 2k")
	}
	return value, nil
}

func normalizeConsoleImageQuality(model, value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "", nil
	}
	if strings.TrimSpace(model) != "grok-imagine-image-2.0" {
		return "", errors.New("quality 仅支持 grok-imagine-image-2.0")
	}
	if value != "low" && value != "medium" {
		return "", errors.New("quality 必须是 low 或 medium")
	}
	return value, nil
}

func resolveConsoleImageAspectRatio(aspectRatio, size string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(aspectRatio))
	if value == "" {
		value = strings.ToLower(strings.TrimSpace(size))
	}
	if value == "" || value == "auto" {
		return "", nil
	}
	values := map[string]string{
		"1:1": "1:1", "16:9": "16:9", "9:16": "9:16", "4:3": "4:3", "3:4": "3:4", "3:2": "3:2", "2:3": "2:3", "2:1": "2:1", "1:2": "1:2",
		"1024x1024": "1:1", "1280x720": "16:9", "720x1280": "9:16", "1792x1024": "3:2", "1536x1024": "3:2", "1024x1792": "2:3", "1024x1536": "2:3",
	}
	if resolved := values[value]; resolved != "" {
		return resolved, nil
	}
	return "", errors.New("aspect_ratio 或 size 不受支持")
}
