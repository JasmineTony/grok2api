package relational

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *AccountRepository) UpdateTokens(ctx context.Context, id uint64, accessToken, refreshToken string, expiresAt time.Time, buildBotFlagSource int) (account.Credential, error) {
	now := time.Now().UTC()
	refreshDueAt := account.CredentialRefreshDueAt(id, expiresAt)
	if err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var providerRow struct{ Provider string }
		if err := tx.Model(&accountModel{}).Select("provider").Where("id = ?", id).Take(&providerRow).Error; err != nil {
			return err
		}
		updates := map[string]any{
			"encrypted_primary": accessToken, "expires_at": expiresAt, "refresh_due_at": refreshDueAt,
			"build_bot_flag_source": normalizeBuildBotFlagSource(account.Provider(providerRow.Provider), buildBotFlagSource),
			"last_refresh_at":       now, "refresh_failures": 0, "refresh_unclassified_auth_failures": 0, "last_refresh_error_status": 0, "last_refresh_error": "", "last_refresh_error_message": "", "last_refresh_error_response": "", "refresh_permanent": false, "updated_at": now,
		}
		if refreshToken != "" {
			updates["encrypted_refresh"] = refreshToken
		}
		if err := tx.Model(&accountCredentialModel{}).Where("account_id = ?", id).Updates(updates).Error; err != nil {
			return err
		}
		return tx.Model(&accountModel{}).Where("id = ?", id).Updates(map[string]any{"auth_status": string(account.AuthStatusActive), "last_error": "", "reauth_marked_at": nil}).Error
	}); err != nil {
		return account.Credential{}, err
	}
	stored, err := r.Get(ctx, id)
	if err == nil {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountCredentialChanged, Provider: stored.Provider, AccountID: id})
	} else {
		// The database write already committed; retain a broad fallback if the read-back fails.
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountCredentialChanged, AccountID: id})
	}
	return stored, err
}

