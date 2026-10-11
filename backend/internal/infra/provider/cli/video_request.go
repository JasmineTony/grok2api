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
	if strings.TrimSpace(request.ImageURL) != "" && (len(request.ReferenceURLs) > 0 || len(request.ReferenceAudios) > 0) {
		return nil, fmt.Errorf("image 不能与 reference_images/reference_audios 同时使用")
	}
	if len(request.ReferenceURLs) > 0 {
		references := make([]map[string]any, 0, len(request.ReferenceURLs))
		for _, rawURL := range request.ReferenceURLs {
			refURL := strings.TrimSpace(rawURL)
			if refURL == "" {
				return nil, fmt.Errorf("视频参考图 URL 不能为空")
			}
			references = append(references, map[string]any{profile.imageURLField: refURL})
		}
		// A single reference must stay in reference_images; do not coerce to image.
		payload["reference_images"] = references
	}
	if len(request.ReferenceAudios) > 0 {
		if len(request.ReferenceAudios) > 3 {
			return nil, fmt.Errorf("reference_audios 最多 3 个")
		}
		audios := make([]map[string]any, 0, len(request.ReferenceAudios))
		for _, raw := range request.ReferenceAudios {
			voiceID := strings.TrimSpace(raw)
			if voiceID == "" {
				return nil, fmt.Errorf("reference_audios.voice_id 不能为空")
			}
			audios = append(audios, map[string]any{"voice_id": voiceID})
		}
		payload["reference_audios"] = audios
	}
	hasReferenceMode := len(request.ReferenceURLs) > 0 || len(request.ReferenceAudios) > 0
	if hasReferenceMode {
		if strings.TrimSpace(request.Prompt) == "" {
			return nil, fmt.Errorf("参考图/参考音频视频必须提供 prompt")
		}
		if strings.EqualFold(strings.TrimSpace(request.Resolution), "1080p") {
			return nil, fmt.Errorf("参考图视频 resolution 最高 720p")
		}
	}
	if _, hasPrompt := payload["prompt"]; !hasPrompt {
		if _, hasImage := payload["image"]; !hasImage {
			if !hasReferenceMode {
				return nil, fmt.Errorf("文本生视频必须提供 prompt；图片生视频可以省略 prompt")
			}
		}
	}
	if uploadURL = strings.TrimSpace(uploadURL); uploadURL != "" {
		payload["output"] = map[string]any{"upload_url": uploadURL}
	}
	return payload, nil
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
