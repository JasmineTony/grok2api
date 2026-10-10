package web

import (
	"fmt"
	"strings"
)

func buildImageEditPayload(prompt string, assets []string, aspectRatio string) map[string]any {
	imageToImage := map[string]any{
		"prompt":      prompt,
		"inputAssets": assets,
	}
	if aspectRatio != "" {
		imageToImage["aspectRatio"] = aspectRatio
	}
	return map[string]any{
		"modelName": "imagine-image-edit", "message": prompt,
		"enableImageStreaming": true, "enableSideBySide": true, "sendFinalMetadata": true,
		"mediaGenInput": map[string]any{"imageToImage": imageToImage},
	}
}

func resolveImageEditAspectRatio(aspectRatio, size string) (string, error) {
	if strings.TrimSpace(aspectRatio) == "" && strings.TrimSpace(size) == "" {
		return "", nil
	}
	return resolveImageAspectRatio(aspectRatio, size)
}

func resolveImageAspectRatio(aspectRatio, size string) (string, error) {
	values := map[string]string{
		"auto": "auto", "1:1": "1:1", "16:9": "16:9", "9:16": "9:16", "4:3": "4:3", "3:4": "3:4",
		"3:2": "3:2", "2:3": "2:3", "2:1": "2:1", "1:2": "1:2", "19.5:9": "19.5:9", "9:19.5": "9:19.5", "20:9": "20:9", "9:20": "9:20",
		"1280x720": "16:9", "720x1280": "9:16", "1792x1024": "3:2", "1536x1024": "3:2", "1024x1792": "2:3", "1024x1536": "2:3", "1024x1024": "1:1",
	}
	value := strings.ToLower(strings.TrimSpace(aspectRatio))
	if value == "" {
		value = strings.ToLower(strings.TrimSpace(size))
	}
	if value == "" {
		return "auto", nil
	}
	if resolved := values[value]; resolved != "" {
		return resolved, nil
	}
	return "", fmt.Errorf("aspect_ratio 不受支持")
}

func resolveAspectRatio(size string) string {
	if strings.TrimSpace(size) == "" {
		return "1:1"
	}
	value, err := resolveImageAspectRatio("", size)
	if err != nil {
		return "1:1"
	}
	return value
}
