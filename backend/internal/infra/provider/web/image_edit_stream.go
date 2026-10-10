package web

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

type imageEditStreamFrame struct {
	URL       string
	Progress  int
	Moderated bool
}

func parseImageEditStreamFrame(data []byte) (imageEditStreamFrame, bool) {
	var root map[string]any
	if json.Unmarshal(data, &root) != nil {
		return imageEditStreamFrame{}, false
	}
	result, _ := root["result"].(map[string]any)
	response, _ := result["response"].(map[string]any)
	imageResponse, _ := response["streamingImageGenerationResponse"].(map[string]any)
	if imageResponse == nil {
		return imageEditStreamFrame{}, false
	}
	rawURL := firstString(imageResponse, "imageUrl", "url")
	if rawURL == "" {
		return imageEditStreamFrame{}, false
	}
	progress, hasProgress := numberAsInt(imageResponse["progress"])
	if !hasProgress {
		if final, _ := imageResponse["isFinal"].(bool); !final {
			return imageEditStreamFrame{}, false
		}
		progress = 100
	}
	moderated, _ := imageResponse["moderated"].(bool)
	return imageEditStreamFrame{URL: absoluteAssetURL(rawURL), Progress: progress, Moderated: moderated}, true
}

func (a *Adapter) streamImageEdit(
	ctx context.Context,
	writer *io.PipeWriter,
	source io.ReadCloser,
	lease *egress.Lease,
	credential account.Credential,
	partialImages int,
	size string,
	aspectRatio string,
) {
	defer lease.Release()
	defer source.Close()
	parsed := parsedChat{}
	capture := &boundedCapture{limit: 8 << 20}
	sink := &imageEditPartialSink{
		adapter: a, ctx: ctx, writer: writer, credential: credential,
		createdAt: time.Now().Unix(), eventSize: imageEditEventSize(size, aspectRatio),
		limit: partialImages, seen: make(map[string]struct{}, partialImages),
	}
	consumeErr := consumeJSONObjects(io.TeeReader(source, capture), 8<<20, func(data []byte) error {
		return sink.consumeFrame(data, &parsed)
	})
	if consumeErr != nil {
		a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, 0, consumeErr)
		_ = writer.CloseWithError(consumeErr)
		return
	}
	a.completeStreamImageEdit(ctx, writer, lease, credential, &parsed, capture.Bytes(), sink.createdAt, sink.eventSize)
}

// completeStreamImageEdit 下载最终编辑结果并写回 completed 事件；各失败点按原语义上报出口反馈。
func (a *Adapter) completeStreamImageEdit(ctx context.Context, writer *io.PipeWriter, lease *egress.Lease, credential account.Credential, parsed *parsedChat, captured []byte, createdAt int64, eventSize string) {
	urls := imageEditResultURLs(parsed, captured)
	if len(urls) == 0 {
		err := fmt.Errorf("上游未返回可用的编辑图片")
		a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, 0, err)
		_ = writer.CloseWithError(err)
		return
	}
	raw, err := a.imageBytes(ctx, credential, imagineImageValue{URL: urls[0]})
	if err != nil {
		_ = writer.CloseWithError(provider.NewMediaPostProcessingError(provider.MediaPostProcessingDownload, err))
		return
	}
	if err := a.saveStreamImage(ctx, raw); err != nil {
		_ = writer.CloseWithError(err)
		return
	}
	if err := writeSSE(writer, "image_edit.completed", openAIImageEditStreamEvent(
		"image_edit.completed", raw, createdAt, eventSize, 0,
	)); err != nil {
		_ = writer.CloseWithError(err)
		return
	}
	a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, http.StatusOK, nil)
	_ = writer.Close()
}

// imageEditPartialSink 在结果落盘前尽力转发 partial_image 预览帧；预览失败不阻断最终结果。
type imageEditPartialSink struct {
	adapter      *Adapter
	ctx          context.Context
	writer       *io.PipeWriter
	credential   account.Credential
	createdAt    int64
	eventSize    string
	limit        int
	partialIndex int
	seen         map[string]struct{}
}

func (s *imageEditPartialSink) consumeFrame(data []byte, parsed *parsedChat) error {
	if _, _, err := parseUpstreamFrame(data, parsed); err != nil {
		return err
	}
	frame, ok := parseImageEditStreamFrame(data)
	if !ok || frame.Moderated || frame.Progress >= 100 || s.partialIndex >= s.limit {
		return nil
	}
	if _, exists := s.seen[frame.URL]; exists {
		return nil
	}
	raw, err := s.adapter.imageBytes(s.ctx, s.credential, imagineImageValue{URL: frame.URL})
	if err != nil {
		// partial_images 是尽力而为；预览下载失败不应阻断最终编辑结果。
		return nil
	}
	if err := writeSSE(s.writer, "image_edit.partial_image", openAIImageEditStreamEvent(
		"image_edit.partial_image", raw, s.createdAt, s.eventSize, s.partialIndex,
	)); err != nil {
		return err
	}
	s.seen[frame.URL] = struct{}{}
	s.partialIndex++
	return nil
}

func openAIImageEditStreamEvent(eventType string, raw []byte, createdAt int64, size string, partialIndex int) map[string]any {
	value := map[string]any{
		"type": eventType, "b64_json": base64.StdEncoding.EncodeToString(raw),
		"created_at": createdAt, "size": size, "quality": "auto",
		"background": "auto", "output_format": imageOutputFormat(raw),
	}
	if eventType == "image_edit.partial_image" {
		value["partial_image_index"] = partialIndex
	} else {
		value["usage"] = map[string]any{
			"total_tokens": 0, "input_tokens": 0, "output_tokens": 0,
			"input_tokens_details": map[string]any{"text_tokens": 0, "image_tokens": 0},
		}
	}
	return value
}

func imageEditEventSize(size, aspectRatio string) string {
	switch value := strings.ToLower(strings.TrimSpace(size)); value {
	case "1024x1024", "1024x1536", "1536x1024", "auto":
		return value
	}
	switch strings.ToLower(strings.TrimSpace(aspectRatio)) {
	case "1:1":
		return "1024x1024"
	case "2:3":
		return "1024x1536"
	case "3:2":
		return "1536x1024"
	default:
		return "auto"
	}
}

func imageEditResultURLs(parsed *parsedChat, captured []byte) []string {
	values := append([]string(nil), parsed.Images...)
	if len(values) == 0 {
		values = extractCapturedImageURLs(captured)
	}
	if len(values) == 0 {
		values = extractMarkdownImages(parsed.Text.String())
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = absoluteAssetURL(value)
		if _, moderated := parsed.moderatedImages[value]; moderated || containsString(result, value) {
			continue
		}
		result = append(result, value)
	}
	return result
}

type boundedCapture struct {
	data  []byte
	limit int
}

func (w *boundedCapture) Write(value []byte) (int, error) {
	remaining := w.limit - len(w.data)
	if remaining > 0 {
		w.data = append(w.data, value[:min(remaining, len(value))]...)
	}
	return len(value), nil
}

func (w *boundedCapture) Bytes() []byte { return w.data }

func extractCapturedImageURLs(data []byte) []string {
	results := make([]string, 0, 2)
	_ = consumeJSONObjects(bytes.NewReader(data), 8<<20, func(frame []byte) error {
		var value any
		if json.Unmarshal(frame, &value) == nil {
			collectCapturedImageURLs(value, &results)
		}
		return nil
	})
	return results
}
