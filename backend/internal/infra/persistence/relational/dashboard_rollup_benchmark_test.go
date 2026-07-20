package relational

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func BenchmarkDashboardMetricsRawVsRollup(b *testing.B) {
	ctx := context.Background()
	database, err := OpenSQLite(ctx, filepath.Join(b.TempDir(), "dashboard-benchmark.db"))
	if err != nil {
		b.Fatal(err)
	}
	defer database.Close()
	if err := database.InitializeSchema(ctx); err != nil {
		b.Fatal(err)
	}
	now := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
	const auditCount = 60000
	rows := make([]requestAuditModel, 0, 500)
	for index := 0; index < auditCount; index++ {
		createdAt := now.Add(-time.Duration(index%2160) * time.Hour).Add(time.Duration(index%60) * time.Second)
		rows = append(rows, requestAuditModel{
			RequestID: fmt.Sprintf("bench-%d", index), ClientKeyID: uint64(index%8 + 1), ModelRouteID: uint64(index%8 + 1),
			ModelPublicID: fmt.Sprintf("grok-%d", index%8), Provider: "grok_build", Operation: "responses", UsageSource: "upstream",
			AccountID: usageRollupUint64Pointer(uint64(index%8 + 1)), StatusCode: 200, InputTokens: 100, CachedInputTokens: 25,
			OutputTokens: 40, TotalTokens: 140, EstimatedCostInUSDTicks: 1000, DurationMS: 50, CreatedAt: createdAt,
		})
		if len(rows) == cap(rows) {
			if err := database.db.WithContext(ctx).CreateInBatches(rows, 500).Error; err != nil {
				b.Fatal(err)
			}
			rows = rows[:0]
		}
	}
	if len(rows) > 0 {
		if err := database.db.WithContext(ctx).CreateInBatches(rows, 500).Error; err != nil {
			b.Fatal(err)
		}
	}
	if _, err := NewUsageRollupRepository(database).Refresh(ctx, now); err != nil {
		b.Fatal(err)
	}
	boundaries := testDashboardBoundaries(now.Add(-90*24*time.Hour), 7*24*time.Hour, 13)
	repository := NewDashboardRepository(database)
	rawRange := dashboardQueryRange{start: boundaries[0], end: boundaries[len(boundaries)-1]}
	rollupRange := dashboardQueryRange{useRollup: true, start: boundaries[0], end: boundaries[len(boundaries)-1]}
	b.Run("raw_audits", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := repository.queryDashboardMetrics(database.db.WithContext(ctx), rawRange, "bucket", boundaries); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("hour_rollups", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := repository.queryDashboardMetrics(database.db.WithContext(ctx), rollupRange, "bucket", boundaries); err != nil {
				b.Fatal(err)
			}
		}
	})
}
