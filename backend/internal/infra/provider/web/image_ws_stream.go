package web

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	fhttp "github.com/bogdanfinn/fhttp"
	"github.com/bogdanfinn/websocket"
	"github.com/chenyme/grok2api/backend/internal/domain/account"
	domainegress "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

func (a *Adapter) generateWSImageAttempt(ctx context.Context, request provider.ImageGenerationRequest, count int, format, ratio string, modelConfig imagineModelConfig) (*provider.Response, error) {
	cfg := a.config()
	token, err := a.cipher.Decrypt(request.Credential.EncryptedAccessToken)
	if err != nil {
		return nil, err
	}
	lease, err := a.egress.AcquireCredential(ctx, domainegress.ScopeWeb, request.Credential)
	if err != nil {
		return nil, err
	}
	leaseOwned := true
	defer func() {
		if leaseOwned {
			lease.Release()
		}
	}()
	wsURL, headers, err := imagineHandshake(cfg.BaseURL, token, lease)
	if err != nil {
		return nil, err
	}
	connection, response, err := lease.DialWebSocketDeferredForbidden(ctx, wsURL, headers, 30*time.Second)
	if err != nil {
		return nil, a.imagineHandshakeFailure(ctx, lease, response, err)
	}
	connectionOwned := true
	defer func() {
		if connectionOwned {
			_ = connection.Close()
		}
	}()
	if err := prepareImagineConnection(connection, cfg.ImageTimeoutSeconds, request.Prompt, ratio, cfg.AllowNSFW, modelConfig.Pro, modelConfig.ExpectedCount); err != nil {
		a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, 0, err)
		return nil, err
	}
	if request.Streaming {
		reader, writer := io.Pipe()
		streamCtx, cancel := context.WithCancel(ctx)
		leaseOwned = false
		connectionOwned = false
		go a.streamImagineImages(streamCtx, writer, connection, lease, request.Credential, count, request.PartialImages, modelConfig)
		return &provider.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: streamHeaders(), Body: &cancelBody{ReadCloser: reader, cancel: cancel}, QuotaUnits: count}, nil
	}
	images, early, err := a.collectImagineImages(ctx, connection, lease, count, modelConfig)
	if err != nil || early != nil {
		return early, err
	}
	return a.imagineImageResponse(ctx, request.Credential, images, count, format)
}

// imagineHandshake 构造 Imagine WebSocket 握手所需的 URL 与请求头。
func imagineHandshake(baseURL, token string, lease *egress.Lease) (string, fhttp.Header, error) {
	wsURL, err := imagineURL(baseURL)
	if err != nil {
		return "", nil, err
	}
	headers := fhttp.Header{}
	headers.Set("Origin", baseURL)
	headers.Set("User-Agent", lease.UserAgent)
	headers.Set("Cookie", egress.BuildSSOCookie(token, lease.CFCookies))
	headers.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	headers.Set("Cache-Control", "no-cache")
	headers.Set("Pragma", "no-cache")
	return wsURL, headers, nil
}

// imagineHandshakeFailure 处理握手失败：记录上游拒绝并按需失效 clearance。
func (a *Adapter) imagineHandshakeFailure(ctx context.Context, lease *egress.Lease, response *fhttp.Response, err error) error {
	if response == nil {
		a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, 0, err)
		return fmt.Errorf("连接 Imagine WebSocket: %w", err)
	}
	var body []byte
	if response.Body != nil {
		body, _ = io.ReadAll(io.LimitReader(response.Body, webMediaDiagnosticBodyLimit+1))
		_ = response.Body.Close()
	}
	truncated := len(body) > webMediaDiagnosticBodyLimit
	if truncated {
		body = body[:webMediaDiagnosticBodyLimit]
	}
	upstreamErr := newWebMediaUpstreamError(response.StatusCode, body, truncated)
	if isClearanceRefreshableMediaError(upstreamErr) {
		lease.InvalidateClearance()
	}
	a.logWebMediaUpstreamRejection("image_imagine_handshake", &http.Response{
		StatusCode: response.StatusCode,
		Header:     http.Header(response.Header).Clone(),
	}, upstreamErr)
	if response.StatusCode != http.StatusForbidden {
		a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, response.StatusCode, err)
	}
	return upstreamErr
}

