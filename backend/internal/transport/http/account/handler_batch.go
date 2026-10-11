package account

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/shared/response"
	"github.com/gin-gonic/gin"
)

func (h *Handler) batchUpdate(c *gin.Context) {
	var request batchUpdateRequest
	if c.ShouldBindJSON(&request) != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "请求参数无效")
		return
	}
	ids, err := parseIDs(request.IDs)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "invalidId", err.Error())
		return
	}
	updated, err := h.service.BatchUpdate(c.Request.Context(), accountdomain.Provider(request.Provider), ids, accountapp.UpdateInput{Enabled: request.Enabled, Priority: request.Priority, MaxConcurrent: request.MaxConcurrent, MinimumRemaining: request.MinimumRemaining})
	if err != nil {
		h.writeServiceError(c, "accountBatchUpdateFailed", err, http.StatusInternalServerError, "批量更新账号失败")
		return
	}
	response.Success(c, http.StatusOK, gin.H{"updated": updated})
}

func (h *Handler) batchDelete(c *gin.Context) {
	var request batchDeleteRequest
	if c.ShouldBindJSON(&request) != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "请求参数无效")
		return
	}
	ids, err := parseIDs(request.IDs)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "invalidId", err.Error())
		return
	}
	if !h.validateProviderIDs(c, ids, request.Provider) {
		return
	}
	targets, err := parseLinkedDeleteTargets(request.LinkedDeleteTargets)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "invalidLinkedDeleteTargets", err.Error())
		return
	}
	result, err := h.service.BatchDeleteWithLinked(c.Request.Context(), accountdomain.Provider(request.Provider), ids, targets)
	if err != nil {
		h.writeServiceError(c, "accountBatchDeleteFailed", err, http.StatusInternalServerError, "批量删除账号失败")
		return
	}
	response.Success(c, http.StatusOK, newAccountDeleteResponse(result))
}

func (h *Handler) previewDeletion(c *gin.Context) {
	var request deletionPreviewRequest
	if c.ShouldBindJSON(&request) != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "请求参数无效")
		return
	}
	ids, err := parseIDs(request.IDs)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "invalidId", err.Error())
		return
	}
	if !h.validateProviderIDs(c, ids, request.Provider) {
		return
	}
	targets, err := parseLinkedDeleteTargets(request.LinkedDeleteTargets)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "invalidLinkedDeleteTargets", err.Error())
		return
	}
	resolution, err := h.service.PreviewLinkedDelete(c.Request.Context(), accountdomain.Provider(request.Provider), ids, targets)
	if err != nil {
		h.writeServiceError(c, "accountDeletionPreviewFailed", err, http.StatusInternalServerError, "预览删除账号失败")
		return
	}
	linked := gin.H{}
	for provider, count := range resolution.LinkedByProvider {
		linked[string(provider)] = count
	}
	response.Success(c, http.StatusOK, gin.H{
		"rootCount":        len(resolution.RootIDs),
		"linkedByProvider": linked,
		"total":            len(resolution.FinalIDs),
	})
}

func (h *Handler) batchRefreshBilling(c *gin.Context) {
	var request batchDeleteRequest
	if c.ShouldBindJSON(&request) != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "请求参数无效")
		return
	}
	ids, err := parseIDs(request.IDs)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "invalidId", err.Error())
		return
	}
	if request.Provider != string(accountdomain.ProviderBuild) {
		response.Error(c, http.StatusBadRequest, "invalidProvider", "仅 Grok Build 账号支持 Billing 同步")
		return
	}
	if !h.validateProviderIDs(c, ids, request.Provider) {
		return
	}
	succeeded, failed, err := h.service.BatchRefreshBilling(c.Request.Context(), ids)
	if err != nil {
		h.writeServiceError(c, "billingBatchRefreshFailed", err, http.StatusBadGateway, "批量同步 Billing 失败")
		return
	}
	response.Success(c, http.StatusOK, gin.H{"succeeded": succeeded, "failed": failed})
}

func (h *Handler) detectBuildAccounts(c *gin.Context) {
	var request detectBuildAccountsRequest
	if c.Request.Body != nil {
		if err := json.NewDecoder(c.Request.Body).Decode(&request); err != nil && !errors.Is(err, io.EOF) {
			response.Error(c, http.StatusBadRequest, "invalidRequest", "请求参数无效")
			return
		}
	}
	if request.Provider != "" && request.Provider != string(accountdomain.ProviderBuild) {
		response.Error(c, http.StatusBadRequest, "invalidProvider", "仅 Grok Build 账号支持可用性检测")
		return
	}
	hasIDs := len(request.IDs) > 0
	if request.All == hasIDs {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "必须明确选择全部账号或提供非空账号 ID")
		return
	}
	var ids []uint64
	if hasIDs {
		parsed, err := parseIDs(request.IDs)
		if err != nil {
			response.Error(c, http.StatusBadRequest, "invalidId", err.Error())
			return
		}
		if !h.validateProviderIDs(c, parsed, string(accountdomain.ProviderBuild)) {
			return
		}
		ids = parsed
	}
	stream := newAccountEventStream(c)
	defer stream.Close()
	itemObserver := func(item accountapp.BuildDetectItemResult) error {
		return stream.Write("item", accountDetectItemResponse{
			ID:         strconv.FormatUint(item.AccountID, 10),
			Name:       item.Name,
			Email:      item.Email,
			Outcome:    string(item.Outcome),
			Reason:     item.Reason,
			HTTPStatus: item.HTTPStatus,
		})
	}
	succeeded, failed, err := h.service.DetectBuildAccountsWithProgress(c.Request.Context(), ids, request.All, stream.ProgressObserver(), itemObserver)
	if err != nil {
		stream.WriteError("accountDetectFailed", "检测 Grok Build 账号失败")
		return
	}
	_ = stream.Write("complete", accountBatchResponse{Succeeded: succeeded, Failed: failed})
}

