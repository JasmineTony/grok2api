package relational

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	dashboarddomain "github.com/chenyme/grok2api/backend/internal/domain/dashboard"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
)

type DashboardRepository struct{ db *Database }

func NewDashboardRepository(db *Database) *DashboardRepository { return &DashboardRepository{db: db} }

const dashboardTopModelsLimit = 10

type dashboardMetricRow struct {
	BucketIndex                 int
	Provider                    string
	Model                       string
	AccountID                   uint64
	ClientKeyID                 uint64
	Requests                    int64
	SuccessfulRequests          int64
	FailedRequests              int64
	InputTokens                 int64
	CachedInputTokens           int64
	OutputTokens                int64
	ReasoningTokens              int64
	Tokens                      int64
	ActualCostUSDTicks           int64
	EstimatedCostUSDTicks        int64
	BilledCostUSDTicks           int64
	RequestCacheEligibleRequests int64
	RequestCacheHits             int64
}

type dashboardQueryRange struct {
	useRollup bool
	start     time.Time
	end       time.Time
}

// Snapshot reads resource counts and usage. Completed UTC hours use disposable rollups;
// uncovered edges and non-hour-aligned timezone ranges deliberately fall back to audits.
func (r *DashboardRepository) Snapshot(ctx context.Context, window repository.DashboardSnapshotWindow, snapshotAt time.Time) (dashboarddomain.Aggregate, error) {
	if err := validateDashboardBoundaries(window.BucketBoundaries); err != nil {
		return dashboarddomain.Aggregate{}, err
	}
	if err := validateDashboardBoundaries(window.ActivityBoundaries); err != nil {
		return dashboarddomain.Aggregate{}, err
	}
	bucketBoundaries := window.BucketBoundaries
	result := dashboarddomain.Aggregate{}
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var accounts struct {
			Total           int64
			Active          int64
			BuildAccounts   int64
			WebAccounts     int64
			ConsoleAccounts int64
		}
		if err := tx.Model(&accountModel{}).
			Select("COUNT(*) AS total, COALESCE(SUM(CASE WHEN enabled = ? AND auth_status = ? AND (cooldown_until IS NULL OR cooldown_until <= ?) AND NOT EXISTS (SELECT 1 FROM account_quota_recovery WHERE account_quota_recovery.account_id = provider_accounts.id AND account_quota_recovery.status IN ?) THEN 1 ELSE 0 END), 0) AS active, COALESCE(SUM(CASE WHEN provider = 'grok_build' THEN 1 ELSE 0 END), 0) AS build_accounts, COALESCE(SUM(CASE WHEN provider = 'grok_web' THEN 1 ELSE 0 END), 0) AS web_accounts, COALESCE(SUM(CASE WHEN provider = 'grok_console' THEN 1 ELSE 0 END), 0) AS console_accounts", true, "active", snapshotAt, []string{"exhausted", "probing"}).
			Scan(&accounts).Error; err != nil {
			return err
		}
		var models struct{ Total, Enabled int64 }
		if err := tx.Model(&modelRouteModel{}).
			Select("COUNT(*) AS total, COALESCE(SUM(CASE WHEN enabled = ? AND "+availableRoutePredicate+" THEN 1 ELSE 0 END), 0) AS enabled", true, true, "active").
			Scan(&models).Error; err != nil {
			return err
		}
		var clientKeys struct{ Total, Active int64 }
		if err := tx.Model(&clientKeyModel{}).
			Select("COUNT(*) AS total, COALESCE(SUM(CASE WHEN enabled = ? AND (expires_at IS NULL OR expires_at > ?) THEN 1 ELSE 0 END), 0) AS active", true, snapshotAt).
			Scan(&clientKeys).Error; err != nil {
			return err
		}
		result.Resources = dashboarddomain.Resources{
			ActiveAccounts: accounts.Active, TotalAccounts: accounts.Total, BuildAccounts: accounts.BuildAccounts,
			WebAccounts: accounts.WebAccounts, ConsoleAccounts: accounts.ConsoleAccounts, EnabledModels: models.Enabled,
			TotalModels: models.Total, ActiveClientKeys: clientKeys.Active, TotalClientKeys: clientKeys.Total,
		}

		bucketRanges, err := r.dashboardQueryRanges(tx, bucketBoundaries)
		if err != nil {
			return err
		}
		activityRanges, err := r.dashboardQueryRanges(tx, window.ActivityBoundaries)
		if err != nil {
			return err
		}
		var total dashboardMetricRow
		for _, queryRange := range bucketRanges {
			rows, queryErr := r.queryDashboardMetrics(tx, queryRange, "", nil)
			if queryErr != nil {
				return queryErr
			}
			if len(rows) > 0 {
				addMetricRow(&total, rows[0])
			}
		}
		result.Usage = usageFromMetric(total)

		bucketRows := make(map[int]dashboardMetricRow, len(bucketBoundaries)-1)
		for _, queryRange := range bucketRanges {
			rows, queryErr := r.queryDashboardMetrics(tx, queryRange, "bucket", bucketBoundaries)
			if queryErr != nil {
				return queryErr
			}
			for _, row := range rows {
				current := bucketRows[row.BucketIndex]
				addMetricRow(&current, row)
				current.BucketIndex = row.BucketIndex
				bucketRows[row.BucketIndex] = current
			}
		}
		result.Buckets = make([]dashboarddomain.Bucket, 0, len(bucketBoundaries)-1)
		for index := 0; index < len(bucketBoundaries)-1; index++ {
			row := bucketRows[index]
			result.Buckets = append(result.Buckets, bucketFromMetric(index, row))
		}

		activityRows := make(map[int]int64, len(window.ActivityBoundaries)-1)
		for _, queryRange := range activityRanges {
			rows, queryErr := r.queryDashboardMetrics(tx, queryRange, "activity", window.ActivityBoundaries)
			if queryErr != nil {
				return queryErr
			}
			for _, row := range rows {
				activityRows[row.BucketIndex] += row.Requests
			}
		}
		result.ActivityBuckets = make([]dashboarddomain.ActivityBucket, 0, len(window.ActivityBoundaries)-1)
		for index := 0; index < len(window.ActivityBoundaries)-1; index++ {
			result.ActivityBuckets = append(result.ActivityBuckets, dashboarddomain.ActivityBucket{Index: index, Requests: activityRows[index]})
		}

		providerRows := make(map[string]dashboardMetricRow)
		for _, queryRange := range bucketRanges {
			rows, queryErr := r.queryDashboardMetrics(tx, queryRange, "provider", nil)
			if queryErr != nil {
				return queryErr
			}
			for _, row := range rows {
				current := providerRows[row.Provider]
				addMetricRow(&current, row)
				current.Provider = row.Provider
				providerRows[row.Provider] = current
			}
		}
		providers := make([]dashboarddomain.ProviderUsage, 0, len(providerRows))
		for _, row := range providerRows {
			providers = append(providers, providerFromMetric(row))
		}
		sort.Slice(providers, func(i, j int) bool {
			if providers[i].Requests != providers[j].Requests {
				return providers[i].Requests > providers[j].Requests
			}
			return providers[i].Provider < providers[j].Provider
		})
		result.Providers = providers

		accountRows := make(map[uint64]dashboardMetricRow)
		for _, queryRange := range bucketRanges {
			rows, queryErr := r.queryDashboardMetrics(tx, queryRange, "account", nil)
			if queryErr != nil {
				return queryErr
			}
			for _, row := range rows {
				if row.AccountID == 0 {
					continue
				}
				current := accountRows[row.AccountID]
				addMetricRow(&current, row)
				current.AccountID = row.AccountID
				accountRows[row.AccountID] = current
			}
		}
		result.TopAccounts, err = r.topAccountUsage(tx, accountRows)
		if err != nil {
			return err
		}

		clientKeyRows := make(map[uint64]dashboardMetricRow)
		for _, queryRange := range bucketRanges {
			rows, queryErr := r.queryDashboardMetrics(tx, queryRange, "clientKey", nil)
			if queryErr != nil {
				return queryErr
			}
			for _, row := range rows {
				if row.ClientKeyID == 0 {
					continue
				}
				current := clientKeyRows[row.ClientKeyID]
				addMetricRow(&current, row)
				current.ClientKeyID = row.ClientKeyID
				clientKeyRows[row.ClientKeyID] = current
			}
		}
		result.TopClientKeys, err = r.topClientKeyUsage(tx, clientKeyRows)
		if err != nil {
			return err
		}

		modelRows := make(map[string]dashboardMetricRow)
		for _, queryRange := range bucketRanges {
			rows, queryErr := r.queryDashboardMetrics(tx, queryRange, "model", nil)
			if queryErr != nil {
				return queryErr
			}
			for _, row := range rows {
				current := modelRows[row.Model]
				addMetricRow(&current, row)
				current.Model = row.Model
				modelRows[row.Model] = current
			}
		}
		modelUsage := make([]dashboarddomain.ModelUsage, 0, len(modelRows))
		for _, row := range modelRows {
			modelUsage = append(modelUsage, modelFromMetric(row))
		}
		sort.Slice(modelUsage, func(i, j int) bool {
			if modelUsage[i].BilledCostUSDTicks != modelUsage[j].BilledCostUSDTicks {
				return modelUsage[i].BilledCostUSDTicks > modelUsage[j].BilledCostUSDTicks
			}
			if modelUsage[i].Requests != modelUsage[j].Requests {
				return modelUsage[i].Requests > modelUsage[j].Requests
			}
			if modelUsage[i].Tokens != modelUsage[j].Tokens {
				return modelUsage[i].Tokens > modelUsage[j].Tokens
			}
			return modelUsage[i].Model < modelUsage[j].Model
		})
		if len(modelUsage) > dashboardTopModelsLimit {
			modelUsage = modelUsage[:dashboardTopModelsLimit]
		}
		result.TopModels = modelUsage

		listedModels := make(map[string]struct{}, dashboardTopModelsLimit)
		for _, item := range result.TopModels {
			listedModels[item.Model] = struct{}{}
		}
		if len(result.TopModels) < dashboardTopModelsLimit {
			var enabledModels []struct{ PublicID, Provider string }
			if err := tx.Model(&modelRouteModel{}).Select("public_id, provider").Where("enabled = ?", true).Order("public_id ASC").Limit(dashboardTopModelsLimit * len(accountdomain.Providers())).Scan(&enabledModels).Error; err != nil {
				return err
			}
			for _, route := range enabledModels {
				publicID := modeldomain.ExternalPublicID(accountdomain.Provider(route.Provider), route.PublicID)
				if publicID == "" {
					continue
				}
				if _, exists := listedModels[publicID]; exists {
					continue
				}
				result.TopModels = append(result.TopModels, dashboarddomain.ModelUsage{Model: publicID})
				listedModels[publicID] = struct{}{}
				if len(result.TopModels) == dashboardTopModelsLimit {
					break
				}
			}
		}
		return nil
	})
	return result, err
}

