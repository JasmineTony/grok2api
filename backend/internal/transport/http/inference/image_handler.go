package inference

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/application/gateway"
	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	"github.com/chenyme/grok2api/backend/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
)

func (h *Handler) generateImage(c *gin.Context) {
	body, ok := h.readImageRequestBody(c, "图片生成")
	if !ok {
		return
	}
	var request imageGenerationRequest
	if decodeSingleJSON(bytes.NewReader(body), &request, false) != nil || strings.TrimSpace(request.Model) == "" || strings.TrimSpace(request.Prompt) == "" {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_request", "图片请求缺少有效 model 或 prompt")
		return
	}
	if !validateImageStorageOptions(c, request.StorageOptions) {
		return
	}
	count := 1
	if request.Count != nil {
		if !validateImageCount(c, *request.Count) {
			return
		}
		count = *request.Count
	}
	if request.Stream && count != 1 {
		writeImageGenerationUserError(c, "unsupported_parameter", "input", "Streaming is only supported with n=1.")
		return
	}
	partialImages, ok := parsePartialImages(c, request.PartialImages, request.Stream)
	if !ok {
		return
	}
	quality, ok := normalizeImageQuality(c, request.Quality)
	if !ok {
		return
	}
	clientKey, requestID, ok := requestIdentity(c)
	if !ok {
		return
	}
	result, err := h.gateway.GenerateImage(c.Request.Context(), gateway.ImageGenerationInput{
		RequestID: requestID, ClientKey: clientKey, PublicModel: request.Model, Prompt: request.Prompt,
		Count: count, Size: request.Size, AspectRatio: request.AspectRatio,
		Resolution: request.Resolution, Quality: quality, ResponseFormat: request.ResponseFormat,
		Streaming: request.Stream, PartialImages: partialImages,
		Method: c.Request.Method, Path: c.Request.URL.Path, Headers: c.Request.Header.Clone(),
	})
	if err != nil {
		writeGatewayError(c, err)
		return
	}
	h.writeResult(c, result, request.Stream, streamProtocolImage)
}

func (h *Handler) editImage(c *gin.Context) {
	request, ok := h.decodeImageEditRequest(c)
	if !ok {
		return
	}
	if !validateImageStorageOptions(c, request.StorageOptions) {
		return
	}
	model := strings.TrimSpace(request.Model)
	prompt := strings.TrimSpace(request.Prompt)
	count := 1
	if request.Count != nil {
		count = *request.Count
	}
	imageURLs, ok := collectImageEditURLs(c, request)
	if !ok {
		return
	}
	if model == "" || prompt == "" {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_request", "图片编辑缺少有效 model 或 prompt")
		return
	}
	if !validateImageCount(c, count) {
		return
	}
	partialImages, ok := parsePartialImages(c, request.PartialImages, request.Stream)
	if !ok {
		return
	}
	options, ok := parseImageEditOutputOptions(c, request)
	if !ok {
		return
	}
	clientKey, requestID, ok := requestIdentity(c)
	if !ok {
		return
	}
	result, err := h.gateway.EditImage(c.Request.Context(), gateway.ImageEditInput{
		RequestID: requestID, ClientKey: clientKey, PublicModel: model, Prompt: prompt,
		ImageURLs: imageURLs, Count: count, Size: options.size, AspectRatio: options.aspectRatio,
		Resolution: options.resolution, Quality: options.quality, ResponseFormat: request.ResponseFormat,
		Streaming: request.Stream, PartialImages: partialImages,
		Method: c.Request.Method, Path: c.Request.URL.Path, Headers: c.Request.Header.Clone(),
	})
	if err != nil {
		writeGatewayError(c, err)
		return
	}
	h.writeResult(c, result, request.Stream, streamProtocolImage)
}

func (h *Handler) decodeImageEditRequest(c *gin.Context) (imageEditJSONRequest, bool) {
	body, ok := h.readImageRequestBody(c, "图片编辑")
	if !ok {
		return imageEditJSONRequest{}, false
	}
	var request imageEditJSONRequest
	if err := decodeSingleJSON(bytes.NewReader(body), &request, false); err != nil {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_request", "图片编辑 JSON 请求无效")
		return imageEditJSONRequest{}, false
	}
	return request, true
}

// readImageRequestBody 读取图片接口的 JSON 请求体，label 用于区分生成与编辑的错误文案。
func (h *Handler) readImageRequestBody(c *gin.Context, label string) ([]byte, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, h.maxBodyBytes)
	if !isJSONRequest(c) {
		writeOpenAIError(c, http.StatusUnsupportedMediaType, "invalid_request", label+"仅支持 application/json")
		return nil, false
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		writeOpenAIError(c, http.StatusRequestEntityTooLarge, "request_too_large", "请求体超过限制")
		return nil, false
	}
	return body, true
}

