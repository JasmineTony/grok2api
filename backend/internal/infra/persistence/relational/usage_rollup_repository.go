package relational

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const usageRollupRebuildWindow = 48 * time.Hour

type UsageRollupRepository struct{ db *Database }

func NewUsageRollupRepository(db *Database) *UsageRollupRepository {
	return &UsageRollupRepository{db: db}
}

type usageRollupAggregateRow struct {
	BucketNumber          int64 `gorm:"column:bucket_number"`
	Provider              string
	Model                 string
	AccountID             uint64
	ClientKeyID           uint64
	Requests              int64
	SuccessfulRequests    int64
	FailedRequests        int64
	InputTokens           int64
	CachedInputTokens     int64
	OutputTokens          int64
	ReasoningTokens       int64
	TotalTokens           int64
	ActualCostUSDTicks    int64
	BilledCostUSDTicks    int64
	EstimatedCostUSDTicks int64
	RequestCacheEligible  int64
	RequestCacheHits      int64
	DurationMS            int64
}

// Refresh rebuilds a bounded tail of derived rollups and extends initial coverage.
// Deleting and reinserting a covered range in one transaction makes retries idempotent.
func (r *UsageRollupRepository) Refresh(ctx context.Context, now time.Time) (repository.UsageRollupRefreshResult, error) {
	until := now.UTC().Truncate(time.Hour)
	result := repository.UsageRollupRefreshResult{CoveredFrom: until, CoveredUntil: until}
	var earliest requestAuditModel
	earliestQuery := r.db.db.WithContext(ctx).Model(&requestAuditModel{}).Order("created_at ASC, id ASC").Limit(1).Find(&earliest)
	if earliestQuery.Error != nil {
		return result, earliestQuery.Error
	}
	if earliestQuery.RowsAffected == 0 {
		err := r.db.db.WithContext(ctx).Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "id"}},
			DoUpdates: clause.Assignments(map[string]any{"covered_from": until, "covered_until": until, "updated_at": now.UTC()}),
		}).Create(&usageRollupCheckpointModel{ID: 1, CoveredFrom: until, CoveredUntil: until, UpdatedAt: now.UTC()}).Error
		return result, err
	}

	coveredFrom := earliest.CreatedAt.UTC().Truncate(time.Hour)
	start := coveredFrom
	var checkpoint usageRollupCheckpointModel
	err := r.db.db.WithContext(ctx).First(&checkpoint, 1).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return result, err
	}
	if err == nil {
		coverageExpanded := coveredFrom.Before(checkpoint.CoveredFrom.UTC().Truncate(time.Hour))
		if checkpoint.CoveredFrom.Before(coveredFrom) {
			coveredFrom = checkpoint.CoveredFrom.UTC().Truncate(time.Hour)
		}
		start = checkpoint.CoveredUntil.UTC().Truncate(time.Hour)
		if coverageExpanded {
			start = coveredFrom
		}
		recentStart := until.Add(-usageRollupRebuildWindow)
		if recentStart.Before(start) {
			start = recentStart
		}
		if start.Before(coveredFrom) {
			start = coveredFrom
		}
	}
	if start.After(until) {
		start = until
	}
	result.CoveredFrom = coveredFrom
	result.CoveredUntil = until

	err = r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if start.Before(until) {
			hourRows, aggregateErr := r.aggregateAudits(tx, start, until, "hour")
			if aggregateErr != nil {
				return aggregateErr
			}
			if deleteErr := tx.Where("bucket_kind = ? AND bucket_start >= ? AND bucket_start < ?", "hour", start, until).Delete(&usageRollupModel{}).Error; deleteErr != nil {
				return deleteErr
			}
			if len(hourRows) > 0 {
				if createErr := tx.CreateInBatches(hourRows, 500).Error; createErr != nil {
					return createErr
				}
			}
			result.HourRows = int64(len(hourRows))
		}

		dayStart := start.Truncate(24 * time.Hour)
		dayUntil := until.Truncate(24 * time.Hour)
		if dayStart.Before(dayUntil) {
			dayRows, aggregateErr := r.aggregateHours(tx, dayStart, dayUntil)
			if aggregateErr != nil {
				return aggregateErr
			}
			if deleteErr := tx.Where("bucket_kind = ? AND bucket_start >= ? AND bucket_start < ?", "day", dayStart, dayUntil).Delete(&usageRollupModel{}).Error; deleteErr != nil {
				return deleteErr
			}
			if len(dayRows) > 0 {
				if createErr := tx.CreateInBatches(dayRows, 500).Error; createErr != nil {
					return createErr
				}
			}
			result.DayRows = int64(len(dayRows))
		}

		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "id"}},
			DoUpdates: clause.Assignments(map[string]any{"covered_from": coveredFrom, "covered_until": until, "updated_at": now.UTC()}),
		}).Create(&usageRollupCheckpointModel{ID: 1, CoveredFrom: coveredFrom, CoveredUntil: until, UpdatedAt: now.UTC()}).Error
	})
	return result, err
}

