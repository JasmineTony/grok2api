package account

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/shared/response"
	"github.com/gin-gonic/gin"
)

func (h *Handler) importAuth(c *gin.Context) {
	h.importFile(c, accountdomain.ProviderBuild)
}

func (h *Handler) importWebAuth(c *gin.Context) {
	h.importFile(c, accountdomain.ProviderWeb)
}

func (h *Handler) importConsoleAuth(c *gin.Context) {
	h.importFile(c, accountdomain.ProviderConsole)
}

func (h *Handler) importFile(c *gin.Context, providerValue accountdomain.Provider) {
	fileDescription := "账号凭据 JSON、逐行 JSON 或 refresh token 文本"
	if providerValue == accountdomain.ProviderWeb {
		fileDescription = "Grok Web JSON、逐行 JSON 或 SSO 文本"
	} else if providerValue == accountdomain.ProviderConsole {
		fileDescription = "Grok Console JSON、逐行 JSON 或 SSO 文本"
	}
	documents, ok := readAccountImportDocuments(c, fileDescription)
	if !ok {
		return
	}
	stream := newAccountEventStream(c)
	defer stream.Close()
	var total atomic.Int64
	pipeline := h.startSyncPipeline(c.Request.Context(), stream.SyncProgressObserver())
	var result accountapp.ImportResult
	var err error
	if providerValue == accountdomain.ProviderWeb {
		result, err = h.service.ImportWebCredentialDocumentsWithProgress(pipeline.ctx, documents, pipeline.Observe, stream.PhaseProgressObserver("importing", &total))
	} else if providerValue == accountdomain.ProviderConsole {
		result, err = h.service.ImportConsoleCredentialDocumentsWithProgress(pipeline.ctx, documents, pipeline.Observe, stream.PhaseProgressObserver("importing", &total))
	} else {
		result, err = h.service.ImportCredentialDocumentsWithProgress(pipeline.ctx, documents, pipeline.Observe, stream.PhaseProgressObserver("importing", &total))
	}
	syncResult := pipeline.Finish(err != nil)
	if err != nil {
		stream.WriteError("authImportFailed", "导入账号失败")
		return
	}
	_ = stream.Write("complete", accountImportResponse{Created: result.Created, Updated: result.Updated, Skipped: result.Skipped, Failed: result.Failed, Synced: syncResult.Succeeded, SyncFailed: syncResult.Failed})
}

func readAccountImportDocuments(c *gin.Context, fileDescription string) ([][]byte, bool) {
	form, err := c.MultipartForm()
	if err != nil {
		var sizeError *http.MaxBytesError
		if errors.As(err, &sizeError) {
			response.Error(c, http.StatusRequestEntityTooLarge, "accountImportFileTooLarge", "账号凭据文件总大小不能超过 30 MiB")
			return nil, false
		}
		response.Error(c, http.StatusBadRequest, "invalidAuthFile", "请选择有效的"+fileDescription)
		return nil, false
	}
	defer form.RemoveAll()
	files := append(form.File["files"], form.File["file"]...)
	if len(files) == 0 {
		response.Error(c, http.StatusBadRequest, "invalidAuthFile", "请选择有效的"+fileDescription)
		return nil, false
	}
	if len(files) > maxAccountImportFiles {
		response.Error(c, http.StatusBadRequest, "invalidAuthFile", "单次最多选择 1000 个账号文件")
		return nil, false
	}
	documents := make([][]byte, 0, len(files))
	totalBytes := int64(0)
	for _, file := range files {
		if file.Size < 0 || totalBytes+file.Size > maxAccountImportBytes {
			response.Error(c, http.StatusRequestEntityTooLarge, "accountImportFileTooLarge", "账号凭据文件总大小不能超过 30 MiB")
			return nil, false
		}
		opened, openErr := file.Open()
		if openErr != nil {
			response.Error(c, http.StatusBadRequest, "invalidAuthFile", "无法读取"+fileDescription)
			return nil, false
		}
		data, readErr := io.ReadAll(io.LimitReader(opened, maxAccountImportBytes-totalBytes+1))
		_ = opened.Close()
		if readErr != nil {
			response.Error(c, http.StatusBadRequest, "invalidAuthFile", "无法读取"+fileDescription)
			return nil, false
		}
		totalBytes += int64(len(data))
		if totalBytes > maxAccountImportBytes {
			response.Error(c, http.StatusRequestEntityTooLarge, "accountImportFileTooLarge", "账号凭据文件总大小不能超过 30 MiB")
			return nil, false
		}
		documents = append(documents, data)
	}
	return documents, true
}

