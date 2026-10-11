package relational

import (
	"context"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

type EgressRepository struct{ db *Database }

func NewEgressRepository(db *Database) *EgressRepository { return &EgressRepository{db: db} }

func (r *EgressRepository) ListEgressNodes(ctx context.Context, scope egress.Scope, sort repository.SortQuery) ([]egress.Node, error) {
	query := r.db.db.WithContext(ctx).Model(&egressNodeModel{})
	if scope != "" {
		query = query.Where("scope = ?", scope)
	}
	var rows []egressNodeModel
	query = applyStableSort(query, sort, map[string]sortSpec{
		"name":      {expression: "LOWER(egress_nodes.name)"},
		"scope":     {expression: "egress_nodes.scope"},
		"proxy":     {expression: "CASE WHEN egress_nodes.encrypted_proxy_url <> '' THEN 0 ELSE 1 END"},
		"clearance": {expression: "CASE WHEN egress_nodes.encrypted_cloudflare_cookie <> '' THEN 0 ELSE 1 END"},
		"health":    {expression: "egress_nodes.health", defaultDirection: repository.SortDescending},
	}, sortSpec{expression: "egress_nodes.scope"}, "egress_nodes.id")
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	values := make([]egress.Node, 0, len(rows))
	counts, err := r.assignedAccountCounts(ctx)
	if err != nil {
		return nil, err
	}
	profileNames, err := r.egressProxyProfileNames(ctx, rows)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		value := toEgressDomain(row)
		value.AssignedAccountCount = counts[value.ID]
		value.ProxyProfileName = profileNames[value.ProxyProfileID]
		values = append(values, value)
	}
	return values, nil
}

func (r *EgressRepository) ListEgressNodePage(ctx context.Context, input repository.EgressNodeListQuery) ([]egress.Node, int64, error) {
	query := r.db.db.WithContext(ctx).Model(&egressNodeModel{})
	if search := strings.TrimSpace(input.Page.Search); search != "" {
		query = query.Where("LOWER(egress_nodes.name) LIKE ?", "%"+strings.ToLower(search)+"%")
	}
	if input.Filter.Scope != "" {
		query = query.Where("egress_nodes.scope = ?", input.Filter.Scope)
	}
	if input.Filter.Enabled != nil {
		query = query.Where("egress_nodes.enabled = ?", *input.Filter.Enabled)
	}
	if input.Filter.ProbeStatus != "" {
		query = query.Where("egress_nodes.probe_status = ?", input.Filter.ProbeStatus)
	}
	switch input.Filter.Assignment {
	case "bound":
		query = query.Where("EXISTS (SELECT 1 FROM provider_accounts account WHERE account.egress_node_id = egress_nodes.id)")
	case "unbound":
		query = query.Where("NOT EXISTS (SELECT 1 FROM provider_accounts account WHERE account.egress_node_id = egress_nodes.id)")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	query = applyStableSort(query, input.Page.Sort, map[string]sortSpec{
		"name":      {expression: "LOWER(egress_nodes.name)"},
		"scope":     {expression: "egress_nodes.scope"},
		"proxy":     {expression: "CASE WHEN egress_nodes.encrypted_proxy_url <> '' THEN 0 ELSE 1 END"},
		"clearance": {expression: "CASE WHEN egress_nodes.encrypted_cloudflare_cookie <> '' THEN 0 ELSE 1 END"},
		"health":    {expression: "egress_nodes.health", defaultDirection: repository.SortDescending},
	}, sortSpec{expression: "egress_nodes.scope"}, "egress_nodes.id")
	var rows []egressNodeModel
	if err := query.Offset(input.Page.Offset).Limit(input.Page.Limit).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	if len(rows) == 0 {
		return []egress.Node{}, total, nil
	}

	ids := make([]uint64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	counts, err := r.assignedAccountCountsForNodes(ctx, ids)
	if err != nil {
		return nil, 0, err
	}
	profileNames, err := r.egressProxyProfileNames(ctx, rows)
	if err != nil {
		return nil, 0, err
	}
	values := make([]egress.Node, 0, len(rows))
	for _, row := range rows {
		value := toEgressDomain(row)
		value.AssignedAccountCount = counts[value.ID]
		value.ProxyProfileName = profileNames[value.ProxyProfileID]
		values = append(values, value)
	}
	return values, total, nil
}

func (r *EgressRepository) GetEgressNode(ctx context.Context, id uint64) (egress.Node, error) {
	var row egressNodeModel
	if err := r.db.db.WithContext(ctx).First(&row, id).Error; err != nil {
		return egress.Node{}, mapError(err)
	}
	// AssignedAccountCount is management-list metadata. Keep point lookups lean:
	// this method is also used by the bound-account inference hot path.
	return toEgressDomain(row), nil
}
