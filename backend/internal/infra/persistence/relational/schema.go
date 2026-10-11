package relational

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

const mediaJobInputMetadataPendingIndex = "CREATE INDEX IF NOT EXISTS idx_media_jobs_input_metadata_pending ON media_jobs(id) WHERE input_image_count IS NULL"

const postgresSchemaMigrationLockID int64 = 0x47524f4b32415049

const standaloneProxyProfileMigrationBatchSize = 100

var schemaModels = []any{
	&adminModel{},
	&adminSessionModel{},
	&egressSubscriptionSourceModel{},
	&egressProxyProfileModel{},
	&egressNodeModel{},
	&egressOperationsConfigModel{},
	&accountModel{},
	&accountCredentialModel{},
	&accountProviderLinkModel{},
	&webConsoleAccountLinkModel{},
	&webAccountProfileModel{},
	&quotaWindowModel{},
	&billingModel{},
	&quotaRecoveryModel{},
	&modelRouteModel{},
	&modelRouteAliasModel{},
	&modelRouteAccountModel{},
	&accountModelCapabilityModel{},
	&accountModelSyncStateModel{},
	&accountModelQuotaBlockModel{},
	&accountEgressLeaseBlockModel{},
	&clientKeyModel{},
	&clientKeyModelPermission{},
	&billingReservationModel{},
	&requestAuditModel{},
	&requestAuditAttemptModel{},
	&responseOwnershipModel{},
	&webResponseStateModel{},
	&mediaJobModel{},
	&mediaAssetModel{},
	&mediaUploadTicketModel{},
	&runtimeSettingsModel{},
}

