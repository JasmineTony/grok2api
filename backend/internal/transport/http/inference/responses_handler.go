package inference

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/application/gateway"
	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	"github.com/chenyme/grok2api/backend/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
)

func (h *Handler) createResponse(c *gin.Context) {
	h.handleCreate(c, false)
}

func (h *Handler) compactResponse(c *gin.Context) {
	h.handleCreate(c, true)
}

func (h *Handler) handleCreate(c *gin.Context, compact bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, h.maxBodyBytes)
	if !isJSONRequest(c) {
		writeOpenAIError(c, http.StatusUnsupportedMediaType, "invalid_request", "Responses only supports application/json")
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		writeOpenAIError(c, http.StatusRequestEntityTooLarge, "request_too_large", "请求体超过限制")
		return
	}
	request, body, err := decodeResponsesRequest(body, compact)
	if err != nil {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	clientKey, ok := clientKeyFromContext(c)
	if !ok {
		return
	}
	input := newResponsesGatewayInput(c, clientKey, request, body)
	var result *gateway.Result
	if compact {
		result, err = h.gateway.CompactResponse(c.Request.Context(), input)
	} else {
		result, err = h.gateway.CreateResponse(c.Request.Context(), input)
	}
	if err != nil {
		writeGatewayError(c, err)
		return
	}
	h.writeResponsesResult(c, result, request.Stream && !compact, request.Model)
}

// decodeResponsesRequest 校验并归一化 Responses 请求体；compact 模式强制 stream=false。
func decodeResponsesRequest(body []byte, compact bool) (responsesRequest, []byte, error) {
	var request responsesRequest
	if err := json.Unmarshal(body, &request); err != nil || strings.TrimSpace(request.Model) == "" {
		return responsesRequest{}, nil, errors.New("Responses 请求缺少有效 model")
	}
	if !compact {
		return request, body, nil
	}
	patched, err := forceJSONBoolean(body, "stream", false)
	if err != nil {
		return responsesRequest{}, nil, errors.New("Compact 请求格式无效")
	}
	request.Stream = false
	return request, patched, nil
}

// clientKeyFromContext 取自中间件写入的客户端密钥；缺失时按既有 401 文案结束请求。
func clientKeyFromContext(c *gin.Context) (clientkeydomain.Key, bool) {
	clientValue, exists := c.Get(middleware.ClientKey)
	clientKey, ok := clientValue.(clientkeydomain.Key)
	if !exists || !ok {
		writeOpenAIError(c, http.StatusUnauthorized, "invalid_api_key", "客户端 API Key 无效")
		return clientkeydomain.Key{}, false
	}
	return clientKey, true
}

// newResponsesGatewayInput 组装网关入参，字段与中间件/请求头来源保持一致。
func newResponsesGatewayInput(c *gin.Context, clientKey clientkeydomain.Key, request responsesRequest, body []byte) gateway.Input {
	requestID, _ := c.Get(middleware.RequestIDKey)
	requestIDValue, _ := requestID.(string)
	return gateway.Input{
		RequestID: requestIDValue, ClientKey: clientKey, PublicModel: request.Model,
		Body: body, Streaming: request.Stream, PromptCacheKey: request.PromptCacheKey,
		PromptCacheSeed: extractPromptCacheSeed(c.Request.Header, body), PreviousResponseID: request.PreviousResponseID,
		AllowClientToolCacheRoute: allowBuildClientToolCacheRoute(c.Request.Header),
		GrokTurnIndex:             c.GetHeader("x-grok-turn-idx"),
		Method:                    c.Request.Method,
		Path:                      c.Request.URL.Path,
		Headers:                   c.Request.Header.Clone(),
	}
}

func isJSONRequest(c *gin.Context) bool {
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	return err == nil && strings.EqualFold(mediaType, "application/json")
}

func decodeSingleJSON(reader io.Reader, target any, disallowUnknown bool) error {
	decoder := json.NewDecoder(reader)
	if disallowUnknown {
		decoder.DisallowUnknownFields()
	}
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("请求体只能包含一个 JSON 对象")
		}
		return err
	}
	return nil
}

func (h *Handler) getResponse(c *gin.Context) {
	h.handleOwnedResource(c, false)
}

func (h *Handler) deleteResponse(c *gin.Context) {
	h.handleOwnedResource(c, true)
}

func (h *Handler) handleOwnedResource(c *gin.Context, deleteResource bool) {
	clientValue, exists := c.Get(middleware.ClientKey)
	clientKey, ok := clientValue.(clientkeydomain.Key)
	if !exists || !ok {
		writeOpenAIError(c, http.StatusUnauthorized, "invalid_api_key", "客户端 API Key 无效")
		return
	}
	input := gateway.ResourceInput{ClientKey: clientKey, ResponseID: strings.TrimSpace(c.Param("responseId")), RawQuery: c.Request.URL.RawQuery}
	if input.ResponseID == "" {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_request", "response_id 不能为空")
		return
	}
	var result *gateway.Result
	var err error
	if deleteResource {
		result, err = h.gateway.DeleteResponse(c.Request.Context(), input)
	} else {
		result, err = h.gateway.GetResponse(c.Request.Context(), input)
	}
	if err != nil {
		writeGatewayError(c, err)
		return
	}
	h.writeResult(c, result, false, streamProtocolResponses)
}
