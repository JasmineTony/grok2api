package cli

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	mediadomain "github.com/chenyme/grok2api/backend/internal/domain/media"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

const (
	buildVideoModel = "grok-imagine-video-1.5"
	xaiVideoModel   = "grok-imagine-video-1.5-preview"
	// Align with the gateway ceiling and official xAI video inputs:
	// image = first frame; reference_images = style/content references (may be length 1).
	buildVideoMaxImages         = mediadomain.MaxInputImages
	buildVideoPollEvery         = 2 * time.Second
	buildVideoMaxBodySize       = 2 << 20
	buildVideoErrorSummaryLimit = 256
	buildVideoErrorMessageLimit = 160
)

type videoRequestProfile struct {
	model            string
	imageURLField    string
	userAgentProduct string
}

var (
	buildVideoRequestProfile = videoRequestProfile{model: buildVideoModel, imageURLField: "image_url"}
	// Direct XAI image and video tools use xai-grok-build/<version>, unlike the
	// grok-shell/<version> user agent used for cli-chat-proxy sampling requests.
	xaiVideoRequestProfile = videoRequestProfile{model: xaiVideoModel, imageURLField: "url", userAgentProduct: "xai-grok-build"}
)

func videoCreatePayload(request provider.VideoRequest, uploadURL string, profile videoRequestProfile) (map[string]any, error) {
	payload := videoBasePayload(request, profile)
	if strings.TrimSpace(request.ImageURL) != "" && (len(request.ReferenceURLs) > 0 || len(request.ReferenceAudios) > 0) {
		return nil, fmt.Errorf("image 不能与 reference_images/reference_audios 同时使用")
	}
	references, err := videoReferenceImages(request.ReferenceURLs, profile)
	if err != nil {
		return nil, err
	}
	if references != nil {
		// A single reference must stay in reference_images; do not coerce to image.
		payload["reference_images"] = references
	}
	audios, err := videoReferenceAudios(request.ReferenceAudios)
	if err != nil {
		return nil, err
	}
	if audios != nil {
		payload["reference_audios"] = audios
	}
	hasReferenceMode := len(request.ReferenceURLs) > 0 || len(request.ReferenceAudios) > 0
	if hasReferenceMode {
		if err := validateVideoReferenceMode(request); err != nil {
			return nil, err
		}
	}
	if err := validateVideoPromptRequirement(payload, hasReferenceMode); err != nil {
		return nil, err
	}
	if uploadURL = strings.TrimSpace(uploadURL); uploadURL != "" {
		payload["output"] = map[string]any{"upload_url": uploadURL}
	}
	return payload, nil
}

// videoBasePayload 写入模型与可选生成参数；字段名与官方 xAI 视频协议保持一致。
func videoBasePayload(request provider.VideoRequest, profile videoRequestProfile) map[string]any {
	payload := map[string]any{
		"model": profile.model,
	}
	if prompt := strings.TrimSpace(request.Prompt); prompt != "" {
		payload["prompt"] = prompt
	}
	if request.Duration > 0 {
		payload["duration"] = request.Duration
	}
	if ratio := strings.TrimSpace(request.AspectRatio); ratio != "" {
		payload["aspect_ratio"] = ratio
	}
	if resolution := strings.TrimSpace(request.Resolution); resolution != "" {
		payload["resolution"] = resolution
	}
	if imageURL := strings.TrimSpace(request.ImageURL); imageURL != "" {
		payload["image"] = map[string]any{profile.imageURLField: imageURL}
	}
	return payload
}

// videoReferenceImages 构造 reference_images：空 URL 报错，单个参考图仍保留在 reference_images。
func videoReferenceImages(rawURLs []string, profile videoRequestProfile) ([]map[string]any, error) {
	if len(rawURLs) == 0 {
		return nil, nil
	}
	references := make([]map[string]any, 0, len(rawURLs))
	for _, rawURL := range rawURLs {
		refURL := strings.TrimSpace(rawURL)
		if refURL == "" {
			return nil, fmt.Errorf("视频参考图 URL 不能为空")
		}
		references = append(references, map[string]any{profile.imageURLField: refURL})
	}
	return references, nil
}

// videoReferenceAudios 构造 reference_audios：最多 3 个，voice_id 不能为空。
func videoReferenceAudios(rawAudios []string) ([]map[string]any, error) {
	if len(rawAudios) == 0 {
		return nil, nil
	}
	if len(rawAudios) > 3 {
		return nil, fmt.Errorf("reference_audios 最多 3 个")
	}
	audios := make([]map[string]any, 0, len(rawAudios))
	for _, raw := range rawAudios {
		voiceID := strings.TrimSpace(raw)
		if voiceID == "" {
			return nil, fmt.Errorf("reference_audios.voice_id 不能为空")
		}
		audios = append(audios, map[string]any{"voice_id": voiceID})
	}
	return audios, nil
}

// validateVideoReferenceMode 校验参考图/参考音频视频的 prompt 与分辨率上限。
func validateVideoReferenceMode(request provider.VideoRequest) error {
	if strings.TrimSpace(request.Prompt) == "" {
		return fmt.Errorf("参考图/参考音频视频必须提供 prompt")
	}
	if strings.EqualFold(strings.TrimSpace(request.Resolution), "1080p") {
		return fmt.Errorf("参考图视频 resolution 最高 720p")
	}
	return nil
}

// validateVideoPromptRequirement 保证文本生视频必须带 prompt；图片与参考模式可以省略。
func validateVideoPromptRequirement(payload map[string]any, hasReferenceMode bool) error {
	if _, hasPrompt := payload["prompt"]; hasPrompt {
		return nil
	}
	if _, hasImage := payload["image"]; hasImage {
		return nil
	}
	if hasReferenceMode {
		return nil
	}
	return fmt.Errorf("文本生视频必须提供 prompt；图片生视频可以省略 prompt")
}

func (a *Adapter) doVideoJSON(ctx context.Context, credential account.Credential, accessToken, method, base, path string, body []byte, profile videoRequestProfile, withTrace bool) ([]byte, error) {
	var bodyReader io.Reader
	if len(body) > 0 {
		bodyReader = bytes.NewReader(body)
	}
	requestCtx := infraegress.WithCredential(ctx, credential)
	req, err := http.NewRequestWithContext(requestCtx, method, a.urlWithBase(base, path), bodyReader)
	if err != nil {
		return nil, err
	}
	if err := a.applyHeaders(req, credential, accessToken, profile.model, "", withTrace); err != nil {
		return nil, err
	}
	if profile.userAgentProduct != "" {
		version := strings.TrimSpace(a.config().ClientVersion)
		if version != "" {
			req.Header.Set("User-Agent", profile.userAgentProduct+"/"+version)
		}
	}
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	resp, err := a.http.Do(req)
	if err != nil {
		return nil, err
	}
	if err := normalizeGzipResponse(resp); err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, buildVideoMaxBodySize+1))
	if err != nil {
		return nil, err
	}
	if len(data) > buildVideoMaxBodySize {
		return nil, fmt.Errorf("Build 视频上游响应超过 %d 字节", buildVideoMaxBodySize)
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, provider.ErrUnauthorized
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, newVideoUpstreamError(resp.StatusCode, data)
	}
	return data, nil
}

func buildVideoImageCount(request provider.VideoRequest) int {
	count := 0
	if strings.TrimSpace(request.ImageURL) != "" {
		count++
	}
	for _, raw := range request.ReferenceURLs {
		if strings.TrimSpace(raw) != "" {
			count++
		}
	}
	return count
}
