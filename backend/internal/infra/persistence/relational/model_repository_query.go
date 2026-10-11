package relational

import (
	"context"
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *ModelRepository) List(ctx context.Context, input repository.ModelListQuery) ([]model.Route, int64, error) {
	var total int64
	query := r.db.db.WithContext(ctx).Model(&modelRouteModel{})
	if input.Filter.ActiveScope {
		query = r.availableRoutes(query)
	}
	if search := strings.TrimSpace(input.Page.Search); search != "" {
		pattern := "%" + strings.ToLower(search) + "%"
		query = query.Where("LOWER(public_id) LIKE ? OR LOWER(upstream_model) LIKE ?", pattern, pattern)
	}
	if input.Filter.Provider != "" {
		query = query.Where("provider = ?", input.Filter.Provider)
	}
	if len(input.Filter.Providers) > 0 {
		query = query.Where("provider IN ?", input.Filter.Providers)
	}
	tierPredicate := modelTierAvailabilityPredicate(input.Filter.Tiers)
	if input.Filter.ActiveScope {
		tierPredicate = modelTierAvailabilityPredicateWithAvailability(input.Filter.Tiers, true)
	}
	if tierPredicate != "" {
		query = query.Where(tierPredicate)
	}
	if input.Filter.Enabled != nil {
		query = query.Where("enabled = ?", *input.Filter.Enabled)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []modelRouteModel
	query = applyStableSort(query, input.Page.Sort, map[string]sortSpec{
		"publicId":       {expression: "LOWER(model_routes.public_id)"},
		"upstreamModel":  {expression: "LOWER(model_routes.upstream_model)"},
		"status":         {expression: "CASE WHEN model_routes.enabled = TRUE THEN 0 ELSE 1 END"},
		"provider":       {expression: "model_routes.provider"},
		"accountSupport": {expression: modelSupportSortExpression, defaultDirection: repository.SortDescending},
		"lastSyncedAt":   {expression: modelSyncedSortExpression, nullsLast: true, defaultDirection: repository.SortDescending},
	}, sortSpec{expression: "model_routes.created_at", defaultDirection: repository.SortDescending}, "model_routes.id")
	if err := query.Offset(input.Page.Offset).Limit(input.Page.Limit).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	values := mapModelRows(rows)
	if err := r.annotateAvailability(ctx, values); err != nil {
		return nil, 0, err
	}
	return values, total, nil
}

type modelRouteGroupRow struct {
	Provider      string
	PublicID      string
	UpstreamModel string
	Origin        string
	ManualRouteID uint64
	RouteIDs      string
}

// ListGroups paginates logical model targets before loading their member
// routes. This keeps capability groups complete under filters and avoids the
// admin UI fetching and annotating the entire route table.
func (r *ModelRepository) ListGroups(ctx context.Context, input repository.ModelListQuery) ([]model.RouteGroup, int64, error) {
	expr := modelGroupExpressionsFor(r.db.dialect, input.Page.Sort.Field)

	var total int64
	if err := r.db.db.WithContext(ctx).Table("(?) AS grouped_model_routes", r.modelRouteGroupQuery(ctx, input, expr, false)).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	query := applyModelGroupOrdering(r.modelRouteGroupQuery(ctx, input, expr, true), input, expr)
	var groupRows []modelRouteGroupRow
	if err := query.Offset(input.Page.Offset).Limit(input.Page.Limit).Scan(&groupRows).Error; err != nil {
		return nil, 0, err
	}

	groupIDs, allIDs, err := parseModelRouteGroupRowIDs(groupRows)
	if err != nil {
		return nil, 0, err
	}
	if len(allIDs) == 0 {
		return []model.RouteGroup{}, total, nil
	}
	var rows []modelRouteModel
	if err := r.db.db.WithContext(ctx).Where("id IN ?", allIDs).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	values := mapModelRows(rows)
	if err := r.annotateAvailability(ctx, values); err != nil {
		return nil, 0, err
	}
	return buildModelRouteGroups(groupIDs, values), total, nil
}

// Route-level metrics must be calculated before grouping. In particular,
// PostgreSQL does not allow a correlated metric to reference model_routes.id
// from inside a grouped SELECT when id is not itself a grouping key.
func (r *ModelRepository) modelRouteMetricsQuery(ctx context.Context, input repository.ModelListQuery, includeMetrics bool) *gorm.DB {
	columns := []string{
		"model_routes.id",
		"model_routes.provider",
		"model_routes.public_id",
		"model_routes.upstream_model",
		"model_routes.origin",
		"model_routes.enabled",
		"model_routes.created_at",
	}
	if includeMetrics && input.Page.Sort.Field == "accountSupport" {
		columns = append(columns, modelSupportSortExpression+" AS support_sort")
	}
	if includeMetrics && input.Page.Sort.Field == "lastSyncedAt" {
		columns = append(columns, modelSyncedSortExpression+" AS last_synced_sort")
	}
	query := r.db.db.WithContext(ctx).Model(&modelRouteModel{}).Select(strings.Join(columns, ", "))
	if search := strings.TrimSpace(input.Page.Search); search != "" {
		pattern := "%" + strings.ToLower(search) + "%"
		query = query.Where("LOWER(model_routes.public_id) LIKE ? OR LOWER(model_routes.upstream_model) LIKE ?", pattern, pattern)
	}
	if input.Filter.Provider != "" {
		query = query.Where("model_routes.provider = ?", input.Filter.Provider)
	}
	return query
}

// modelGroupExpressions 汇总分组查询依赖的 SQL 片段，避免调用方重复拼接。
type modelGroupExpressions struct {
	manualRouteID  string
	routeIDs       string
	enabledCount   string
	groupColumns   string
	supportSort    string
	lastSyncedSort string
}

func modelGroupExpressionsFor(dialect, sortField string) modelGroupExpressions {
	manualRouteIDExpression := "CASE WHEN route_metrics.origin = 'manual' THEN route_metrics.id ELSE 0 END"
	routeIDsExpression := "GROUP_CONCAT(CAST(route_metrics.id AS TEXT), ',')"
	if dialect == "postgres" {
		routeIDsExpression = "STRING_AGG(CAST(route_metrics.id AS TEXT), ',' ORDER BY route_metrics.id)"
	}
	enabledCountExpression := "SUM(CASE WHEN route_metrics.enabled = TRUE THEN 1 ELSE 0 END)"
	groupColumnsExpression := "route_metrics.provider, route_metrics.public_id, route_metrics.upstream_model, route_metrics.origin, " + manualRouteIDExpression
	supportSortExpression := "0"
	if sortField == "accountSupport" {
		supportSortExpression = "MAX(route_metrics.support_sort)"
	}
	lastSyncedSortExpression := "NULL"
	if sortField == "lastSyncedAt" {
		lastSyncedSortExpression = "MAX(route_metrics.last_synced_sort)"
	}
	return modelGroupExpressions{
		manualRouteID:  manualRouteIDExpression,
		routeIDs:       routeIDsExpression,
		enabledCount:   enabledCountExpression,
		groupColumns:   groupColumnsExpression,
		supportSort:    supportSortExpression,
		lastSyncedSort: lastSyncedSortExpression,
	}
}

func (r *ModelRepository) modelRouteGroupQuery(ctx context.Context, input repository.ModelListQuery, expr modelGroupExpressions, includeMetrics bool) *gorm.DB {
	query := r.db.db.WithContext(ctx).Table("(?) AS route_metrics", r.modelRouteMetricsQuery(ctx, input, includeMetrics))
	if includeMetrics {
		query = query.Select(fmt.Sprintf(`
				route_metrics.provider,
				route_metrics.public_id,
				route_metrics.upstream_model,
				route_metrics.origin,
				%s AS manual_route_id,
				%s AS route_ids,
				CASE
					WHEN %s = COUNT(*) THEN 0
					WHEN %s > 0 THEN 1
					ELSE 2
				END AS status_sort,
				%s AS group_support_sort,
				%s AS group_last_synced_sort,
				MAX(route_metrics.created_at) AS created_sort
			`, expr.manualRouteID, expr.routeIDs, expr.enabledCount, expr.enabledCount, expr.supportSort, expr.lastSyncedSort))
	} else {
		query = query.Select("route_metrics.provider, route_metrics.public_id, route_metrics.upstream_model, route_metrics.origin, " + expr.manualRouteID + " AS manual_route_id")
	}
	query = query.Group(expr.groupColumns)
	if input.Filter.Enabled != nil {
		if *input.Filter.Enabled {
			query = query.Having(expr.enabledCount + " > 0")
		} else {
			query = query.Having(expr.enabledCount + " = 0")
		}
	}
	return query
}

func applyModelGroupOrdering(query *gorm.DB, input repository.ModelListQuery, expr modelGroupExpressions) *gorm.DB {
	spec, direction := stableSortSpec(input.Page.Sort, map[string]sortSpec{
		"publicId":       {expression: "LOWER(route_metrics.public_id)"},
		"upstreamModel":  {expression: "LOWER(route_metrics.upstream_model)"},
		"status":         {expression: "status_sort"},
		"provider":       {expression: "route_metrics.provider"},
		"accountSupport": {expression: "group_support_sort", defaultDirection: repository.SortDescending},
		"lastSyncedAt":   {expression: "group_last_synced_sort", nullsLast: true, defaultDirection: repository.SortDescending},
	}, sortSpec{expression: "created_sort", defaultDirection: repository.SortDescending})
	if spec.nullsLast {
		// PostgreSQL permits a SELECT alias as a plain ORDER BY item, but not
		// inside another ORDER BY expression. Repeat the aggregate only for the
		// NULL discriminator and use the alias for the value ordering below.
		nullSortExpression := spec.expression
		if input.Page.Sort.Field == "lastSyncedAt" {
			nullSortExpression = expr.lastSyncedSort
		}
		query = query.Order("CASE WHEN " + nullSortExpression + " IS NULL THEN 1 ELSE 0 END ASC")
	}
	return query.Order(spec.expression + " " + direction).
		Order("route_metrics.provider ASC").
		Order("LOWER(route_metrics.public_id) ASC").
		Order("LOWER(route_metrics.upstream_model) ASC").
		Order("route_metrics.origin ASC").
		Order("manual_route_id ASC")
}

func parseModelRouteGroupRowIDs(groupRows []modelRouteGroupRow) ([][]uint64, []uint64, error) {
	groupIDs := make([][]uint64, 0, len(groupRows))
	allIDs := make([]uint64, 0, len(groupRows)*2)
	for _, row := range groupRows {
		ids, err := parseModelRouteGroupIDs(row.RouteIDs)
		if err != nil {
			return nil, nil, err
		}
		groupIDs = append(groupIDs, ids)
		allIDs = append(allIDs, ids...)
	}
	return groupIDs, allIDs, nil
}

func buildModelRouteGroups(groupIDs [][]uint64, values []model.Route) []model.RouteGroup {
	byID := make(map[uint64]model.Route, len(values))
	for _, value := range values {
		byID[value.ID] = value
	}
	groups := make([]model.RouteGroup, 0, len(groupIDs))
	for _, ids := range groupIDs {
		members := make([]model.Route, 0, len(ids))
		for _, id := range ids {
			if value, ok := byID[id]; ok {
				members = append(members, value)
			}
		}
		if len(members) == 0 {
			continue
		}
		groups = append(groups, model.RouteGroup{Routes: members})
	}
	return groups
}

func parseModelRouteGroupIDs(value string) ([]uint64, error) {
	parts := strings.Split(strings.TrimSpace(value), ",")
	ids := make([]uint64, 0, len(parts))
	for _, part := range parts {
		id, err := strconv.ParseUint(strings.TrimSpace(part), 10, 64)
		if err != nil || id == 0 {
			return nil, fmt.Errorf("模型能力组包含无效路由 ID %q", part)
		}
		ids = append(ids, id)
	}
	sort.Slice(ids, func(left, right int) bool { return ids[left] < ids[right] })
	return ids, nil
}

func (r *ModelRepository) ListEnabled(ctx context.Context) ([]model.Route, error) {
	var rows []modelRouteModel
	if err := r.availableRoutes(r.db.db.WithContext(ctx)).Where("enabled = ?", true).Order("public_id ASC, id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	values := mapModelRows(rows)
	if err := r.annotateAvailability(ctx, values); err != nil {
		return nil, err
	}
	return values, nil
}

func (r *ModelRepository) ListEnabledForScope(ctx context.Context, filter repository.ModelListFilter) ([]model.Route, error) {
	query := r.availableRoutes(r.db.db.WithContext(ctx)).Where("enabled = ?", true)
	if len(filter.Providers) > 0 {
		query = query.Where("provider IN ?", filter.Providers)
	}
	if tierPredicate := modelTierAvailabilityPredicateWithAvailability(filter.Tiers, true); tierPredicate != "" {
		query = query.Where(tierPredicate)
	}
	var rows []modelRouteModel
	if err := query.Order("public_id ASC, id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	values := mapModelRows(rows)
	if err := r.annotateAvailability(ctx, values); err != nil {
		return nil, err
	}
	return values, nil
}

// ListConfiguredEnabled 返回所有已启用配置，包括暂时没有可用账号的路由，供 readiness 展示部分故障。
func (r *ModelRepository) ListConfiguredEnabled(ctx context.Context) ([]model.Route, error) {
	var rows []modelRouteModel
	if err := r.db.db.WithContext(ctx).Where("enabled = ?", true).Order("public_id ASC, id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	values := mapModelRows(rows)
	if err := r.annotateAvailability(ctx, values); err != nil {
		return nil, err
	}
	return values, nil
}

func (r *ModelRepository) Get(ctx context.Context, id uint64) (model.Route, error) {
	var row modelRouteModel
	if err := r.db.db.WithContext(ctx).First(&row, id).Error; err != nil {
		return model.Route{}, mapError(err)
	}
	values := []model.Route{toModelDomain(row)}
	if err := r.annotateAvailability(ctx, values); err != nil {
		return model.Route{}, err
	}
	return values[0], nil
}

func (r *ModelRepository) GetByPublicID(ctx context.Context, publicID string) (model.Route, error) {
	values, err := r.GetByPublicIDCandidates(ctx, publicID)
	if err != nil {
		return model.Route{}, mapError(err)
	}
	return values[0], nil
}

// GetByPublicIDCandidates 返回同一下游模型名称当前可用的全部来源路由。
// 返回顺序遵循 Build、Web、Console 的稳定 Provider 顺序。
func (r *ModelRepository) GetByPublicIDCandidates(ctx context.Context, publicID string) ([]model.Route, error) {
	db := r.availableRoutes(r.db.db.WithContext(ctx)).Where("enabled = ?", true)
	rows, err := findModelRoutesByPublicID(db, publicID)
	if err != nil {
		return nil, mapError(err)
	}
	return mapModelRows(rows), nil
}

func (r *ModelRepository) GetByPublicIDIncludingDisabled(ctx context.Context, publicID string) (model.Route, error) {
	db := r.db.db.WithContext(ctx)
	rows, err := findModelRoutesByPublicID(db, publicID)
	if err != nil {
		return model.Route{}, mapError(err)
	}
	return toModelDomain(rows[0]), nil
}

func findModelRoutesByPublicID(db *gorm.DB, publicID string) ([]modelRouteModel, error) {
	groups := model.PublicIDCandidateGroups(publicID)
	requested := strings.TrimSpace(publicID)
	for index, candidates := range groups {
		aliasRequested := ""
		if len(groups) == 1 || index == len(groups)-1 {
			aliasRequested = requested
		}
		rows, err := findModelRoutesByPublicIDGroup(db, candidates, aliasRequested)
		if err != nil {
			return nil, err
		}
		if len(rows) > 0 {
			return rows, nil
		}
	}
	if len(groups) > 0 {
		return nil, gorm.ErrRecordNotFound
	}
	query := db.Session(&gorm.Session{})
	query = query.Where(`
		EXISTS (
			SELECT 1 FROM model_route_aliases alias
			WHERE alias.model_route_id = model_routes.id AND alias.alias = ?
		)
	`, requested).Order(modelProviderPriorityExpression + ", model_routes.id ASC")
	var rows []modelRouteModel
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return rows, nil
}

func findModelRoutesByPublicIDGroup(db *gorm.DB, candidates []string, requested string) ([]modelRouteModel, error) {
	aliasCandidates := append([]string(nil), candidates...)
	if requested != "" && !slices.Contains(aliasCandidates, requested) {
		aliasCandidates = append(aliasCandidates, requested)
	}
	query := db.Session(&gorm.Session{}).Where(`
		(model_routes.public_id IN ? OR EXISTS (
			SELECT 1 FROM model_route_aliases alias
			WHERE alias.model_route_id = model_routes.id AND alias.alias IN ?
		))
	`, candidates, aliasCandidates).Clauses(clause.OrderBy{Expression: clause.Expr{
		SQL:  "CASE WHEN model_routes.public_id IN ? THEN 0 ELSE 1 END, " + modelProviderPriorityExpression + ", model_routes.id ASC",
		Vars: []any{candidates},
	}})
	var rows []modelRouteModel
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *ModelRepository) GetByProviderUpstream(ctx context.Context, provider account.Provider, upstreamModel string) (model.Route, error) {
	var rows []modelRouteModel
	if err := r.availableRoutes(r.db.db.WithContext(ctx)).Where("provider = ? AND upstream_model = ? AND enabled = ?", provider, upstreamModel, true).Find(&rows).Error; err != nil {
		return model.Route{}, mapError(err)
	}
	if len(rows) == 0 {
		return model.Route{}, repository.ErrNotFound
	}
	return toModelDomain(preferProviderUpstreamRoute(provider, upstreamModel, rows)), nil
}

// preferProviderUpstreamRoute 在同一上游存在多条对外名路由时选出稳定代表路由。
func preferProviderUpstreamRoute(provider account.Provider, upstreamModel string, rows []modelRouteModel) modelRouteModel {
	preferred := rows[0]
	localID, _ := discoveredRouteDefaults(provider, upstreamModel)
	canonical, hasCanonical := model.NormalizePublicID(provider, localID)
	for _, row := range rows {
		if hasCanonical && row.PublicID == canonical {
			return row
		}
		originPreferred := row.Origin == string(model.OriginDiscovered) || row.Origin == string(model.OriginCatalog)
		currentPreferred := preferred.Origin == string(model.OriginDiscovered) || preferred.Origin == string(model.OriginCatalog)
		switch {
		case originPreferred && !currentPreferred:
			preferred = row
		case originPreferred == currentPreferred && row.ID < preferred.ID:
			preferred = row
		}
	}
	return preferred
}
