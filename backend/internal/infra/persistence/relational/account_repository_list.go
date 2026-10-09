package relational

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
)

func (r *AccountRepository) List(ctx context.Context, input repository.AccountListQuery) ([]account.Credential, int64, error) {
	var total int64
	query := r.db.db.WithContext(ctx).Model(&accountModel{})
	if input.Filter.Provider != "" {
		query = query.Where("provider = ?", input.Filter.Provider)
	}
	if search := strings.TrimSpace(input.Page.Search); search != "" {
		if id, err := strconv.ParseUint(strings.TrimPrefix(search, "#"), 10, 64); strings.HasPrefix(search, "#") && err == nil && id > 0 {
			// #ID 是管理端名单使用的内部精确查询形式，走主键索引且不改变
			// 原有纯数字名称的模糊搜索语义。
			query = query.Where("provider_accounts.id = ?", id)
		} else {
			pattern := "%" + strings.ToLower(search) + "%"
			query = query.Where("LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(user_id) LIKE ? OR LOWER(team_id) LIKE ?", pattern, pattern, pattern, pattern)
		}
	}
	switch input.Filter.QuotaType {
	case "free":
		// Super（Billing paid 或 BuildSuperEntitled）不得落入 free；与 IsKnownFreeBuild / QuotaView 一致。
		query = query.Where("NOT " + accountBuildSuperPredicate + " AND (EXISTS (SELECT 1 FROM account_quota_recovery recovery WHERE recovery.account_id = provider_accounts.id AND recovery.kind = 'free') OR " + accountFreeSignalPredicate + ")")
	case "paid":
		query = query.Where(accountBuildSuperPredicate)
	case "unknown":
		query = query.Where("NOT " + accountRecoveryPredicate + " AND NOT " + accountBuildSuperPredicate + " AND NOT " + accountFreeSignalPredicate)
	case "auto", "basic", "super", "heavy":
		query = query.Where("EXISTS (SELECT 1 FROM web_account_profiles profile WHERE profile.account_id = provider_accounts.id AND profile.tier = ?)", input.Filter.QuotaType)
	}
	query = applyAccountStatusFilter(query, input.Filter.Status, input.Filter.Now)
	switch input.Filter.Egress {
	case "bound":
		query = query.Where("egress_node_id IS NOT NULL")
		if nodeID := input.Filter.EgressNodeID; nodeID > 0 {
			query = query.Where("egress_node_id = ?", nodeID)
		}
		if sourceID := input.Filter.EgressSourceID; sourceID > 0 {
			query = query.Where("EXISTS (SELECT 1 FROM egress_nodes node WHERE node.id = provider_accounts.egress_node_id AND node.source_id = ?)", sourceID)
		}
	case "unbound":
		query = query.Where("egress_node_id IS NULL")
	}
	if input.Filter.Refreshable != nil {
		if *input.Filter.Refreshable {
			query = query.Where("EXISTS (SELECT 1 FROM account_credentials credential WHERE credential.account_id = provider_accounts.id AND credential.encrypted_refresh <> '')")
		} else {
			query = query.Where("NOT EXISTS (SELECT 1 FROM account_credentials credential WHERE credential.account_id = provider_accounts.id AND credential.encrypted_refresh <> '')")
		}
	}
	switch input.Filter.Risk {
	case "flagged":
		query = query.Where("EXISTS (SELECT 1 FROM account_credentials credential WHERE credential.account_id = provider_accounts.id AND credential.build_bot_flag_source IN (1,2))")
	case "normal":
		query = query.Where("NOT EXISTS (SELECT 1 FROM account_credentials credential WHERE credential.account_id = provider_accounts.id AND credential.build_bot_flag_source IN (1,2))")
	}
	query = applyWebAgreementFilter(query, input.Filter.Agreement)
	query = applyAssociationFilter(query, input.Filter.Provider, input.Filter.Association)
	if input.Filter.RestrictIDs {
		if len(input.Filter.AccountIDs) == 0 {
			query = query.Where("1 = 0")
		} else {
			query = query.Where("provider_accounts.id IN ?", input.Filter.AccountIDs)
		}
	}
	if len(input.Filter.ExcludeIDs) > 0 {
		query = query.Where("provider_accounts.id NOT IN ?", input.Filter.ExcludeIDs)
	}
	if input.Filter.AfterID > 0 {
		query = query.Where("provider_accounts.id > ?", input.Filter.AfterID)
	}
	if input.Filter.ThroughID > 0 {
		query = query.Where("provider_accounts.id <= ?", input.Filter.ThroughID)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []accountModel
	query = applyStableSort(query, input.Page.Sort, map[string]sortSpec{
		"id":        {expression: "provider_accounts.id"},
		"name":      {expression: "LOWER(provider_accounts.name)"},
		"type":      {expression: accountTypeSortExpression},
		"status":    {expression: accountStatusSortExpression},
		"createdAt": {expression: "provider_accounts.created_at", defaultDirection: repository.SortDescending},
	}, sortSpec{expression: "provider_accounts.created_at", defaultDirection: repository.SortDescending}, "provider_accounts.id")
	if err := query.Preload("Credential").Preload("WebProfile").Offset(input.Page.Offset).Limit(input.Page.Limit).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	out := make([]account.Credential, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAccountDomain(row))
	}
	if err := r.attachAccountLinks(ctx, out); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func (r *AccountRepository) ListProviderAccountBatch(ctx context.Context, providerValue account.Provider, afterID uint64, limit int) ([]account.Credential, int64, error) {
	if limit < 1 {
		return []account.Credential{}, 0, nil
	}
	var total int64
	if afterID == 0 {
		if err := r.db.db.WithContext(ctx).Model(&accountModel{}).Where("provider = ?", providerValue).Count(&total).Error; err != nil {
			return nil, 0, err
		}
	}
	var rows []accountModel
	if err := r.db.db.WithContext(ctx).
		Preload("Credential").Preload("WebProfile").
		Where("provider = ? AND id > ?", providerValue, afterID).
		Order("id ASC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	out := make([]account.Credential, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAccountDomain(row))
	}
	if err := r.attachAccountLinks(ctx, out); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

// CountProviderAccountsByIDs 只校验账号主表归属，不加载额度、关联或审计数据。
func (r *AccountRepository) CountProviderAccountsByIDs(ctx context.Context, providerValue account.Provider, ids []uint64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var count int64
	err := r.db.db.WithContext(ctx).Model(&accountModel{}).
		Where("provider = ? AND id IN ?", providerValue, ids).
		Count(&count).Error
	return count, err
}

// CountAvailableAmong counts IDs that currently match Summarize's available predicate.
func (r *AccountRepository) CountAvailableAmong(ctx context.Context, providerValue account.Provider, ids []uint64, now time.Time) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	const batchSize = 500
	var total int64
	for start := 0; start < len(ids); start += batchSize {
		end := min(start+batchSize, len(ids))
		var count int64
		query := r.db.db.WithContext(ctx).Model(&accountModel{}).
			Where("provider = ? AND id IN ?", providerValue, ids[start:end])
		query = applyAccountStatusFilter(query, "active", now)
		if err := query.Count(&count).Error; err != nil {
			return 0, err
		}
		total += count
	}
	return total, nil
}

// CountBuildBotFlagged counts persisted Build risk metadata without loading an
// account-ID slice or credential material.
func (r *AccountRepository) CountBuildBotFlagged(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.db.WithContext(ctx).Model(&accountModel{}).
		Joins("JOIN account_credentials AS credential ON credential.account_id = provider_accounts.id").
		Where("provider_accounts.provider = ? AND credential.build_bot_flag_source IN (1,2)", account.ProviderBuild).
		Count(&count).Error
	return count, err
}

// CountAvailableBuildBotFlagged uses the same availability predicate as
// Summarize without expanding a potentially unbounded ID list.
func (r *AccountRepository) CountAvailableBuildBotFlagged(ctx context.Context, now time.Time) (int64, error) {
	var count int64
	query := r.db.db.WithContext(ctx).Model(&accountModel{}).
		Joins("JOIN account_credentials AS credential ON credential.account_id = provider_accounts.id").
		Where("provider_accounts.provider = ? AND credential.build_bot_flag_source IN (1,2)", account.ProviderBuild)
	query = applyAccountStatusFilter(query, "active", now)
	err := query.Count(&count).Error
	return count, err
}

// ListBuildBotFlaggedAccountIDs reads persisted non-sensitive metadata only; it
// never loads or decrypts access tokens on the scheduling path.
func (r *AccountRepository) ListBuildBotFlaggedAccountIDs(ctx context.Context) ([]uint64, error) {
	var ids []uint64
	err := r.db.db.WithContext(ctx).
		Table("provider_accounts AS account").
		Select("account.id").
		Joins("JOIN account_credentials AS credential ON credential.account_id = account.id").
		Where("account.provider = ? AND credential.build_bot_flag_source IN (1,2)", account.ProviderBuild).
		Order("account.id ASC").
		Scan(&ids).Error
	return ids, err
}

// ListBuildBotFlagCredentialBatch returns the minimum projection required for
// startup backfill of the persisted risk source.
func (r *AccountRepository) ListBuildBotFlagCredentialBatch(ctx context.Context, afterID uint64, limit int) ([]repository.BuildBotFlagCredential, error) {
	if limit < 1 {
		return []repository.BuildBotFlagCredential{}, nil
	}
	var rows []struct {
		AccountID            uint64
		EncryptedAccessToken string
		StoredSource         int
	}
	err := r.db.db.WithContext(ctx).
		Table("provider_accounts AS account").
		Select("account.id AS account_id, credential.encrypted_primary AS encrypted_access_token, credential.build_bot_flag_source AS stored_source").
		Joins("JOIN account_credentials AS credential ON credential.account_id = account.id").
		Where("account.provider = ? AND account.id > ?", account.ProviderBuild, afterID).
		Order("account.id ASC").Limit(limit).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make([]repository.BuildBotFlagCredential, 0, len(rows))
	for _, row := range rows {
		result = append(result, repository.BuildBotFlagCredential{
			AccountID: row.AccountID, EncryptedAccessToken: row.EncryptedAccessToken, StoredSource: row.StoredSource,
		})
	}
	return result, nil
}

// UpdateBuildBotFlagSources persists a bounded backfill batch transactionally.
func (r *AccountRepository) UpdateBuildBotFlagSources(ctx context.Context, values []repository.BuildBotFlagSourceUpdate) error {
	if len(values) == 0 {
		return nil
	}
	changed := false
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, value := range values {
			source := normalizeBuildBotFlagSource(account.ProviderBuild, value.Source)
			result := tx.Model(&accountCredentialModel{}).
				Where("account_id = ? AND encrypted_primary = ?", value.AccountID, value.ExpectedEncryptedAccessToken).
				Update("build_bot_flag_source", source)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected > 0 {
				changed = true
			}
		}
		return nil
	})
	if err == nil && changed {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountCredentialChanged, Provider: account.ProviderBuild})
	}
	return err
}

