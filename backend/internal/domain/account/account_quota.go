package account

import "time"

type QuotaSource string

const (
	QuotaSourceDefault   QuotaSource = "default"
	QuotaSourceEstimated QuotaSource = "estimated"
	QuotaSourceUpstream  QuotaSource = "upstream"
)

const (
	QuotaModeWebImagePro  = "image_pro"
	QuotaModeWebImageEdit = "image_edit"
	QuotaModeWebVideo     = "video"
	QuotaModeWebVideo720p = "video_720p"
	QuotaGroupWebImagine  = "web_imagine"
)

func WebImagineQuotaModes() []string {
	return []string{QuotaModeWebImagePro, QuotaModeWebImageEdit, QuotaModeWebVideo, QuotaModeWebVideo720p}
}

func IsWebImagineQuotaMode(mode string) bool {
	switch mode {
	case QuotaModeWebImagePro, QuotaModeWebImageEdit, QuotaModeWebVideo, QuotaModeWebVideo720p:
		return true
	default:
		return false
	}
}

// QuotaWindow 表示 Provider 单个模式的额度窗口。
type QuotaWindow struct {
	AccountID     uint64
	Mode          string
	Remaining     int
	Total         int
	UsagePercent  float64
	Breakdown     []QuotaBreakdown
	WindowSeconds int
	ResetAt       *time.Time
	SyncedAt      *time.Time
	Source        QuotaSource
	UpdatedAt     time.Time
}

// QuotaBreakdown 保存上游周额度中的产品枚举及其使用百分比。
type QuotaBreakdown struct {
	ProductCode  int
	UsagePercent float64
}

const (
	QuotaProductThirdParty = 0
	QuotaProductAPI        = 1
	QuotaProductBuild      = 2
	QuotaProductPlugins    = 3
	QuotaProductChat       = 4
	QuotaProductImagine    = 5
	QuotaProductVoice      = 6
)

type QuotaRecoveryEvent struct {
	AccountID  uint64
	Mode       string
	DueAt      time.Time
	Attempts   int
	ClaimToken string
}

// QuotaRecoveryKind 区分需要真实流量探测的 Free 额度和需要 Billing 探测的付费账期。
type QuotaRecoveryKind string

const (
	QuotaRecoveryKindFree QuotaRecoveryKind = "free"
	QuotaRecoveryKindPaid QuotaRecoveryKind = "paid"
)

// QuotaRecoveryStatus 表示 Free 额度耗尽后的持久化恢复状态。
type QuotaRecoveryStatus string

const (
	QuotaRecoveryStatusActive    QuotaRecoveryStatus = "active"
	QuotaRecoveryStatusExhausted QuotaRecoveryStatus = "exhausted"
	QuotaRecoveryStatusProbing   QuotaRecoveryStatus = "probing"
)

// QuotaRecovery 保存额度耗尽后的单次恢复探测状态。
type QuotaRecovery struct {
	AccountID       uint64
	Kind            QuotaRecoveryKind
	Status          QuotaRecoveryStatus
	ConfirmedUsed   int64
	ConfirmedLimit  int64
	ExhaustedAt     *time.Time
	NextProbeAt     *time.Time
	LastConfirmedAt *time.Time
	UpdatedAt       time.Time
}
