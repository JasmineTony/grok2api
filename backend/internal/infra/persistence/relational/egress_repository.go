package relational

import (
	"context"
	"errors"

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
	for _, row := range rows {
		values = append(values, toEgressDomain(row))
	}
	return values, nil
}

func (r *EgressRepository) GetEgressNode(ctx context.Context, id uint64) (egress.Node, error) {
	var row egressNodeModel
	if err := r.db.db.WithContext(ctx).First(&row, id).Error; err != nil {
		return egress.Node{}, mapError(err)
	}
	return toEgressDomain(row), nil
}

func (r *EgressRepository) CreateEgressNode(ctx context.Context, value egress.Node) (egress.Node, error) {
	row := fromEgressDomain(value)
	if err := r.db.db.WithContext(ctx).Create(&row).Error; err != nil {
		return egress.Node{}, mapError(err)
	}
	return toEgressDomain(row), nil
}

func (r *EgressRepository) UpdateEgressNode(ctx context.Context, value egress.Node) (egress.Node, error) {
	row := fromEgressDomain(value)
	result := r.db.db.WithContext(ctx).Save(&row)
	if result.Error != nil {
		return egress.Node{}, mapError(result.Error)
	}
	if result.RowsAffected == 0 {
		return egress.Node{}, repository.ErrNotFound
	}
	return toEgressDomain(row), nil
}

func (r *EgressRepository) DeleteEgressNode(ctx context.Context, id uint64) error {
	result := r.db.db.WithContext(ctx).Delete(&egressNodeModel{}, id)
	if result.Error != nil {
		return mapError(result.Error)
	}
	if result.RowsAffected == 0 {
		return repository.ErrNotFound
	}
	return nil
}

func (r *EgressRepository) GetAccountEgressPolicy(ctx context.Context, accountID uint64) (egress.AccountPolicy, error) {
	if accountID == 0 {
		return egress.AccountPolicy{}, repository.ErrNotFound
	}
	var row accountEgressPolicyModel
	if err := r.db.db.WithContext(ctx).Where("account_id = ?", accountID).First(&row).Error; err == nil {
		return toAccountEgressPolicyDomain(row), nil
	} else if !errors.Is(mapError(err), repository.ErrNotFound) {
		return egress.AccountPolicy{}, mapError(err)
	}
	var count int64
	if err := r.db.db.WithContext(ctx).Model(&accountModel{}).Where("id = ?", accountID).Count(&count).Error; err != nil {
		return egress.AccountPolicy{}, err
	}
	if count == 0 {
		return egress.AccountPolicy{}, repository.ErrNotFound
	}
	return egress.AccountPolicy{AccountID: accountID, Strategy: egress.AccountPolicyInherit}, nil
}

func (r *EgressRepository) UpsertAccountEgressPolicy(ctx context.Context, value egress.AccountPolicy) (egress.AccountPolicy, error) {
	if value.AccountID == 0 || !value.Strategy.IsValid() {
		return egress.AccountPolicy{}, repository.ErrConflict
	}
	var accountRow accountModel
	if err := r.db.db.WithContext(ctx).Select("id", "provider").Where("id = ?", value.AccountID).First(&accountRow).Error; err != nil {
		return egress.AccountPolicy{}, mapError(err)
	}
	if value.Strategy == egress.AccountPolicyInherit {
		if err := r.db.db.WithContext(ctx).Where("account_id = ?", value.AccountID).Delete(&accountEgressPolicyModel{}).Error; err != nil {
			return egress.AccountPolicy{}, err
		}
		return egress.AccountPolicy{AccountID: value.AccountID, Strategy: egress.AccountPolicyInherit}, nil
	}
	if value.Strategy == egress.AccountPolicyDirect {
		value.EgressNodeID = nil
	}
	if value.Strategy == egress.AccountPolicyNode {
		if value.EgressNodeID == nil || *value.EgressNodeID == 0 {
			return egress.AccountPolicy{}, repository.ErrConflict
		}
		var node egressNodeModel
		if err := r.db.db.WithContext(ctx).Where("id = ?", *value.EgressNodeID).First(&node).Error; err != nil {
			return egress.AccountPolicy{}, mapError(err)
		}
		if !accountProviderAllowsEgressScope(accountRow.Provider, egress.Scope(node.Scope)) {
			return egress.AccountPolicy{}, repository.ErrConflict
		}
	}
	row := fromAccountEgressPolicyDomain(value)
	var existing accountEgressPolicyModel
	if err := r.db.db.WithContext(ctx).Where("account_id = ?", value.AccountID).First(&existing).Error; err == nil {
		row.CreatedAt = existing.CreatedAt
	}
	if err := r.db.db.WithContext(ctx).Save(&row).Error; err != nil {
		return egress.AccountPolicy{}, mapError(err)
	}
	return toAccountEgressPolicyDomain(row), nil
}

