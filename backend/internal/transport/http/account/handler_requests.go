package account

import (
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
)

type updateRequest struct {
	Name                   *string                       `json:"name"`
	Enabled                *bool                         `json:"enabled"`
	Priority               *int                          `json:"priority"`
	MaxConcurrent          *int                          `json:"maxConcurrent"`
	MinimumRemaining       *float64                      `json:"minimumRemaining"`
	CloudflareCookies      *string                       `json:"cloudflareCookies"`
	ClearCloudflareCookies bool                          `json:"clearCloudflareCookies"`
	BuildSuperEntitled     *bool                         `json:"buildSuperEntitled"`
	BuildRouteMode         *accountdomain.BuildRouteMode `json:"buildRouteMode"`
}

type batchUpdateRequest struct {
	IDs              []string `json:"ids" binding:"required"`
	Provider         string   `json:"provider" binding:"required"`
	Enabled          *bool    `json:"enabled"`
	Priority         *int     `json:"priority"`
	MaxConcurrent    *int     `json:"maxConcurrent"`
	MinimumRemaining *float64 `json:"minimumRemaining"`
}

type batchDeleteRequest struct {
	IDs                 []string `json:"ids" binding:"required"`
	Provider            string   `json:"provider" binding:"required"`
	LinkedDeleteTargets []string `json:"linkedDeleteTargets"`
}

type credentialExportRequest struct {
	IDs      []string `json:"ids" binding:"required"`
	Provider string   `json:"provider" binding:"required"`
}

type deletionPreviewRequest struct {
	IDs                 []string `json:"ids" binding:"required"`
	Provider            string   `json:"provider" binding:"required"`
	LinkedDeleteTargets []string `json:"linkedDeleteTargets"`
}

type accountCleanupRequest struct {
	Provider            string                     `json:"provider" binding:"required"`
	Statuses            []accountapp.CleanupStatus `json:"statuses" binding:"required"`
	LinkedDeleteTargets []string                   `json:"linkedDeleteTargets"`
}

type buildConversionRequest struct {
	IDs      []string                           `json:"ids"`
	All      bool                               `json:"all"`
	Strategy accountapp.BuildConversionStrategy `json:"strategy"`
}

// detectBuildAccountsRequest 要求显式选择全部账号或提供非空 id 集合。
type detectBuildAccountsRequest struct {
	IDs      []string `json:"ids"`
	All      bool     `json:"all"`
	Provider string   `json:"provider"`
}

type webConsoleSyncRequest struct {
	IDs      []string                          `json:"ids"`
	All      bool                              `json:"all"`
	Strategy accountapp.WebConsoleSyncStrategy `json:"strategy"`
}

type buildConversionResponse struct {
	Created    int `json:"created"`
	Linked     int `json:"linked"`
	Skipped    int `json:"skipped"`
	Failed     int `json:"failed"`
	Synced     int `json:"synced"`
	SyncFailed int `json:"syncFailed"`
}

type accountTaskProgressResponse struct {
	Completed int    `json:"completed"`
	Total     int    `json:"total"`
	Phase     string `json:"phase,omitempty"`
}

// accountDetectItemResponse 是检测任务的单账号增量事件；全量检测仅推送 invalid。
type accountDetectItemResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Email      string `json:"email,omitempty"`
	Outcome    string `json:"outcome"`
	Reason     string `json:"reason,omitempty"`
	HTTPStatus int    `json:"httpStatus,omitempty"`
}

type accountBatchResponse struct {
	Succeeded int `json:"succeeded"`
	Failed    int `json:"failed"`
}

type accountTokenRefreshResponse struct {
	Succeeded int `json:"succeeded"`
	Failed    int `json:"failed"`
	Skipped   int `json:"skipped"`
}

type accountImportResponse struct {
	Created    int `json:"created"`
	Updated    int `json:"updated"`
	Skipped    int `json:"skipped"`
	Failed     int `json:"failed"`
	Synced     int `json:"synced"`
	SyncFailed int `json:"syncFailed"`
}

