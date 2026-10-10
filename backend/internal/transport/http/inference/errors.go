package inference

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	clientkeyapp "github.com/chenyme/grok2api/backend/internal/application/clientkey"
	"github.com/chenyme/grok2api/backend/internal/application/gateway"
	"github.com/chenyme/grok2api/backend/internal/pkg/neterror"
	"github.com/gin-gonic/gin"
)

func anthropicUpstreamHTTPErrorType(status int) string {
	switch status {
	case http.StatusBadRequest, http.StatusConflict, http.StatusUnprocessableEntity:
		return "invalid_request_error"
	case http.StatusNotFound:
		return "not_found_error"
	case http.StatusTooManyRequests:
		return "rate_limit_error"
	case http.StatusRequestTimeout, http.StatusGatewayTimeout:
		return "timeout_error"
	default:
		return "api_error"
	}
}

func classifyCopyError(ctx context.Context, err error) string {
	if err == nil {
		return ""
	}
	if neterror.IsClientRequestCancel(ctx, err) {
		return "client_stream_interrupted"
	}
	switch {
	case errors.Is(err, errResponseTransferLimit):
		return "response_too_large"
	case errors.Is(err, errUpstreamStreamFailed):
		return "upstream_stream_error"
	case errors.Is(err, errUpstreamStreamIncomplete):
		return "upstream_stream_incomplete"
	case errors.Is(err, neterror.ErrUpstreamStreamIdleTimeout):
		return "upstream_stream_idle_timeout"
	case errors.Is(err, neterror.ErrUpstreamResponseEmpty):
		return "upstream_response_empty"
	case errors.Is(err, neterror.ErrUpstreamOutputLoop):
		return "upstream_output_loop"
	case errors.Is(err, errUpstreamStreamRead):
		return "upstream_stream_interrupted"
	default:
		return "stream_interrupted"
	}
}

func writeOpenAIError(c *gin.Context, status int, code, message string) {
	errorType := "invalid_request_error"
	switch {
	case status == http.StatusUnauthorized:
		errorType = "authentication_error"
	case status == http.StatusTooManyRequests:
		errorType = "rate_limit_error"
	case status >= 500:
		errorType = "server_error"
	}
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{"message": message, "type": errorType, "code": code, "param": nil}})
}

func writeImageGenerationUserError(c *gin.Context, code, param, message string) {
	c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": gin.H{
		"message": message, "type": "image_generation_user_error", "param": param, "code": code,
	}})
}

func writeGatewayError(c *gin.Context, err error) {
	status, code := http.StatusBadGateway, "upstream_unavailable"
	message := "上游服务暂不可用"
	var upstreamFailure *gateway.UpstreamFailure
	var selectionFailure *gateway.SelectionUnavailableError
	switch {
	case errors.Is(err, gateway.ErrLedgerUnavailable):
		status, code = http.StatusServiceUnavailable, "ledger_unavailable"
		message = gateway.ErrLedgerUnavailable.Error()
	case errors.Is(err, clientkeyapp.ErrBillingLimit):
		status, code = http.StatusTooManyRequests, "billing_limit_exceeded"
		message = clientkeyapp.ErrBillingLimit.Error()
	case errors.Is(err, clientkeyapp.ErrModelNotAllowed):
		status, code = http.StatusForbidden, "model_not_allowed"
		message = clientkeyapp.ErrModelNotAllowed.Error()
	case errors.Is(err, gateway.ErrModelNotFound):
		status, code = http.StatusNotFound, "model_not_found"
		message = "模型不存在"
	case errors.Is(err, gateway.ErrResponseNotFound):
		status, code = http.StatusNotFound, "response_not_found"
		message = "Response 不存在或已过期"
	case errors.Is(err, gateway.ErrResponseStateUnsupported), errors.Is(err, gateway.ErrConversationUnsupported):
		status, code = http.StatusBadRequest, "unsupported_parameter"
		message = err.Error()
	case errors.Is(err, gateway.ErrVideoInputTooLarge), errors.Is(err, gateway.ErrVideoInputUnavailable), errors.Is(err, gateway.ErrVideoParameterInvalid):
		status, code = http.StatusBadRequest, "invalid_request"
		message = err.Error()
	case errors.Is(err, gateway.ErrVideoOperationUnsupported):
		status, code = http.StatusBadRequest, "unsupported_model"
		message = err.Error()
	case errors.As(err, &upstreamFailure):
		status, code, message = applyUpstreamFailureError(c, upstreamFailure)
	case errors.As(err, &selectionFailure):
		status, code, message = selectionErrorResponse(c, selectionFailure)
	case errors.Is(err, gateway.ErrResponseAccountUnavailable), errors.Is(err, gateway.ErrNoAvailableAccount):
		status, code = http.StatusServiceUnavailable, "upstream_unavailable"
		message = "当前没有可用的上游账号"
	}
	writeOpenAIError(c, status, code, message)
}

