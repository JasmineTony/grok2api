package account

import (
	"context"
	"sync"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

const permanentRefreshExpiredReason = "OAuth refresh token 已永久失效且 access token 已过期"
const buildBotFlagCacheKey = "build-bot-flagged-account-ids"

type buildBotFlagIndexRepository interface {
	ListBuildBotFlaggedAccountIDs(ctx context.Context) ([]uint64, error)
	ListBuildBotFlagCredentialBatch(ctx context.Context, afterID uint64, limit int) ([]repository.BuildBotFlagCredential, error)
	UpdateBuildBotFlagSources(ctx context.Context, values []repository.BuildBotFlagSourceUpdate) error
	CountBuildBotFlagged(ctx context.Context) (int64, error)
	CountAvailableBuildBotFlagged(ctx context.Context, now time.Time) (int64, error)
}

type quotaRefreshState struct {
	generation          uint64
	publishedGeneration uint64
	sharedGeneration    uint64
	queued              bool
	running             bool
	pending             bool
	failures            int
	nextAttemptAt       time.Time
}

type observedModelState struct {
	model       string
	persistedAt time.Time
}

type observedModelShard struct {
	sync.Mutex
	values        map[uint64]observedModelState
	lastCleanupAt time.Time
}

type quotaRefreshRequest struct {
	key       string
	accountID uint64
	mode      string
}

type quotaRefreshResult struct {
	Credential accountdomain.Credential
	Windows    []accountdomain.QuotaWindow
	Modes      []string
}

type QuotaRefreshStats struct {
	Pending int
	Queued  int
	Running int
}

type QuotaType string
type QuotaStatus string

const (
	QuotaTypeUnknown        QuotaType   = "unknown"
	QuotaTypeFree           QuotaType   = "free"
	QuotaTypePaid           QuotaType   = "paid"
	QuotaStatusActive       QuotaStatus = "active"
	QuotaStatusWaitingReset QuotaStatus = "waitingReset"
	QuotaStatusProbing      QuotaStatus = "probing"
)

type QuotaView struct {
	Type            QuotaType
	Source          string
	Confidence      string
	Unit            string
	Used            float64
	Limit           float64
	Remaining       float64
	UsagePercent    float64
	LimitKnown      bool
	WindowHours     int
	Observed        bool
	Confirmed       bool
	Status          QuotaStatus
	PeriodStart     string
	PeriodEnd       string
	ExhaustedAt     *time.Time
	NextProbeAt     *time.Time
	LastConfirmedAt *time.Time
}

type View struct {
	Credential         accountdomain.Credential
	Billing            *accountdomain.Billing
	Quota              QuotaView
	QuotaWindows       []accountdomain.QuotaWindow
	ModelQuotaBlocks   []accountdomain.ModelQuotaBlock
	BuildBotFlagged    bool
	BuildBotFlagSource int
	// EnabledChanged is request-scoped update metadata. It is not persisted or
	// serialized directly; the HTTP layer uses it to avoid warning when a PATCH
	// merely repeats the account's existing enabled value.
	EnabledChanged bool
}

type UpdateInput struct {
	Name                   *string
	Enabled                *bool
	Priority               *int
	MaxConcurrent          *int
	MinimumRemaining       *float64
	CloudflareCookies      *string
	ClearCloudflareCookies bool
	// BuildSuperEntitled 仅 grok_build 可设置；非 Build 返回业务错误。
	BuildSuperEntitled *bool
	// BuildRouteMode 仅 grok_build 可设置；nil 表示不修改。
	BuildRouteMode *accountdomain.BuildRouteMode
}

type CleanupStatus string

const (
	CleanupStatusCooldown       CleanupStatus = "cooldown"
	CleanupStatusDisabled       CleanupStatus = "disabled"
	CleanupStatusReauthRequired CleanupStatus = "reauthRequired"
)

type DeviceStartResult struct {
	SessionID               string
	UserCode                string
	VerificationURI         string
	VerificationURIComplete string
	Interval                time.Duration
	ExpiresAt               time.Time
}

type ImportResult struct {
	Created    int
	Updated    int
	Skipped    int
	Failed     int
	AccountIDs []uint64
}

type BuildConversionStrategy string

const (
	BuildConversionAll     BuildConversionStrategy = "all"
	BuildConversionMissing BuildConversionStrategy = "missing"
)

type WebConsoleSyncStrategy string

const (
	WebConsoleSyncAll     WebConsoleSyncStrategy = "all"
	WebConsoleSyncMissing WebConsoleSyncStrategy = "missing"
)

type ImportedAccountObserver func(accountID uint64) error

// BatchProgressObserver 在单个账号任务结束后报告批次完成数。
type BatchProgressObserver func(completed, total int) error

// BuildDetectOutcome 描述单次 Grok Build 可用性探测结果。
type BuildDetectOutcome string

const (
	// BuildDetectOutcomeOK 表示探测成功，账号可用。
	BuildDetectOutcomeOK BuildDetectOutcome = "ok"
	// BuildDetectOutcomeInvalid 表示已确认失效并标 reauthRequired。
	BuildDetectOutcomeInvalid BuildDetectOutcome = "invalid"
	// BuildDetectOutcomeFailed 表示探测失败但未判定为永久失效（网络/5xx/临时额度等）。
	BuildDetectOutcomeFailed BuildDetectOutcome = "failed"
)

// BuildDetectItemResult 是单账号探测的结构化结果，供 SSE 增量推送。
type BuildDetectItemResult struct {
	AccountID  uint64
	Name       string
	Email      string
	Outcome    BuildDetectOutcome
	Reason     string
	HTTPStatus int
}

// BuildDetectItemObserver 在单个账号探测完成后推送明细；返回错误会取消批次。
type BuildDetectItemObserver func(item BuildDetectItemResult) error

type ExportResult struct {
	Data  []byte
	Count int
}

type ExportPageResult struct {
	ExportResult
	NextID        uint64
	SnapshotMaxID uint64
	HasMore       bool
}

type BuildConversionResult struct {
	Created         int
	Linked          int
	Skipped         int
	Failed          int
	BuildAccountIDs []uint64
}

type ListFilter struct {
	Provider  string
	QuotaType string
	Status    string
	Egress    string
	Renewal   string
	Risk      string
	// Agreement applies only to grok_web accounts.
	Agreement string
	// Association values are provider-specific: Web supports build, console, and combined filters;
	// Build and Console support only webLinked and webUnlinked.
	Association string
	Sort        repository.SortQuery
}

type Summary struct {
	Total      int64
	Available  int64
	Recovering int64
	Attention  int64
	Risk       int64
	Providers  map[string]ProviderSummary
	Recovery   RecoverySummary
	Issues     IssueSummary
}

type ProviderSummary struct {
	Total     int64
	Available int64
}

type RecoverySummary struct {
	Cooldown     int64
	WaitingReset int64
	Probing      int64
}

type IssueSummary struct {
	Disabled       int64
	ReauthRequired int64
}
