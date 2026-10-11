package relational

import (
	"context"
	"errors"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *EgressRepository) GetEgressOperationsConfig(ctx context.Context) (egress.OperationsConfig, error) {
	var row egressOperationsConfigModel
	if err := r.db.db.WithContext(ctx).First(&row, 1).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return egress.DefaultOperationsConfig(), nil
		}
		return egress.OperationsConfig{}, mapError(err)
	}
	return toEgressOperationsConfigDomain(row), nil
}

func (r *EgressRepository) SaveEgressOperationsConfig(ctx context.Context, value egress.OperationsConfig) (egress.OperationsConfig, error) {
	row := fromEgressOperationsConfigDomain(value)
	row.ID = 1
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		locked, err := lockEgressOperationsConfig(tx)
		if err != nil {
			return err
		}
		// This schema-only marker is deliberately outside the domain settings.
		// Preserve it across ordinary configuration updates so the legacy proxy
		// migration cannot run again and overwrite an intentionally direct source.
		row.SubscriptionProxyMigrationCompleted = locked.SubscriptionProxyMigrationCompleted
		row.ProxyProfileMigrationCompleted = locked.ProxyProfileMigrationCompleted
		if err := validateLockedEgressFallbackNodes(tx, row); err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&row).Error
	})
	if err != nil {
		return egress.OperationsConfig{}, mapError(err)
	}
	return toEgressOperationsConfigDomain(row), nil
}

func lockEgressOperationsConfig(tx *gorm.DB) (egressOperationsConfigModel, error) {
	defaults := fromEgressOperationsConfigDomain(egress.DefaultOperationsConfig())
	defaults.ID = 1
	defaults.UpdatedAt = time.Now().UTC()
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&defaults).Error; err != nil {
		return egressOperationsConfigModel{}, err
	}
	var row egressOperationsConfigModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, 1).Error; err != nil {
		return egressOperationsConfigModel{}, err
	}
	return row, nil
}

func configReferencesAnyFallbackNode(config egressOperationsConfigModel, ids []uint64) bool {
	selected := make(map[uint64]struct{}, len(ids))
	for _, id := range ids {
		selected[id] = struct{}{}
	}
	for _, fallback := range []struct {
		mode   string
		nodeID uint64
	}{
		{config.BuildFallbackMode, config.BuildFallbackNodeID},
		{config.WebFallbackMode, config.WebFallbackNodeID},
		{config.ConsoleFallbackMode, config.ConsoleFallbackNodeID},
		{config.WebAssetFallbackMode, config.WebAssetFallbackNodeID},
		{config.ConsoleAssetFallbackMode, config.ConsoleAssetFallbackNodeID},
	} {
		if egress.FallbackMode(fallback.mode).Normalized() != egress.FallbackModeFixed {
			continue
		}
		if _, exists := selected[fallback.nodeID]; exists {
			return true
		}
	}
	return false
}

func validateLockedEgressFallbackNodes(tx *gorm.DB, config egressOperationsConfigModel) error {
	fallbacks := []struct {
		scope  egress.Scope
		mode   string
		nodeID uint64
	}{
		{egress.ScopeBuild, config.BuildFallbackMode, config.BuildFallbackNodeID},
		{egress.ScopeWeb, config.WebFallbackMode, config.WebFallbackNodeID},
		{egress.ScopeConsole, config.ConsoleFallbackMode, config.ConsoleFallbackNodeID},
		{egress.ScopeWebAsset, config.WebAssetFallbackMode, config.WebAssetFallbackNodeID},
		{egress.ScopeConsoleAsset, config.ConsoleAssetFallbackMode, config.ConsoleAssetFallbackNodeID},
	}
	ids := make([]uint64, 0, len(fallbacks))
	for _, fallback := range fallbacks {
		if egress.FallbackMode(fallback.mode).Normalized() == egress.FallbackModeFixed && fallback.nodeID != 0 {
			ids = append(ids, fallback.nodeID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	var rows []egressNodeModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ?", ids).Order("id ASC").Find(&rows).Error; err != nil {
		return err
	}
	byID := make(map[uint64]egressNodeModel, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}
	for _, fallback := range fallbacks {
		if egress.FallbackMode(fallback.mode).Normalized() != egress.FallbackModeFixed {
			continue
		}
		node, exists := byID[fallback.nodeID]
		if !exists || !node.Enabled || node.ProxyPool || node.EncryptedProxyURL == "" || !egress.SupportsScope(egress.Scope(node.Scope), fallback.scope) {
			return repository.ErrEgressFallbackInUse
		}
	}
	return nil
}

func clearEgressFallbackNodeReferences(tx *gorm.DB, ids []uint64) error {
	if len(ids) == 0 {
		return nil
	}
	for _, columns := range [][2]string{
		{"build_fallback_mode", "build_fallback_node_id"},
		{"web_fallback_mode", "web_fallback_node_id"},
		{"console_fallback_mode", "console_fallback_node_id"},
		{"web_asset_fallback_mode", "web_asset_fallback_node_id"},
		{"console_asset_fallback_mode", "console_asset_fallback_node_id"},
	} {
		if err := tx.Model(&egressOperationsConfigModel{}).
			Where("id = ? AND "+columns[1]+" IN ?", 1, ids).
			Updates(map[string]any{columns[0]: string(egress.FallbackModeNone), columns[1]: 0}).Error; err != nil {
			return err
		}
	}
	return nil
}

func clearInvalidEgressFallbackNodeReferences(tx *gorm.DB) error {
	var config egressOperationsConfigModel
	if err := tx.First(&config, 1).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	for _, fallback := range []struct {
		scope                egress.Scope
		mode                 string
		nodeID               uint64
		modeColumn, idColumn string
	}{
		{egress.ScopeBuild, config.BuildFallbackMode, config.BuildFallbackNodeID, "build_fallback_mode", "build_fallback_node_id"},
		{egress.ScopeWeb, config.WebFallbackMode, config.WebFallbackNodeID, "web_fallback_mode", "web_fallback_node_id"},
		{egress.ScopeConsole, config.ConsoleFallbackMode, config.ConsoleFallbackNodeID, "console_fallback_mode", "console_fallback_node_id"},
		{egress.ScopeWebAsset, config.WebAssetFallbackMode, config.WebAssetFallbackNodeID, "web_asset_fallback_mode", "web_asset_fallback_node_id"},
		{egress.ScopeConsoleAsset, config.ConsoleAssetFallbackMode, config.ConsoleAssetFallbackNodeID, "console_asset_fallback_mode", "console_asset_fallback_node_id"},
	} {
		if egress.FallbackMode(fallback.mode).Normalized() != egress.FallbackModeFixed {
			continue
		}
		var node egressNodeModel
		err := tx.First(&node, fallback.nodeID).Error
		valid := err == nil && node.Enabled && !node.ProxyPool && node.EncryptedProxyURL != "" && egress.SupportsScope(egress.Scope(node.Scope), fallback.scope)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if valid {
			continue
		}
		if err := tx.Model(&egressOperationsConfigModel{}).Where("id = ?", 1).
			Updates(map[string]any{fallback.modeColumn: string(egress.FallbackModeNone), fallback.idColumn: 0}).Error; err != nil {
			return err
		}
	}
	return nil
}
