package inference

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/application/gateway"
	"github.com/gin-gonic/gin"
)

func (h *Handler) writeMediaResult(c *gin.Context, result *gateway.Result) {
	errorCode := ""
	defer result.Body.Close()
	defer func() { result.Finalize(gateway.Usage{}, "", errorCode) }()
	if isUpstreamCredentialStatus(result.StatusCode) {
		errorCode = "upstream_unavailable"
		clientCode := readCredentialErrorCode(result.StatusCode, result.Body)
		writeOpenAIError(c, http.StatusServiceUnavailable, clientCode, credentialErrorMessage(clientCode))
		return
	}
	if result.StatusCode < http.StatusOK || (result.StatusCode >= http.StatusMultipleChoices && result.StatusCode < http.StatusBadRequest) {
		errorCode = "invalid_upstream_status"
		writeOpenAIError(c, http.StatusBadGateway, "invalid_upstream_response", "上游媒体服务返回了不安全的重定向响应")
		return
	}
	contentType, safeContentType := normalizeMediaResponseContentType(result.Header.Get("Content-Type"))
	if !safeContentType {
		errorCode = "unsafe_media_content_type"
		writeOpenAIError(c, http.StatusBadGateway, "invalid_media_type", "上游媒体服务返回了不受支持的内容类型")
		return
	}
	contentLength, contentLengthErr := strconv.ParseInt(result.Header.Get("Content-Length"), 10, 64)
	if contentLengthErr == nil && contentLength > maxMediaResponseTransferBytes {
		errorCode = "response_too_large"
		writeOpenAIError(c, http.StatusBadGateway, "media_too_large", "上游媒体超过 2 GiB 安全上限")
		return
	}
	setSafeMediaResponseHeaders(c, result.Header)
	if contentLengthErr == nil && contentLength >= 0 {
		c.Header("Content-Length", strconv.FormatInt(contentLength, 10))
	} else {
		c.Header("Trailer", mediaTransferErrorTrailer)
	}
	if err := writeMediaBody(c, result.Body, contentType, result.StatusCode, maxMediaResponseTransferBytes); err != nil {
		if errors.Is(err, errResponseTransferLimit) {
			errorCode = "response_too_large"
		} else {
			errorCode = "stream_interrupted"
		}
		if contentLengthErr != nil {
			c.Header(mediaTransferErrorTrailer, errorCode)
		}
	}
}

func normalizeMediaResponseContentType(value string) (string, bool) {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(value))
	if err != nil {
		return "", false
	}
	mediaType = strings.ToLower(mediaType)
	switch mediaType {
	case "application/json":
		return "application/json; charset=utf-8", true
	case "text/plain":
		return "text/plain; charset=utf-8", true
	case "application/ogg":
		return mediaType, true
	}
	if strings.HasPrefix(mediaType, "audio/") {
		switch mediaType {
		case "audio/aac", "audio/flac", "audio/l16", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/opus", "audio/pcm", "audio/wav", "audio/webm", "audio/x-flac", "audio/x-wav":
			return mediaType, true
		}
	}
	return "", false
}

func setSafeMediaResponseHeaders(c *gin.Context, upstream http.Header) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "default-src 'none'; sandbox")
	c.Header("Referrer-Policy", "no-referrer")
	for _, name := range []string{"Retry-After", "X-Request-Id"} {
		if value := strings.TrimSpace(upstream.Get(name)); value != "" {
			c.Header(name, value)
		}
	}
}

func setResponseWriteDeadline(writer http.ResponseWriter) error {
	err := http.NewResponseController(writer).SetWriteDeadline(time.Now().Add(responseWriteTimeout))
	if errors.Is(err, http.ErrNotSupported) {
		return nil
	}
	return err
}

// writeMediaBody binds the validated non-HTML content type before emitting the
// response body, so no caller can stream media bytes without their MIME context.
func writeMediaBody(c *gin.Context, source io.Reader, contentType string, statusCode int, limit int64) error {
	c.Header("Content-Type", contentType)
	c.Status(statusCode)
	buffer := make([]byte, 64<<10)
	var transferred int64
	for {
		n, readErr := source.Read(buffer)
		if n > 0 {
			remaining := limit - transferred
			if remaining <= 0 {
				return errResponseTransferLimit
			}
			writeSize := n
			if int64(writeSize) > remaining {
				writeSize = int(remaining)
			}
			if err := setResponseWriteDeadline(c.Writer); err != nil {
				return err
			}
			written, writeErr := c.Writer.Write(buffer[:writeSize])
			transferred += int64(written)
			if writeErr != nil {
				return writeErr
			}
			if written != writeSize {
				return io.ErrShortWrite
			}
			if writeSize != n {
				return errResponseTransferLimit
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return nil
			}
			return readErr
		}
	}
}
