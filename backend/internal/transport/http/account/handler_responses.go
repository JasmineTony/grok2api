package account

import (
	"errors"
	"net/http"
	"strconv"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"github.com/chenyme/grok2api/backend/internal/shared/response"
	"github.com/gin-gonic/gin"
)

// writeServiceError 仅暴露明确的账号业务错误，未知内部错误使用稳定文案。
func (h *Handler) writeServiceError(c *gin.Context, code string, err error, fallbackStatus int, fallbackMessage string) {
	switch {
	case errors.Is(err, accountapp.ErrImportLimit):
		response.Error(c, http.StatusBadRequest, "accountImportLimitExceeded", err.Error())
	case errors.Is(err, accountapp.ErrExportLimit):
		response.Error(c, http.StatusBadRequest, "accountExportLimitExceeded", err.Error())
	case errors.Is(err, accountapp.ErrInvalidInput), errors.Is(err, accountapp.ErrInvalidImport):
		response.Error(c, http.StatusBadRequest, code, err.Error())
	case errors.Is(err, accountapp.ErrAccountPoolMismatch):
		response.Error(c, http.StatusConflict, "accountPoolMismatch", err.Error())
	case errors.Is(err, accountapp.ErrConflict):
		response.Error(c, http.StatusConflict, code, err.Error())
	case errors.Is(err, accountapp.ErrNotFound):
		response.Error(c, http.StatusNotFound, "accountNotFound", err.Error())
	case errors.Is(err, accountapp.ErrUnsupported):
		response.Error(c, http.StatusConflict, "accountOperationUnsupported", err.Error())
	case errors.Is(err, accountapp.ErrConversionBusy):
		response.Error(c, http.StatusConflict, "accountConversionBusy", err.Error())
	case errors.Is(err, accountapp.ErrWebAccountScriptBusy):
		response.Error(c, http.StatusConflict, "webAccountScriptBusy", err.Error())
	default:
		response.Error(c, fallbackStatus, code, fallbackMessage)
	}
}

func newAccountResponse(value accountapp.View) accountResponse {
	c := value.Credential
	buildRouteMode := c.BuildRouteMode
	if c.Provider != accountdomain.ProviderBuild || !buildRouteMode.IsValid() {
		buildRouteMode = accountdomain.BuildRouteAuto
	}
	result := accountResponse{
		ID: c.ID, Provider: string(c.Provider), AuthType: string(c.AuthType), WebTier: string(c.WebTier),
		WebTierSyncedAt: c.WebTierSyncedAt, WebNSFWEnabledAt: c.WebNSFWEnabledAt, WebTermsAcceptedAt: c.WebTermsAcceptedAt, Name: c.Name, Email: c.Email, UserID: c.UserID, TeamID: c.TeamID,
		Enabled: c.Enabled, AuthStatus: string(c.AuthStatus), Refreshable: c.EncryptedRefreshToken != "",
		RefreshDueAt: c.RefreshDueAt, LastRefreshAt: c.LastRefreshAt,
		RefreshFailures: c.RefreshFailureCount, LastRefreshErrorStatus: c.LastRefreshErrorStatus, LastRefreshError: c.LastRefreshErrorCode, LastRefreshErrorMessage: c.LastRefreshErrorMessage, LastRefreshErrorResponse: c.LastRefreshErrorResponse,
		Priority: c.Priority, MaxConcurrent: c.MaxConcurrent, MinimumRemaining: c.MinimumRemaining,
		FailureCount: c.FailureCount, CooldownUntil: c.CooldownUntil, LastError: c.LastError,
		LastUsedAt: c.LastUsedAt, LinkedAccountID: c.LinkedAccountID, LinkedName: c.LinkedAccountName, LinkedProvider: string(c.LinkedProvider),
		CreatedAt: c.CreatedAt, ObservedModel: c.ObservedModel, ObservedModelAt: c.ObservedModelAt,
		CloudflareCookieConfigured: c.EncryptedCloudflareCookie != "",
		BuildSuperEntitled:         c.BuildSuperEntitled && c.Provider == accountdomain.ProviderBuild,
		BuildRouteMode:             string(buildRouteMode),
		BuildBotFlagged:            value.BuildBotFlagged && c.Provider == accountdomain.ProviderBuild,
		BuildBotFlagSource:         buildBotFlagSourceResponse(c.Provider, value.BuildBotFlagged, value.BuildBotFlagSource),
		EgressNodeID:               c.EgressNodeID,
		EgressAssignmentMode:       string(c.EgressAssignmentMode),
		Quota:                      newQuotaResponse(value.Quota, value.ModelQuotaBlocks), QuotaWindows: make([]quotaWindowResponse, 0, len(value.QuotaWindows)),
	}
	for _, linked := range c.LinkedAccounts {
		result.LinkedAccounts = append(result.LinkedAccounts, linkedAccountResponse{ID: linked.ID, Provider: string(linked.Provider), Name: linked.Name, Email: linked.Email, UserID: linked.UserID})
	}
	for _, window := range value.QuotaWindows {
		breakdown := make([]quotaBreakdownResponse, 0, len(window.Breakdown))
		for _, item := range window.Breakdown {
			breakdown = append(breakdown, quotaBreakdownResponse{ProductCode: item.ProductCode, UsagePercent: item.UsagePercent})
		}
		result.QuotaWindows = append(result.QuotaWindows, quotaWindowResponse{
			Mode: window.Mode, Remaining: window.Remaining, Total: window.Total,
			UsagePercent: window.UsagePercent, Breakdown: breakdown,
			WindowSeconds: window.WindowSeconds, ResetAt: window.ResetAt, SyncedAt: window.SyncedAt,
			Source: string(window.Source),
		})
	}
	if !c.ExpiresAt.IsZero() {
		expiresAt := c.ExpiresAt
		result.ExpiresAt = &expiresAt
	}
	if value.Billing != nil {
		billing := newBillingResponse(*value.Billing)
		result.Billing = &billing
	}
	return result
}