func (r *AccountRepository) Summarize(ctx context.Context, now time.Time) ([]repository.AccountSummary, error) {
	var rows []repository.AccountSummary
	selectFields := `
		provider,
		COUNT(*) AS total,
		SUM(CASE WHEN enabled = ? AND auth_status = ? AND NOT ` + accountRecoveryPredicate + ` AND NOT ` + providerQuotaExhaustedPredicate + ` AND (cooldown_until IS NULL OR cooldown_until <= ?) THEN 1 ELSE 0 END) AS available,
		SUM(CASE WHEN enabled = ? AND auth_status = ? AND NOT ` + accountRecoveryPredicate + ` AND NOT ` + providerQuotaExhaustedPredicate + ` AND cooldown_until > ? THEN 1 ELSE 0 END) AS cooldown,
		SUM(CASE WHEN enabled = ? AND auth_status = ? AND (EXISTS (SELECT 1 FROM account_quota_recovery recovery WHERE recovery.account_id = provider_accounts.id AND recovery.status = 'exhausted') OR ` + providerQuotaExhaustedPredicate + `) THEN 1 ELSE 0 END) AS waiting_reset,
		SUM(CASE WHEN enabled = ? AND auth_status = ? AND EXISTS (SELECT 1 FROM account_quota_recovery recovery WHERE recovery.account_id = provider_accounts.id AND recovery.status = 'probing') THEN 1 ELSE 0 END) AS probing,
		SUM(CASE WHEN enabled = ? THEN 1 ELSE 0 END) AS disabled,
		SUM(CASE WHEN enabled = ? AND auth_status = ? THEN 1 ELSE 0 END) AS reauth_required`
	err := r.db.db.WithContext(ctx).Model(&accountModel{}).Select(
		selectFields,
		true, account.AuthStatusActive, now,
		true, account.AuthStatusActive, now,
		true, account.AuthStatusActive,
		true, account.AuthStatusActive,
		false,
		true, account.AuthStatusReauthRequired,
	).Group("provider").Scan(&rows).Error
	return rows, err
}

