package console

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// resolveConsoleVideoOperation 归一化 Console 视频的模型名与操作类型，
// 并保留上游对模型与操作的互斥约束。
func resolveConsoleVideoOperation(request provider.VideoRequest) (string, provider.VideoOperation, error) {
	modelName := strings.TrimSpace(request.Model)
	if modelName == "" {
		modelName = "grok-imagine-video"
	}
	if !ResolveMedia(modelName, modeldomain.CapabilityVideo) {
		return "", "", fmt.Errorf("Console 视频模型未注册: %s", modelName)
	}
	operation := request.Operation
	if operation == "" {
		operation = provider.VideoOperationGenerate
	}
	switch operation {
	case provider.VideoOperationGenerate, provider.VideoOperationEdit, provider.VideoOperationExtend:
	default:
		return "", "", fmt.Errorf("不支持的视频操作: %s", operation)
	}
	// Official video edit/extension docs and model catalog only expose VIDEO input on
	// grok-imagine-video. 1.5 is generation-oriented (TEXT/IMAGE/AUDIO) and is rejected here.
	if operation != provider.VideoOperationGenerate && modelName != "grok-imagine-video" {
		return "", "", fmt.Errorf("%s 仅支持 grok-imagine-video", operation)
	}
	return modelName, operation, nil
}

// consoleVideoDuration 按操作类型校验并归一化视频时长，延长操作会补上上游默认值。
func consoleVideoDuration(operation provider.VideoOperation, modelName string, referenceImages, duration int) (int, error) {
	switch operation {
	case provider.VideoOperationGenerate:
		if duration < 1 || duration > 15 {
			return 0, errors.New("duration 必须在 1 到 15 秒之间")
		}
		// reference-to-video on the base model caps at 10s upstream; measured:
		//   grok-imagine-video + reference_images + duration=15
		//   -> 400 "Duration 15s exceeds the maximum allowed for reference-to-video, which is 10s."
		// image-to-video (the image field) and grok-imagine-video-1.5 both keep 15s,
		// so the cap keys on reference_images plus the base model, not on duration alone.
		if modelName == "grok-imagine-video" && referenceImages > 0 && duration > provider.ConsoleVideoMaxReferenceDurationSeconds {
			return 0, fmt.Errorf("%s 的参考图生视频最长 %d 秒，当前为 %d 秒", modelName, provider.ConsoleVideoMaxReferenceDurationSeconds, duration)
		}
	case provider.VideoOperationExtend:
		// Official /v1/videos/extensions defaults to 6s and accepts 2-10s.
		if duration == 0 {
			duration = 6
		}
		if duration < 2 || duration > 10 {
			return 0, errors.New("视频延长 duration 必须在 2 到 10 秒之间")
		}
	default:
		if duration != 0 {
			return 0, errors.New("视频编辑不支持 duration")
		}
	}
	return duration, nil
}

// validateConsoleVideoResolution 校验视频分辨率与模型、参考图模式的组合约束。
func validateConsoleVideoResolution(modelName, resolution string, hasReferences bool) error {
	if resolution == "1080p" {
		if modelName != "grok-imagine-video-1.5" {
			return fmt.Errorf("%s 不支持 1080p", modelName)
		}
		if hasReferences {
			return errors.New("reference_images 模式最高支持 720p")
		}
		return nil
	}
	if resolution != "" && resolution != "480p" && resolution != "720p" {
		return fmt.Errorf("%s 仅支持 480p、720p 或 1080p", modelName)
	}
	return nil
}

// consoleVideoBasePayload 构造生成与延长共用的视频请求负载骨架。
func consoleVideoBasePayload(modelName string, operation provider.VideoOperation, request provider.VideoRequest, duration int) map[string]any {
	payload := map[string]any{"model": modelName}
	if operation == provider.VideoOperationGenerate || operation == provider.VideoOperationExtend {
		payload["duration"] = duration
	}
	if prompt := strings.TrimSpace(request.Prompt); prompt != "" {
		payload["prompt"] = prompt
	}
	return payload
}

// applyConsoleVideoGeneratePayload 按生成模式的字段顺序填充视频负载并校验输入。
func applyConsoleVideoGeneratePayload(payload map[string]any, request provider.VideoRequest) error {
	if ratio := strings.TrimSpace(request.AspectRatio); ratio != "" {
		payload["aspect_ratio"] = ratio
	}
	if resolution := strings.TrimSpace(request.Resolution); resolution != "" {
		payload["resolution"] = resolution
	}
	if imageURL := strings.TrimSpace(request.ImageURL); imageURL != "" {
		if !validConsoleMediaInputURL(imageURL, "image") {
			return errors.New("视频首图必须是 HTTPS URL 或 image data URL")
		}
		payload["image"] = map[string]any{"url": imageURL}
	}
	if strings.TrimSpace(request.ImageURL) != "" && (len(request.ReferenceURLs) > 0 || len(request.ReferenceAudios) > 0) {
		return errors.New("image 不能与 reference_images/reference_audios 同时使用")
	}
	if len(request.ReferenceURLs) > 0 {
		references, err := consoleVideoReferenceImages(request.ReferenceURLs)
		if err != nil {
			return err
		}
		payload["reference_images"] = references
	}
	if len(request.ReferenceAudios) > 0 {
		audios, err := consoleVideoReferenceAudios(request.ReferenceAudios)
		if err != nil {
			return err
		}
		payload["reference_audios"] = audios
	}
	hasReferenceMode := len(request.ReferenceURLs) > 0 || len(request.ReferenceAudios) > 0
	if hasReferenceMode {
		if strings.TrimSpace(request.Prompt) == "" {
			return errors.New("参考图/参考音频视频必须提供 prompt")
		}
		if strings.EqualFold(strings.TrimSpace(request.Resolution), "1080p") {
			return errors.New("参考图视频 resolution 最高 720p")
		}
	}
	if _, hasPrompt := payload["prompt"]; !hasPrompt {
		if _, hasImage := payload["image"]; !hasImage {
			if !hasReferenceMode {
				return errors.New("文本生视频必须提供 prompt；图片生视频可以省略 prompt")
			}
		}
	}
	return nil
}