type accountResponse struct {
	ID                       uint64     `json:"id,string"`
	Provider                 string     `json:"provider"`
	AuthType                 string     `json:"authType"`
	WebTier                  string     `json:"webTier,omitempty"`
	WebTierSyncedAt          *time.Time `json:"webTierSyncedAt,omitempty"`
	WebNSFWEnabledAt         *time.Time `json:"nsfwEnabledAt,omitempty"`
	WebTermsAcceptedAt       *time.Time `json:"termsAcceptedAt,omitempty"`
	Name                     string     `json:"name"`
	Email                    string     `json:"email,omitempty"`
	UserID                   string     `json:"userId,omitempty"`
	TeamID                   string     `json:"teamId,omitempty"`
	Enabled                  bool       `json:"enabled"`
	AuthStatus               string     `json:"authStatus"`
	ExpiresAt                *time.Time `json:"expiresAt,omitempty"`
	Refreshable              bool       `json:"refreshable"`
	RefreshDueAt             *time.Time `json:"refreshDueAt,omitempty"`
	LastRefreshAt            *time.Time `json:"lastRefreshAt,omitempty"`
	RefreshFailures          int        `json:"refreshFailureCount"`
	LastRefreshErrorStatus   int        `json:"lastRefreshErrorStatus,omitempty"`
	LastRefreshError         string     `json:"lastRefreshErrorCode,omitempty"`
	LastRefreshErrorMessage  string     `json:"lastRefreshErrorMessage,omitempty"`
	LastRefreshErrorResponse string     `json:"lastRefreshErrorResponse,omitempty"`
	Priority                 int        `json:"priority"`
	MaxConcurrent            int        `json:"maxConcurrent"`
	MinimumRemaining         float64    `json:"minimumRemaining"`
	FailureCount             int        `json:"failureCount"`
	CooldownUntil            *time.Time `json:"cooldownUntil,omitempty"`
	LastError                string     `json:"lastError,omitempty"`
	// EnabledDoesNotClearCooldown is set on PATCH when enabled was changed
	// while the account is still cooling. Toggling enabled is not a health reset.
	EnabledDoesNotClearCooldown bool                    `json:"enabledDoesNotClearCooldown,omitempty"`
	LastUsedAt                  *time.Time              `json:"lastUsedAt,omitempty"`
	LinkedAccountID             uint64                  `json:"linkedAccountId,omitempty,string"`
	LinkedName                  string                  `json:"linkedAccountName,omitempty"`
	LinkedProvider              string                  `json:"linkedProvider,omitempty"`
	LinkedAccounts              []linkedAccountResponse `json:"linkedAccounts,omitempty"`
	CreatedAt                   time.Time               `json:"createdAt"`
	ObservedModel               string                  `json:"observedModel,omitempty"`
	ObservedModelAt             *time.Time              `json:"observedModelAt,omitempty"`
	CloudflareCookieConfigured  bool                    `json:"cloudflareCookieConfigured"`
	BuildSuperEntitled          bool                    `json:"buildSuperEntitled"`
	BuildRouteMode              string                  `json:"buildRouteMode"`
	BuildBotFlagged             bool                    `json:"buildBotFlagged"`
	BuildBotFlagSource          int                     `json:"buildBotFlagSource,omitempty"`
	EgressNodeID                uint64                  `json:"egressNodeId,omitempty,string"`
	EgressAssignmentMode        string                  `json:"egressAssignmentMode,omitempty"`
	ModelSyncFailed             bool                    `json:"modelSyncFailed,omitempty"`
	Billing                     *billingResponse        `json:"billing,omitempty"`
	Quota                       quotaResponse           `json:"quota"`
	QuotaWindows                []quotaWindowResponse   `json:"quotaWindows,omitempty"`
}

type linkedAccountResponse struct {
	ID       uint64 `json:"id,string"`
	Provider string `json:"provider"`
	Name     string `json:"name"`
	Email    string `json:"email,omitempty"`
	UserID   string `json:"userId,omitempty"`
}