// BackfillCredentialRefreshSchedules 为升级前凭据分批补齐调度时间，不解密 Token，也不发起 OAuth 请求。
func (r *AccountRepository) BackfillCredentialRefreshSchedules(ctx context.Context, now time.Time, limit int) (int, error) {
	if limit < 1 {
		return 0, nil
	}
	var rows []struct {
		AccountID        uint64
		ExpiresAt        *time.Time
		EncryptedPrimary string
	}
	err := r.db.db.WithContext(ctx).
		Table("account_credentials AS credential").
		Select("credential.account_id, credential.expires_at, credential.encrypted_primary").
		Joins("JOIN provider_accounts AS account ON account.id = credential.account_id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ?", account.ProviderBuild, true, account.AuthStatusActive).
		Where("credential.auth_type = ? AND credential.encrypted_refresh <> '' AND credential.refresh_due_at IS NULL", account.AuthTypeOAuth).
		Where("credential.expires_at IS NOT NULL OR credential.encrypted_primary = ''").
		Order("credential.account_id ASC").Limit(limit).Scan(&rows).Error
	if err != nil || len(rows) == 0 {
		return 0, err
	}
	err = r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, row := range rows {
			dueAt := now
			if row.EncryptedPrimary != "" && row.ExpiresAt != nil && !row.ExpiresAt.IsZero() {
				dueAt = account.CredentialRefreshDueAt(row.AccountID, *row.ExpiresAt)
			}
			if err := tx.Model(&accountCredentialModel{}).Where("account_id = ? AND refresh_due_at IS NULL", row.AccountID).Update("refresh_due_at", dueAt).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return len(rows), err
}

// ListCriticalCredentialRefreshIDs 只返回重启后必须优先恢复的凭据，避免启动时刷新整个账号池。
func (r *AccountRepository) ListCriticalCredentialRefreshIDs(ctx context.Context, now, expiresBefore time.Time, limit int) ([]uint64, error) {
	if limit < 1 {
		return []uint64{}, nil
	}
	var ids []uint64
	err := r.db.db.WithContext(ctx).
		Table("account_credentials AS credential").
		Select("credential.account_id").
		Joins("JOIN provider_accounts AS account ON account.id = credential.account_id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ?", account.ProviderBuild, true, account.AuthStatusActive).
		Where("credential.auth_type = ? AND credential.encrypted_refresh <> ''", account.AuthTypeOAuth).
		Where("credential.encrypted_primary = '' OR credential.expires_at <= ? OR (credential.refresh_failures > 0 AND credential.refresh_due_at IS NOT NULL AND credential.refresh_due_at <= ?)", expiresBefore.UTC(), now.UTC()).
		Order(gorm.Expr("CASE WHEN credential.encrypted_primary = '' THEN 0 WHEN credential.expires_at <= ? THEN 1 ELSE 2 END, credential.expires_at ASC, credential.account_id ASC", now.UTC())).
		Limit(limit).
		Scan(&ids).Error
	return ids, err
}

func (r *AccountRepository) ListDueCredentialRefreshIDs(ctx context.Context, now time.Time, limit int) ([]uint64, error) {
	if limit < 1 {
		return []uint64{}, nil
	}
	var ids []uint64
	err := r.db.db.WithContext(ctx).
		Table("account_credentials AS credential").
		Select("credential.account_id").
		Joins("JOIN provider_accounts AS account ON account.id = credential.account_id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ?", account.ProviderBuild, true, account.AuthStatusActive).
		Where("credential.auth_type = ? AND credential.encrypted_refresh <> '' AND credential.refresh_due_at IS NOT NULL AND credential.refresh_due_at <= ?", account.AuthTypeOAuth, now).
		Order("credential.refresh_due_at ASC, credential.account_id ASC").Limit(limit).Scan(&ids).Error
	return ids, err
}

func (r *AccountRepository) NextCredentialRefreshDueAt(ctx context.Context) (*time.Time, error) {
	var rows []struct{ RefreshDueAt time.Time }
	err := r.db.db.WithContext(ctx).
		Table("account_credentials AS credential").
		Select("credential.refresh_due_at").
		Joins("JOIN provider_accounts AS account ON account.id = credential.account_id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ?", account.ProviderBuild, true, account.AuthStatusActive).
		Where("credential.auth_type = ? AND credential.encrypted_refresh <> '' AND credential.refresh_due_at IS NOT NULL", account.AuthTypeOAuth).
		Order("credential.refresh_due_at ASC, credential.account_id ASC").Limit(1).Scan(&rows).Error
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	value := rows[0].RefreshDueAt.UTC()
	return &value, nil
}

func (r *AccountRepository) UpdateCredentialRefreshFailure(ctx context.Context, id uint64, failure repository.CredentialRefreshFailure) error {
	err := r.db.db.WithContext(ctx).Model(&accountCredentialModel{}).Where("account_id = ?", id).Updates(map[string]any{
		"refresh_due_at": failure.RetryAt.UTC(), "refresh_failures": max(0, failure.Count),
		"refresh_unclassified_auth_failures": max(0, failure.UnclassifiedAuthFailureCount),
		"last_refresh_error_status":          max(0, failure.Status), "last_refresh_error": truncate(failure.Code, 100),
		"last_refresh_error_message": truncate(failure.Message, 512), "last_refresh_error_response": truncate(failure.Response, 4096),
		"refresh_permanent": failure.Permanent, "updated_at": time.Now().UTC(),
	}).Error
	if err == nil && failure.Permanent {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountCredentialChanged, AccountID: id})
	}
	return err
}

func (r *AccountRepository) UpdateObservedModel(ctx context.Context, id uint64, model string, observedAt time.Time) error {
	_, err := r.UpdateObservedModelIfNewer(ctx, id, model, observedAt)
	return err
}

func (r *AccountRepository) UpdateObservedModelIfNewer(ctx context.Context, id uint64, model string, observedAt time.Time) (bool, error) {
	model = truncate(model, 255)
	result := r.db.db.WithContext(ctx).Model(&accountModel{}).
		Where("id = ? AND (observed_model_at IS NULL OR observed_model_at <= ?) AND (COALESCE(observed_model, '') <> ? OR observed_model_at <= ?)", id, observedAt, model, observedAt.Add(-30*time.Minute)).
		Updates(map[string]any{"observed_model": model, "observed_model_at": observedAt})
	if result.Error == nil && result.RowsAffected > 0 {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged, AccountID: id})
	}
	return result.RowsAffected > 0, result.Error
}

// MarkBuildAPIFallback idempotently updates the XAI inference fallback marker for Grok Build accounts.
func (r *AccountRepository) MarkBuildAPIFallback(ctx context.Context, id uint64, enabled bool) error {
	result := r.db.db.WithContext(ctx).Model(&accountModel{}).
		Where("id = ? AND provider = ?", id, account.ProviderBuild).
		Update("build_api_fallback", enabled)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		var count int64
		if err := r.db.db.WithContext(ctx).Model(&accountModel{}).Where("id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return repository.ErrNotFound
		}
		return fmt.Errorf("仅 grok_build 账号支持 Build API 降级标记")
	}
	r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged, Provider: account.ProviderBuild, AccountID: id})
	return nil
}