func (h *Handler) exportCredentials(c *gin.Context) {
	providerValue := accountdomain.Provider(c.DefaultQuery("provider", string(accountdomain.ProviderBuild)))
	if limitText, pagedExport := c.GetQuery("limit"); pagedExport {
		if _, usesOffset := c.GetQuery("offset"); usesOffset {
			response.Error(c, http.StatusBadRequest, "accountExportFailed", "分批导出不支持 offset，请使用服务端返回的 afterId")
			return
		}
		limit, err := strconv.Atoi(strings.TrimSpace(limitText))
		if err != nil {
			response.Error(c, http.StatusBadRequest, "accountExportFailed", "导出数量必须为整数")
			return
		}
		afterID, err := strconv.ParseUint(strings.TrimSpace(c.DefaultQuery("afterId", "0")), 10, 64)
		if err != nil {
			response.Error(c, http.StatusBadRequest, "accountExportFailed", "导出游标必须为非负整数")
			return
		}
		snapshotMaxID, err := strconv.ParseUint(strings.TrimSpace(c.DefaultQuery("snapshotMaxId", "0")), 10, 64)
		if err != nil {
			response.Error(c, http.StatusBadRequest, "accountExportFailed", "导出快照上界必须为非负整数")
			return
		}
		result, exportErr := h.service.ExportProviderCredentialsCursor(c.Request.Context(), providerValue, afterID, snapshotMaxID, limit)
		if exportErr != nil {
			h.writeServiceError(c, "accountExportFailed", exportErr, http.StatusInternalServerError, "导出账号失败")
			return
		}
		c.Header("X-Export-Next-ID", strconv.FormatUint(result.NextID, 10))
		c.Header("X-Export-Snapshot-Max-ID", strconv.FormatUint(result.SnapshotMaxID, 10))
		c.Header("X-Export-Has-More", strconv.FormatBool(result.HasMore))
		h.writeCredentialExport(c, providerValue, result.ExportResult)
		return
	}
	result, err := h.service.ExportProviderCredentials(c.Request.Context(), providerValue)
	if err != nil {
		h.writeServiceError(c, "accountExportFailed", err, http.StatusInternalServerError, "导出账号失败")
		return
	}
	h.writeCredentialExport(c, providerValue, result)
}

func (h *Handler) exportSelectedCredentials(c *gin.Context) {
	var request credentialExportRequest
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
	result, err := h.service.ExportProviderCredentialsByIDs(c.Request.Context(), providerValue, ids)
	if err != nil {
		h.writeServiceError(c, "accountExportFailed", err, http.StatusInternalServerError, "导出账号失败")
		return
	}
	h.writeCredentialExport(c, providerValue, result)
}

func (h *Handler) writeCredentialExport(c *gin.Context, providerValue accountdomain.Provider, result accountapp.ExportResult) {
	filename := "grok2api-" + string(providerValue) + "-accounts-" + time.Now().UTC().Format("20060102T150405Z") + ".json"
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Access-Control-Expose-Headers", "Content-Disposition, X-Exported-Accounts, X-Export-Next-ID, X-Export-Snapshot-Max-ID, X-Export-Has-More")
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("X-Exported-Accounts", strconv.Itoa(result.Count))
	c.Data(http.StatusOK, "application/json; charset=utf-8", result.Data)
}