func writeGatewayAnthropicError(c *gin.Context, err error) {
	status, errorType := http.StatusBadGateway, "api_error"
	message := "上游服务暂不可用"
	clientCode := ""
	var upstreamFailure *gateway.UpstreamFailure
	var selectionFailure *gateway.SelectionUnavailableError
	switch {
	case errors.Is(err, gateway.ErrLedgerUnavailable):
		status, errorType = http.StatusServiceUnavailable, "overloaded_error"
		message = gateway.ErrLedgerUnavailable.Error()
	case errors.Is(err, clientkeyapp.ErrBillingLimit):
		status, errorType = http.StatusTooManyRequests, "rate_limit_error"
		message = clientkeyapp.ErrBillingLimit.Error()
	case errors.Is(err, clientkeyapp.ErrModelNotAllowed):
		status, errorType, clientCode = http.StatusForbidden, "permission_error", "model_not_allowed"
		message = clientkeyapp.ErrModelNotAllowed.Error()
	case errors.Is(err, gateway.ErrModelNotFound):
		status, errorType = http.StatusNotFound, "not_found_error"
		message = "模型不存在"
	case errors.Is(err, gateway.ErrResponseStateUnsupported), errors.Is(err, gateway.ErrConversationUnsupported):
		status, errorType = http.StatusBadRequest, "invalid_request_error"
		message = err.Error()
	case errors.As(err, &upstreamFailure):
		status, errorType, message, clientCode = applyAnthropicUpstreamFailure(c, upstreamFailure)
	case errors.As(err, &selectionFailure):
		status, clientCode, message = selectionErrorResponse(c, selectionFailure)
		if status == http.StatusTooManyRequests {
			errorType = "rate_limit_error"
		} else {
			errorType = "overloaded_error"
		}
	case errors.Is(err, gateway.ErrResponseAccountUnavailable), errors.Is(err, gateway.ErrNoAvailableAccount):
		status, errorType = http.StatusServiceUnavailable, "overloaded_error"
		message = "当前没有可用的上游账号"
	}
	writeAnthropicError(c, status, errorType, message, clientCode)
}

// applyUpstreamFailureError 按上游失败类型决定状态码与公开文案，并按需回写 Retry-After。
func applyUpstreamFailureError(c *gin.Context, failure *gateway.UpstreamFailure) (int, string, string) {
	status, code, message := failure.HTTPStatus, failure.Code, failure.PublicMessage
	if isSanitizedUpstreamAvailabilityFailure(failure) {
		// Gateway mid-tier behavior: never expose upstream upgrade/billing prompts to clients.
		code = failure.ClientCredentialErrorCode()
		if failure.QuotaExhausted || failure.FreeQuotaExhausted || failure.HTTPStatus == http.StatusPaymentRequired {
			code = "upstream_unavailable"
		}
		status, message = http.StatusServiceUnavailable, credentialErrorMessage(code)
	}
	if !isUpstreamCredentialStatus(failure.HTTPStatus) && failure.RetryAfter > 0 {
		c.Header("Retry-After", strconv.FormatInt(max(1, int64(failure.RetryAfter.Round(time.Second)/time.Second)), 10))
	}
	return status, code, message
}