type quotaWindowResponse struct {
	Mode          string                   `json:"mode"`
	Remaining     int                      `json:"remaining"`
	Total         int                      `json:"total"`
	UsagePercent  float64                  `json:"usagePercent"`
	Breakdown     []quotaBreakdownResponse `json:"breakdown,omitempty"`
	WindowSeconds int                      `json:"windowSeconds"`
	ResetAt       *time.Time               `json:"resetAt,omitempty"`
	SyncedAt      *time.Time               `json:"syncedAt,omitempty"`
	Source        string                   `json:"source"`
}

// modelQuotaBlockResponse 表示账号整体可用但某个模型仍处于额度封锁。
type modelQuotaBlockResponse struct {
	Model         string     `json:"model"`
	Reason        string     `json:"reason"`
	CooldownUntil *time.Time `json:"cooldownUntil,omitempty"`
}

type quotaBreakdownResponse struct {
	ProductCode  int     `json:"productCode"`
	UsagePercent float64 `json:"usagePercent"`
}

type billingResponse struct {
	PlanCode             string                   `json:"planCode,omitempty"`
	PlanName             string                   `json:"planName,omitempty"`
	MonthlyLimit         float64                  `json:"monthlyLimit"`
	Used                 float64                  `json:"used"`
	Remaining            float64                  `json:"remaining"`
	OnDemandCap          float64                  `json:"onDemandCap"`
	OnDemandUsed         float64                  `json:"onDemandUsed"`
	PrepaidBalance       float64                  `json:"prepaidBalance"`
	CreditUsagePercent   float64                  `json:"creditUsagePercent"`
	IsUnifiedBillingUser bool                     `json:"isUnifiedBillingUser"`
	OnDemandEnabled      *bool                    `json:"onDemandEnabled,omitempty"`
	TopUpMethod          string                   `json:"topUpMethod,omitempty"`
	UsagePeriodType      string                   `json:"usagePeriodType,omitempty"`
	UsagePeriodStart     string                   `json:"usagePeriodStart,omitempty"`
	UsagePeriodEnd       string                   `json:"usagePeriodEnd,omitempty"`
	BillingPeriodStart   string                   `json:"billingPeriodStart,omitempty"`
	BillingPeriodEnd     string                   `json:"billingPeriodEnd,omitempty"`
	History              []billingHistoryResponse `json:"history,omitempty"`
	SyncedAt             time.Time                `json:"syncedAt"`
}

type billingHistoryResponse struct {
	Year         int     `json:"year"`
	Month        int     `json:"month"`
	PeriodType   string  `json:"periodType,omitempty"`
	PeriodStart  string  `json:"periodStart,omitempty"`
	PeriodEnd    string  `json:"periodEnd,omitempty"`
	IncludedUsed float64 `json:"includedUsed"`
	OnDemandUsed float64 `json:"onDemandUsed"`
	TotalUsed    float64 `json:"totalUsed"`
}

type quotaResponse struct {
	Type            string     `json:"type"`
	Source          string     `json:"source"`
	Confidence      string     `json:"confidence"`
	Unit            string     `json:"unit,omitempty"`
	Used            float64    `json:"used"`
	Limit           float64    `json:"limit"`
	Remaining       float64    `json:"remaining"`
	UsagePercent    float64    `json:"usagePercent"`
	LimitKnown      bool       `json:"limitKnown"`
	WindowHours     int        `json:"windowHours,omitempty"`
	Observed        bool       `json:"observed"`
	Confirmed       bool       `json:"confirmed"`
	Status          string     `json:"status"`
	PeriodStart     string     `json:"periodStart,omitempty"`
	PeriodEnd       string     `json:"periodEnd,omitempty"`
	ExhaustedAt     *time.Time `json:"exhaustedAt,omitempty"`
	NextProbeAt     *time.Time `json:"nextProbeAt,omitempty"`
	LastConfirmedAt *time.Time `json:"lastConfirmedAt,omitempty"`
	// ModelQuotaBlocks 仅在存在未过期模型级封锁时输出，保持 omitempty 语义。
	ModelQuotaBlocks []modelQuotaBlockResponse `json:"modelQuotaBlocks,omitempty"`
}