func (r *UsageRollupRepository) aggregateAudits(tx *gorm.DB, start, end time.Time, kind string) ([]usageRollupModel, error) {
	if kind != "hour" {
		return nil, fmt.Errorf("unsupported audit rollup kind %q", kind)
	}
	bucketExpression := r.bucketNumberExpression("created_at", time.Hour)
	modelExpression := "CASE WHEN TRIM(model_public_id) <> '' THEN model_public_id WHEN TRIM(model_upstream_model) <> '' THEN model_upstream_model ELSE 'unknown' END"
	selectExpression := bucketExpression + ` AS bucket_number, provider, ` + modelExpression + ` AS model, COALESCE(account_id, 0) AS account_id, client_key_id, ` + usageRollupAggregateSelect("request_audits")
	var rows []usageRollupAggregateRow
	if err := tx.Model(&requestAuditModel{}).
		Select(selectExpression).
		Where("created_at >= ? AND created_at < ?", start, end).
		Group(bucketExpression + ", provider, " + modelExpression + ", account_id, client_key_id").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	return makeUsageRollupModels(rows, kind, time.Hour, time.Now().UTC()), nil
}

func (r *UsageRollupRepository) aggregateHours(tx *gorm.DB, start, end time.Time) ([]usageRollupModel, error) {
	bucketExpression := r.bucketNumberExpression("bucket_start", 24*time.Hour)
	selectExpression := bucketExpression + ` AS bucket_number, provider, model, account_id, client_key_id, ` + usageRollupAggregateSelect("usage_rollups")
	var rows []usageRollupAggregateRow
	if err := tx.Model(&usageRollupModel{}).
		Select(selectExpression).
		Where("bucket_kind = ? AND bucket_start >= ? AND bucket_start < ?", "hour", start, end).
		Group(bucketExpression + ", provider, model, account_id, client_key_id").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	return makeUsageRollupModels(rows, "day", 24*time.Hour, time.Now().UTC()), nil
}

func usageRollupAggregateSelect(table string) string {
	if table == "request_audits" {
		return "COUNT(*) AS requests, " +
			"COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END), 0) AS successful_requests, " +
			"COALESCE(SUM(CASE WHEN status_code < 200 OR status_code >= 300 THEN 1 ELSE 0 END), 0) AS failed_requests, " +
			"COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens, " +
			"COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens, " +
			"COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(cost_in_usd_ticks), 0) AS actual_cost_usd_ticks, " +
			"COALESCE(SUM(CASE WHEN cost_in_usd_ticks > 0 THEN cost_in_usd_ticks ELSE estimated_cost_in_usd_ticks END), 0) AS billed_cost_usd_ticks, " +
			"COALESCE(SUM(estimated_cost_in_usd_ticks), 0) AS estimated_cost_usd_ticks, " +
			"COALESCE(SUM(CASE WHEN request_cache_eligible THEN 1 ELSE 0 END), 0) AS request_cache_eligible, " +
			"COALESCE(SUM(CASE WHEN request_cache_hit THEN 1 ELSE 0 END), 0) AS request_cache_hits, COALESCE(SUM(duration_ms), 0) AS duration_ms"
	}
	return "COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(successful_requests), 0) AS successful_requests, " +
		"COALESCE(SUM(failed_requests), 0) AS failed_requests, COALESCE(SUM(input_tokens), 0) AS input_tokens, " +
		"COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, " +
		"COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, " +
		"COALESCE(SUM(actual_cost_usd_ticks), 0) AS actual_cost_usd_ticks, COALESCE(SUM(billed_cost_usd_ticks), 0) AS billed_cost_usd_ticks, " +
		"COALESCE(SUM(estimated_cost_usd_ticks), 0) AS estimated_cost_usd_ticks, " +
		"COALESCE(SUM(request_cache_eligible), 0) AS request_cache_eligible, COALESCE(SUM(request_cache_hits), 0) AS request_cache_hits, " +
		"COALESCE(SUM(duration_ms), 0) AS duration_ms"
}

func (r *UsageRollupRepository) bucketNumberExpression(column string, width time.Duration) string {
	seconds := int64(width / time.Second)
	if r.db.dialect == "postgres" {
		return fmt.Sprintf("CAST(FLOOR(EXTRACT(EPOCH FROM %s) / %d) AS BIGINT)", column, seconds)
	}
	return fmt.Sprintf("CAST(strftime('%%s', %s) AS INTEGER) / %d", column, seconds)
}

func makeUsageRollupModels(rows []usageRollupAggregateRow, kind string, width time.Duration, now time.Time) []usageRollupModel {
	result := make([]usageRollupModel, 0, len(rows))
	seconds := int64(width / time.Second)
	for _, row := range rows {
		result = append(result, usageRollupModel{
			BucketKind: kind, BucketStart: time.Unix(row.BucketNumber*seconds, 0).UTC(), Provider: row.Provider, Model: row.Model,
			AccountID: row.AccountID, ClientKeyID: row.ClientKeyID, Requests: row.Requests, SuccessfulRequests: row.SuccessfulRequests,
			FailedRequests: row.FailedRequests, InputTokens: row.InputTokens, CachedInputTokens: row.CachedInputTokens,
			OutputTokens: row.OutputTokens, ReasoningTokens: row.ReasoningTokens, TotalTokens: row.TotalTokens,
			ActualCostUSDTicks: row.ActualCostUSDTicks, BilledCostUSDTicks: row.BilledCostUSDTicks, EstimatedCostUSDTicks: row.EstimatedCostUSDTicks,
			RequestCacheEligible: row.RequestCacheEligible, RequestCacheHits: row.RequestCacheHits, DurationMS: row.DurationMS,
			CreatedAt: now, UpdatedAt: now,
		})
	}
	return result
}