func (h *Handler) batchResetQuota(c *gin.Context) {
	var request batchDeleteRequest
	if c.ShouldBindJSON(&request) != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "请求参数无效")
		return
	}
	ids, err := parseIDs(request.IDs)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "invalidId", err.Error())
		return
	}
	if request.Provider != string(accountdomain.ProviderBuild) {
		response.Error(c, http.StatusBadRequest, "invalidProvider", "仅 Grok Build 账号支持手动重置额度状态")
		return
	}
	reset, err := h.service.BatchResetQuotaState(c.Request.Context(), ids)
	if err != nil {
		h.writeServiceError(c, "quotaBatchResetFailed", err, http.StatusInternalServerError, "批量重置额度状态失败")
		return
	}
	response.Success(c, http.StatusOK, gin.H{"reset": reset})
}

func (h *Handler) resetAllBuildQuota(c *gin.Context) {
	reset, err := h.service.ResetAllBuildQuotaState(c.Request.Context())
	if err != nil {
		h.writeServiceError(c, "quotaResetFailed", err, http.StatusInternalServerError, "重置全部 Grok Build 额度状态失败")
		return
	}
	response.Success(c, http.StatusOK, gin.H{"reset": reset})
}

func (h *Handler) cleanup(c *gin.Context) {
	var request accountCleanupRequest
	if c.ShouldBindJSON(&request) != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "请求参数无效")
		return
	}
	targets, err := parseLinkedDeleteTargets(request.LinkedDeleteTargets)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "invalidLinkedDeleteTargets", err.Error())
		return
	}
	result, err := h.service.CleanupAccounts(c.Request.Context(), accountdomain.Provider(request.Provider), request.Statuses, targets)
	if err != nil {
		h.writeServiceError(c, "accountCleanupFailed", err, http.StatusInternalServerError, "清理账号失败")
		return
	}
	byProvider := gin.H{}
	for provider, count := range result.DeletedByProvider {
		byProvider[string(provider)] = count
	}
	response.Success(c, http.StatusOK, gin.H{
		"deleted":           result.Deleted,
		"rootsDeleted":      result.RootsDeleted,
		"linkedDeleted":     result.LinkedDeleted,
		"skipped":           result.Skipped,
		"deletedByProvider": byProvider,
	})
}

// cleanupPreview returns root and linked-peer counts for the cleanup dialog.
func (h *Handler) cleanupPreview(c *gin.Context) {
	var request accountCleanupRequest
	if c.ShouldBindJSON(&request) != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "请求参数无效")
		return
	}
	targets, err := parseLinkedDeleteTargets(request.LinkedDeleteTargets)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "invalidLinkedDeleteTargets", err.Error())
		return
	}
	preview, err := h.service.PreviewCleanup(c.Request.Context(), accountdomain.Provider(request.Provider), request.Statuses, targets)
	if err != nil {
		h.writeServiceError(c, "accountCleanupPreviewFailed", err, http.StatusInternalServerError, "预览清理账号失败")
		return
	}
	rootsByStatus := gin.H{}
	for status, count := range preview.RootsByStatus {
		rootsByStatus[status] = count
	}
	linked := gin.H{}
	for provider, count := range preview.LinkedByProvider {
		linked[string(provider)] = count
	}
	response.Success(c, http.StatusOK, gin.H{
		"rootsByStatus":    rootsByStatus,
		"rootCount":        preview.RootCount,
		"linkedByProvider": linked,
		"total":            preview.Total,
	})
}

func (h *Handler) batchRefreshQuotas(c *gin.Context) {
	var request batchDeleteRequest
	if c.ShouldBindJSON(&request) != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "请求参数无效")
		return
	}
	ids, err := parseIDs(request.IDs)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "invalidId", err.Error())
		return
	}
	providerValue := accountdomain.Provider(request.Provider)
	if !providerValue.IsValid() {
		response.Error(c, http.StatusBadRequest, "invalidProvider", "账号来源无效")
		return
	}
	if !h.validateProviderIDs(c, ids, request.Provider) {
		return
	}
	var succeeded, failed int
	if providerValue == accountdomain.ProviderBuild {
		succeeded, failed, err = h.service.BatchRefreshBilling(c.Request.Context(), ids)
	} else {
		succeeded, failed, err = h.service.BatchRefreshQuota(c.Request.Context(), ids)
	}
	if err != nil {
		h.writeServiceError(c, "quotaBatchRefreshFailed", err, http.StatusBadGateway, "批量同步账号额度失败")
		return
	}
	response.Success(c, http.StatusOK, gin.H{"succeeded": succeeded, "failed": failed})
}

func (h *Handler) batchRefreshTokens(c *gin.Context) {
	var request batchDeleteRequest
	if c.ShouldBindJSON(&request) != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "请求参数无效")
		return
	}
	ids, err := parseIDs(request.IDs)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "invalidId", err.Error())
		return
	}
	if request.Provider != string(accountdomain.ProviderBuild) {
		response.Error(c, http.StatusBadRequest, "invalidProvider", "仅 Grok Build 账号支持凭据刷新")
		return
	}
	if !h.validateProviderIDs(c, ids, request.Provider) {
		return
	}
	succeeded, failed, skipped, err := h.service.BatchRefreshTokens(c.Request.Context(), ids)
	if err != nil {
		h.writeServiceError(c, "tokenRefreshFailed", err, http.StatusBadGateway, "批量刷新账号凭据失败")
		return
	}
	response.Success(c, http.StatusOK, gin.H{"succeeded": succeeded, "failed": failed, "skipped": skipped})
}
