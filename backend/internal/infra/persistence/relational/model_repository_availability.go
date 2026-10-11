package relational

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/model"
	"gorm.io/gorm"
)

func (r *ModelRepository) availableRoutes(query *gorm.DB) *gorm.DB {
	return query.Where(availableRoutePredicate, true, account.AuthStatusActive)
}

func (r *ModelRepository) annotateAvailability(ctx context.Context, values []model.Route) error {
	if len(values) == 0 {
		return nil
	}
	ids := make([]uint64, 0, len(values))
	for _, value := range values {
		ids = append(ids, value.ID)
	}
	type availabilityRow struct {
		RouteID           uint64
		SupportedAccounts int
		SyncedAccounts    int
		TotalAccounts     int
		LastSyncedUnix    sql.NullInt64
	}
	var rows []availabilityRow
	lastSyncedExpression := "MAX(unixepoch(sync.last_success_at))"
	if r.db.dialect == "postgres" {
		lastSyncedExpression = "CAST(MAX(EXTRACT(EPOCH FROM sync.last_success_at)) AS BIGINT)"
	}
	err := r.db.db.WithContext(ctx).Raw(fmt.Sprintf(`
		SELECT route.id AS route_id,
			CASE WHEN COUNT(DISTINCT binding.account_id) > 0
				THEN COUNT(DISTINCT CASE WHEN account.enabled = TRUE AND account.auth_status = ? AND binding.account_id IS NOT NULL THEN account.id END)
				ELSE COUNT(DISTINCT CASE WHEN account.enabled = TRUE AND account.auth_status = ? AND (`+modelConsoleStaticSupportAvailabilityExpression+` OR `+modelWebBasicMediaStaticSupportAvailabilityExpression+` OR capability.account_id IS NOT NULL OR `+modelSharedPaidBuildSupportAvailabilityExpression+`) THEN account.id END)
			END AS supported_accounts,
			CASE WHEN COUNT(DISTINCT binding.account_id) > 0
				THEN COUNT(DISTINCT CASE WHEN account.enabled = TRUE AND account.auth_status = ? AND binding.account_id IS NOT NULL AND sync.last_success_at IS NOT NULL THEN account.id END)
				ELSE COUNT(DISTINCT CASE WHEN account.enabled = TRUE AND account.auth_status = ? AND sync.last_success_at IS NOT NULL THEN account.id END)
			END AS synced_accounts,
			CASE WHEN COUNT(DISTINCT binding.account_id) > 0
				THEN COUNT(DISTINCT binding.account_id)
				ELSE COUNT(DISTINCT CASE WHEN account.enabled = TRUE AND account.auth_status = ? THEN account.id END)
			END AS total_accounts,
			%s AS last_synced_unix
		FROM model_routes route
		LEFT JOIN provider_accounts account ON account.provider = route.provider
		LEFT JOIN model_route_accounts binding ON binding.model_route_id = route.id AND binding.account_id = account.id
		LEFT JOIN account_model_sync_states sync ON sync.account_id = account.id
		LEFT JOIN account_model_capabilities capability ON capability.account_id = account.id AND capability.upstream_model = route.upstream_model
		WHERE route.id IN ?
		GROUP BY route.id
	`, lastSyncedExpression), account.AuthStatusActive, account.AuthStatusActive, account.AuthStatusActive, account.AuthStatusActive, account.AuthStatusActive, ids).Scan(&rows).Error
	if err != nil {
		return err
	}
	var bindings []modelRouteAccountModel
	if err := r.db.db.WithContext(ctx).Where("model_route_id IN ?", ids).Order("model_route_id ASC, account_id ASC").Find(&bindings).Error; err != nil {
		return err
	}
	boundByRoute := make(map[uint64][]uint64, len(values))
	for _, binding := range bindings {
		boundByRoute[binding.ModelRouteID] = append(boundByRoute[binding.ModelRouteID], binding.AccountID)
	}
	byID := make(map[uint64]availabilityRow, len(rows))
	for _, row := range rows {
		byID[row.RouteID] = row
	}
	for index := range values {
		row := byID[values[index].ID]
		values[index].SupportedAccounts = row.SupportedAccounts
		values[index].SyncedAccounts = row.SyncedAccounts
		values[index].TotalAccounts = row.TotalAccounts
		values[index].BoundAccountIDs = boundByRoute[values[index].ID]
		if row.LastSyncedUnix.Valid {
			lastSyncedAt := time.Unix(row.LastSyncedUnix.Int64, 0).UTC()
			values[index].LastSyncedAt = &lastSyncedAt
		}
	}
	return nil
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func mapModelRows(rows []modelRouteModel) []model.Route {
	out := make([]model.Route, 0, len(rows))
	for _, row := range rows {
		out = append(out, toModelDomain(row))
	}
	return out
}

func normalizeRouteOrigin(value, fallback model.Origin) model.Origin {
	if value == model.OriginCatalog || value == model.OriginDiscovered || value == model.OriginManual {
		return value
	}
	return fallback
}
