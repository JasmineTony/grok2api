package relational

import (
	"context"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
)

// listActiveProviderAccountRows avoids GORM association preloads for complete
// provider pools. Preload expands every parent key into an IN list and exceeds
// SQLite's variable limit for large pools. The fixed-shape JOIN queries below
// remain valid for both SQLite and PostgreSQL regardless of pool size.
func (r *AccountRepository) listActiveProviderAccountRows(ctx context.Context, provider account.Provider, credentialColumns []string) ([]accountModel, error) {
	var rows []accountModel
	if err := r.db.db.WithContext(ctx).
		Where("provider = ? AND enabled = ? AND auth_status = ?", provider, true, account.AuthStatusActive).
		Order("priority DESC, id ASC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return rows, nil
	}
	positions := make(map[uint64]int, len(rows))
	for index := range rows {
		positions[rows[index].ID] = index
	}
	if err := r.attachProviderCredentialRows(ctx, provider, credentialColumns, rows, positions); err != nil {
		return nil, err
	}
	if err := r.attachProviderWebProfileRows(ctx, provider, rows, positions); err != nil {
		return nil, err
	}
	return rows, nil
}

// attachProviderCredentialRows 用一次固定形状的 JOIN 查询把凭据行按账号回填到已加载的账号行。
func (r *AccountRepository) attachProviderCredentialRows(ctx context.Context, provider account.Provider, credentialColumns []string, rows []accountModel, positions map[uint64]int) error {
	credentialSelect := "credential.*"
	if len(credentialColumns) > 0 {
		credentialSelect = qualifiedColumnList("credential", credentialColumns)
	}
	var credentials []accountCredentialModel
	if err := r.db.db.WithContext(ctx).
		Table("account_credentials AS credential").
		Select(credentialSelect).
		Joins("JOIN provider_accounts AS account ON account.id = credential.account_id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ?", provider, true, account.AuthStatusActive).
		Find(&credentials).Error; err != nil {
		return err
	}
	for index := range credentials {
		if position, ok := positions[credentials[index].AccountID]; ok {
			rows[position].Credential = &credentials[index]
		}
	}
	return nil
}

// attachProviderWebProfileRows 仅 Web 号池需要回填 Web 资料行。
func (r *AccountRepository) attachProviderWebProfileRows(ctx context.Context, provider account.Provider, rows []accountModel, positions map[uint64]int) error {
	if provider != account.ProviderWeb {
		return nil
	}
	var profiles []webAccountProfileModel
	if err := r.db.db.WithContext(ctx).
		Table("web_account_profiles AS profile").
		Select("profile.*").
		Joins("JOIN provider_accounts AS account ON account.id = profile.account_id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ?", provider, true, account.AuthStatusActive).
		Find(&profiles).Error; err != nil {
		return err
	}
	for index := range profiles {
		if position, ok := positions[profiles[index].AccountID]; ok {
			rows[position].WebProfile = &profiles[index]
		}
	}
	return nil
}

func qualifiedColumnList(alias string, columns []string) string {
	qualified := make([]string, 0, len(columns))
	for _, column := range columns {
		qualified = append(qualified, alias+"."+column)
	}
	return strings.Join(qualified, ", ")
}

// routingCredentialMetadataColumns contains all credential fields used for
// routing and execution decisions, but deliberately excludes the encrypted
// access token, refresh token, and Cloudflare cookie.
var routingCredentialMetadataColumns = []string{
	"account_id", "auth_type", "client_id", "expires_at", "refresh_due_at", "last_refresh_at",
	"refresh_failures", "last_refresh_error", "refresh_permanent", "build_bot_flag_source", "updated_at",
}

var routingBillingColumns = []string{
	"account_id", "plan_code", "plan_name", "monthly_limit", "used", "on_demand_cap", "on_demand_used", "prepaid_balance",
	"credit_usage_percent", "is_unified_billing_user", "on_demand_enabled", "top_up_method", "usage_period_type",
	"usage_period_start", "usage_period_end", "billing_period_start", "billing_period_end", "synced_at",
}

func (r *AccountRepository) getRoutingBillings(ctx context.Context, provider account.Provider) (map[uint64]account.Billing, error) {
	result := make(map[uint64]account.Billing)
	var rows []billingModel
	if err := r.db.db.WithContext(ctx).
		Table("account_billing_snapshots AS billing").
		Select(qualifiedColumnList("billing", routingBillingColumns)).
		Joins("JOIN provider_accounts AS account ON account.id = billing.account_id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ?", provider, true, account.AuthStatusActive).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.AccountID] = toRoutingBillingDomain(row)
	}
	return result, nil
}

func (r *AccountRepository) getRoutingQuotaRecoveries(ctx context.Context, provider account.Provider) (map[uint64]account.QuotaRecovery, error) {
	result := make(map[uint64]account.QuotaRecovery)
	var rows []quotaRecoveryModel
	if err := r.db.db.WithContext(ctx).
		Table("account_quota_recovery AS recovery").
		Select("recovery.*").
		Joins("JOIN provider_accounts AS account ON account.id = recovery.account_id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ?", provider, true, account.AuthStatusActive).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.AccountID] = account.QuotaRecovery{
			AccountID: row.AccountID, Kind: account.QuotaRecoveryKind(row.Kind), Status: account.QuotaRecoveryStatus(row.Status), ConfirmedUsed: row.ConfirmedUsed,
			ConfirmedLimit: row.ConfirmedLimit, ExhaustedAt: row.ExhaustedAt, NextProbeAt: row.NextProbeAt,
			LastConfirmedAt: row.LastConfirmedAt, UpdatedAt: row.UpdatedAt,
		}
	}
	return result, nil
}