func (r *AccountRepository) UpdateHealth(ctx context.Context, id uint64, provider account.Provider, failureCount int, cooldownUntil *time.Time, lastError string, success bool) error {
	if id == 0 || !provider.IsValid() {
		return repository.ErrNotFound
	}
	failureCount = max(0, failureCount)
	lastError = truncate(lastError, 512)
	updates := map[string]any{"failure_count": failureCount, "cooldown_until": cooldownUntil, "last_error": lastError}
	if success {
		now := time.Now().UTC()
		updates["last_used_at"] = &now
	}
	result := r.db.db.WithContext(ctx).Model(&accountModel{}).Where("id = ? AND provider = ?", id, provider).Updates(updates)
	if result.Error != nil {
		return mapError(result.Error)
	}
	if result.RowsAffected == 0 {
		return repository.ErrNotFound
	}
	r.notifyInvalidation(ctx, repository.InvalidationEvent{
		Kind: repository.InvalidationAccountHealthChanged, Provider: provider, AccountID: id,
		FailureCount: failureCount, CooldownUntil: cooldownUntil, HealthMarker: account.NormalizeHealthMarker(lastError),
	})
	return nil
}

func (r *AccountRepository) TouchLastUsed(ctx context.Context, id uint64, usedAt time.Time) error {
	if id == 0 || usedAt.IsZero() {
		return repository.ErrNotFound
	}
	result := r.db.db.WithContext(ctx).Model(&accountModel{}).Where("id = ?", id).Update("last_used_at", usedAt.UTC())
	if result.Error != nil {
		return mapError(result.Error)
	}
	if result.RowsAffected == 0 {
		return repository.ErrNotFound
	}
	return nil
}

func (r *AccountRepository) UpsertModelQuotaBlock(ctx context.Context, value account.ModelQuotaBlock) error {
	value.UpstreamModel = strings.TrimSpace(value.UpstreamModel)
	value.Reason = strings.TrimSpace(value.Reason)
	if value.AccountID == 0 || value.UpstreamModel == "" || value.Reason == "" || value.CooldownUntil.IsZero() {
		return repository.ErrConflict
	}
	now := time.Now().UTC()
	row := accountModelQuotaBlockModel{
		AccountID: value.AccountID, UpstreamModel: truncate(value.UpstreamModel, 255), Reason: truncate(value.Reason, 100),
		CooldownUntil: value.CooldownUntil.UTC(), UpdatedAt: now,
	}
	err := r.db.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "account_id"}, {Name: "upstream_model"}},
		DoUpdates: clause.Assignments(map[string]any{
			"reason":         gorm.Expr("CASE WHEN cooldown_until > ? THEN reason ELSE ? END", row.CooldownUntil, row.Reason),
			"cooldown_until": gorm.Expr("CASE WHEN cooldown_until > ? THEN cooldown_until ELSE ? END", row.CooldownUntil, row.CooldownUntil), "updated_at": now,
		}),
	}).Create(&row).Error
	if err == nil {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountModelQuotaChanged, AccountID: value.AccountID, UpstreamModel: value.UpstreamModel})
	}
	return err
}

func egressLeaseBlockFromModel(row accountEgressLeaseBlockModel) account.EgressLeaseBlock {
	return account.EgressLeaseBlock{
		AccountID: row.AccountID, NodeID: row.NodeID, Reason: row.Reason, Version: row.Version,
		CooldownUntil: row.CooldownUntil.UTC(), UpdatedAt: row.UpdatedAt.UTC(),
	}
}

