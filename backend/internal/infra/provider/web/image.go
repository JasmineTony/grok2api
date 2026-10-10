package web

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

const (
	maxGeneratedImages            = 10
	mediaOutputAttempts           = 3
	imageDownloadTimeout          = 60 * time.Second
	imagineSelfUploadSource       = "IMAGINE_SELF_UPLOAD_FILE_SOURCE"
	directFileUploadResponseLimit = 2 << 20
)

var errLiteImageReady = errors.New("Lite 图片已完成")

func invalidImageRequest(message string) (*provider.Response, error) {
	return jsonProviderResponse(http.StatusBadRequest, map[string]any{"error": map[string]any{
		"message": message, "type": "invalid_request_error",
	}}), nil
}

func imageGenerationUserError(message, param, code string) (*provider.Response, error) {
	return jsonProviderResponse(http.StatusBadRequest, map[string]any{"error": map[string]any{
		"message": message, "type": "image_generation_user_error", "param": param, "code": code,
	}}), nil
}

// generateImageOptions 承载校验后的图片生成参数。
type generateImageOptions struct {
	count  int
	format string
}

// validateGenerateImageRequest 校验 n/partial_images/response_format；early 非 nil 表示拒绝。
func validateGenerateImageRequest(request provider.ImageGenerationRequest) (generateImageOptions, *provider.Response, error) {
	count := request.Count
	if count <= 0 {
		count = 1
	}
	if request.Streaming && count != 1 {
		response, err := imageGenerationUserError("Streaming is only supported with n=1.", "input", "unsupported_parameter")
		return generateImageOptions{}, response, err
	}
	if request.PartialImages < 0 || request.PartialImages > 3 {
		response, err := invalidImageRequest("partial_images 必须在 0 到 3 之间")
		return generateImageOptions{}, response, err
	}
	if request.PartialImages > 0 && !request.Streaming {
		response, err := invalidImageRequest("partial_images 仅可在 stream=true 时使用")
		return generateImageOptions{}, response, err
	}
	format := strings.ToLower(strings.TrimSpace(request.ResponseFormat))
	if format == "" {
		format = "url"
	}
	if format != "url" && format != "b64_json" {
		return generateImageOptions{}, jsonProviderResponse(http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "response_format 必须是 url 或 b64_json", "type": "invalid_request_error"}}), nil
	}
	return generateImageOptions{count: count, format: format}, nil, nil
}

func (a *Adapter) GenerateImage(ctx context.Context, request provider.ImageGenerationRequest) (*provider.Response, error) {
	options, early, err := validateGenerateImageRequest(request)
	if err != nil || early != nil {
		return early, err
	}
	spec, modelKnown := Resolve(request.Model)
	if !modelKnown || spec.Capability != "image" {
		return invalidImageRequest("模型不支持图片生成")
	}
	protocolModel := spec.ProtocolModel
	if protocolModel == "" {
		protocolModel = spec.UpstreamModel
	}
	if protocolModel == "imagine-lite" {
		if request.Streaming {
			return invalidImageRequest("grok-imagine-image-lite 不支持 stream")
		}
		if options.count > maxGeneratedImages {
			return invalidImageRequest("n 不能超过 10")
		}
		return a.generateLiteImage(ctx, request, options.count, options.format)
	}
	ratio, err := resolveImageAspectRatio(request.AspectRatio, request.Size)
	if err != nil {
		return invalidImageRequest(err.Error())
	}
	modelConfig, ok := resolveImagineModel(protocolModel, spec.ImaginePro, options.count)
	if !ok {
		return invalidImageRequest("模型不支持图片生成")
	}
	if options.count > modelConfig.MaxReturnCount {
		return invalidImageRequest(fmt.Sprintf("n 不能超过 %d", modelConfig.MaxReturnCount))
	}
	return a.generateWSImage(ctx, request, options.count, options.format, ratio, modelConfig)
}

func (a *Adapter) generateLiteImage(ctx context.Context, request provider.ImageGenerationRequest, count int, format string) (*provider.Response, error) {
	spec, _ := Resolve(request.Model)
	urls := make([]string, 0, count)
	for len(urls) < count {
		value, err := a.generateLiteImageURL(ctx, request.Credential, spec, request.Prompt)
		if err != nil {
			var mediaErr *webMediaUpstreamError
			if errors.As(err, &mediaErr) && len(urls) == 0 {
				return mediaErr.providerResponse(), nil
			}
			var upstreamErr *liteUpstreamError
			if errors.As(err, &upstreamErr) && len(urls) == 0 {
				return upstreamErr.Response(), nil
			}
			if len(urls) > 0 {
				return jsonProviderResponse(http.StatusBadGateway, map[string]any{"error": map[string]any{
					"message": fmt.Sprintf("Lite 图片仅完成 %d/%d 张: %v", len(urls), count, err),
					"type":    "server_error", "code": "image_generation_incomplete",
				}}), nil
			}
			return nil, err
		}
		urls = append(urls, value)
	}
	response, err := a.imageResponse(ctx, request.Credential, urls, nil, count, format)
	if response != nil {
		response.QuotaUnits = count
	}
	return response, err
}