var routingQuotaWindowColumns = []string{
	"account_id", "mode", "remaining", "total", "usage_percent", "window_seconds", "reset_at", "synced_at", "source", "updated_at",
}

func (r *AccountRepository) getRoutingQuotaWindows(ctx context.Context, provider account.Provider, quotaMode string, credentials []account.Credential) (map[uint64]account.QuotaWindow, error) {
	result := make(map[uint64]account.QuotaWindow)
	if provider != account.ProviderWeb && quotaMode == "" {
		return result, nil
	}
	modes := routingQuotaWindowModes(provider, quotaMode)
	webImagineMode := provider == account.ProviderWeb && account.IsWebImagineQuotaMode(quotaMode)
	rows, err := r.loadRoutingQuotaWindowRows(ctx, provider, modes)
	if err != nil {
		return nil, err
	}
	webTiers := make(map[uint64]account.WebTier, len(credentials))
	for _, credential := range credentials {
		webTiers[credential.ID] = credential.WebTier
	}
	for _, row := range rows {
		mergeRoutingQuotaWindow(result, row, webTiers[row.AccountID], quotaMode, webImagineMode)
	}
	return result, nil
}

// routingQuotaWindowModes 计算需要加载的额度窗口模式：Web 始终加载共享周窗口，
// Imagine 额外加载产品窗口，最后叠加调用方指定的模式。
func routingQuotaWindowModes(provider account.Provider, quotaMode string) []string {
	modes := make([]string, 0, 3)
	// Paid Web routes use the shared weekly pool. Imagine may additionally
	// expose a product-specific remainingQueries window (notably for Basic and
	// older response shapes); load both and prefer the exact product window
	// below, falling back to weekly only for confirmed Super/Heavy accounts.
	if provider == account.ProviderWeb {
		modes = append(modes, "weekly")
	}
	if provider == account.ProviderWeb && quotaMode == account.QuotaModeWebImageEdit {
		// Basic Web accounts use image_pro for editing, while Super/Heavy
		// accounts have the dedicated image_edit product. Load both once and
		// select the authoritative window per account below.
		modes = append(modes, account.QuotaModeWebImagePro)
	}
	if quotaMode != "" {
		modes = append(modes, quotaMode)
	}
	return modes
}

// loadRoutingQuotaWindowRows 按固定形状的 JOIN 加载指定模式下的额度窗口行。
func (r *AccountRepository) loadRoutingQuotaWindowRows(ctx context.Context, provider account.Provider, modes []string) ([]quotaWindowModel, error) {
	var rows []quotaWindowModel
	if err := r.db.db.WithContext(ctx).
		Table("account_quota_windows AS quota").
		Select(qualifiedColumnList("quota", routingQuotaWindowColumns)).
		Joins("JOIN provider_accounts AS account ON account.id = quota.account_id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ? AND quota.mode IN ?", provider, true, account.AuthStatusActive, modes).
		Order("CASE WHEN quota.mode = 'weekly' THEN 0 ELSE 1 END").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

// mergeRoutingQuotaWindow 按账号合并单个额度窗口行；Imagine 场景优先精确产品窗口，
// 只在确认的 Super/Heavy 账号上回退到共享周窗口。
func mergeRoutingQuotaWindow(result map[uint64]account.QuotaWindow, row quotaWindowModel, tier account.WebTier, quotaMode string, webImagineMode bool) {
	if !webImagineMode {
		if _, exists := result[row.AccountID]; !exists {
			result[row.AccountID] = toRoutingQuotaWindowDomain(row)
		}
		return
	}
	productMode := quotaMode
	if quotaMode == account.QuotaModeWebImageEdit {
		productMode = webImageEditRoutingQuotaMode(tier)
	}
	switch {
	case row.Mode == productMode:
		// An explicit product window is more precise than the shared pool,
		// regardless of query order.
		result[row.AccountID] = toRoutingQuotaWindowDomain(row)
	case row.Mode == "weekly" && (tier == account.WebTierSuper || tier == account.WebTierHeavy):
		if existing, exists := result[row.AccountID]; !exists || existing.Mode != productMode {
			result[row.AccountID] = toRoutingQuotaWindowDomain(row)
		}
	}
}

func webImageEditRoutingQuotaMode(tier account.WebTier) string {
	switch tier {
	case account.WebTierSuper, account.WebTierHeavy:
		return account.QuotaModeWebImageEdit
	default:
		// Empty and auto tiers are deliberately treated as Basic, matching the
		// Web adapter's conservative capability normalization.
		return account.QuotaModeWebImagePro
	}
}

func toRoutingQuotaWindowDomain(row quotaWindowModel) account.QuotaWindow {
	return account.QuotaWindow{
		AccountID: row.AccountID, Mode: row.Mode, Remaining: row.Remaining, Total: row.Total,
		UsagePercent: row.UsagePercent, WindowSeconds: row.WindowSeconds,
		ResetAt: row.ResetAt, SyncedAt: row.SyncedAt, Source: account.QuotaSource(row.Source), UpdatedAt: row.UpdatedAt,
	}
}
