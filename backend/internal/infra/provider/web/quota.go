package web

import (
	"context"
	"errors"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

const weeklyQuotaMode = "weekly"

func (a *Adapter) SyncQuota(ctx context.Context, credential account.Credential) (provider.QuotaSnapshot, error) {
	chatWindows := make([]account.QuotaWindow, 0, 2)
	autoWindow, autoErr := a.SyncQuotaMode(ctx, credential, "auto")
	if errors.Is(autoErr, provider.ErrUnauthorized) {
		return provider.QuotaSnapshot{}, autoErr
	}
	if autoErr == nil {
		chatWindows = append(chatWindows, autoWindow)
	}
	fastWindow, fastErr := a.SyncQuotaMode(ctx, credential, "fast")
	if errors.Is(fastErr, provider.ErrUnauthorized) {
		return provider.QuotaSnapshot{}, fastErr
	}
	if fastErr == nil {
		chatWindows = append(chatWindows, fastWindow)
	}
	imagineSnapshot, imagineErr := a.SyncQuotaGroup(ctx, credential, account.QuotaGroupWebImagine)
	if imagineErr != nil {
		// A full refresh replaces every stored window. Never return a partial
		// snapshot, otherwise a transient Imagine failure would erase the last
		// known authoritative media quotas.
		return provider.QuotaSnapshot{}, imagineErr
	}
	if len(chatWindows) > 0 {
		return a.chatQuotaSnapshot(ctx, credential, chatWindows, imagineSnapshot)
	}
	// 模式端点暂不可用时，仅已确认的付费账号允许用 weekly 兜底；
	// Basic/Auto 不能凭周额度探测提权，也不应制造无意义的付费端点流量。
	if credential.WebTier == account.WebTierSuper || credential.WebTier == account.WebTierHeavy {
		return a.paidWeeklyQuotaSnapshot(ctx, credential, imagineSnapshot)
	}
	if fastErr != nil {
		return provider.QuotaSnapshot{}, fastErr
	}
	return provider.QuotaSnapshot{}, autoErr
}

// chatQuotaSnapshot 在拿到模式额度后确定套餐等级，付费账号改为使用权威周池窗口。
func (a *Adapter) chatQuotaSnapshot(ctx context.Context, credential account.Credential, chatWindows []account.QuotaWindow, imagineSnapshot provider.QuotaGroupSnapshot) (provider.QuotaSnapshot, error) {
	tier, _ := resolveWebTierFromQuota(credential.WebTier, chatWindows, false)
	var windows []account.QuotaWindow
	// Basic/未知账号没有付费周池，避免为每次完整同步额外访问付费端点。
	// 只有模式额度已经确认付费等级时才读取 weekly 作为权威额度。
	if tier == account.WebTierSuper || tier == account.WebTierHeavy {
		weekly, weeklyErr := a.syncWeeklyCredits(ctx, credential)
		if weeklyErr != nil {
			// Paid Web routing is governed by the shared weekly pool. Returning a
			// partial successful snapshot would make the application replace and
			// erase the last authoritative weekly window.
			return provider.QuotaSnapshot{}, weeklyErr
		}
		// 周池覆盖 chat 模式窗口，但保留 imagine 窗口供前端展示与触顶判定。
		kept := make([]account.QuotaWindow, 0, 1+len(imagineSnapshot.Windows))
		kept = append(kept, weekly)
		kept = append(kept, imagineSnapshot.Windows...)
		windows = kept
	}
	if windows == nil {
		windows = append(chatWindows, imagineSnapshot.Windows...)
	}
	return provider.QuotaSnapshot{Tier: tier, Windows: windows, SyncedAt: time.Now().UTC()}, nil
}

// paidWeeklyQuotaSnapshot 用权威周池构造快照，失败时按原语义返回错误而不返回部分快照。
func (a *Adapter) paidWeeklyQuotaSnapshot(ctx context.Context, credential account.Credential, imagineSnapshot provider.QuotaGroupSnapshot) (provider.QuotaSnapshot, error) {
	weekly, weeklyErr := a.syncWeeklyCredits(ctx, credential)
	if weeklyErr != nil {
		return provider.QuotaSnapshot{}, weeklyErr
	}
	kept := append([]account.QuotaWindow{weekly}, imagineSnapshot.Windows...)
	return provider.QuotaSnapshot{Tier: credential.WebTier, Windows: kept, SyncedAt: time.Now().UTC()}, nil
}

func resolveWebTierFromQuota(current account.WebTier, windows []account.QuotaWindow, weeklyAvailable bool) (account.WebTier, bool) {
	if len(windows) > 0 {
		tier, known := inferWebTierFromQuota(windows)
		if !known {
			// 上游可能随时调整额度。无法识别的新形态保持 Auto，并由路由层
			// 按 Basic 的最小权限处理；不能伪造一个已确认的套餐等级。
			return account.WebTierAuto, false
		}
		return tier, weeklyAvailable && tier != account.WebTierBasic
	}
	// 周额度是付费账号信号，但无法区分 Super/Heavy。已确认的等级在模式
	// 额度暂时不可用时保留；未确认（Auto/Basic）的不能凭周额度提权。
	if current == account.WebTierHeavy || current == account.WebTierSuper {
		return current, weeklyAvailable
	}
	return current, false
}

// inferWebTierFromQuota 使用 Grok Web /rest/rate-limits 的真实额度形态判级。
// 同一快照出现矛盾信号时选择较低等级，避免把 Basic 账号路由到付费能力。
func inferWebTierFromQuota(windows []account.QuotaWindow) (account.WebTier, bool) {
	detected := account.WebTierAuto
	rank := map[account.WebTier]int{
		account.WebTierBasic: 1,
		account.WebTierSuper: 2,
		account.WebTierHeavy: 3,
	}
	for _, window := range windows {
		candidate := account.WebTierAuto
		switch window.Mode {
		case "auto":
			switch window.Total {
			case 7, 20:
				candidate = account.WebTierBasic
			case 50:
				candidate = account.WebTierSuper
			case 150:
				candidate = account.WebTierHeavy
			}
		case "fast":
			switch window.Total {
			case 30:
				candidate = account.WebTierBasic
			case 140:
				candidate = account.WebTierSuper
			case 400:
				candidate = account.WebTierHeavy
			}
		case "heavy":
			if window.Total > 0 {
				candidate = account.WebTierHeavy
			}
		}
		if candidate != account.WebTierAuto && (detected == account.WebTierAuto || rank[candidate] < rank[detected]) {
			detected = candidate
		}
	}
	return detected, detected != account.WebTierAuto
}