func applyAccountStatusFilter(query *gorm.DB, status string, now time.Time) *gorm.DB {
	switch status {
	case "active":
		return query.Where("enabled = ? AND auth_status = ? AND NOT "+accountRecoveryPredicate+" AND NOT "+providerQuotaExhaustedPredicate+" AND (cooldown_until IS NULL OR cooldown_until <= ?)", true, account.AuthStatusActive, now)
	case "disabled":
		return query.Where("enabled = ?", false)
	case "reauthRequired":
		return query.Where("enabled = ? AND auth_status = ?", true, account.AuthStatusReauthRequired)
	case "cooldown":
		return query.Where("enabled = ? AND auth_status = ? AND NOT "+accountRecoveryPredicate+" AND cooldown_until > ?", true, account.AuthStatusActive, now)
	case "waitingReset":
		return query.Where("enabled = ? AND auth_status = ? AND (EXISTS (SELECT 1 FROM account_quota_recovery recovery WHERE recovery.account_id = provider_accounts.id AND recovery.status = 'exhausted') OR "+providerQuotaExhaustedPredicate+")", true, account.AuthStatusActive)
	case "probing":
		return query.Where("enabled = ? AND auth_status = ? AND EXISTS (SELECT 1 FROM account_quota_recovery recovery WHERE recovery.account_id = provider_accounts.id AND recovery.status = 'probing')", true, account.AuthStatusActive)
	default:
		return query
	}
}