func (r *DashboardRepository) dashboardQueryRanges(tx *gorm.DB, boundaries []time.Time) ([]dashboardQueryRange, error) {
	if !dashboardBoundariesAreUTCHourAligned(boundaries) {
		return []dashboardQueryRange{{start: boundaries[0], end: boundaries[len(boundaries)-1]}}, nil
	}
	var checkpoint usageRollupCheckpointModel
	if err := tx.First(&checkpoint, 1).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return []dashboardQueryRange{{start: boundaries[0], end: boundaries[len(boundaries)-1]}}, nil
		}
		return nil, err
	}
	start := boundaries[0].UTC()
	end := boundaries[len(boundaries)-1].UTC()
	rollupStart := maxDashboardTime(start, checkpoint.CoveredFrom.UTC())
	rollupEnd := minDashboardTime(end, checkpoint.CoveredUntil.UTC())
	result := make([]dashboardQueryRange, 0, 3)
	if start.Before(rollupStart) {
		result = append(result, dashboardQueryRange{start: start, end: minDashboardTime(end, rollupStart)})
	}
	if rollupStart.Before(rollupEnd) {
		result = append(result, dashboardQueryRange{useRollup: true, start: rollupStart, end: rollupEnd})
	}
	if rollupEnd.Before(end) {
		result = append(result, dashboardQueryRange{start: maxDashboardTime(start, rollupEnd), end: end})
	}
	if len(result) == 0 {
		result = append(result, dashboardQueryRange{start: start, end: end})
	}
	return result, nil
}