var schemaIndexes = []string{
	"CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_created ON admin_sessions(admin_id, created_at DESC, id DESC)",
	"CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at)",
	// SQLite 通过重建表修改 CHECK 约束，重建会删除独立存储的 GORM 唯一索引；
	// 在统一索引阶段显式恢复这些数据完整性约束。
	"CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_accounts_identity_key ON provider_accounts(identity_key)",
	"CREATE INDEX IF NOT EXISTS idx_accounts_routing ON provider_accounts(provider, enabled, auth_status, priority DESC, id ASC)",
	"CREATE INDEX IF NOT EXISTS idx_accounts_created_id ON provider_accounts(created_at DESC, id DESC)",
	"CREATE INDEX IF NOT EXISTS idx_accounts_auto_clean_reauth ON provider_accounts(auth_status, reauth_marked_at, id)",
	"CREATE INDEX IF NOT EXISTS idx_accounts_auto_clean_reauth_cursor ON provider_accounts(auth_status, enabled, id, reauth_marked_at)",
	"CREATE INDEX IF NOT EXISTS idx_account_credentials_refresh_due ON account_credentials(refresh_due_at, account_id)",
	"CREATE INDEX IF NOT EXISTS idx_account_credentials_build_bot_flag ON account_credentials(build_bot_flag_source, account_id)",
	"CREATE INDEX IF NOT EXISTS idx_account_egress_lease_blocks_due ON account_egress_lease_blocks(cooldown_until, account_id, node_id)",
	"CREATE INDEX IF NOT EXISTS idx_quota_windows_due ON account_quota_windows(remaining, reset_at, account_id)",
	"CREATE INDEX IF NOT EXISTS idx_model_routes_public_id_lookup ON model_routes(public_id)",
	// Catalog/discovered rows remain idempotent per API capability. One public
	// image model may intentionally serve both generation and editing, while
	// manual rows may still share a public ID and form a route-target pool.
	"CREATE UNIQUE INDEX IF NOT EXISTS uidx_model_routes_managed_public_capability ON model_routes(public_id, capability) WHERE origin IN ('catalog', 'discovered')",
	"CREATE INDEX IF NOT EXISTS idx_model_routes_provider_upstream ON model_routes(provider, upstream_model)",
	"CREATE INDEX IF NOT EXISTS idx_model_routes_grouping ON model_routes(provider, public_id, upstream_model, origin, id)",
	"CREATE INDEX IF NOT EXISTS idx_model_routes_created_id ON model_routes(created_at DESC, id DESC)",
	"CREATE INDEX IF NOT EXISTS idx_model_routes_enabled ON model_routes(enabled, public_id, id)",
	"CREATE INDEX IF NOT EXISTS idx_model_route_aliases_route ON model_route_aliases(model_route_id, alias)",
	"CREATE INDEX IF NOT EXISTS idx_model_route_accounts_account_route ON model_route_accounts(account_id, model_route_id)",
	"CREATE INDEX IF NOT EXISTS idx_account_model_quota_blocks_due ON account_model_quota_blocks(cooldown_until, account_id)",
	"CREATE INDEX IF NOT EXISTS idx_client_keys_created_id ON client_keys(created_at DESC, id DESC)",
	"CREATE INDEX IF NOT EXISTS idx_client_keys_status ON client_keys(enabled, expires_at, created_at DESC, id DESC)",
	"CREATE UNIQUE INDEX IF NOT EXISTS idx_client_keys_internal_kind ON client_keys(internal_kind) WHERE internal_kind IS NOT NULL",
	"CREATE INDEX IF NOT EXISTS idx_client_key_models_route_key ON client_key_models(model_route_id, client_key_id)",
	"CREATE INDEX IF NOT EXISTS idx_billing_reservations_expiry ON billing_reservations(expires_at, client_key_id)",
	"CREATE INDEX IF NOT EXISTS idx_egress_nodes_scope_health ON egress_nodes(scope, enabled, health DESC, id ASC)",
	"CREATE INDEX IF NOT EXISTS idx_egress_nodes_probe_due ON egress_nodes(enabled, last_probed_at, id)",
	"CREATE INDEX IF NOT EXISTS idx_egress_nodes_proxy_profile ON egress_nodes(proxy_profile_id, id)",
	"CREATE INDEX IF NOT EXISTS idx_egress_sources_scope_name ON egress_subscription_sources(scope, LOWER(name), id)",
	"CREATE INDEX IF NOT EXISTS idx_audits_created_id ON request_audits(created_at DESC, id DESC)",
	"CREATE UNIQUE INDEX IF NOT EXISTS idx_audits_event_id ON request_audits(event_id) WHERE event_id <> ''",
	"CREATE INDEX IF NOT EXISTS idx_audits_account_created_id ON request_audits(account_id, created_at DESC, id DESC)",
	"CREATE INDEX IF NOT EXISTS idx_audits_status_created_id ON request_audits(status_code, created_at DESC, id DESC)",
	"CREATE INDEX IF NOT EXISTS idx_audits_streaming_created_id ON request_audits(streaming, created_at DESC, id DESC)",
	"CREATE INDEX IF NOT EXISTS idx_audits_provider_streaming_created_id ON request_audits(provider, streaming, created_at DESC, id DESC)",
	"CREATE INDEX IF NOT EXISTS idx_audit_attempts_audit_number ON request_audit_attempts(audit_id, number)",
	"CREATE INDEX IF NOT EXISTS idx_response_ownership_expires_id ON response_ownership(expires_at, response_id)",
	"CREATE INDEX IF NOT EXISTS idx_response_ownership_account ON response_ownership(account_id)",
	"CREATE INDEX IF NOT EXISTS idx_response_ownership_client_key ON response_ownership(client_key_id)",
	"CREATE INDEX IF NOT EXISTS idx_response_ownership_route ON response_ownership(model_route_id)",
	"CREATE INDEX IF NOT EXISTS idx_web_response_states_expires_id ON web_response_states(expires_at, response_id)",
	"CREATE INDEX IF NOT EXISTS idx_web_response_states_account ON web_response_states(account_id, created_at DESC)",
	"CREATE INDEX IF NOT EXISTS idx_media_jobs_client_created ON media_jobs(client_key_id, created_at DESC)",
	"CREATE INDEX IF NOT EXISTS idx_media_jobs_account_status ON media_jobs(account_id, status)",
	"CREATE INDEX IF NOT EXISTS idx_media_jobs_recovery ON media_jobs(status, lease_until, created_at, id)",
	"CREATE INDEX IF NOT EXISTS idx_media_jobs_usage_recovery ON media_jobs(status, usage_recorded_at, completed_at, id)",
	"CREATE INDEX IF NOT EXISTS idx_media_assets_created ON media_assets(created_at DESC, id)",
	"CREATE INDEX IF NOT EXISTS idx_media_assets_kind_created ON media_assets(kind, created_at DESC, id)",
	"CREATE INDEX IF NOT EXISTS idx_media_assets_expires ON media_assets(expires_at, id) WHERE expires_at IS NOT NULL",
	"CREATE INDEX IF NOT EXISTS idx_media_upload_tickets_expires ON media_upload_tickets(expires_at, consumed_at)",
	"CREATE INDEX IF NOT EXISTS idx_media_jobs_result_asset ON media_jobs(result_asset_id) WHERE result_asset_id <> ''",
	// Pending input metadata rows only; keeps startup backfill scans off the full table after migration completes.
	mediaJobInputMetadataPendingIndex,
}