// ListEgressLeaseBlocks returns the durable guard-owned lease state, including
// expired rows. The sidecar uses expired rows for recovery reconciliation; the
// selector independently ignores them after CooldownUntil as a fail-safe.
func (r *AccountRepository) ListEgressLeaseBlocks(ctx context.Context, limit int, after *account.EgressLeaseBlockCursor) ([]account.EgressLeaseBlock, error) {
	if limit <= 0 || limit > 1001 {
		return nil, repository.ErrConflict
	}
	var rows []accountEgressLeaseBlockModel
	query := r.db.db.WithContext(ctx).
		Table("account_egress_lease_blocks AS block").Select("block.*").
		Joins("JOIN provider_accounts AS account ON account.id = block.account_id").
		Joins("JOIN egress_nodes AS node ON node.id = block.node_id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ? AND (account.egress_node_id IS NULL OR account.egress_node_id = block.node_id) AND node.enabled = ? AND node.scope = ?", account.ProviderBuild, true, account.AuthStatusActive, true, "grok_build").
		Order("block.cooldown_until ASC, block.account_id ASC, block.node_id ASC").Limit(limit)
	if after != nil {
		cursorTime := after.CooldownUntil.UTC()
		query = query.Where(
			"block.cooldown_until > ? OR (block.cooldown_until = ? AND (block.account_id > ? OR (block.account_id = ? AND block.node_id > ?)))",
			cursorTime, cursorTime, after.AccountID, after.AccountID, after.NodeID,
		)
	}
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	values := make([]account.EgressLeaseBlock, 0, len(rows))
	for _, row := range rows {
		values = append(values, egressLeaseBlockFromModel(row))
	}
	return values, nil
}

func deleteInvalidEgressLeaseBlocksForAccount(tx *gorm.DB, row accountModel) (int64, error) {
	if account.Provider(row.Provider) != account.ProviderBuild {
		return 0, nil
	}
	query := tx.Where("account_id = ?", row.ID)
	if row.Enabled && account.AuthStatus(row.AuthStatus) == account.AuthStatusActive {
		if row.EgressNodeID == nil {
			return 0, nil
		}
		query = query.Where("node_id <> ?", *row.EgressNodeID)
	}
	result := query.Delete(&accountEgressLeaseBlockModel{})
	return result.RowsAffected, result.Error
}

func (r *AccountRepository) PruneInvalidEgressLeaseBlocks(ctx context.Context, limit int) (int64, error) {
	if limit < 1 || limit > 1000 {
		return 0, repository.ErrConflict
	}
	var rows []accountEgressLeaseBlockModel
	err := r.db.db.WithContext(ctx).
		Table("account_egress_lease_blocks AS block").Select("block.*").
		Joins("LEFT JOIN provider_accounts AS account ON account.id = block.account_id").
		Joins("LEFT JOIN egress_nodes AS node ON node.id = block.node_id").
		Where("account.id IS NULL OR account.provider <> ? OR account.enabled <> ? OR account.auth_status <> ? OR (account.egress_node_id IS NOT NULL AND account.egress_node_id <> block.node_id) OR node.id IS NULL OR node.enabled <> ? OR node.scope <> ?", account.ProviderBuild, true, account.AuthStatusActive, true, "grok_build").
		Order("block.cooldown_until ASC, block.account_id ASC, block.node_id ASC").Limit(limit).Find(&rows).Error
	if err != nil || len(rows) == 0 {
		return 0, err
	}
	var deleted int64
	err = r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for start := 0; start < len(rows); start += 400 {
			end := min(start+400, len(rows))
			pairs := make([][]any, 0, end-start)
			for _, row := range rows[start:end] {
				pairs = append(pairs, []any{row.AccountID, row.NodeID})
			}
			result := tx.Where("(account_id, node_id) IN ?", pairs).Delete(&accountEgressLeaseBlockModel{})
			if result.Error != nil {
				return result.Error
			}
			deleted += result.RowsAffected
		}
		return nil
	})
	if err == nil && deleted > 0 {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountEgressLeaseChanged, Provider: account.ProviderBuild})
	}
	return deleted, err
}

func (r *AccountRepository) DeleteEgressLeaseBlocksByNodes(ctx context.Context, nodeIDs []uint64) (int64, error) {
	if len(nodeIDs) == 0 {
		return 0, nil
	}
	result := r.db.db.WithContext(ctx).Where("node_id IN ?", nodeIDs).Delete(&accountEgressLeaseBlockModel{})
	if result.Error == nil && result.RowsAffected > 0 {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountEgressLeaseChanged, Provider: account.ProviderBuild})
	}
	return result.RowsAffected, result.Error
}

