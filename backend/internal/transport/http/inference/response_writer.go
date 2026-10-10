package inference

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/application/gateway"
	"github.com/chenyme/grok2api/backend/internal/pkg/neterror"
	"github.com/gin-gonic/gin"
)

func (h *Handler) writeResult(c *gin.Context, result *gateway.Result, stream bool, protocol streamProtocol) {
	h.writeProtocolResult(c, result, stream, false, protocol, "")
}

func (h *Handler) writeResponsesResult(c *gin.Context, result *gateway.Result, stream bool, fallbackModel string) {
	h.writeProtocolResult(c, result, stream, false, streamProtocolResponses, fallbackModel)
}

func (h *Handler) writeAnthropicResult(c *gin.Context, result *gateway.Result, stream bool) {
	h.writeProtocolResult(c, result, stream, true, streamProtocolAnthropic, "")
}

func (h *Handler) writeProtocolResult(c *gin.Context, result *gateway.Result, stream, anthropic bool, protocol streamProtocol, fallbackModel string) {
	usage := gateway.Usage{}
	responseID := ""
	errorCode := ""
	defer result.Body.Close()
	defer func() { result.Finalize(usage, responseID, errorCode) }()
	if isUpstreamCredentialStatus(result.StatusCode) {
		errorCode = "upstream_unavailable"
		writeCredentialFailure(c, result, anthropic)
		return
	}
	body := io.Reader(result.Body)
	if !stream && result.StatusCode >= http.StatusOK && result.StatusCode < http.StatusMultipleChoices {
		var peekErr error
		body, peekErr = peekNonEmptyJSONBody(result.Body)
		if peekErr != nil {
			errorCode = writeEmptyUpstreamFailure(c, peekErr, anthropic)
			return
		}
	}
	transferLimit := int64(maxJSONResponseTransferBytes)
	if stream {
		transferLimit = maxStreamResponseTransferBytes
	}
	if contentLength, parseErr := strconv.ParseInt(result.Header.Get("Content-Length"), 10, 64); parseErr == nil && contentLength > transferLimit {
		errorCode = "response_too_large"
		writeOpenAIError(c, http.StatusBadGateway, "response_too_large", "上游响应超过代理安全上限")
		return
	}
	copyHeaders(c.Writer.Header(), result.Header)
	if result.StatusCode >= 400 {
		errorCode = "upstream_error"
		if stream && !isEventStreamContentType(result.Header.Get("Content-Type")) {
			errorCode = writeUpstreamErrorBody(c, result, anthropic)
			return
		}
	}
	c.Status(result.StatusCode)
	usage, responseID, errorCode = h.copyProtocolBody(c, result, body, stream, protocol, fallbackModel, errorCode)
}

// writeCredentialFailure 把上游凭据类状态码统一脱敏为 503，不再向客户端暴露升级/额度提示。
func writeCredentialFailure(c *gin.Context, result *gateway.Result, anthropic bool) {
	clientCode := readCredentialErrorCode(result.StatusCode, result.Body)
	if anthropic {
		writeAnthropicError(c, http.StatusServiceUnavailable, "overloaded_error", credentialErrorMessage(clientCode), clientCode)
		return
	}
	writeOpenAIError(c, http.StatusServiceUnavailable, clientCode, credentialErrorMessage(clientCode))
}

// writeEmptyUpstreamFailure 把非流式空/超时响应映射为真实的 502/504，并返回计费错误码。
func writeEmptyUpstreamFailure(c *gin.Context, peekErr error, anthropic bool) string {
	status, code, message := http.StatusBadGateway, "stream_interrupted", "读取上游响应失败"
	switch {
	case neterror.IsUpstreamStreamIdleTimeout(peekErr):
		status, code, message = http.StatusGatewayTimeout, "upstream_stream_idle_timeout", "上游响应长时间无数据"
	case neterror.IsUpstreamResponseEmpty(peekErr):
		status, code, message = http.StatusBadGateway, "upstream_response_empty", "上游响应为空"
	}
	if anthropic {
		writeAnthropicError(c, status, "api_error", message, code)
	} else {
		writeOpenAIError(c, status, code, message)
	}
	return code
}

// writeUpstreamErrorBody 处理带错误状态码但正文不是 SSE 的上游响应，返回计费错误码。
func writeUpstreamErrorBody(c *gin.Context, result *gateway.Result, anthropic bool) string {
	raw, readErr := io.ReadAll(io.LimitReader(result.Body, maxJSONResponseTransferBytes+1))
	if readErr != nil {
		if anthropic {
			writeAnthropicError(c, http.StatusBadGateway, "api_error", "读取上游错误响应失败", "upstream_error")
		} else {
			writeOpenAIError(c, http.StatusBadGateway, "upstream_error", "读取上游错误响应失败")
		}
		return "upstream_error"
	}
	c.Writer.Header().Del("Content-Length")
	code, message := gateway.ClassifyUpstreamHTTPError(result.StatusCode, raw)
	if anthropic {
		writeAnthropicError(c, result.StatusCode, anthropicUpstreamHTTPErrorType(result.StatusCode), message, code)
	} else {
		writeOpenAIError(c, result.StatusCode, code, message)
	}
	return code
}

