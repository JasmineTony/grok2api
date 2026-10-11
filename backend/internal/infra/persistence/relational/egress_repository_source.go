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

func (r *EgressRepository) CreateEgressSource(ctx context.Context, value egress.SubscriptionSource) (egress.SubscriptionSource, error) {
	row := fromEgressSubscriptionSourceDomain(value)
	if err := r.db.db.WithContext(ctx).Create(&row).Error; err != nil {
		return egress.SubscriptionSource{}, mapError(err)
	}
	return toEgressSubscriptionSourceDomain(row), nil
}

func (r *EgressRepository) UpdateEgressSource(ctx context.Context, value egress.SubscriptionSource) (egress.SubscriptionSource, error) {
	row := fromEgressSubscriptionSourceDomain(value)
	result := r.db.db.WithContext(ctx).Save(&row)
	if result.Error != nil {
		return egress.SubscriptionSource{}, mapError(result.Error)
	}
	if result.RowsAffected == 0 {
		return egress.SubscriptionSource{}, repository.ErrNotFound
	}
	return toEgressSubscriptionSourceDomain(row), nil
}

// DeleteEgressSource keeps already imported nodes intact. They become normal
// manually managed nodes rather than silently losing proxy configuration.
func (r *EgressRepository) DeleteEgressSource(ctx context.Context, id uint64) error {
	return r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&egressNodeModel{}).Where("source_id = ?", id).Updates(map[string]any{"source_id": nil, "source_key": ""}).Error; err != nil {
			return mapError(err)
		}
		result := tx.Delete(&egressSubscriptionSourceModel{}, id)
		if result.Error != nil {
			return mapError(result.Error)
		}
		if result.RowsAffected == 0 {
			return repository.ErrNotFound
		}
		return nil
	})
}

func (r *EgressRepository) UpdateEgressSourceSync(ctx context.Context, id uint64, syncedAt, nextSyncAt time.Time, imported int, lastError string) error {
	result := r.db.db.WithContext(ctx).Model(&egressSubscriptionSourceModel{}).Where("id = ?", id).Updates(map[string]any{
		"last_synced_at": syncedAt.UTC(), "next_sync_at": nextSyncAt.UTC(), "last_sync_imported": imported,
		"last_sync_error": lastError, "updated_at": time.Now().UTC(),
	})
	if result.Error != nil {
		return mapError(result.Error)
	}
	if result.RowsAffected == 0 {
		return repository.ErrNotFound
	}
	return nil
}

// UpsertEgressNodesFromSource replaces the active representation of a source
// atomically. Stale nodes are disabled instead of deleted so auto-assigned
// accounts can be moved by the next balancing cycle without touching manual
// bindings.
func (r *EgressRepository) UpsertEgressNodesFromSource(ctx context.Context, sourceID uint64, values []egress.Node) (int, error) {
	if sourceID == 0 {
		return 0, errors.New("subscription source id is required")
	}
	returned := 0
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existingKeys []string
		if err := tx.Model(&egressNodeModel{}).Where("source_id = ?", sourceID).Pluck("source_key", &existingKeys).Error; err != nil {
			return mapError(err)
		}
		existing := make(map[string]struct{}, len(existingKeys))
		for _, key := range existingKeys {
			existing[key] = struct{}{}
		}
		keys, imported, err := upsertEgressNodesFromSource(tx, sourceID, values, existing)
		returned = imported
		if err != nil {
			return err
		}
		if err := disableStaleEgressNodesFromSource(tx, sourceID, keys); err != nil {
			return err
		}
		if err := clearInvalidEgressFallbackNodeReferences(tx); err != nil {
			return err
		}
		return nil
	})
	return returned, err
}

func upsertEgressNodesFromSource(tx *gorm.DB, sourceID uint64, values []egress.Node, existing map[string]struct{}) ([]string, int, error) {
	keys := make([]string, 0, len(values))
	returned := 0
	for _, value := range values {
		if value.SourceID != sourceID || value.SourceKey == "" {
			return keys, returned, errors.New("invalid subscription node")
		}
		row := fromEgressDomain(value)
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "source_id"}, {Name: "source_key"}},
			DoUpdates: clause.Assignments(map[string]any{
				"name": row.Name, "scope": row.Scope, "enabled": row.Enabled, "proxy_pool": row.ProxyPool,
				"account_capacity": row.AccountCapacity, "encrypted_proxy_url": row.EncryptedProxyURL,
				"updated_at": time.Now().UTC(),
			}),
		}).Create(&row).Error; err != nil {
			return keys, returned, mapError(err)
		}
		keys = append(keys, value.SourceKey)
		if _, found := existing[value.SourceKey]; !found {
			returned++
			existing[value.SourceKey] = struct{}{}
		}
	}
	return keys, returned, nil
}

func disableStaleEgressNodesFromSource(tx *gorm.DB, sourceID uint64, keys []string) error {
	stale := tx.Model(&egressNodeModel{}).Where("source_id = ?", sourceID)
	if len(keys) > 0 {
		stale = stale.Where("source_key NOT IN ?", keys)
	}
	if err := stale.Updates(map[string]any{
		"enabled": false, "probe_status": string(egress.ProbeStatusUnknown), "probe_error": "subscription entry removed", "probe_provider": "",
		"ipv4_probe_status": string(egress.ProbeStatusUnknown), "ipv4_last_probed_at": nil, "ipv4_probe_latency_ms": 0, "ipv4_exit_ip": "", "ipv4_probe_error": "subscription entry removed",
		"ipv6_probe_status": string(egress.ProbeStatusUnknown), "ipv6_last_probed_at": nil, "ipv6_probe_latency_ms": 0, "ipv6_exit_ip": "", "ipv6_probe_error": "subscription entry removed",
		"updated_at": time.Now().UTC(),
	}).Error; err != nil {
		return mapError(err)
	}
	return nil
}