// UpsertEgressLeaseBlock atomically verifies that the Build account may still
// use the observed node. Unbound accounts can receive a runtime-selected
// account-derived proxy; explicit bindings remain authoritative. A shorter
// concurrent hold cannot replace a longer one or rotate its CAS version.
func (r *AccountRepository) UpsertEgressLeaseBlock(ctx context.Context, value account.EgressLeaseBlock) (account.EgressLeaseBlock, error) {
	value.Reason = strings.TrimSpace(value.Reason)
	value.Version = strings.TrimSpace(value.Version)
	if value.AccountID == 0 || value.NodeID == 0 || value.Reason == "" || len(value.Version) < 16 || len(value.Version) > 64 || value.CooldownUntil.IsZero() {
		return account.EgressLeaseBlock{}, repository.ErrConflict
	}
	value.Reason = truncate(value.Reason, 100)
	value.CooldownUntil = value.CooldownUntil.UTC()
	value.UpdatedAt = time.Now().UTC()
	stored := value
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var owner accountModel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "provider", "enabled", "auth_status", "egress_node_id").First(&owner, value.AccountID).Error; err != nil {
			return mapError(err)
		}
		if account.Provider(owner.Provider) != account.ProviderBuild || !owner.Enabled || account.AuthStatus(owner.AuthStatus) != account.AuthStatusActive || (owner.EgressNodeID != nil && *owner.EgressNodeID != value.NodeID) {
			return repository.ErrConflict
		}
		var existing accountEgressLeaseBlockModel
		load := tx.Where("account_id = ? AND node_id = ?", value.AccountID, value.NodeID).Limit(1).Find(&existing)
		if load.Error != nil {
			return load.Error
		}
		if load.RowsAffected > 0 && existing.CooldownUntil.After(value.CooldownUntil) {
			stored = egressLeaseBlockFromModel(existing)
			return nil
		}
		row := accountEgressLeaseBlockModel{
			AccountID: value.AccountID, NodeID: value.NodeID, Reason: value.Reason, Version: value.Version,
			CooldownUntil: value.CooldownUntil, UpdatedAt: value.UpdatedAt,
		}
		created := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "account_id"}, {Name: "node_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"reason", "version", "cooldown_until", "updated_at"}),
			Where: clause.Where{Exprs: []clause.Expression{clause.Expr{
				SQL: "account_egress_lease_blocks.cooldown_until <= excluded.cooldown_until",
			}}},
		}).Create(&row)
		if created.Error != nil {
			return created.Error
		}
		if created.RowsAffected == 0 {
			if err := tx.Where("account_id = ? AND node_id = ?", value.AccountID, value.NodeID).First(&existing).Error; err != nil {
				return err
			}
			stored = egressLeaseBlockFromModel(existing)
			return nil
		}
		stored = egressLeaseBlockFromModel(row)
		return nil
	})
	if err == nil {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountEgressLeaseChanged, Provider: account.ProviderBuild, AccountID: value.AccountID})
	}
	return stored, err
}

// DeleteEgressLeaseBlock uses the opaque version as a compare-and-swap token,
// so a stale recovery probe cannot clear a newer quarantine.
func (r *AccountRepository) DeleteEgressLeaseBlock(ctx context.Context, accountID, nodeID uint64, version string) (bool, error) {
	version = strings.TrimSpace(version)
	if accountID == 0 || nodeID == 0 || version == "" {
		return false, repository.ErrConflict
	}
	result := r.db.db.WithContext(ctx).Where("account_id = ? AND node_id = ? AND version = ?", accountID, nodeID, version).Delete(&accountEgressLeaseBlockModel{})
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 1 {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountEgressLeaseChanged, Provider: account.ProviderBuild, AccountID: accountID})
		return true, nil
	}
	return false, nil
}

func (r *AccountRepository) PruneExpiredModelQuotaBlocks(ctx context.Context, now time.Time, limit int) (int64, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	var rows []accountModelQuotaBlockModel
	if err := r.db.db.WithContext(ctx).Select("account_id", "upstream_model").Where("cooldown_until <= ?", now.UTC()).Order("cooldown_until ASC").Limit(limit).Find(&rows).Error; err != nil || len(rows) == 0 {
		return 0, err
	}
	var deleted int64
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, row := range rows {
			result := tx.Where("account_id = ? AND upstream_model = ? AND cooldown_until <= ?", row.AccountID, row.UpstreamModel, now.UTC()).Delete(&accountModelQuotaBlockModel{})
			if result.Error != nil {
				return result.Error
			}
			deleted += result.RowsAffected
		}
		return nil
	})
	if err == nil && deleted > 0 {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountModelQuotaChanged})
	}
	return deleted, err
}