// Web agreement predicates match the effective state exposed by the admin API.
// Terms are current only when the recorded version reaches CurrentWebTermsVersion.
const (
	webNSFWEnabledPredicate   = "EXISTS (SELECT 1 FROM web_account_profiles profile WHERE profile.account_id = provider_accounts.id AND profile.nsfw_enabled_at IS NOT NULL)"
	webTermsAcceptedPredicate = "EXISTS (SELECT 1 FROM web_account_profiles profile WHERE profile.account_id = provider_accounts.id AND profile.terms_accepted_at IS NOT NULL AND profile.terms_accepted_version >= ?)"
	webBuildLinkedPredicate   = "EXISTS (SELECT 1 FROM account_provider_links link WHERE link.web_account_id = provider_accounts.id)"
	webConsoleLinkedPredicate = "EXISTS (SELECT 1 FROM web_console_account_links link WHERE link.web_account_id = provider_accounts.id)"
	// Build and Console filter by whether a Web link exists.
	buildWebLinkedPredicate   = "EXISTS (SELECT 1 FROM account_provider_links link WHERE link.build_account_id = provider_accounts.id)"
	consoleWebLinkedPredicate = "EXISTS (SELECT 1 FROM web_console_account_links link WHERE link.console_account_id = provider_accounts.id)"
)

func applyWebAgreementFilter(query *gorm.DB, agreement string) *gorm.DB {
	switch agreement {
	case "nsfwEnabled":
		return query.Where(webNSFWEnabledPredicate)
	case "nsfwDisabled":
		return query.Where("NOT " + webNSFWEnabledPredicate)
	case "termsAccepted":
		return query.Where(webTermsAcceptedPredicate, account.CurrentWebTermsVersion)
	case "termsNotAccepted":
		return query.Where("NOT "+webTermsAcceptedPredicate, account.CurrentWebTermsVersion)
	case "allAccepted":
		return query.Where(webNSFWEnabledPredicate).Where(webTermsAcceptedPredicate, account.CurrentWebTermsVersion)
	case "allNotAccepted":
		return query.Where("NOT "+webNSFWEnabledPredicate).Where("NOT "+webTermsAcceptedPredicate, account.CurrentWebTermsVersion)
	default:
		return query
	}
}

// applyAssociationFilter applies provider-specific association predicates.
// Web supports Build, Console, and combined filters; Build and Console use
// provider-specific foreign keys for webLinked and webUnlinked.
func applyAssociationFilter(query *gorm.DB, providerValue, association string) *gorm.DB {
	switch association {
	case "buildLinked":
		return query.Where(webBuildLinkedPredicate)
	case "buildUnlinked":
		return query.Where("NOT " + webBuildLinkedPredicate)
	case "consoleLinked":
		return query.Where(webConsoleLinkedPredicate)
	case "consoleUnlinked":
		return query.Where("NOT " + webConsoleLinkedPredicate)
	case "allLinked":
		return query.Where(webBuildLinkedPredicate).Where(webConsoleLinkedPredicate)
	case "allUnlinked":
		return query.Where("NOT " + webBuildLinkedPredicate).Where("NOT " + webConsoleLinkedPredicate)
	case "webLinked":
		if providerValue == string(account.ProviderConsole) {
			return query.Where(consoleWebLinkedPredicate)
		}
		return query.Where(buildWebLinkedPredicate)
	case "webUnlinked":
		if providerValue == string(account.ProviderConsole) {
			return query.Where("NOT " + consoleWebLinkedPredicate)
		}
		return query.Where("NOT " + buildWebLinkedPredicate)
	default:
		return query
	}
}
