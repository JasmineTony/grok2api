package web

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/infra/provider/conversation"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

func (a *Adapter) forwardImageChatCompletion(ctx context.Context, request provider.ResponseResourceRequest, input openAIRequest, normalized normalizedChatInput, spec ModelSpec) (*provider.Response, error) {
	if len(normalized.Attachments) > 0 {
		return invalidImageRequest("文生图模型只接受当前用户消息中的纯文本；图生图请使用 grok-imagine-image-edit 和 /v1/images/edits")
	}
	count := 1
	format := "url"
	if input.ImageConfig != nil {
		if input.ImageConfig.Count != nil {
			count = *input.ImageConfig.Count
		}
		if strings.TrimSpace(input.ImageConfig.ResponseFormat) != "" {
			format = strings.ToLower(strings.TrimSpace(input.ImageConfig.ResponseFormat))
		}
	}
	if count < 1 || count > maxGeneratedImages {
		return invalidImageRequest("image_config.n 必须在 1 到 10 之间")
	}
	if format != "url" && format != "b64_json" {
		return invalidImageRequest("image_config.response_format 必须是 url 或 b64_json")
	}
	if spec.ProtocolModel != "imagine-lite" {
		return a.forwardQualityImageChatCompletion(ctx, request, input, normalized, count, format)
	}
	responseID := newWebID("resp")
	parsed := parsedChat{ResponseID: responseID, InputTokens: estimateTokens(normalized.Prompt)}
	if early, err := a.appendLiteImageChatImages(ctx, request, spec, normalized.Prompt, count, format, &parsed); err != nil || early != nil {
		return early, err
	}
	return respondImageChatCompletion(request, input, responseID, &parsed, count)
}

// appendLiteImageChatImages 依次生成 count 张 Lite 图片并追加到正文字段。
func (a *Adapter) appendLiteImageChatImages(ctx context.Context, request provider.ResponseResourceRequest, spec ModelSpec, prompt string, count int, format string, parsed *parsedChat) (*provider.Response, error) {
	for range count {
		rawURL, err := a.generateLiteImageURL(ctx, request.Credential, spec, prompt)
		if err != nil {
			var mediaErr *webMediaUpstreamError
			if errors.As(err, &mediaErr) && parsed.Text.Len() == 0 {
				return mediaErr.providerResponse(), nil
			}
			var upstreamErr *liteUpstreamError
			if errors.As(err, &upstreamErr) && parsed.Text.Len() == 0 {
				return upstreamErr.Response(), nil
			}
			return nil, err
		}
		item, err := a.imageDataItem(ctx, request.Credential, imagineImageValue{URL: rawURL}, format)
		if err != nil {
			return nil, err
		}
		if parsed.Text.Len() > 0 {
			parsed.appendText("\n\n")
		}
		parsed.appendText(liteImageMarkdown(item))
	}
	return nil, nil
}

// respondImageChatCompletion 按 stream 标记输出图片兼容响应。
func respondImageChatCompletion(request provider.ResponseResourceRequest, input openAIRequest, responseID string, parsed *parsedChat, quotaUnits int) (*provider.Response, error) {
	if input.Stream || request.Streaming {
		stream, err := buildImageCompatibilityStream(request.Operation, responseID, input.Model, parsed)
		if err != nil {
			return nil, err
		}
		return &provider.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: streamHeaders(), Body: io.NopCloser(bytes.NewReader(stream)), QuotaUnits: quotaUnits}, nil
	}
	payload := buildOpenAIResult(request.Operation, responseID, input.Model, *parsed, false)
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return &provider.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: jsonHeaders(), Body: io.NopCloser(bytes.NewReader(data)), QuotaUnits: quotaUnits}, nil
}

// decodeGeneratedImageData 解析图片生成兼容响应中的 data 数组。
func decodeGeneratedImageData(body io.Reader) ([]map[string]any, error) {
	var payload struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.NewDecoder(body).Decode(&payload); err != nil {
		return nil, provider.NewMediaPostProcessingError(provider.MediaPostProcessingStorage, fmt.Errorf("图片生成兼容响应解析失败: %w", err))
	}
	return payload.Data, nil
}

// imageChatParsedFromGenerated 把生成结果转为图片 markdown 正文。
func imageChatParsedFromGenerated(data []map[string]any, prompt string) (*parsedChat, error) {
	parsed := &parsedChat{ResponseID: newWebID("resp"), InputTokens: estimateTokens(prompt)}
	for _, item := range data {
		markdown := liteImageMarkdown(item)
		if markdown == "" {
			continue
		}
		if parsed.Text.Len() > 0 {
			parsed.appendText("\n\n")
		}
		parsed.appendText(markdown)
	}
	if parsed.Text.Len() == 0 {
		return nil, fmt.Errorf("图片生成兼容响应中没有图片")
	}
	return parsed, nil
}

func (a *Adapter) forwardQualityImageChatCompletion(ctx context.Context, request provider.ResponseResourceRequest, input openAIRequest, normalized normalizedChatInput, count int, format string) (*provider.Response, error) {
	aspectRatio := ""
	resolution := ""
	if input.ImageConfig != nil {
		aspectRatio = input.ImageConfig.AspectRatio
		resolution = input.ImageConfig.Resolution
	}
	generated, err := a.GenerateImage(ctx, provider.ImageGenerationRequest{
		Credential: request.Credential, Model: request.Model, Prompt: normalized.Prompt,
		Count: count, AspectRatio: aspectRatio, Resolution: resolution, ResponseFormat: format,
	})
	if err != nil {
		return nil, err
	}
	if generated.StatusCode < http.StatusOK || generated.StatusCode >= http.StatusMultipleChoices {
		return generated, nil
	}
	defer generated.Body.Close()
	data, err := decodeGeneratedImageData(generated.Body)
	if err != nil {
		return nil, err
	}
	parsed, err := imageChatParsedFromGenerated(data, normalized.Prompt)
	if err != nil {
		return nil, err
	}
	return respondImageChatCompletion(request, input, parsed.ResponseID, parsed, generated.QuotaUnits)
}

func buildImageCompatibilityStream(operation, responseID, model string, parsed *parsedChat) ([]byte, error) {
	var stream bytes.Buffer
	writeStreamStart(&stream, operation, responseID, model, parsed.InputTokens)
	if operation == conversation.OperationResponses {
		responsesStream := newWebResponsesStream(&stream, responseID)
		if err := responsesStream.Delta("text", parsed.Text.String()); err != nil {
			return nil, err
		}
		if err := responsesStream.Finish(parsed); err != nil {
			return nil, err
		}
	} else if err := writeStreamDelta(&stream, operation, responseID, model, "text", parsed.Text.String()); err != nil {
		return nil, err
	}
	payload := buildOpenAIResult(operation, responseID, model, *parsed, false)
	writeStreamDone(&stream, operation, responseID, model, *parsed, payload)
	return stream.Bytes(), nil
}
