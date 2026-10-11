package relational

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	settingsdomain "github.com/chenyme/grok2api/backend/internal/domain/settings"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// migrateStandaloneEgressProxyProfiles promotes existing manually managed
// node proxies to reusable configurations exactly once. Subscription-managed
// nodes keep their source-owned proxy lifecycle.
func (d *Database) migrateStandaloneEgressProxyProfiles(ctx context.Context) error {
	for {
		completed, err := d.migrateStandaloneEgressProxyProfileBatch(ctx)
		if err != nil {
			return err
		}
		if completed {
			return nil
		}
	}
}

// migrateStandaloneEgressProxyProfileBatch keeps each resumable unit bounded.
// Already-bound rows are excluded by the predicate, so a process restart can
// safely continue without duplicating completed work.
func (d *Database) migrateStandaloneEgressProxyProfileBatch(ctx context.Context) (bool, error) {
	completed := false
	err := d.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		config, err := lockEgressOperationsConfig(tx)
		if err != nil {
			return err
		}
		if config.ProxyProfileMigrationCompleted {
			completed = true
			return nil
		}
		var nodes []egressNodeModel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id IS NULL AND proxy_profile_id IS NULL AND encrypted_proxy_url <> ''").
			Order("id ASC").Limit(standaloneProxyProfileMigrationBatchSize).Find(&nodes).Error; err != nil {
			return err
		}
		if len(nodes) == 0 {
			completed = true
			return tx.Model(&egressOperationsConfigModel{}).Where("id = ?", config.ID).
				Update("proxy_profile_migration_completed", true).Error
		}
		for _, node := range nodes {
			suffix := fmt.Sprintf(" · %s #%d", migratedProxyProfileScopeName(node.Scope), node.ID)
			name := truncate(strings.TrimSpace(node.Name), max(1, 160-len([]rune(suffix)))) + suffix
			profile := egressProxyProfileModel{Name: name, EncryptedProxyURL: node.EncryptedProxyURL}
			if err := tx.Create(&profile).Error; err != nil {
				return err
			}
			result := tx.Model(&egressNodeModel{}).Where("id = ? AND proxy_profile_id IS NULL", node.ID).
				Update("proxy_profile_id", profile.ID)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return fmt.Errorf("bind migrated proxy profile for egress node %d: row changed concurrently", node.ID)
			}
		}
		return nil
	})
	return completed, err
}

func migratedProxyProfileScopeName(scope string) string {
	switch scope {
	case "grok_build":
		return "Grok Build"
	case "grok_web":
		return "Grok Web"
	case "grok_console":
		return "Grok Console"
	case "grok_web_asset":
		return "Grok Web Assets"
	case "grok_console_asset":
		return "Grok Console Assets"
	default:
		return scope
	}
}

func (d *Database) migratePerSourceSubscriptionProxy(ctx context.Context) error {
	return d.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var legacy struct {
			EncryptedProxyURL  string `gorm:"column:encrypted_subscription_proxy_url"`
			MigrationCompleted bool   `gorm:"column:subscription_proxy_migration_completed"`
		}
		err := tx.Table("egress_operations_config").
			Select("encrypted_subscription_proxy_url", "subscription_proxy_migration_completed").
			Where("id = ?", 1).
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Take(&legacy).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if legacy.MigrationCompleted {
			return nil
		}
		if strings.TrimSpace(legacy.EncryptedProxyURL) != "" {
			if err := tx.Model(&egressSubscriptionSourceModel{}).Where("encrypted_proxy_url = ''").Updates(map[string]any{
				"encrypted_proxy_url": legacy.EncryptedProxyURL,
				"next_sync_at":        nil,
				"last_sync_error":     "",
			}).Error; err != nil {
				return err
			}
		}
		// Keep the encrypted legacy value for still-running old replicas and a
		// rollback window. The marker prevents subsequent startups from applying
		// it to sources that were later configured for direct fetching.
		return tx.Table("egress_operations_config").Where("id = ?", 1).
			Update("subscription_proxy_migration_completed", true).Error
	})
}

// migrateClientKeyAccountScopes translates the short-lived account_pool
// representation only when the corresponding scope columns are first added.
func (d *Database) migrateClientKeyAccountScopes(ctx context.Context, hadLegacyAccountPool, providerScopeAdded, tierScopeAdded bool) error {
	if !hadLegacyAccountPool || (!providerScopeAdded && !tierScopeAdded) {
		return nil
	}
	updates := make(map[string]any, 2)
	if providerScopeAdded {
		updates["provider_scope_mask"] = uint8(clientkeydomain.ProviderScopeAll)
	}
	if tierScopeAdded {
		updates["tier_scope_mask"] = gorm.Expr("CASE account_pool WHEN 'free' THEN 1 WHEN 'super' THEN 2 ELSE 7 END")
	}
	return d.db.WithContext(ctx).Table("client_keys").Where("1 = 1").Updates(updates).Error
}

