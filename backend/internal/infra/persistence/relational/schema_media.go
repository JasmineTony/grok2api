package relational

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/domain/media"
)

// migrateMediaJobInputMetadata backfills the compact image count introduced
// after InputJSON began accepting large Base64 references. Already-audited
// terminal jobs can discard the raw payload immediately; active and unaudited
// jobs retain it for worker recovery.
func (d *Database) migrateMediaJobInputMetadata(ctx context.Context) error {
	db := d.db.WithContext(ctx)
	terminal := []string{"completed", "failed"}
	if err := db.Model(&mediaJobModel{}).
		Where("status IN ? AND usage_recorded_at IS NOT NULL AND input_json <> ?", terminal, "{}").
		UpdateColumn("input_json", "{}").Error; err != nil {
		return err
	}
	type inputRow struct {
		ID        string
		InputJSON string
	}
	const batchSize = 8
	cursor := ""
	for {
		var rows []inputRow
		query := db.Model(&mediaJobModel{}).
			Select("id", "input_json").
			Where("id > ? AND input_image_count IS NULL", cursor).
			Order("id ASC").Limit(batchSize)
		if err := query.Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		for _, row := range rows {
			var input struct {
				ImageURLs []string `json:"image_urls"`
			}
			parseErr := json.Unmarshal([]byte(row.InputJSON), &input)
			count := min(len(input.ImageURLs), media.MaxInputImages)
			updates := map[string]any{"input_image_count": count}
			// Historical code treated malformed or empty input as no references.
			// Normalize it once so future startups do not rescan the same row.
			if parseErr != nil || count == 0 {
				updates["input_json"] = "{}"
			}
			if err := db.Model(&mediaJobModel{}).Where("id = ?", row.ID).UpdateColumns(updates).Error; err != nil {
				return err
			}
		}
		cursor = rows[len(rows)-1].ID
	}
}

// ensureMediaJobAccountForeignKey 让终态视频任务在账号删除后保留快照，
// 同时由应用层阻止删除仍有关联 queued/in_progress 任务的账号。
func (d *Database) ensureMediaJobAccountForeignKey(ctx context.Context) error {
	constraint := consoleConstraint{model: &mediaJobModel{}, table: "media_jobs", name: "fk_media_jobs_account"}
	definition, err := d.constraintDefinition(ctx, constraint)
	if err != nil {
		return err
	}
	if d.dialect == "postgres" {
		db := d.db.WithContext(ctx)
		if err := db.Exec("ALTER TABLE media_jobs ALTER COLUMN account_id DROP NOT NULL").Error; err != nil {
			return err
		}
		if strings.Contains(strings.ToUpper(definition), "ON DELETE SET NULL") {
			return nil
		}
		if err := db.Exec("ALTER TABLE media_jobs DROP CONSTRAINT IF EXISTS fk_media_jobs_account").Error; err != nil {
			return err
		}
		return db.Exec("ALTER TABLE media_jobs ADD CONSTRAINT fk_media_jobs_account FOREIGN KEY (account_id) REFERENCES provider_accounts(id) ON UPDATE CASCADE ON DELETE SET NULL").Error
	}
	if strings.Contains(strings.ToUpper(definition), "ON DELETE SET NULL") {
		return nil
	}
	return d.withSQLiteForeignKeysDisabled(ctx, func() error {
		migrator := d.db.WithContext(ctx).Migrator()
		if err := migrator.AlterColumn(&mediaJobModel{}, "AccountID"); err != nil {
			return err
		}
		if definition != "" {
			if err := migrator.DropConstraint(&mediaJobModel{}, "Account"); err != nil {
				return err
			}
		}
		return migrator.CreateConstraint(&mediaJobModel{}, "Account")
	})
}

// ensureMediaAssetConstraints 升级历史仅允许 image 的媒体资产 CHECK，以支持 video 与更大体积。
func (d *Database) ensureMediaAssetConstraints(ctx context.Context) error {
	if err := d.ensureNamedConstraints(ctx, []consoleConstraint{
		{model: &mediaAssetModel{}, table: "media_assets", name: "chk_media_assets_kind"},
	}, "video"); err != nil {
		return err
	}
	if err := d.ensureNamedConstraints(ctx, []consoleConstraint{
		{model: &mediaAssetModel{}, table: "media_assets", name: "chk_media_assets_mime"},
	}, "video/mp4"); err != nil {
		return err
	}
	return d.ensureNamedConstraints(ctx, []consoleConstraint{
		{model: &mediaAssetModel{}, table: "media_assets", name: "chk_media_assets_size"},
	}, "268435456")
}