func (r *DashboardRepository) queryDashboardMetrics(tx *gorm.DB, queryRange dashboardQueryRange, grouping string, boundaries []time.Time) ([]dashboardMetricRow, error) {
	var table any
	var timeColumn string
	var where string
	var whereArgs []any
	if queryRange.useRollup {
		table = &usageRollupModel{}
		timeColumn = "bucket_start"
		where = "bucket_kind = ? AND bucket_start >= ? AND bucket_start < ?"
		whereArgs = []any{"hour", queryRange.start, queryRange.end}
	} else {
		table = &requestAuditModel{}
		timeColumn = "created_at"
		where = "created_at >= ? AND created_at < ?"
		whereArgs = []any{queryRange.start, queryRange.end}
	}
	selectParts := []string{}
	selectArgs := []any{}
	groupParts := []string{}
	switch grouping {
	case "bucket", "activity":
		expression, args := dashboardBucketExpressionFor(timeColumn, boundaries)
		selectParts = append(selectParts, expression+" AS bucket_index")
		selectArgs = args
		groupParts = append(groupParts, "bucket_index")
	case "provider":
		selectParts = append(selectParts, "provider")
		groupParts = append(groupParts, "provider")
	case "model":
		if queryRange.useRollup {
			selectParts = append(selectParts, "model")
			groupParts = append(groupParts, "model")
		} else {
			modelExpression := "CASE WHEN TRIM(model_public_id) <> '' THEN model_public_id WHEN TRIM(model_upstream_model) <> '' THEN model_upstream_model ELSE 'unknown' END"
			selectParts = append(selectParts, modelExpression+" AS model")
			groupParts = append(groupParts, modelExpression)
		}
	case "account":
		selectParts = append(selectParts, "COALESCE(account_id, 0) AS account_id")
		groupParts = append(groupParts, "account_id")
	case "clientKey":
		selectParts = append(selectParts, "client_key_id")
		groupParts = append(groupParts, "client_key_id")
	}
	selectParts = append(selectParts, dashboardMetricSelect(queryRange.useRollup))
	query := tx.Model(table).Select(strings.Join(selectParts, ", "), selectArgs...).Where(where, whereArgs...)
	if len(groupParts) > 0 {
		query = query.Group(strings.Join(groupParts, ", "))
	}
	var rows []dashboardMetricRow
	if err := query.Scan(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func dashboardMetricSelect(useRollup bool) string {
	if useRollup {
		return "COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(successful_requests), 0) AS successful_requests, COALESCE(SUM(failed_requests), 0) AS failed_requests, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(actual_cost_usd_ticks), 0) AS actual_cost_usd_ticks, COALESCE(SUM(estimated_cost_usd_ticks), 0) AS estimated_cost_usd_ticks, COALESCE(SUM(billed_cost_usd_ticks), 0) AS billed_cost_usd_ticks, COALESCE(SUM(request_cache_eligible), 0) AS request_cache_eligible_requests, COALESCE(SUM(request_cache_hits), 0) AS request_cache_hits"
	}
	return "COUNT(*) AS requests, COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END), 0) AS successful_requests, COALESCE(SUM(CASE WHEN status_code < 200 OR status_code >= 300 THEN 1 ELSE 0 END), 0) AS failed_requests, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(cost_in_usd_ticks), 0) AS actual_cost_usd_ticks, COALESCE(SUM(estimated_cost_in_usd_ticks), 0) AS estimated_cost_usd_ticks, COALESCE(SUM(CASE WHEN cost_in_usd_ticks > 0 THEN cost_in_usd_ticks ELSE estimated_cost_in_usd_ticks END), 0) AS billed_cost_usd_ticks, COALESCE(SUM(CASE WHEN request_cache_eligible THEN 1 ELSE 0 END), 0) AS request_cache_eligible_requests, COALESCE(SUM(CASE WHEN request_cache_hit THEN 1 ELSE 0 END), 0) AS request_cache_hits"
}

func addMetricRow(target *dashboardMetricRow, value dashboardMetricRow) {
	target.Requests += value.Requests
	target.SuccessfulRequests += value.SuccessfulRequests
	target.FailedRequests += value.FailedRequests
	target.InputTokens += value.InputTokens
	target.CachedInputTokens += value.CachedInputTokens
	target.OutputTokens += value.OutputTokens
	target.ReasoningTokens += value.ReasoningTokens
	target.Tokens += value.Tokens
	target.ActualCostUSDTicks += value.ActualCostUSDTicks
	target.EstimatedCostUSDTicks += value.EstimatedCostUSDTicks
	target.BilledCostUSDTicks += value.BilledCostUSDTicks
	target.RequestCacheEligibleRequests += value.RequestCacheEligibleRequests
	target.RequestCacheHits += value.RequestCacheHits
}

func usageFromMetric(row dashboardMetricRow) dashboarddomain.Usage {
	return dashboarddomain.Usage{Requests: row.Requests, SuccessfulRequests: row.SuccessfulRequests, FailedRequests: row.FailedRequests, InputTokens: row.InputTokens, CachedInputTokens: row.CachedInputTokens, OutputTokens: row.OutputTokens, ReasoningTokens: row.ReasoningTokens, Tokens: row.Tokens, ActualCostUSDTicks: row.ActualCostUSDTicks, EstimatedCostUSDTicks: row.EstimatedCostUSDTicks, BilledCostUSDTicks: row.BilledCostUSDTicks, RequestCacheEligibleRequests: row.RequestCacheEligibleRequests, RequestCacheHits: row.RequestCacheHits}
}

func bucketFromMetric(index int, row dashboardMetricRow) dashboarddomain.Bucket {
	return dashboarddomain.Bucket{Index: index, Requests: row.Requests, InputTokens: row.InputTokens, CachedInputTokens: row.CachedInputTokens, OutputTokens: row.OutputTokens, ReasoningTokens: row.ReasoningTokens, Tokens: row.Tokens, ActualCostUSDTicks: row.ActualCostUSDTicks, EstimatedCostUSDTicks: row.EstimatedCostUSDTicks, BilledCostUSDTicks: row.BilledCostUSDTicks, RequestCacheEligibleRequests: row.RequestCacheEligibleRequests, RequestCacheHits: row.RequestCacheHits}
}

func modelFromMetric(row dashboardMetricRow) dashboarddomain.ModelUsage {
	return dashboarddomain.ModelUsage{Model: row.Model, Requests: row.Requests, InputTokens: row.InputTokens, CachedInputTokens: row.CachedInputTokens, OutputTokens: row.OutputTokens, ReasoningTokens: row.ReasoningTokens, Tokens: row.Tokens, ActualCostUSDTicks: row.ActualCostUSDTicks, EstimatedCostUSDTicks: row.EstimatedCostUSDTicks, BilledCostUSDTicks: row.BilledCostUSDTicks, RequestCacheEligibleRequests: row.RequestCacheEligibleRequests, RequestCacheHits: row.RequestCacheHits}
}

func providerFromMetric(row dashboardMetricRow) dashboarddomain.ProviderUsage {
	return dashboarddomain.ProviderUsage{Provider: row.Provider, Requests: row.Requests, SuccessfulRequests: row.SuccessfulRequests, Tokens: row.Tokens, ActualCostUSDTicks: row.ActualCostUSDTicks, EstimatedCostUSDTicks: row.EstimatedCostUSDTicks, BilledCostUSDTicks: row.BilledCostUSDTicks, RequestCacheEligibleRequests: row.RequestCacheEligibleRequests, RequestCacheHits: row.RequestCacheHits}
}

func (r *DashboardRepository) topAccountUsage(tx *gorm.DB, rows map[uint64]dashboardMetricRow) ([]dashboarddomain.AccountUsage, error) {
	if len(rows) == 0 {
		return []dashboarddomain.AccountUsage{}, nil
	}
	ids := make([]uint64, 0, len(rows))
	for id := range rows {
		ids = append(ids, id)
	}
	var labels []struct {
		ID       uint64
		Name     string
		Provider string
	}
	if err := tx.Model(&accountModel{}).Select("id, name, provider").Where("id IN ?", ids).Scan(&labels).Error; err != nil {
		return nil, err
	}
	labelByID := make(map[uint64]struct {
		Name     string
		Provider string
	}, len(labels))
	for _, label := range labels {
		labelByID[label.ID] = struct {
			Name     string
			Provider string
		}{Name: label.Name, Provider: label.Provider}
	}
	result := make([]dashboarddomain.AccountUsage, 0, len(rows))
	for id, row := range rows {
		label := labelByID[id]
		if label.Name == "" {
			label.Name = fmt.Sprintf("account #%d", id)
		}
		result = append(result, dashboarddomain.AccountUsage{AccountID: id, AccountName: label.Name, Provider: label.Provider, Usage: dimensionUsageFromMetric(row)})
	}
	sort.Slice(result, func(i, j int) bool { return dimensionUsageBefore(result[i].Usage, result[j].Usage, result[i].AccountName, result[j].AccountName) })
	if len(result) > dashboardTopModelsLimit {
		result = result[:dashboardTopModelsLimit]
	}
	return result, nil
}

func (r *DashboardRepository) topClientKeyUsage(tx *gorm.DB, rows map[uint64]dashboardMetricRow) ([]dashboarddomain.ClientKeyUsage, error) {
	if len(rows) == 0 {
		return []dashboarddomain.ClientKeyUsage{}, nil
	}
	ids := make([]uint64, 0, len(rows))
	for id := range rows {
		ids = append(ids, id)
	}
	var labels []struct {
		ID   uint64
		Name string
	}
	if err := tx.Model(&clientKeyModel{}).Select("id, name").Where("id IN ?", ids).Scan(&labels).Error; err != nil {
		return nil, err
	}
	labelByID := make(map[uint64]string, len(labels))
	for _, label := range labels {
		labelByID[label.ID] = label.Name
	}
	result := make([]dashboarddomain.ClientKeyUsage, 0, len(rows))
	for id, row := range rows {
		name := labelByID[id]
		if name == "" {
			name = fmt.Sprintf("key #%d", id)
		}
		result = append(result, dashboarddomain.ClientKeyUsage{ClientKeyID: id, ClientKeyName: name, Usage: dimensionUsageFromMetric(row)})
	}
	sort.Slice(result, func(i, j int) bool { return dimensionUsageBefore(result[i].Usage, result[j].Usage, result[i].ClientKeyName, result[j].ClientKeyName) })
	if len(result) > dashboardTopModelsLimit {
		result = result[:dashboardTopModelsLimit]
	}
	return result, nil
}

func dimensionUsageFromMetric(row dashboardMetricRow) dashboarddomain.DimensionUsage {
	return dashboarddomain.DimensionUsage{Requests: row.Requests, SuccessfulRequests: row.SuccessfulRequests, FailedRequests: row.FailedRequests, InputTokens: row.InputTokens, CachedInputTokens: row.CachedInputTokens, OutputTokens: row.OutputTokens, ReasoningTokens: row.ReasoningTokens, Tokens: row.Tokens, ActualCostUSDTicks: row.ActualCostUSDTicks, EstimatedCostUSDTicks: row.EstimatedCostUSDTicks, BilledCostUSDTicks: row.BilledCostUSDTicks, RequestCacheEligibleRequests: row.RequestCacheEligibleRequests, RequestCacheHits: row.RequestCacheHits}
}

func dimensionUsageBefore(left, right dashboarddomain.DimensionUsage, leftName, rightName string) bool {
	if left.BilledCostUSDTicks != right.BilledCostUSDTicks {
		return left.BilledCostUSDTicks > right.BilledCostUSDTicks
	}
	if left.Requests != right.Requests {
		return left.Requests > right.Requests
	}
	if left.Tokens != right.Tokens {
		return left.Tokens > right.Tokens
	}
	return leftName < rightName
}

func validateDashboardBoundaries(boundaries []time.Time) error {
	if len(boundaries) < 2 {
		return fmt.Errorf("Dashboard 聚合范围无效")
	}
	for index := 1; index < len(boundaries); index++ {
		if !boundaries[index-1].Before(boundaries[index]) {
			return fmt.Errorf("Dashboard 时间桶无效")
		}
	}
	return nil
}

func dashboardBoundariesAreUTCHourAligned(boundaries []time.Time) bool {
	for _, boundary := range boundaries {
		value := boundary.UTC()
		if !value.Truncate(time.Hour).Equal(value) {
			return false
		}
	}
	return true
}

func dashboardBucketExpressionFor(column string, boundaries []time.Time) (string, []any) {
	var expression strings.Builder
	expression.WriteString("CASE")
	args := make([]any, 0, (len(boundaries)-1)*3)
	for index := 0; index < len(boundaries)-1; index++ {
		expression.WriteString(" WHEN " + column + " >= ? AND " + column + " < ? THEN ?")
		args = append(args, boundaries[index], boundaries[index+1], index)
	}
	expression.WriteString(" ELSE -1 END")
	return expression.String(), args
}

func maxDashboardTime(left, right time.Time) time.Time {
	if left.After(right) {
		return left
	}
	return right
}

func minDashboardTime(left, right time.Time) time.Time {
	if left.Before(right) {
		return left
	}
	return right
}
