package relational

import (
	"context"

	"github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *EgressRepository) DeleteEgressNode(ctx context.Context, id uint64) error {
	return r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&accountModel{}).Where("egress_node_id = ?", id).Updates(map[string]any{
			"egress_node_id": nil, "egress_assignment_mode": "", "egress_assigned_at": nil,
		})
		if result.Error != nil {
			return result.Error
		}
		if err := clearEgressFallbackNodeReferences(tx, []uint64{id}); err != nil {
			return err
		}
		result = tx.Delete(&egressNodeModel{}, id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return repository.ErrNotFound
		}
		return nil
	})
}

// DeleteEgressNodes deletes a selection atomically. Account bindings are
// removed first so no account can retain a reference to a deleted node.
func (r *EgressRepository) DeleteEgressNodes(ctx context.Context, ids []uint64) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var deleted int64
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		deleted, err = deleteEgressNodeIDs(tx, ids)
		return err
	})
	return int(deleted), mapError(err)
}

func (r *EgressRepository) PreviewUnhealthyEgressNodes(ctx context.Context) (repository.EgressNodeCleanupPreview, error) {
	var result repository.EgressNodeCleanupPreview
	if err := r.unhealthyEgressNodes(ctx).Count(&result.Nodes).Error; err != nil {
		return result, mapError(err)
	}
	if err := r.unhealthyEgressNodes(ctx).Where("source_id IS NOT NULL").Count(&result.SubscriptionManaged).Error; err != nil {
		return result, mapError(err)
	}
	subquery := r.db.db.WithContext(ctx).Model(&egressNodeModel{}).Select("id").
		Where("ipv4_probe_status = ? AND ipv6_probe_status = ?", egress.ProbeStatusUnhealthy, egress.ProbeStatusUnhealthy)
	if err := r.db.db.WithContext(ctx).Model(&accountModel{}).Where("egress_node_id IN (?)", subquery).Count(&result.BoundAccounts).Error; err != nil {
		return result, mapError(err)
	}
	return result, nil
}

func (r *EgressRepository) unhealthyEgressNodes(ctx context.Context) *gorm.DB {
	return r.db.db.WithContext(ctx).Model(&egressNodeModel{}).
		Where("ipv4_probe_status = ? AND ipv6_probe_status = ?", egress.ProbeStatusUnhealthy, egress.ProbeStatusUnhealthy)
}

func (r *EgressRepository) DeleteUnhealthyEgressNodes(ctx context.Context) ([]uint64, error) {
	ids := make([]uint64, 0)
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		query := tx.Model(&egressNodeModel{}).
			Where("ipv4_probe_status = ? AND ipv6_probe_status = ?", egress.ProbeStatusUnhealthy, egress.ProbeStatusUnhealthy).
			Order("id ASC")
		if tx.Dialector.Name() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.Pluck("id", &ids).Error; err != nil {
			return err
		}
		_, err := deleteEgressNodeIDs(tx, ids)
		return err
	})
	return ids, mapError(err)
}

func deleteEgressNodeIDs(tx *gorm.DB, ids []uint64) (int64, error) {
	var deleted int64
	for start := 0; start < len(ids); start += 500 {
		end := min(start+500, len(ids))
		batch := ids[start:end]
		if result := tx.Model(&accountModel{}).Where("egress_node_id IN ?", batch).Updates(map[string]any{
			"egress_node_id": nil, "egress_assignment_mode": "", "egress_assigned_at": nil,
		}); result.Error != nil {
			return deleted, result.Error
		}
		if err := clearEgressFallbackNodeReferences(tx, batch); err != nil {
			return deleted, err
		}
		result := tx.Where("id IN ?", batch).Delete(&egressNodeModel{})
		if result.Error != nil {
			return deleted, result.Error
		}
		deleted += result.RowsAffected
	}
	return deleted, nil
}