// consoleVideoReferenceImages 逐张校验参考图并构造 reference_images 负载项。
func consoleVideoReferenceImages(urls []string) ([]map[string]any, error) {
	references := make([]map[string]any, 0, len(urls))
	for _, rawURL := range urls {
		value := strings.TrimSpace(rawURL)
		if !validConsoleMediaInputURL(value, "image") {
			return nil, errors.New("每张视频参考图都必须是 HTTPS URL 或 image data URL")
		}
		references = append(references, map[string]any{"url": value})
	}
	// A single reference must stay in reference_images; do not coerce to image.
	return references, nil
}

// consoleVideoReferenceAudios 校验参考音频数量与 voice_id 并构造 reference_audios 负载项。
func consoleVideoReferenceAudios(values []string) ([]map[string]any, error) {
	if len(values) > 3 {
		return nil, errors.New("reference_audios 最多 3 个")
	}
	audios := make([]map[string]any, 0, len(values))
	for _, raw := range values {
		voiceID := strings.TrimSpace(raw)
		if voiceID == "" {
			return nil, errors.New("reference_audios.voice_id 不能为空")
		}
		audios = append(audios, map[string]any{"voice_id": voiceID})
	}
	return audios, nil
}

// applyConsoleVideoEditPayload 按编辑/延长模式填充视频负载并校验输入。
func applyConsoleVideoEditPayload(payload map[string]any, request provider.VideoRequest) error {
	prompt := strings.TrimSpace(request.Prompt)
	if prompt == "" {
		return errors.New("视频编辑/延长必须提供 prompt")
	}
	videoURL := strings.TrimSpace(request.VideoURL)
	if !validConsoleMediaInputURL(videoURL, "video") {
		return errors.New("输入视频必须是 HTTPS URL 或 video data URL")
	}
	payload["prompt"] = prompt
	payload["video"] = map[string]any{"url": videoURL}
	if strings.TrimSpace(request.ImageURL) != "" || len(request.ReferenceURLs) > 0 || len(request.ReferenceAudios) > 0 {
		return errors.New("视频编辑/延长不支持 image、reference_images 或 reference_audios")
	}
	if strings.TrimSpace(request.AspectRatio) != "" || strings.TrimSpace(request.Resolution) != "" {
		return errors.New("视频编辑/延长不支持 aspect_ratio 或 resolution")
	}
	return nil
}

// consoleVideoPayload 组装视频请求负载，生成与编辑/延长按操作分流。
func consoleVideoPayload(modelName string, operation provider.VideoOperation, request provider.VideoRequest, duration int) (map[string]any, error) {
	payload := consoleVideoBasePayload(modelName, operation, request, duration)
	var err error
	if operation == provider.VideoOperationGenerate {
		err = applyConsoleVideoGeneratePayload(payload, request)
	} else {
		err = applyConsoleVideoEditPayload(payload, request)
	}
	if err != nil {
		return nil, err
	}
	return payload, nil
}

func parseConsoleVideoCreate(body []byte) (string, error) {
	var payload struct {
		RequestID string `json:"request_id"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", fmt.Errorf("解析 Console 视频创建响应: %w", err)
	}
	if strings.TrimSpace(payload.RequestID) == "" {
		return "", errors.New("Console 视频创建响应缺少 request_id")
	}
	return payload.RequestID, nil
}

func parseConsoleVideoStatus(body []byte, progress func(int)) (provider.VideoResult, bool, error) {
	var payload struct {
		Status   string `json:"status"`
		Progress int    `json:"progress"`
		Video    struct {
			URL string `json:"url"`
		} `json:"video"`
		Error any `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return provider.VideoResult{}, false, fmt.Errorf("解析 Console 视频状态响应: %w", err)
	}
	if progress != nil && payload.Progress > 0 {
		progress(min(99, payload.Progress))
	}
	switch status := strings.ToLower(strings.TrimSpace(payload.Status)); status {
	case "done", "completed", "succeeded", "success", "ready":
		if strings.TrimSpace(payload.Video.URL) == "" {
			return provider.VideoResult{}, false, errors.New("Console 视频生成完成但没有返回内容 URL")
		}
		return provider.VideoResult{URL: strings.TrimSpace(payload.Video.URL), ContentType: "video/mp4"}, true, nil
	case "failed", "expired", "cancelled", "canceled", "error":
		message := safeConsoleMediaErrorValue(payload.Error)
		if message == "" {
			message = strings.ToLower(strings.TrimSpace(payload.Status))
		}
		return provider.VideoResult{}, false, fmt.Errorf("Console 视频生成失败: %s", message)
	case "pending", "processing", "in_progress", "queued":
		return provider.VideoResult{}, false, nil
	default:
		return provider.VideoResult{}, false, fmt.Errorf("Console 视频状态无效: %q", safeConsoleMediaText(status))
	}
}

func trustedConsoleVideoHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	return host == "vidgen.x.ai" || strings.HasSuffix(host, ".vidgen.x.ai")
}

func consoleVideoImageCounts(request provider.VideoRequest) (firstFrames int, referenceImages int) {
	if strings.TrimSpace(request.ImageURL) != "" {
		firstFrames++
	}
	for _, raw := range request.ReferenceURLs {
		if strings.TrimSpace(raw) != "" {
			referenceImages++
		}
	}
	return firstFrames, referenceImages
}