// prepareImagineConnection 设置连接读写上限与截止时间，并发出 reset 与生成请求。
func prepareImagineConnection(connection *websocket.Conn, timeoutSeconds int, prompt, ratio string, nsfw, pro bool, expectedCount int) error {
	connection.SetReadLimit(64 << 20)
	deadline := time.Now().Add(time.Duration(timeoutSeconds) * time.Second)
	_ = connection.SetReadDeadline(deadline)
	_ = connection.SetWriteDeadline(deadline)
	if err := connection.WriteJSON(imagineResetMessage()); err != nil {
		return err
	}
	return connection.WriteJSON(imagineRequestMessage(newWebID("img"), prompt, ratio, nsfw, pro, expectedCount))
}

// collectImagineImages 读取至收集到足够图片；early 非 nil 表示应直接响应该状态码。
func (a *Adapter) collectImagineImages(ctx context.Context, connection *websocket.Conn, lease *egress.Lease, count int, modelConfig imagineModelConfig) ([]imagineImageValue, *provider.Response, error) {
	collector := newImagineCollector()
	for collector.UsableCount() < count && !collector.Done(modelConfig.ExpectedCount) {
		messageType, data, readErr := connection.ReadMessage()
		if readErr != nil {
			a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, 0, readErr)
			return nil, nil, fmt.Errorf("读取 Imagine WebSocket: %w", readErr)
		}
		if messageType != websocket.TextMessage {
			continue
		}
		var message map[string]any
		if json.Unmarshal(data, &message) != nil {
			continue
		}
		if message["type"] == "error" {
			upstreamErr := fmt.Errorf("Imagine WebSocket 返回错误")
			a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, 0, upstreamErr)
			return nil, nil, upstreamErr
		}
		collector.Accept(message)
	}
	a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, http.StatusOK, nil)
	images := collector.Images()
	if len(images) == 0 {
		return nil, nil, fmt.Errorf("Imagine WebSocket 完成但没有可用图片")
	}
	if len(images) < count {
		return nil, jsonProviderResponse(http.StatusBadGateway, map[string]any{"error": map[string]any{
			"message": fmt.Sprintf("上游仅返回 %d/%d 张可用图片", len(images), count),
			"type":    "server_error", "code": "image_generation_incomplete",
		}}), nil
	}
	return images, nil, nil
}

// imagineImageResponse 把收集到的图片转换为最终响应载荷。
func (a *Adapter) imagineImageResponse(ctx context.Context, credential account.Credential, images []imagineImageValue, count int, format string) (*provider.Response, error) {
	urls := make([]string, 0, len(images))
	blobs := make([]string, 0, len(images))
	for _, image := range images {
		urls = append(urls, image.URL)
		blobs = append(blobs, image.Blob)
	}
	result, err := a.imageResponse(ctx, credential, urls, blobs, count, format)
	if result != nil {
		result.QuotaUnits = count
	}
	return result, err
}

func (a *Adapter) streamImagineImages(ctx context.Context, writer *io.PipeWriter, connection *websocket.Conn, lease *egress.Lease, credential account.Credential, count, partialImages int, modelConfig imagineModelConfig) {
	defer lease.Release()
	defer connection.Close()
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			_ = connection.Close()
		case <-done:
		}
	}()
	collector := newImagineCollector()
	emitted := 0
	partialIndex := 0
	for emitted < count {
		message, ok, readErr := readImagineEvent(connection)
		if readErr != nil {
			a.finishImagineStreamWithReadError(ctx, writer, lease, readErr)
			return
		}
		if !ok {
			continue
		}
		if message["type"] == "error" {
			upstreamErr := fmt.Errorf("Imagine WebSocket 返回错误")
			a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, 0, upstreamErr)
			_ = writer.CloseWithError(upstreamErr)
			return
		}
		collector.Accept(message)
		if err := a.emitImaginePreviews(ctx, writer, credential, collector, partialImages, &partialIndex); err != nil {
			_ = writer.CloseWithError(err)
			return
		}
		if err := a.emitImagineImages(ctx, writer, credential, collector, count, &emitted); err != nil {
			_ = writer.CloseWithError(err)
			return
		}
		if collector.Done(modelConfig.ExpectedCount) && emitted < count {
			_ = writer.CloseWithError(fmt.Errorf("上游仅返回 %d/%d 张可用图片", emitted, count))
			return
		}
	}
	a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, http.StatusOK, nil)
	_ = writer.Close()
}

// readImagineEvent 读取一条可处理的文本事件；ok=false 表示应忽略该消息。
func readImagineEvent(connection *websocket.Conn) (map[string]any, bool, error) {
	messageType, data, readErr := connection.ReadMessage()
	if readErr != nil {
		return nil, false, readErr
	}
	if messageType != websocket.TextMessage {
		return nil, false, nil
	}
	var message map[string]any
	if json.Unmarshal(data, &message) != nil {
		return nil, false, nil
	}
	return message, true, nil
}