type liteUpstreamError struct {
	StatusCode int
	Status     string
	Body       []byte
}

func (e *liteUpstreamError) Error() string {
	return fmt.Sprintf("Lite 图片上游返回 %d", e.StatusCode)
}

func (e *liteUpstreamError) Response() *provider.Response {
	return &provider.Response{StatusCode: e.StatusCode, Status: e.Status, Header: jsonHeaders(), Body: io.NopCloser(bytes.NewReader(e.Body))}
}

// openLiteImageUpstream 发起一次 Lite 图片上游请求并取回出口租约。
func (a *Adapter) openLiteImageUpstream(ctx context.Context, credential account.Credential, spec ModelSpec, prompt string) (*http.Response, *egress.Lease, string, error) {
	upstream, lease, _, statsigTarget, err := a.openChat(ctx, credential, "", spec, normalizedChatInput{Prompt: "Drawing: " + prompt}, gatewayOpenOptions{deferForbidden: true})
	if err != nil {
		return nil, nil, "", err
	}
	return upstream, lease, statsigTarget, nil
}

// liteImageUpstreamStatusError 处理非 2xx 的 Lite 图片响应；retry=true 表示应重新获取租约再试。
func (a *Adapter) liteImageUpstreamStatusError(ctx context.Context, upstream *http.Response, lease *egress.Lease, statsigTarget string, attempt int) (error, bool) {
	body, _ := io.ReadAll(io.LimitReader(upstream.Body, webMediaDiagnosticBodyLimit+1))
	_ = upstream.Body.Close()
	truncated := len(body) > webMediaDiagnosticBodyLimit
	if truncated {
		body = body[:webMediaDiagnosticBodyLimit]
	}
	if upstream.StatusCode == http.StatusForbidden {
		upstreamErr := newWebMediaUpstreamError(upstream.StatusCode, body, truncated)
		a.logWebMediaUpstreamRejection("image_lite_handshake", upstream, upstreamErr)
		if isClearanceRefreshableMediaError(upstreamErr) {
			// The failed WebSocket handshake invalidates the current browser
			// session. Statsig is independent and must not gate reacquiring
			// a fresh lease for the retry.
			lease.InvalidateClearance()
			_ = a.invalidateSignedStatsig(http.MethodPost, statsigTarget)
			if attempt == 0 {
				lease.Release()
				return nil, true
			}
		}
		lease.Release()
		return upstreamErr, false
	}
	a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, upstream.StatusCode, nil)
	lease.Release()
	return &liteUpstreamError{StatusCode: upstream.StatusCode, Status: upstream.Status, Body: body}, false
}

// consumeLiteImageStream 读取 Lite 上游流，返回首个图片 URL、解析结果与捕获帧。
func consumeLiteImageStream(body io.Reader) (string, parsedChat, *boundedCapture, error) {
	firstImage := ""
	capture := &boundedCapture{limit: 8 << 20}
	parsed, consumeErr := consumeUpstream(io.TeeReader(body, capture), func(kind, delta string) error {
		if kind != "image" || strings.TrimSpace(delta) == "" {
			return nil
		}
		firstImage = delta
		return errLiteImageReady
	})
	return firstImage, parsed, capture, consumeErr
}

// liteImageConsumeError 处理 Lite 流消费错误；retry=true 表示应重新获取租约再试。
func (a *Adapter) liteImageConsumeError(ctx context.Context, lease *egress.Lease, statsigTarget string, attempt int, consumeErr error) (error, bool) {
	if errors.Is(consumeErr, errWebUsageLimit) {
		lease.Release()
		response := jsonProviderResponse(http.StatusTooManyRequests, map[string]any{"error": map[string]any{
			"message": "Grok Imagine 速率限制中，请稍后重试",
			"type":    "rate_limit_error",
			"code":    "usage_limit_reached",
		}})
		body, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		return &liteUpstreamError{StatusCode: http.StatusTooManyRequests, Status: "429 Too Many Requests", Body: body}, false
	}
	status := 0
	if errors.Is(consumeErr, errWebAntiBot) {
		status = http.StatusForbidden
		// A challenge can arrive inside an otherwise successful stream,
		// so the handshake path cannot invalidate it for us.
		lease.InvalidateClearance()
		if attempt == 0 {
			_ = a.invalidateSignedStatsig(http.MethodPost, statsigTarget)
			lease.Release()
			return nil, true
		}
	}
	a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, status, consumeErr)
	lease.Release()
	if status == http.StatusForbidden {
		response := antiBotProviderResponse()
		body, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		return &liteUpstreamError{StatusCode: status, Status: "403 Forbidden", Body: body}, false
	}
	return consumeErr, false
}