// applyAnthropicUpstreamFailure 按上游失败类型决定 Anthropic 状态码、错误类型与公开文案。
func applyAnthropicUpstreamFailure(c *gin.Context, failure *gateway.UpstreamFailure) (int, string, string, string) {
	status, errorType, clientCode := failure.HTTPStatus, "api_error", ""
	message := failure.PublicMessage
	if isSanitizedUpstreamAvailabilityFailure(failure) {
		clientCode = failure.ClientCredentialErrorCode()
		if failure.QuotaExhausted || failure.FreeQuotaExhausted || failure.HTTPStatus == http.StatusPaymentRequired {
			clientCode = "upstream_unavailable"
		}
		status, errorType, message = http.StatusServiceUnavailable, "overloaded_error", credentialErrorMessage(clientCode)
	} else if failure.Code == "upstream_header_timeout" {
		errorType = "timeout_error"
	}
	if !isUpstreamCredentialStatus(failure.HTTPStatus) && failure.RetryAfter > 0 {
		c.Header("Retry-After", strconv.FormatInt(max(1, int64(failure.RetryAfter.Round(time.Second)/time.Second)), 10))
	}
	if status == http.StatusTooManyRequests {
		errorType = "rate_limit_error"
	}
	return status, errorType, message, clientCode
}

func isUpstreamCredentialStatus(status int) bool {
	// Include 402 so official "add credits / upgrade SuperGrok" bodies never reach clients (Grok CLI, etc.).
	return status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusPaymentRequired
}

func isSanitizedUpstreamAvailabilityFailure(failure *gateway.UpstreamFailure) bool {
	return failure != nil && (isUpstreamCredentialStatus(failure.HTTPStatus) || failure.QuotaExhausted || failure.FreeQuotaExhausted)
}

func selectionErrorResponse(c *gin.Context, failure *gateway.SelectionUnavailableError) (int, string, string) {
	status, code, message := http.StatusServiceUnavailable, "upstream_unavailable", "当前没有可用的上游账号"
	if failure == nil {
		return status, code, message
	}
	status, code = failure.HTTPStatus(), failure.Code()
	if failure.Scope.IsRestricted() {
		message = failure.Error()
	} else {
		switch failure.Reason {
		case gateway.SelectionCooling:
			message = "上游账号正在冷却"
		case gateway.SelectionModelCooling:
			message = "上游账号的目标模型正在冷却"
		case gateway.SelectionQuotaExhausted:
			message = "上游账号额度等待恢复"
		case gateway.SelectionSaturated:
			message = "上游账号当前均达到并发上限"
		case gateway.SelectionUnsupportedModel:
			message = "当前账号池不支持该模型"
		case gateway.SelectionPinnedUnavailable:
			message = "绑定的上游账号当前不可用"
		}
	}
	if failure.RetryAfter > 0 {
		seconds := max(int64(1), int64((failure.RetryAfter+time.Second-1)/time.Second))
		c.Header("Retry-After", strconv.FormatInt(seconds, 10))
	}
	return status, code, message
}

func writeAnthropicError(c *gin.Context, status int, errorType, message string, errorCode ...string) {
	errorPayload := gin.H{"type": errorType, "message": message}
	if len(errorCode) > 0 && errorCode[0] != "" && errorCode[0] != "upstream_unavailable" {
		errorPayload["code"] = errorCode[0]
	}
	c.AbortWithStatusJSON(status, gin.H{"type": "error", "error": errorPayload})
}

func readCredentialErrorCode(status int, source io.Reader) string {
	body, err := io.ReadAll(io.LimitReader(source, maxCredentialErrorInspectBytes+1))
	if err != nil || len(body) > maxCredentialErrorInspectBytes {
		return "upstream_unavailable"
	}
	return gateway.ClientCredentialErrorCodeFromBody(status, body)
}

func credentialErrorMessage(code string) string {
	if code == "permission-denied" {
		return "上游服务暂不可用，聊天端点访问被拒绝"
	}
	return "上游服务暂不可用"
}

func forceJSONBoolean(body []byte, key string, value bool) ([]byte, error) {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	payload[key] = json.RawMessage("false")
	if value {
		payload[key] = json.RawMessage("true")
	}
	return json.Marshal(payload)
}