// finishImagineStreamWithReadError 按请求取消与读取失败分别关闭流并回写反馈。
func (a *Adapter) finishImagineStreamWithReadError(ctx context.Context, writer *io.PipeWriter, lease *egress.Lease, readErr error) {
	if ctx.Err() != nil {
		_ = writer.CloseWithError(ctx.Err())
		return
	}
	a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, 0, readErr)
	_ = writer.CloseWithError(readErr)
}

// emitImaginePreviews 写出未超出上限的局部预览图。
func (a *Adapter) emitImaginePreviews(ctx context.Context, writer *io.PipeWriter, credential account.Credential, collector *imagineCollector, partialImages int, partialIndex *int) error {
	if partialImages <= 0 {
		return nil
	}
	for _, image := range collector.ReadyPreviews() {
		if *partialIndex >= partialImages {
			continue
		}
		raw, err := a.imageBytes(ctx, credential, image)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			continue
		}
		if err := writeSSE(writer, "image_generation.partial_image", openAIImageStreamEvent("image_generation.partial_image", image, raw, *partialIndex)); err != nil {
			return err
		}
		*partialIndex++
	}
	return nil
}

// emitImagineImages 写出已完成图片并累加本轮写出数量。
func (a *Adapter) emitImagineImages(ctx context.Context, writer *io.PipeWriter, credential account.Credential, collector *imagineCollector, count int, emitted *int) error {
	for _, image := range collector.ReadyImages() {
		if *emitted >= count {
			break
		}
		raw, err := a.imageBytes(ctx, credential, image)
		if err != nil {
			return err
		}
		if err := a.saveStreamImage(ctx, raw); err != nil {
			return err
		}
		if err := writeSSE(writer, "image_generation.completed", openAIImageStreamEvent("image_generation.completed", image, raw, 0)); err != nil {
			return err
		}
		*emitted++
	}
	return nil
}

func openAIImageStreamEvent(eventType string, image imagineImageValue, raw []byte, partialIndex int) map[string]any {
	width, height := image.Width, image.Height
	size := "auto"
	if width > 0 && height > 0 {
		size = fmt.Sprintf("%dx%d", width, height)
	}
	value := map[string]any{
		"type": eventType, "b64_json": base64.StdEncoding.EncodeToString(raw),
		"created_at": time.Now().Unix(), "size": size, "quality": "auto",
		"background": "auto", "output_format": imageOutputFormat(raw),
	}
	if eventType == "image_generation.partial_image" {
		value["partial_image_index"] = partialIndex
	}
	return value
}

func imageOutputFormat(raw []byte) string {
	mimeType := http.DetectContentType(raw)
	switch mimeType {
	case "image/png":
		return "png"
	case "image/webp":
		return "webp"
	default:
		return "jpeg"
	}
}

func (a *Adapter) saveStreamImage(ctx context.Context, raw []byte) error {
	if a.assets == nil {
		return provider.NewMediaPostProcessingError(provider.MediaPostProcessingStorage, fmt.Errorf("图片媒体存储未配置"))
	}
	if _, err := a.saveImageWithRetry(ctx, raw); err != nil {
		return provider.NewMediaPostProcessingError(provider.MediaPostProcessingStorage, err)
	}
	return nil
}

func imagineURL(baseURL string) (string, error) {
	value, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	switch value.Scheme {
	case "https":
		value.Scheme = "wss"
	case "http":
		value.Scheme = "ws"
	default:
		return "", fmt.Errorf("Grok Web Base URL 协议无效")
	}
	value.Path = "/ws/imagine/listen"
	value.RawQuery = ""
	return value.String(), nil
}

func imagineResetMessage() map[string]any {
	return map[string]any{"type": "conversation.item.create", "timestamp": time.Now().UnixMilli(), "item": map[string]any{"type": "message", "content": []any{map[string]any{"type": "reset"}}}}
}

func imagineRequestMessage(id, prompt, ratio string, nsfw, pro bool, generations int) map[string]any {
	return map[string]any{"type": "conversation.item.create", "timestamp": time.Now().UnixMilli(), "item": map[string]any{"type": "message", "content": []any{map[string]any{"requestId": id, "text": prompt, "type": "input_text", "properties": map[string]any{"section_count": 0, "is_kids_mode": false, "enable_nsfw": nsfw, "skip_upsampler": false, "enable_side_by_side": true, "is_initial": false, "aspect_ratio": ratio, "enable_pro": pro, "num_generations": generations}}}}}
}