// copyProtocolBody 按协议转发正文并回传计费所需的结果元数据。
func (h *Handler) copyProtocolBody(c *gin.Context, result *gateway.Result, body io.Reader, stream bool, protocol streamProtocol, fallbackModel, errorCode string) (gateway.Usage, string, string) {
	if stream {
		metadata, copyErr := copyStreamWithFallbackModel(c.Writer, result.Body, protocol, result.MarkFirstToken, fallbackModel)
		if metadata.StreamFailure != nil && result.RecordStreamFailure != nil {
			result.RecordStreamFailure(*metadata.StreamFailure)
		}
		return metadata.Usage, metadata.ResponseID, copyErrorCode(c, copyErr, errorCode)
	}
	metadata, copyErr := copyJSON(c.Writer, body, protocol)
	return metadata.Usage, metadata.ResponseID, copyErrorCode(c, copyErr, errorCode)
}

// copyErrorCode 保留原有错误码，只在出现复制错误时覆盖。
func copyErrorCode(c *gin.Context, copyErr error, errorCode string) string {
	if copyErr != nil {
		return classifyCopyError(c.Request.Context(), copyErr)
	}
	return errorCode
}

// peekNonEmptyJSONBody delays the downstream 2xx status until the upstream has
// produced at least one response byte. This lets an idle/empty non-streaming
// response become a real 502/504 instead of an empty 200 while preserving a
// streaming copy for large valid JSON bodies.
func peekNonEmptyJSONBody(source io.Reader) (io.Reader, error) {
	reader := bufio.NewReaderSize(source, responseCopyBufferBytes)
	if _, err := reader.Peek(1); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, neterror.ErrUpstreamResponseEmpty
		}
		return nil, err
	}
	return reader, nil
}

func copyJSON(writer gin.ResponseWriter, source io.Reader, protocol streamProtocol) (responseMetadata, error) {
	buffer := make([]byte, responseCopyBufferBytes)
	metadataBody := make([]byte, 0, responseCopyBufferBytes)
	metadataComplete := true
	transferred := 0
	for {
		n, readErr := source.Read(buffer)
		if n > 0 {
			if transferred+n > maxJSONResponseTransferBytes {
				return responseMetadata{}, fmt.Errorf("%w: 非流式响应超过 %d MiB", errResponseTransferLimit, maxJSONResponseTransferBytes>>20)
			}
			chunk := buffer[:n]
			if err := setResponseWriteDeadline(writer); err != nil {
				return responseMetadata{}, err
			}
			if _, err := writer.Write(chunk); err != nil {
				return responseMetadata{}, err
			}
			transferred += n
			if metadataComplete {
				if len(metadataBody)+len(chunk) <= maxJSONMetadataInspectionBytes {
					metadataBody = append(metadataBody, chunk...)
				} else {
					metadataBody = nil
					metadataComplete = false
				}
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				if transferred == 0 {
					return responseMetadata{}, neterror.ErrUpstreamResponseEmpty
				}
				if metadataComplete {
					return normalizeMetadataUsage(extractMetadata(metadataBody), protocol), nil
				}
				return responseMetadata{}, nil
			}
			return responseMetadata{Usage: gateway.Usage{OutputObserved: transferred > 0}}, readErr
		}
	}
}

func copyHeaders(destination, source http.Header) {
	excluded := map[string]struct{}{
		"connection": {}, "content-length": {}, "keep-alive": {}, "proxy-authenticate": {},
		"proxy-authorization": {}, "set-cookie": {}, "te": {}, "trailer": {},
		"transfer-encoding": {}, "upgrade": {}, "x-models-etag": {},
	}
	for _, value := range source.Values("Connection") {
		for name := range strings.SplitSeq(value, ",") {
			name = strings.ToLower(strings.TrimSpace(name))
			if name != "" {
				excluded[name] = struct{}{}
			}
		}
	}
	for name, values := range source {
		lower := strings.ToLower(name)
		if _, skip := excluded[lower]; skip {
			continue
		}
		for _, value := range values {
			destination.Add(name, value)
		}
	}
}

func isEventStreamContentType(value string) bool {
	mediaType, _, err := mime.ParseMediaType(value)
	return err == nil && strings.EqualFold(mediaType, "text/event-stream")
}