// validateImageStorageOptions 拒绝本兼容层暂不支持的 storage_options。
func validateImageStorageOptions(c *gin.Context, storageOptions json.RawMessage) bool {
	value := bytes.TrimSpace(storageOptions)
	if len(value) == 0 || bytes.Equal(value, []byte("null")) {
		return true
	}
	writeOpenAIError(c, http.StatusBadRequest, "unsupported_parameter", "当前兼容层暂不支持 storage_options")
	return false
}

func validateImageCount(c *gin.Context, count int) bool {
	if count >= 1 && count <= 10 {
		return true
	}
	writeOpenAIError(c, http.StatusBadRequest, "invalid_parameter", "n 必须在 1 到 10 之间")
	return false
}

// parsePartialImages 校验 partial_images 取值，并保持“仅限流式”的约束。
func parsePartialImages(c *gin.Context, raw *int, streaming bool) (int, bool) {
	if raw == nil {
		return 0, true
	}
	partialImages := *raw
	if partialImages < 0 || partialImages > 3 {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_parameter", "partial_images 必须在 0 到 3 之间")
		return 0, false
	}
	if partialImages > 0 && !streaming {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_parameter", "partial_images 仅可在 stream=true 时使用")
		return 0, false
	}
	return partialImages, true
}

func normalizeImageQuality(c *gin.Context, raw string) (string, bool) {
	quality := strings.ToLower(strings.TrimSpace(raw))
	if quality != "" && quality != "low" && quality != "medium" {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_parameter", "quality 必须是 low 或 medium")
		return "", false
	}
	return quality, true
}

// collectImageEditURLs 合并 image 与 images 入参并校验数量与 url 完整性。
func collectImageEditURLs(c *gin.Context, request imageEditJSONRequest) ([]string, bool) {
	inputs := append([]imageEditJSONImage(nil), request.Images...)
	if request.Image != nil {
		inputs = append([]imageEditJSONImage{*request.Image}, inputs...)
	}
	if len(inputs) == 0 || len(inputs) > 8 {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_request", "image 或 images 数量必须在 1 到 8 之间")
		return nil, false
	}
	imageURLs := make([]string, 0, len(inputs))
	for _, input := range inputs {
		if strings.TrimSpace(input.FileID) != "" {
			writeOpenAIError(c, http.StatusBadRequest, "unsupported_parameter", "当前暂不支持 image.file_id，请使用 image.url")
			return nil, false
		}
		if value := strings.TrimSpace(input.URL); value != "" {
			imageURLs = append(imageURLs, value)
		}
	}
	if len(imageURLs) != len(inputs) {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_request", "每个 image 都必须提供有效 url")
		return nil, false
	}
	return imageURLs, true
}

type imageEditOutputOptions struct {
	size        string
	aspectRatio string
	resolution  string
	quality     string
}

// parseImageEditOutputOptions 归一化并校验图片编辑的输出尺寸相关参数。
func parseImageEditOutputOptions(c *gin.Context, request imageEditJSONRequest) (imageEditOutputOptions, bool) {
	aspectRatio := strings.ToLower(strings.TrimSpace(request.AspectRatio))
	size := strings.ToLower(strings.TrimSpace(request.Size))
	if aspectRatio != "" && !validImageAspectRatio(aspectRatio) {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_parameter", "aspect_ratio 不受支持")
		return imageEditOutputOptions{}, false
	}
	if size != "" && !validImageEditSize(size) {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_parameter", "size 必须是 auto、1024x1024、1024x1536 或 1536x1024")
		return imageEditOutputOptions{}, false
	}
	resolution := strings.ToLower(strings.TrimSpace(request.Resolution))
	if resolution == "" {
		resolution = "1k"
	}
	if resolution != "1k" && resolution != "2k" {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_parameter", "resolution 必须是 1k 或 2k")
		return imageEditOutputOptions{}, false
	}
	quality, ok := normalizeImageQuality(c, request.Quality)
	if !ok {
		return imageEditOutputOptions{}, false
	}
	return imageEditOutputOptions{size: size, aspectRatio: aspectRatio, resolution: resolution, quality: quality}, true
}

func requestIdentity(c *gin.Context) (clientkeydomain.Key, string, bool) {
	clientValue, exists := c.Get(middleware.ClientKey)
	clientKey, ok := clientValue.(clientkeydomain.Key)
	if !exists || !ok {
		writeOpenAIError(c, http.StatusUnauthorized, "invalid_api_key", "客户端 API Key 无效")
		return clientkeydomain.Key{}, "", false
	}
	requestID, _ := c.Get(middleware.RequestIDKey)
	requestIDValue, _ := requestID.(string)
	return clientKey, requestIDValue, true
}

func validImageAspectRatio(value string) bool {
	switch value {
	case "auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20":
		return true
	default:
		return false
	}
}

func validImageEditSize(value string) bool {
	switch value {
	case "auto", "1024x1024", "1024x1536", "1536x1024":
		return true
	default:
		return false
	}
}