func (r *EgressRepository) DeleteAccountEgressPolicy(ctx context.Context, accountID uint64) error {
	return r.db.db.WithContext(ctx).Where("account_id = ?", accountID).Delete(&accountEgressPolicyModel{}).Error
}

func accountProviderAllowsEgressScope(provider string, scope egress.Scope) bool {
	switch provider {
	case "grok_build":
		return scope == egress.ScopeBuild
	case "grok_web":
		return scope == egress.ScopeWeb
	case "grok_console":
		return scope == egress.ScopeConsole || scope == egress.ScopeWeb
	default:
		return false
	}
}

func toAccountEgressPolicyDomain(row accountEgressPolicyModel) egress.AccountPolicy {
	return egress.AccountPolicy{
		AccountID: row.AccountID, Strategy: egress.AccountPolicyStrategy(row.Strategy), EgressNodeID: row.EgressNodeID,
		AllowDirectFallback: row.AllowDirectFallback, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func fromAccountEgressPolicyDomain(value egress.AccountPolicy) accountEgressPolicyModel {
	return accountEgressPolicyModel{
		AccountID: value.AccountID, Strategy: string(value.Strategy), EgressNodeID: value.EgressNodeID,
		AllowDirectFallback: value.AllowDirectFallback, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt,
	}
}

func (r *EgressRepository) RecordEgressHealthCheck(ctx context.Context, value egress.HealthCheckResult) error {
	if value.NodeID == 0 || value.DurationMS < 0 || value.CheckedAt.IsZero() {
		return repository.ErrConflict
	}
	row := egressHealthCheckModel{
		NodeID: value.NodeID, Healthy: value.Healthy, DurationMS: value.DurationMS,
		ErrorCode: truncate(value.ErrorCode, 64), CheckedAt: value.CheckedAt.UTC(),
	}
	return r.db.db.WithContext(ctx).Create(&row).Error
}

func (r *EgressRepository) ListEgressHealthChecks(ctx context.Context, nodeID uint64, limit int) ([]egress.HealthCheckResult, error) {
	if nodeID == 0 {
		return nil, repository.ErrNotFound
	}
	limit = max(1, min(limit, 100))
	var rows []egressHealthCheckModel
	if err := r.db.db.WithContext(ctx).Where("node_id = ?", nodeID).Order("checked_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	values := make([]egress.HealthCheckResult, 0, len(rows))
	for _, row := range rows {
		values = append(values, egress.HealthCheckResult{
			ID: row.ID, NodeID: row.NodeID, Healthy: row.Healthy, DurationMS: row.DurationMS,
			ErrorCode: row.ErrorCode, CheckedAt: row.CheckedAt,
		})
	}
	return values, nil
}

func toEgressDomain(row egressNodeModel) egress.Node {
	return egress.Node{
		ID: row.ID, Name: row.Name, Scope: egress.Scope(row.Scope), Enabled: row.Enabled,
		EncryptedProxyURL: row.EncryptedProxyURL, UserAgent: row.UserAgent, EncryptedCloudflareCookie: row.EncryptedCloudflareCookie,
		Health: row.Health, FailureCount: row.FailureCount, CooldownUntil: row.CooldownUntil, LastError: row.LastError,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func fromEgressDomain(value egress.Node) egressNodeModel {
	health := value.Health
	if health == 0 && value.ID == 0 {
		health = 1
	}
	return egressNodeModel{
		ID: value.ID, Name: value.Name, Scope: string(value.Scope), Enabled: value.Enabled,
		EncryptedProxyURL: value.EncryptedProxyURL, UserAgent: value.UserAgent, EncryptedCloudflareCookie: value.EncryptedCloudflareCookie,
		Health: health, FailureCount: value.FailureCount, CooldownUntil: value.CooldownUntil, LastError: value.LastError,
		CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt,
	}
}
