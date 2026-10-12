package account

import (
	"strings"
	"time"
)

type BillingHistoryEntry struct {
	Year         int
	Month        int
	PeriodType   string
	PeriodStart  string
	PeriodEnd    string
	IncludedUsed float64
	OnDemandUsed float64
	TotalUsed    float64
}

// Billing 表示账号最近一次额度快照。
type Billing struct {
	AccountID            uint64
	PlanCode             string
	PlanName             string
	MonthlyLimit         float64
	Used                 float64
	OnDemandCap          float64
	OnDemandUsed         float64
	PrepaidBalance       float64
	CreditUsagePercent   float64
	IsUnifiedBillingUser bool
	OnDemandEnabled      *bool
	TopUpMethod          string
	UsagePeriodType      string
	UsagePeriodStart     string
	UsagePeriodEnd       string
	BillingPeriodStart   string
	BillingPeriodEnd     string
	History              []BillingHistoryEntry
	SyncedAt             time.Time
}

// PeriodEnd 返回上游账期结束时间，无法解析时返回 false。
func (b Billing) PeriodEnd() (time.Time, bool) {
	if b.CreditUsagePercent >= 100 {
		if value, ok := parseBillingTime(b.UsagePeriodEnd); ok {
			return value, true
		}
	}
	return parseBillingTime(b.BillingPeriodEnd)
}

func parseBillingTime(raw string) (time.Time, bool) {
	if raw == "" {
		return time.Time{}, false
	}
	value, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}, false
	}
	return value.UTC(), true
}

// Remaining 返回当前月剩余额度。
func (b Billing) Remaining() float64 {
	remaining := b.MonthlyLimit - b.Used
	if remaining < 0 {
		return 0
	}
	return remaining
}

// IsPaid 判断 Billing 快照是否呈现 Super/paid 信号。
// 语义与 SQL accountPaidBillingPredicate 及 QuotaView paid 分支一致：
// 已确认的付费订阅名称，或任一付费额度字段为正，即为 paid。
// creditUsagePercent 只是当前周期使用率，Free 与 paid 都可能存在，不能参与判级。
// 无快照时应由调用方按 Unknown 处理，不得调用本方法。
// 注意：零 Billing + 管理员确认的 BuildSuperEntitled 由 IsBuildSuper 统一判定，不经本方法。
func (b Billing) IsPaid() bool {
	return isPaidBillingPlan(b.PlanCode) || isPaidBillingPlan(b.PlanName) ||
		b.MonthlyLimit > 0 || b.OnDemandCap > 0 || b.OnDemandUsed > 0 || b.PrepaidBalance > 0
}

// HasFreeProfileSignal accepts an explicit Free or Basic plan name.
func (b Billing) HasFreeProfileSignal() bool {
	return isFreeBillingPlan(b.PlanCode) || isFreeBillingPlan(b.PlanName)
}

// HasInferredFreeProfileSignal accepts a successful zero-value billing snapshot
// with no plan name. The upstream omits the Free plan name in this response.
// A non-zero usage or paid balance remains unknown unless another Free signal
// is available, preventing ordinary weekly billing from being misclassified.
func (b Billing) HasInferredFreeProfileSignal() bool {
	if b.SyncedAt.IsZero() || strings.TrimSpace(b.PlanCode) != "" || strings.TrimSpace(b.PlanName) != "" {
		return false
	}
	return b.MonthlyLimit == 0 && b.Used == 0 &&
		b.OnDemandCap == 0 && b.OnDemandUsed == 0 &&
		b.PrepaidBalance == 0 && b.CreditUsagePercent == 0
}

func normalizeBillingPlan(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.NewReplacer(" ", "", "_", "", "-", "", "+", "plus").Replace(value)
}

func isPaidBillingPlan(value string) bool {
	normalized := normalizeBillingPlan(value)
	switch normalized {
	case "super", "supergrok", "supergrokpro", "supergrokheavy", "supergroklite", "supergrokplus",
		"grokpro", "xpremium", "xpremiumplus", "apikey":
		return true
	default:
		// SuperGrok Plus and later SuperGrok* tiers should stay paid even when
		// weekly numeric limits are zero and the exact plan name is new.
		return strings.HasPrefix(normalized, "supergrok")
	}
}

func isFreeBillingPlan(value string) bool {
	switch normalizeBillingPlan(value) {
	case "free", "grokfree", "freetier", "basic", "grokbasic", "xbasic":
		return true
	default:
		return false
	}
}

// IsBuildSuper 判定 Grok Build 账号是否为 Super：Billing IsPaid 或管理员确认 BuildSuperEntitled。
// 非 Build Provider 恒为 false。与 SQL accountBuildSuperPredicate 语义一致。
func IsBuildSuper(credential Credential, billing *Billing) bool {
	if credential.Provider != ProviderBuild {
		return false
	}
	if credential.BuildSuperEntitled {
		return true
	}
	return billing != nil && billing.IsPaid()
}

// IsKnownFreeBuild 判断候选是否是已确认的 Grok Build Free 账号。
// Super（Billing paid 或 BuildSuperEntitled）优先，避免旧的响应模型或恢复记录把 Super 错分为 Free。
func (c RoutingCandidate) IsKnownFreeBuild() bool {
	if c.Credential.Provider != ProviderBuild {
		return false
	}
	if IsBuildSuper(c.Credential, c.Billing) {
		return false
	}
	if c.QuotaRecovery != nil && c.QuotaRecovery.Kind == QuotaRecoveryKindFree {
		return true
	}
	if strings.HasSuffix(strings.ToLower(strings.TrimSpace(c.Credential.ObservedModel)), "-build-free") {
		return true
	}
	return c.Billing != nil && (c.Billing.HasFreeProfileSignal() || c.Billing.HasInferredFreeProfileSignal())
}

// IsExhausted 判断额度快照是否已达到账号保留阈值。
func (b Billing) IsExhausted(minimum float64) bool {
	if b.MonthlyLimit > 0 && b.Remaining() <= minimum {
		return true
	}
	return b.CreditUsagePercent >= 100 && (b.OnDemandCap > 0 || b.UsagePeriodType != "")
}