// InitializeSchema 以当前持久化模型作为首版数据库结构基线。
func (d *Database) InitializeSchema(ctx context.Context) error {
	if d.dialect == "postgres" {
		return d.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", postgresSchemaMigrationLockID).Error; err != nil {
				return fmt.Errorf("acquire PostgreSQL migration lock: %w", err)
			}
			locked := &Database{db: tx, dialect: d.dialect}
			return locked.initializeSchema(ctx)
		})
	}
	return d.initializeSchema(ctx)
}

func (d *Database) initializeSchema(ctx context.Context) error {
	db := d.db.WithContext(ctx)
	hadClientKeys := db.Migrator().HasTable(&clientKeyModel{})
	hadProviderScope := hadClientKeys && db.Migrator().HasColumn(&clientKeyModel{}, "ProviderScopeMask")
	hadTierScope := hadClientKeys && db.Migrator().HasColumn(&clientKeyModel{}, "TierScopeMask")
	hadLegacyAccountPool := hadClientKeys && db.Migrator().HasColumn("client_keys", "account_pool")
	hadGlobalSubscriptionProxy := db.Migrator().HasTable("egress_operations_config") && db.Migrator().HasColumn("egress_operations_config", "encrypted_subscription_proxy_url")
	// all 作用域会让 Build 与 Web 共用 UA、健康度和冷却状态，升级时直接移除旧节点。
	if db.Migrator().HasTable(&egressNodeModel{}) {
		if err := db.Where("scope = ?", "all").Delete(&egressNodeModel{}).Error; err != nil {
			return fmt.Errorf("清理旧版所有域出口节点: %w", err)
		}
	}
	if err := d.migrateSchemaTables(ctx); err != nil {
		return err
	}
	if hadGlobalSubscriptionProxy {
		if err := d.migratePerSourceSubscriptionProxy(ctx); err != nil {
			return fmt.Errorf("迁移代理订阅拉取代理: %w", err)
		}
	}
	if err := d.migrateStandaloneEgressProxyProfiles(ctx); err != nil {
		return fmt.Errorf("迁移独立出口代理配置: %w", err)
	}
	if err := d.migrateLegacySchemaColumns(ctx, hadLegacyAccountPool, !hadProviderScope, !hadTierScope); err != nil {
		return err
	}
	if err := d.migrateSchemaConstraints(ctx); err != nil {
		return err
	}
	if err := d.migrateMediaJobSchema(ctx); err != nil {
		return err
	}
	return d.finalizeSchemaMigration(ctx)
}

// migrateSchemaTables 按方言执行模型 AutoMigrate；SQLite 需要暂停外键才能重建父表。
func (d *Database) migrateSchemaTables(ctx context.Context) error {
	autoMigrate := func() error {
		return d.db.WithContext(ctx).AutoMigrate(schemaModels...)
	}
	var migrateErr error
	if d.dialect == "sqlite" {
		// SQLite 修改 CHECK 等表级约束时会重建表。provider_accounts 等父表已被多个
		// 子表引用，必须在固定连接上暂停外键，否则 DROP 旧父表会直接失败。
		migrateErr = d.withSQLiteForeignKeysDisabled(ctx, autoMigrate)
	} else {
		migrateErr = autoMigrate()
	}
	if migrateErr != nil {
		return fmt.Errorf("初始化数据库表: %w", migrateErr)
	}
	return nil
}