func buildBotFlagSourceResponse(provider accountdomain.Provider, flagged bool, source int) int {
	if provider != accountdomain.ProviderBuild || !flagged {
		return 0
	}
	if source != 1 && source != 2 {
		return 0
	}
	return source
}

func newQuotaResponse(value accountapp.QuotaView, blocks []accountdomain.ModelQuotaBlock) quotaResponse {
	result := quotaResponse{Type: string(value.Type), Source: value.Source, Confidence: value.Confidence, Unit: value.Unit, Used: value.Used, Limit: value.Limit, Remaining: value.Remaining, UsagePercent: value.UsagePercent, LimitKnown: value.LimitKnown, WindowHours: value.WindowHours, Observed: value.Observed, Confirmed: value.Confirmed, Status: string(value.Status), PeriodStart: value.PeriodStart, PeriodEnd: value.PeriodEnd, ExhaustedAt: value.ExhaustedAt, NextProbeAt: value.NextProbeAt, LastConfirmedAt: value.LastConfirmedAt}
	// 无封锁时保持 nil，避免 omitempty 失效输出空数组。
	if len(blocks) == 0 {
		return result
	}
	result.ModelQuotaBlocks = make([]modelQuotaBlockResponse, 0, len(blocks))
	for _, block := range blocks {
		item := modelQuotaBlockResponse{Model: block.UpstreamModel, Reason: block.Reason}
		if !block.CooldownUntil.IsZero() {
			cooldownUntil := block.CooldownUntil
			item.CooldownUntil = &cooldownUntil
		}
		result.ModelQuotaBlocks = append(result.ModelQuotaBlocks, item)
	}
	return result
}

func newBillingResponse(value accountdomain.Billing) billingResponse {
	history := make([]billingHistoryResponse, 0, len(value.History))
	for _, entry := range value.History {
		history = append(history, billingHistoryResponse{
			Year: entry.Year, Month: entry.Month,
			PeriodType: entry.PeriodType, PeriodStart: entry.PeriodStart, PeriodEnd: entry.PeriodEnd,
			IncludedUsed: entry.IncludedUsed, OnDemandUsed: entry.OnDemandUsed, TotalUsed: entry.TotalUsed,
		})
	}
	return billingResponse{PlanCode: value.PlanCode, PlanName: value.PlanName, MonthlyLimit: value.MonthlyLimit, Used: value.Used, Remaining: value.Remaining(), OnDemandCap: value.OnDemandCap, OnDemandUsed: value.OnDemandUsed, PrepaidBalance: value.PrepaidBalance, CreditUsagePercent: value.CreditUsagePercent, IsUnifiedBillingUser: value.IsUnifiedBillingUser, OnDemandEnabled: value.OnDemandEnabled, TopUpMethod: value.TopUpMethod, UsagePeriodType: value.UsagePeriodType, UsagePeriodStart: value.UsagePeriodStart, UsagePeriodEnd: value.UsagePeriodEnd, BillingPeriodStart: value.BillingPeriodStart, BillingPeriodEnd: value.BillingPeriodEnd, History: history, SyncedAt: value.SyncedAt}
}

func pagination(c *gin.Context) (int, int) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	return repository.NormalizePage(page, size, repository.DefaultPageSize)
}

func pathID(c *gin.Context) (uint64, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		response.Error(c, http.StatusBadRequest, "invalidId", "ID 无效")
		return 0, false
	}
	return id, true
}

func parseIDs(values []string) ([]uint64, error) {
	ids := make([]uint64, 0, len(values))
	for _, value := range values {
		id, err := strconv.ParseUint(value, 10, 64)
		if err != nil || id == 0 {
			return nil, errors.New("ID 无效")
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func (h *Handler) validateProviderIDs(c *gin.Context, ids []uint64, providerValue string) bool {
	provider := accountdomain.Provider(providerValue)
	if !provider.IsValid() {
		response.Error(c, http.StatusBadRequest, "invalidProvider", "账号来源无效")
		return false
	}
	valid, err := h.service.AccountsBelongToProvider(c.Request.Context(), ids, provider)
	if err != nil {
		h.writeServiceError(c, "accountPoolValidationFailed", err, http.StatusInternalServerError, "校验账号号池失败")
		return false
	}
	if !valid {
		response.Error(c, http.StatusConflict, "accountPoolMismatch", "批量操作包含不属于当前号池的账号")
		return false
	}
	return true
}