// migrateBuildResponseHeaderTimeout persists the runtime default for settings
// rows created before the Build response-header timeout became configurable.
func (d *Database) migrateBuildResponseHeaderTimeout(ctx context.Context) error {
	db := d.db.WithContext(ctx)
	for range 4 {
		var row runtimeSettingsModel
		if err := db.Where("key = ?", runtimeSettingsKey).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		var payload runtimeSettingsPayload
		if err := json.Unmarshal([]byte(row.ValueJSON), &payload); err != nil {
			return fmt.Errorf("decode runtime settings: %w", err)
		}
		if payload.Config.ProviderBuild.ResponseHeaderTimeout > 0 {
			return nil
		}
		payload.Config.ProviderBuild.ResponseHeaderTimeout = settingsdomain.DefaultBuildResponseHeaderTimeout
		encoded, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("encode runtime settings: %w", err)
		}
		result := db.Model(&runtimeSettingsModel{}).
			Where("key = ? AND revision = ?", row.Key, row.Revision).
			UpdateColumn("value_json", string(encoded))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			return nil
		}
	}
	return errors.New("runtime settings changed repeatedly during migration")
}

// migrateProviderStreamIdleTimeouts persists runtime defaults for settings rows
// created before provider stream idle timeouts became configurable.
func (d *Database) migrateProviderStreamIdleTimeouts(ctx context.Context) error {
	db := d.db.WithContext(ctx)
	for range 4 {
		var row runtimeSettingsModel
		if err := db.Where("key = ?", runtimeSettingsKey).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		var payload runtimeSettingsPayload
		if err := json.Unmarshal([]byte(row.ValueJSON), &payload); err != nil {
			return fmt.Errorf("decode runtime settings: %w", err)
		}
		changed := false
		if payload.Config.ProviderBuild.StreamIdleTimeout <= 0 {
			payload.Config.ProviderBuild.StreamIdleTimeout = settingsdomain.DefaultBuildStreamIdleTimeout
			changed = true
		}
		if payload.Config.ProviderWeb.StreamIdleTimeout <= 0 {
			payload.Config.ProviderWeb.StreamIdleTimeout = settingsdomain.DefaultWebStreamIdleTimeout
			changed = true
		}
		// ProviderConsole was introduced after runtime settings persistence. Keep
		// a completely absent legacy section absent so applyDomainConfig can retain
		// the current defaults instead of treating a timeout-only section as an
		// explicitly configured (but invalid) Console provider.
		if payload.Config.ProviderConsole != (settingsdomain.ProviderConsoleConfig{}) && payload.Config.ProviderConsole.StreamIdleTimeout <= 0 {
			payload.Config.ProviderConsole.StreamIdleTimeout = settingsdomain.DefaultConsoleStreamIdleTimeout
			changed = true
		}
		if !changed {
			return nil
		}
		encoded, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("encode runtime settings: %w", err)
		}
		result := db.Model(&runtimeSettingsModel{}).
			Where("key = ? AND revision = ?", row.Key, row.Revision).
			UpdateColumn("value_json", string(encoded))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			return nil
		}
	}
	return errors.New("runtime settings changed repeatedly during migration")
}

func (d *Database) dropRedundantResponseExpiryIndexes(ctx context.Context) error {
	for _, name := range []string{"idx_response_ownership_expires", "idx_web_response_states_expires"} {
		if err := d.db.WithContext(ctx).Exec("DROP INDEX IF EXISTS " + name).Error; err != nil {
			return fmt.Errorf("drop index %s: %w", name, err)
		}
	}
	return nil
}

// dropProviderUpstreamUniqueIndex 允许同一 Provider 下多条对外名映射到同一上游模型。
func (d *Database) dropProviderUpstreamUniqueIndex(ctx context.Context) error {
	if err := d.db.WithContext(ctx).Exec("DROP INDEX IF EXISTS uidx_provider_upstream").Error; err != nil {
		return fmt.Errorf("drop index uidx_provider_upstream: %w", err)
	}
	return nil
}

// dropModelPublicIDUniqueIndex upgrades both historical one-route-per-name
// indexes. The capability-aware managed index is recreated by schemaIndexes.
func (d *Database) dropModelPublicIDUniqueIndex(ctx context.Context) error {
	for _, name := range []string{"idx_model_routes_public_id", "uidx_model_routes_managed_public_id"} {
		if err := d.db.WithContext(ctx).Exec("DROP INDEX IF EXISTS " + name).Error; err != nil {
			return fmt.Errorf("drop index %s: %w", name, err)
		}
	}
	return nil
}

// backfillReauthMarkedAt 为历史 reauthRequired 账号补齐清理锚点；优先使用 updated_at。
func (d *Database) backfillReauthMarkedAt(ctx context.Context) error {
	return d.db.WithContext(ctx).Exec(`
UPDATE provider_accounts
SET reauth_marked_at = updated_at
WHERE auth_status = ? AND reauth_marked_at IS NULL
`, "reauthRequired").Error
}
