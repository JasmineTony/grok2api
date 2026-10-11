package relational

import (
	"context"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

func (r *EgressRepository) ListDueEgressNodes(ctx context.Context, now time.Time, interval time.Duration, limit int) ([]egress.Node, error) {
	if limit < 1 {
		return []egress.Node{}, nil
	}
	if interval <= 0 {
		interval = 15 * time.Minute
	}
	var rows []egressNodeModel
	if err := r.db.db.WithContext(ctx).
		Where("enabled = ? AND encrypted_proxy_url <> '' AND (last_probed_at IS NULL OR last_probed_at <= ?)", true, now.UTC().Add(-interval)).
		Order("last_probed_at ASC NULLS FIRST, id ASC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, mapError(err)
	}
	values := make([]egress.Node, 0, len(rows))
	for _, row := range rows {
		values = append(values, toEgressDomain(row))
	}
	return values, nil
}

func (r *EgressRepository) ListEgressSources(ctx context.Context) ([]egress.SubscriptionSource, error) {
	var rows []egressSubscriptionSourceModel
	if err := r.db.db.WithContext(ctx).Order("name ASC, id ASC").Find(&rows).Error; err != nil {
		return nil, mapError(err)
	}
	values := make([]egress.SubscriptionSource, 0, len(rows))
	for _, row := range rows {
		values = append(values, toEgressSubscriptionSourceDomain(row))
	}
	return values, nil
}

func (r *EgressRepository) ListEgressSourcePage(ctx context.Context, input repository.EgressSourceListQuery) ([]egress.SubscriptionSource, int64, error) {
	query := r.db.db.WithContext(ctx).Model(&egressSubscriptionSourceModel{})
	if search := strings.TrimSpace(input.Page.Search); search != "" {
		query = query.Where("LOWER(egress_subscription_sources.name) LIKE ?", "%"+strings.ToLower(search)+"%")
	}
	if input.Filter.Scope != "" {
		query = query.Where("egress_subscription_sources.scope = ?", input.Filter.Scope)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, mapError(err)
	}
	var rows []egressSubscriptionSourceModel
	if err := query.Order("LOWER(egress_subscription_sources.name) ASC, egress_subscription_sources.id ASC").
		Offset(input.Page.Offset).Limit(input.Page.Limit).Find(&rows).Error; err != nil {
		return nil, 0, mapError(err)
	}
	values := make([]egress.SubscriptionSource, 0, len(rows))
	for _, row := range rows {
		values = append(values, toEgressSubscriptionSourceDomain(row))
	}
	return values, total, nil
}

func (r *EgressRepository) ListDueEgressSources(ctx context.Context, now time.Time, limit int) ([]egress.SubscriptionSource, error) {
	if limit < 1 {
		return []egress.SubscriptionSource{}, nil
	}
	var rows []egressSubscriptionSourceModel
	if err := r.db.db.WithContext(ctx).
		Where("enabled = ? AND encrypted_url <> '' AND (next_sync_at IS NULL OR next_sync_at <= ?)", true, now.UTC()).
		Order("next_sync_at ASC NULLS FIRST, id ASC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, mapError(err)
	}
	values := make([]egress.SubscriptionSource, 0, len(rows))
	for _, row := range rows {
		values = append(values, toEgressSubscriptionSourceDomain(row))
	}
	return values, nil
}

func (r *EgressRepository) GetEgressSource(ctx context.Context, id uint64) (egress.SubscriptionSource, error) {
	var row egressSubscriptionSourceModel
	if err := r.db.db.WithContext(ctx).First(&row, id).Error; err != nil {
		return egress.SubscriptionSource{}, mapError(err)
	}
	return toEgressSubscriptionSourceDomain(row), nil
}

func (r *EgressRepository) assignedAccountCounts(ctx context.Context) (map[uint64]int, error) {
	return r.assignedAccountCountsForNodes(ctx, nil)
}

func (r *EgressRepository) egressProxyProfileNames(ctx context.Context, nodes []egressNodeModel) (map[uint64]string, error) {
	ids := make([]uint64, 0)
	seen := make(map[uint64]struct{})
	for _, node := range nodes {
		id := valueEgressNodeID(node.ProxyProfileID)
		if id == 0 {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return map[uint64]string{}, nil
	}
	type row struct {
		ID   uint64
		Name string
	}
	var rows []row
	if err := r.db.db.WithContext(ctx).Model(&egressProxyProfileModel{}).Select("id", "name").Where("id IN ?", ids).Scan(&rows).Error; err != nil {
		return nil, err
	}
	result := make(map[uint64]string, len(rows))
	for _, row := range rows {
		result[row.ID] = row.Name
	}
	return result, nil
}

func (r *EgressRepository) assignedAccountCountsForNodes(ctx context.Context, nodeIDs []uint64) (map[uint64]int, error) {
	type row struct {
		NodeID uint64
		Count  int
	}
	var rows []row
	query := r.db.db.WithContext(ctx).Model(&accountModel{}).
		Select("egress_node_id AS node_id, COUNT(*) AS count").
		Where("egress_node_id IS NOT NULL")
	if nodeIDs != nil {
		if len(nodeIDs) == 0 {
			return map[uint64]int{}, nil
		}
		query = query.Where("egress_node_id IN ?", nodeIDs)
	}
	if err := query.Group("egress_node_id").Scan(&rows).Error; err != nil {
		return nil, err
	}
	result := make(map[uint64]int, len(rows))
	for _, row := range rows {
		result[row.NodeID] = row.Count
	}
	return result, nil
}