// liteImageCapturedURL 从解析结果或捕获帧中提取可用的 Lite 图片 URL。
func (a *Adapter) liteImageCapturedURL(credential account.Credential, parsed *parsedChat, capture *boundedCapture) (string, error) {
	if len(parsed.Images) == 0 {
		parsed.Images = extractMarkdownImages(parsed.Text.String())
	}
	if len(parsed.Images) == 0 {
		parsed.Images = extractCapturedImageURLs(capture.Bytes())
	}
	if len(parsed.Images) == 0 {
		diagnostics := inspectLiteCapture(capture.Bytes())
		a.log().Warn("web_lite_image_not_found",
			"account_id", credential.ID,
			"captured_bytes", len(capture.Bytes()),
			"frames", diagnostics.Frames,
			"response_fields", diagnostics.ResponseFields,
			"message_tags", diagnostics.MessageTags,
			"image_chunks", diagnostics.ImageChunks,
			"image_urls", diagnostics.ImageURLs,
			"image_fields", diagnostics.ImageFields,
			"max_progress", diagnostics.MaxProgress,
			"soft_stop", diagnostics.SoftStop,
			"upstream_error_code", diagnostics.ErrorCode,
			"upstream_error", diagnostics.ErrorMessage,
		)
		return "", fmt.Errorf("Grok Web Lite 响应结束但未解析到最终图片")
	}
	// Lite 上游固定生成两张，但每次查询只计一次 Fast 额度；按旧协议取首张并为 n 重复查询。
	return parsed.Images[0], nil
}

func (a *Adapter) generateLiteImageURL(ctx context.Context, credential account.Credential, spec ModelSpec, prompt string) (string, error) {
	for attempt := 0; attempt < 2; attempt++ {
		upstream, lease, statsigTarget, err := a.openLiteImageUpstream(ctx, credential, spec, prompt)
		if err != nil {
			return "", err
		}
		if upstream.StatusCode < 200 || upstream.StatusCode >= 300 {
			upstreamErr, retry := a.liteImageUpstreamStatusError(ctx, upstream, lease, statsigTarget, attempt)
			if retry {
				continue
			}
			return "", upstreamErr
		}
		firstImage, parsed, capture, consumeErr := consumeLiteImageStream(upstream.Body)
		_ = upstream.Body.Close()
		if consumeErr != nil && !errors.Is(consumeErr, errLiteImageReady) {
			consumeFailure, retry := a.liteImageConsumeError(ctx, lease, statsigTarget, attempt, consumeErr)
			if retry {
				continue
			}
			return "", consumeFailure
		}
		a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, http.StatusOK, nil)
		lease.Release()
		if firstImage != "" {
			return firstImage, nil
		}
		return a.liteImageCapturedURL(credential, &parsed, capture)
	}
	return "", fmt.Errorf("Grok Web Lite 图片签名刷新失败")
}

func liteImageMarkdown(item map[string]any) string {
	if value, _ := item["url"].(string); value != "" {
		return "![image](" + value + ")"
	}
	if value, _ := item["b64_json"].(string); value != "" {
		mimeType, _ := item["mime_type"].(string)
		if mimeType == "" {
			mimeType = "image/jpeg"
		}
		return "![image](data:" + mimeType + ";base64," + value + ")"
	}
	return ""
}

func (a *Adapter) generateWSImage(ctx context.Context, request provider.ImageGenerationRequest, count int, format, ratio string, modelConfig imagineModelConfig) (*provider.Response, error) {
	for attempt := 0; attempt < 2; attempt++ {
		response, err := a.generateWSImageAttempt(ctx, request, count, format, ratio, modelConfig)
		if err == nil {
			return response, nil
		}
		var upstreamErr *webMediaUpstreamError
		if !errors.As(err, &upstreamErr) || !isClearanceRefreshableMediaError(upstreamErr) || attempt > 0 {
			if errors.As(err, &upstreamErr) {
				return upstreamErr.providerResponse(), nil
			}
			return nil, err
		}
		a.log().Warn("web_image_clearance_retry", "operation", "imagine", "status", upstreamErr.status, "body_kind", upstreamErr.bodyKind)
	}
	return nil, fmt.Errorf("Imagine WebSocket Clearance 重试耗尽")
}
