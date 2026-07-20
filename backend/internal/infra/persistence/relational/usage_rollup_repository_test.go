package relational

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestUsageRollupRefreshIsIdempotentAndIncludesLateAudits(t *testing.T) {
	ctx := context.Background()
	database, err := OpenSQLite(ctx, filepath.Join(t.TempDir(), "usage-rollups.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.InitializeSchema(ctx); err != nil {
		t.Fatal(err)
	}
	if err := database.InitializeSchema(ctx); err != nil {
		t.Fatalf("repeated schema initialization: %v", err)
	}

	now := time.Date(2026, 7, 20, 12, 34, 0, 0, time.UTC)
	rows := []requestAuditModel{
		usageRollupAudit("day-one", now.Add(-50*time.Hour), 100, 20, 10, 2, true, true),
		usageRollupAudit("day-two", now.Add(-25*time.Hour), 80, 10, 20, 1, true, false),
		usageRollupAudit("recent", now.Add(-2*time.Hour), 40, 5, 30, 3, false, false),
		usageRollupAudit("open-hour", now.Add(-10*time.Minute), 999, 999, 999, 999, true, true),
	}
	if err := database.db.WithContext(ctx).Create(&rows).Error; err != nil {
		t.Fatal(err)
	}

	repository := NewUsageRollupRepository(database)
	result, err := repository.Refresh(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if !result.CoveredFrom.Equal(rows[0].CreatedAt.Truncate(time.Hour)) || !result.CoveredUntil.Equal(now.Truncate(time.Hour)) {
		t.Fatalf("coverage = %s..%s", result.CoveredFrom, result.CoveredUntil)
	}
	assertUsageRollupTotals(t, database, "hour", 3, 3, 220, 35, 60, 6, 2, 1)
	assertUsageRollupTotals(t, database, "day", 2, 2, 180, 30, 30, 3, 2, 1)

	late := usageRollupAudit("late", rows[1].CreatedAt.Add(15*time.Minute), 20, 5, 4, 1, true, true)
	if err := database.db.WithContext(ctx).Create(&late).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := repository.Refresh(ctx, now.Add(5*time.Minute)); err != nil {
		t.Fatal(err)
	}
	assertUsageRollupTotals(t, database, "hour", 3, 4, 240, 40, 64, 7, 3, 2)
	assertUsageRollupTotals(t, database, "day", 2, 3, 200, 35, 34, 4, 3, 2)

	var matching int64
	if err := database.db.WithContext(ctx).Model(&usageRollupModel{}).
		Where("bucket_kind = ? AND bucket_start = ? AND model = ?", "hour", rows[1].CreatedAt.Truncate(time.Hour), "grok-test").
		Count(&matching).Error; err != nil {
		t.Fatal(err)
	}
	if matching != 1 {
		t.Fatalf("late audit created %d duplicate hour rows", matching)
	}
}

func TestUsageRollupRefreshCreatesEmptyCheckpoint(t *testing.T) {
	ctx := context.Background()
	database, err := OpenSQLite(ctx, filepath.Join(t.TempDir(), "empty-rollups.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.InitializeSchema(ctx); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 20, 12, 34, 0, 0, time.UTC)
	result, err := NewUsageRollupRepository(database).Refresh(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if !result.CoveredFrom.Equal(now.Truncate(time.Hour)) || !result.CoveredUntil.Equal(now.Truncate(time.Hour)) {
		t.Fatalf("coverage = %#v", result)
	}
	var checkpoint usageRollupCheckpointModel
	if err := database.db.WithContext(ctx).First(&checkpoint, 1).Error; err != nil {
		t.Fatal(err)
	}
}

func usageRollupAudit(requestID string, createdAt time.Time, input, cached, actual, estimated int64, cacheEligible, cacheHit bool) requestAuditModel {
	return requestAuditModel{
		RequestID: requestID, ClientKeyID: 7, ModelRouteID: 9, ModelPublicID: "grok-test", Provider: "grok_build",
		Operation: "responses", UsageSource: "upstream", AccountID: usageRollupUint64Pointer(11), StatusCode: 200,
		InputTokens: input, CachedInputTokens: cached, OutputTokens: 5, TotalTokens: input + 5,
		CostInUSDTicks: actual, EstimatedCostInUSDTicks: estimated, RequestCacheEligible: cacheEligible, RequestCacheHit: cacheHit,
		DurationMS: 25, CreatedAt: createdAt,
	}
}

func assertUsageRollupTotals(t *testing.T, database *Database, kind string, wantRows, wantRequests, wantInput, wantCached, wantActual, wantEstimated, wantEligible, wantHits int64) {
	t.Helper()
	var aggregate struct {
		Rows                  int64
		Requests              int64
		InputTokens           int64
		CachedInputTokens     int64
		ActualCostUSDTicks    int64
		EstimatedCostUSDTicks int64
		RequestCacheEligible  int64
		RequestCacheHits      int64
	}
	err := database.db.Model(&usageRollupModel{}).
		Select("COUNT(*) AS rows, COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens, COALESCE(SUM(actual_cost_usd_ticks), 0) AS actual_cost_usd_ticks, COALESCE(SUM(estimated_cost_usd_ticks), 0) AS estimated_cost_usd_ticks, COALESCE(SUM(request_cache_eligible), 0) AS request_cache_eligible, COALESCE(SUM(request_cache_hits), 0) AS request_cache_hits").
		Where("bucket_kind = ?", kind).Scan(&aggregate).Error
	if err != nil {
		t.Fatal(err)
	}
	if aggregate.Rows != wantRows || aggregate.Requests != wantRequests || aggregate.InputTokens != wantInput || aggregate.CachedInputTokens != wantCached || aggregate.ActualCostUSDTicks != wantActual || aggregate.EstimatedCostUSDTicks != wantEstimated || aggregate.RequestCacheEligible != wantEligible || aggregate.RequestCacheHits != wantHits {
		t.Fatalf("%s aggregate = %#v", kind, aggregate)
	}
}

func usageRollupUint64Pointer(value uint64) *uint64 { return &value }