// migrateLegacySchemaColumns 迁移客户端 Key 调用范围与 Build 相关的历史列。
func (d *Database) migrateLegacySchemaColumns(ctx context.Context, hadLegacyAccountPool, missingProviderScope, missingTierScope bool) error {
	if err := d.migrateClientKeyAccountScopes(ctx, hadLegacyAccountPool, missingProviderScope, missingTierScope); err != nil {
		return fmt.Errorf("迁移客户端 Key 调用范围: %w", err)
	}
	if err := d.migrateBuildResponseHeaderTimeout(ctx); err != nil {
		return fmt.Errorf("迁移 Grok Build 响应头超时: %w", err)
	}
	if err := d.migrateProviderStreamIdleTimeouts(ctx); err != nil {
		return fmt.Errorf("迁移 Provider 流式空闲超时: %w", err)
	}
	return nil
}

// migrateSchemaConstraints 迁移 Console、出口、审计与模型路由的表级约束。
func (d *Database) migrateSchemaConstraints(ctx context.Context) error {
	if err := d.ensureConsoleConstraints(ctx); err != nil {
		return fmt.Errorf("迁移 Console 数据库约束: %w", err)
	}
	if err := d.ensureEgressAssetScopeConstraints(ctx); err != nil {
		return fmt.Errorf("迁移资源出口数据库约束: %w", err)
	}
	if err := d.ensureAuditOperationConstraints(ctx); err != nil {
		return fmt.Errorf("迁移请求审计操作约束: %w", err)
	}
	if err := d.ensureModelRouteCapabilityConstraints(ctx); err != nil {
		return fmt.Errorf("迁移模型路由能力约束: %w", err)
	}
	return nil
}

// migrateMediaJobSchema 迁移 media job 约束、操作类型、输入长度、待回填索引与外键。
func (d *Database) migrateMediaJobSchema(ctx context.Context) error {
	if err := d.ensureMediaJobConstraints(ctx); err != nil {
		return fmt.Errorf("迁移 media job 数据库约束: %w", err)
	}
	if err := d.migrateMediaJobOperations(ctx); err != nil {
		return fmt.Errorf("迁移 media job 操作类型: %w", err)
	}
	if err := d.ensureMediaJobInputConstraint(ctx); err != nil {
		return fmt.Errorf("迁移 media job 输入长度约束: %w", err)
	}
	// Create the pending-metadata partial index before backfill so both first
	// upgrade and subsequent empty scans avoid walking the full media_jobs table.
	if err := d.ensureMediaJobInputMetadataPendingIndex(ctx); err != nil {
		return fmt.Errorf("初始化 media job 输入元数据索引: %w", err)
	}
	if err := d.migrateMediaJobInputMetadata(ctx); err != nil {
		return fmt.Errorf("迁移 media job 输入元数据: %w", err)
	}
	if err := d.ensureMediaJobAccountForeignKey(ctx); err != nil {
		return fmt.Errorf("迁移 media job 账号外键: %w", err)
	}
	return nil
}

// finalizeSchemaMigration 迁移剩余约束、回填历史数据、清理冗余索引并创建统一索引。
func (d *Database) finalizeSchemaMigration(ctx context.Context) error {
	db := d.db.WithContext(ctx)
	if err := d.ensureMediaAssetConstraints(ctx); err != nil {
		return fmt.Errorf("迁移 media asset 数据库约束: %w", err)
	}
	if err := d.ensureClientKeyLimitConstraints(ctx); err != nil {
		return fmt.Errorf("迁移客户端 Key 限额约束: %w", err)
	}
	if err := d.backfillWebEgressIdentities(ctx); err != nil {
		return fmt.Errorf("迁移 Web 出口身份: %w", err)
	}
	if err := d.backfillReauthMarkedAt(ctx); err != nil {
		return fmt.Errorf("迁移 reauth_marked_at: %w", err)
	}
	if err := d.dropRedundantResponseExpiryIndexes(ctx); err != nil {
		return fmt.Errorf("迁移响应过期索引: %w", err)
	}
	if err := d.dropProviderUpstreamUniqueIndex(ctx); err != nil {
		return fmt.Errorf("迁移模型路由上游唯一约束: %w", err)
	}
	if err := d.dropModelPublicIDUniqueIndex(ctx); err != nil {
		return fmt.Errorf("迁移模型路由名称唯一约束: %w", err)
	}
	for _, statement := range schemaIndexes {
		if err := db.Exec(statement).Error; err != nil {
			return fmt.Errorf("初始化数据库索引: %w", err)
		}
	}
	if err := d.ensureCanonicalModelPublicIDs(ctx); err != nil {
		return fmt.Errorf("迁移模型 Provider 命名空间: %w", err)
	}
	return nil
}
