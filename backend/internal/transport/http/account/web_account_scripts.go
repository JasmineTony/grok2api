package account

import (
	"net/http"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/shared/response"
	"github.com/gin-gonic/gin"
)

const maxWebAccountScriptRequestIDs = 1000

type webAccountScriptsRequest struct {
	IDs     []string                       `json:"ids"`
	All     bool                           `json:"all"`
	Actions webAccountScriptActionsRequest `json:"actions"`
}

type webAccountScriptActionsRequest struct {
	AcceptTerms  bool `json:"acceptTerms"`
	SetBirthDate bool `json:"setBirthDate"`
	EnableNSFW   bool `json:"enableNSFW"`
}

func (r webAccountScriptActionsRequest) options() accountapp.WebAccountScriptOptions {
	return accountapp.WebAccountScriptOptions{
		AcceptTerms:  r.AcceptTerms,
		SetBirthDate: r.SetBirthDate,
		EnableNSFW:   r.EnableNSFW,
	}
}

func (r webAccountScriptActionsRequest) empty() bool {
	return !r.AcceptTerms && !r.SetBirthDate && !r.EnableNSFW
}

func (h *Handler) runWebAccountScripts(c *gin.Context) {
	var request webAccountScriptsRequest
	if c.ShouldBindJSON(&request) != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "账号脚本请求无效")
		return
	}
	if !validateWebAccountScriptsRequest(c, request) {
		return
	}
	ids, ok := h.resolveWebAccountScriptIDs(c, request)
	if !ok {
		return
	}
	h.streamWebAccountScripts(c, request, ids)
}

// validateWebAccountScriptsRequest 校验账号范围与脚本动作组合，失败时已写出错误响应。
func validateWebAccountScriptsRequest(c *gin.Context, request webAccountScriptsRequest) bool {
	if request.All && len(request.IDs) > 0 {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "全部账号与指定账号不能同时提交")
		return false
	}
	if !request.All && len(request.IDs) == 0 {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "至少选择一个账号")
		return false
	}
	if len(request.IDs) > maxWebAccountScriptRequestIDs {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "单次最多处理 1000 个账号")
		return false
	}
	if request.Actions.empty() {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "至少选择一个账号脚本")
		return false
	}
	return true
}

// resolveWebAccountScriptIDs 解析并去重目标账号，同时校验账号所属通道。
func (h *Handler) resolveWebAccountScriptIDs(c *gin.Context, request webAccountScriptsRequest) ([]uint64, bool) {
	if request.All {
		return nil, true
	}
	ids, err := parseIDs(request.IDs)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "invalidId", err.Error())
		return nil, false
	}
	ids = uniqueWebAccountScriptIDs(ids)
	if !h.validateProviderIDs(c, ids, string(accountdomain.ProviderWeb)) {
		return nil, false
	}
	return ids, true
}

// streamWebAccountScripts 以事件流方式执行脚本并回报成功与失败数量。
func (h *Handler) streamWebAccountScripts(c *gin.Context, request webAccountScriptsRequest, ids []uint64) {
	stream := newAccountEventStream(c)
	defer stream.Close()
	options := request.Actions.options()
	observer := stream.ProgressObserver()
	var (
		succeeded int
		failed    int
		err       error
	)
	if request.All {
		succeeded, failed, err = h.service.RunAllWebAccountScriptsWithProgress(c.Request.Context(), options, observer)
	} else {
		succeeded, failed, err = h.service.RunWebAccountScriptsWithProgress(c.Request.Context(), ids, options, observer)
	}
	if err != nil {
		stream.WriteError("webAccountScriptFailed", "执行 Grok Web 账号脚本失败")
		return
	}
	_ = stream.Write("complete", accountBatchResponse{Succeeded: succeeded, Failed: failed})
}

func uniqueWebAccountScriptIDs(ids []uint64) []uint64 {
	seen := make(map[uint64]struct{}, len(ids))
	result := make([]uint64, 0, len(ids))
	for _, id := range ids {
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}
