package relational

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/domain/media"
)

type consoleConstraint struct {
	model any
	table string
	name  string
}

func (d *Database) ensureConsoleConstraints(ctx context.Context) error {
	return d.ensureNamedConstraints(ctx, []consoleConstraint{
		{model: &accountModel{}, table: "provider_accounts", name: "chk_accounts_provider"},
		{model: &modelRouteModel{}, table: "model_routes", name: "chk_model_routes_provider"},
		{model: &requestAuditModel{}, table: "request_audits", name: "chk_request_audits_provider"},
		{model: &responseOwnershipModel{}, table: "response_ownership", name: "chk_response_ownership_provider"},
		{model: &egressNodeModel{}, table: "egress_nodes", name: "chk_egress_nodes_specific_scope"},
	}, "grok_console")
}

// ensureEgressAssetScopeConstraints upgrades existing SQLite/PostgreSQL CHECK
// definitions so Console CDN traffic can use an independently managed scope.
func (d *Database) ensureEgressAssetScopeConstraints(ctx context.Context) error {
	return d.ensureNamedConstraints(ctx, []consoleConstraint{
		{model: &egressNodeModel{}, table: "egress_nodes", name: "chk_egress_nodes_specific_scope"},
		{model: &egressSubscriptionSourceModel{}, table: "egress_subscription_sources", name: "chk_egress_subscription_sources_scope"},
		{model: &requestAuditModel{}, table: "request_audits", name: "chk_request_audits_egress_scope"},
	}, "grok_console_asset")
}

// ensureAuditOperationConstraints upgrades existing databases so Codex remote
// compaction and Console voice operations can be recorded separately.
func (d *Database) ensureAuditOperationConstraints(ctx context.Context) error {
	return d.ensureNamedConstraints(ctx, []consoleConstraint{
		{model: &requestAuditModel{}, table: "request_audits", name: "chk_request_audits_operation"},
	}, "tts")
}

// ensureModelRouteCapabilityConstraints upgrades existing databases so Console
// TTS/STT/Realtime routes can be managed alongside image and video.
func (d *Database) ensureModelRouteCapabilityConstraints(ctx context.Context) error {
	return d.ensureNamedConstraints(ctx, []consoleConstraint{
		{model: &modelRouteModel{}, table: "model_routes", name: "chk_model_routes_capability"},
	}, "tts")
}

// ensureMediaJobConstraints 将历史仅允许 grok_web 的 media job CHECK 升级到支持 Build 与 Console 视频。
// AutoMigrate 不会可靠替换已有 PostgreSQL CHECK，因此启动时幂等检测并重建。
func (d *Database) ensureMediaJobConstraints(ctx context.Context) error {
	if err := d.ensureNamedConstraints(ctx, []consoleConstraint{
		{model: &mediaJobModel{}, table: "media_jobs", name: "chk_media_jobs_provider"},
	}, "grok_console"); err != nil {
		return err
	}
	if err := d.ensureNamedConstraints(ctx, []consoleConstraint{
		{model: &mediaJobModel{}, table: "media_jobs", name: "chk_media_jobs_egress_scope"},
	}, "grok_console"); err != nil {
		return err
	}
	for _, constraint := range []consoleConstraint{
		{model: &mediaJobModel{}, table: "media_jobs", name: "chk_media_jobs_operation"},
		{model: &mediaJobModel{}, table: "media_jobs", name: "chk_media_jobs_seconds"},
		{model: &mediaJobModel{}, table: "media_jobs", name: "chk_media_jobs_size"},
		{model: &mediaJobModel{}, table: "media_jobs", name: "chk_media_jobs_quality"},
	} {
		marker := "0"
		if constraint.name == "chk_media_jobs_operation" {
			marker = "extend"
		}
		if err := d.ensureNamedConstraints(ctx, []consoleConstraint{constraint}, marker); err != nil {
			return err
		}
	}
	return nil
}

