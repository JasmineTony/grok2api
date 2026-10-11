package account

import (
	"errors"
	"net/http"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	"github.com/chenyme/grok2api/backend/internal/shared/response"
	"github.com/gin-gonic/gin"
)

func (h *Handler) startDevice(c *gin.Context) {
	value, err := h.service.StartDeviceLogin(c.Request.Context())
	if err != nil {
		response.Error(c, http.StatusBadGateway, "deviceLoginStartFailed", "启动 Device OAuth 失败")
		return
	}
	response.Success(c, http.StatusCreated, gin.H{"sessionId": value.SessionID, "userCode": value.UserCode, "verificationUri": value.VerificationURI, "verificationUriComplete": value.VerificationURIComplete, "intervalSeconds": int(value.Interval.Seconds()), "expiresAt": value.ExpiresAt})
}

func (h *Handler) pollDevice(c *gin.Context) {
	value, err := h.service.PollDeviceLogin(c.Request.Context(), c.Param("sessionId"))
	if errors.Is(err, accountapp.ErrDevicePending) {
		response.Success(c, http.StatusAccepted, gin.H{"status": "pending"})
		return
	}
	if errors.Is(err, accountapp.ErrDeviceSlowDown) {
		response.Error(c, http.StatusTooManyRequests, "devicePollTooFast", "轮询过快，请稍后重试")
		return
	}
	if errors.Is(err, accountapp.ErrDeviceDenied) {
		response.Error(c, http.StatusGone, "deviceLoginExpired", "Device OAuth 已拒绝或过期")
		return
	}
	if err != nil {
		response.Error(c, http.StatusBadGateway, "deviceLoginFailed", "Device OAuth 登录失败")
		return
	}
	syncResult := h.syncInitial(c.Request.Context(), value.Credential.ID)
	if refreshed, refreshErr := h.service.Get(c.Request.Context(), value.Credential.ID); refreshErr == nil {
		value = refreshed
	}
	status := "succeeded"
	if syncResult.Failed > 0 {
		status = "syncFailed"
	}
	response.Success(c, http.StatusOK, gin.H{"status": status, "account": newAccountResponse(value), "synced": syncResult.Succeeded, "syncFailed": syncResult.Failed})
}

func (h *Handler) refreshWebQuota(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if _, err := h.service.RefreshQuota(c.Request.Context(), id); err != nil {
		h.writeServiceError(c, "quotaRefreshFailed", err, http.StatusBadGateway, "同步 Provider 额度失败")
		return
	}
	value, err := h.service.Get(c.Request.Context(), id)
	if err != nil {
		h.writeServiceError(c, "accountGetFailed", err, http.StatusInternalServerError, "读取账号失败")
		return
	}
	response.Success(c, http.StatusOK, newAccountResponse(value))
}

func (h *Handler) refreshToken(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	value, err := h.service.RefreshToken(c.Request.Context(), id)
	if err != nil {
		h.writeServiceError(c, "tokenRefreshFailed", err, http.StatusBadGateway, "刷新账号凭据失败")
		return
	}
	response.Success(c, http.StatusOK, newAccountResponse(value))
}

func (h *Handler) acceptWebTerms(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if err := h.service.AcceptWebTerms(c.Request.Context(), id); err != nil {
		h.writeServiceError(c, "webTermsAcceptanceFailed", err, http.StatusBadGateway, "接受 Grok Web 服务协议失败")
		return
	}
	response.Success(c, http.StatusOK, gin.H{"completed": true})
}

func (h *Handler) setWebBirthDate(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if err := h.service.SetWebBirthDate(c.Request.Context(), id); err != nil {
		h.writeServiceError(c, "webBirthDateUpdateFailed", err, http.StatusBadGateway, "设置 Grok Web 账号生日失败")
		return
	}
	response.Success(c, http.StatusOK, gin.H{"completed": true})
}

func (h *Handler) enableWebNSFW(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if err := h.service.EnableWebNSFW(c.Request.Context(), id); err != nil {
		h.writeServiceError(c, "webNSFWEnableFailed", err, http.StatusBadGateway, "开启 Grok Web NSFW 失败")
		return
	}
	response.Success(c, http.StatusOK, gin.H{"completed": true})
}

func (h *Handler) refreshBilling(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	value, err := h.service.RefreshBilling(c.Request.Context(), id)
	if err != nil {
		h.writeServiceError(c, "billingRefreshFailed", err, http.StatusBadGateway, "刷新账号额度失败")
		return
	}
	response.Success(c, http.StatusOK, newBillingResponse(value))
}

func (h *Handler) refreshAllBilling(c *gin.Context) {
	stream := newAccountEventStream(c)
	defer stream.Close()
	succeeded, failed, err := h.service.SyncAllBillingWithProgress(c.Request.Context(), stream.ProgressObserver())
	if err != nil {
		stream.WriteError("billingRefreshFailed", "刷新账号额度失败")
		return
	}
	_ = stream.Write("complete", accountBatchResponse{Succeeded: succeeded, Failed: failed})
}

func (h *Handler) refreshAllTokens(c *gin.Context) {
	stream := newAccountEventStream(c)
	defer stream.Close()
	succeeded, failed, skipped, err := h.service.RefreshAllTokensWithProgress(c.Request.Context(), stream.ProgressObserver())
	if err != nil {
		stream.WriteError("tokenRefreshFailed", "续期账号凭据失败")
		return
	}
	_ = stream.Write("complete", accountTokenRefreshResponse{Succeeded: succeeded, Failed: failed, Skipped: skipped})
}

func (h *Handler) refreshAllWebQuotas(c *gin.Context) {
	stream := newAccountEventStream(c)
	defer stream.Close()
	succeeded, failed, err := h.service.SyncAllWebQuotasWithProgress(c.Request.Context(), stream.ProgressObserver())
	if err != nil {
		stream.WriteError("quotaRefreshFailed", "同步 Grok Web 账号额度失败")
		return
	}
	_ = stream.Write("complete", accountBatchResponse{Succeeded: succeeded, Failed: failed})
}

func (h *Handler) refreshAllConsoleQuotas(c *gin.Context) {
	stream := newAccountEventStream(c)
	defer stream.Close()
	succeeded, failed, err := h.service.SyncAllConsoleQuotasWithProgress(c.Request.Context(), stream.ProgressObserver())
	if err != nil {
		stream.WriteError("quotaRefreshFailed", "同步 Grok Console 账号额度失败")
		return
	}
	_ = stream.Write("complete", accountBatchResponse{Succeeded: succeeded, Failed: failed})
}