// migrateMediaJobOperations preserves queued and in-progress edit/extension
// jobs created before media_jobs.operation existed. Those releases persisted
// the operation only in the compact JSON metadata; AutoMigrate necessarily
// fills the new non-null column with "generate", which must not change the
// request semantics when a job is recovered after an upgrade.
func (d *Database) migrateMediaJobOperations(ctx context.Context) error {
	editPattern := `%"operation":"edit"%`
	extendPattern := `%"operation":"extend"%`
	return d.db.WithContext(ctx).Exec(
		`UPDATE media_jobs
		 SET operation = CASE WHEN input_json LIKE ? THEN ? ELSE ? END
		 WHERE operation = ? AND (input_json LIKE ? OR input_json LIKE ?)`,
		editPattern, media.VideoOperationEdit, media.VideoOperationExtend,
		media.VideoOperationGenerate, editPattern, extendPattern,
	).Error
}

// ensureMediaJobInputConstraint 允许异步视频任务持久化 Base64 首图。
// SQLite 和 PostgreSQL 都不会由 AutoMigrate 可靠替换已有的同名 CHECK。
func (d *Database) ensureMediaJobInputConstraint(ctx context.Context) error {
	if err := d.ensureNamedConstraints(ctx, []consoleConstraint{
		{model: &mediaJobModel{}, table: "media_jobs", name: "chk_media_jobs_input_json"},
	}, strconv.Itoa(media.MaxInputJSONBytes)); err != nil {
		return err
	}
	return d.ensureNamedConstraints(ctx, []consoleConstraint{
		{model: &mediaJobModel{}, table: "media_jobs", name: "chk_media_jobs_input_image_count"},
	}, strconv.Itoa(media.MaxInputImages))
}

// ensureMediaJobInputMetadataPendingIndex accelerates the one-shot input_image_count
// backfill and keeps later startup probes from full-scanning media_jobs after completion.
func (d *Database) ensureMediaJobInputMetadataPendingIndex(ctx context.Context) error {
	if err := d.db.WithContext(ctx).Exec(mediaJobInputMetadataPendingIndex).Error; err != nil {
		return err
	}
	return nil
}

// ensureClientKeyLimitConstraints 将历史正数限制升级为允许 0 表示无限制。
// PostgreSQL 不会由 AutoMigrate 可靠替换同名 CHECK，因此需显式检测并重建。
func (d *Database) ensureClientKeyLimitConstraints(ctx context.Context) error {
	constraints := []consoleConstraint{
		{model: &clientKeyModel{}, table: "client_keys", name: "chk_client_keys_rpm"},
		{model: &clientKeyModel{}, table: "client_keys", name: "chk_client_keys_max_concurrent"},
	}
	migrate := func() error {
		db := d.db.WithContext(ctx)
		for _, value := range constraints {
			definition, err := d.constraintDefinition(ctx, value)
			if err != nil {
				return err
			}
			if clientKeyLimitConstraintAllowsZero(definition) {
				continue
			}
			if definition != "" {
				if err := db.Migrator().DropConstraint(value.model, value.name); err != nil {
					return fmt.Errorf("删除旧约束 %s: %w", value.name, err)
				}
			}
			if err := db.Migrator().CreateConstraint(value.model, value.name); err != nil {
				return fmt.Errorf("创建约束 %s: %w", value.name, err)
			}
		}
		return nil
	}
	if d.dialect == "sqlite" {
		return d.withSQLiteForeignKeysDisabled(ctx, migrate)
	}
	return migrate()
}

func clientKeyLimitConstraintAllowsZero(definition string) bool {
	normalized := strings.NewReplacer(" ", "", "\n", "", "\t", "", "\"", "", "`", "", "(", "", ")", "").Replace(strings.ToLower(definition))
	return strings.Contains(normalized, "between0and") || strings.Contains(normalized, ">=0")
}
