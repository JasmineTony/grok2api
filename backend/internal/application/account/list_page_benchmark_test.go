package account

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
)

const (
	listPageBenchmarkAccounts = 300
	listPageBenchmarkPageSize = 50
)

// openAccountTestDatabase 打开已完成建表的临时 SQLite 库，供账号用例共享。
func openAccountTestDatabase(tb testing.TB, name string) (context.Context, *relational.Database) {
	tb.Helper()
	ctx := context.Background()
	database, err := relational.OpenSQLite(ctx, filepath.Join(tb.TempDir(), name))
	if err != nil {
		tb.Fatal(err)
	}
	tb.Cleanup(func() { _ = database.Close() })
	if err := database.InitializeSchema(ctx); err != nil {
		tb.Fatal(err)
	}
	return ctx, database
}

// seedListPageAccounts 为 List 聚合路径准备账号分页、审计 token 汇总、billing、
// 额度恢复、额度窗口与模型封锁数据，使一次分页读取真实触发全部批量查询。
func seedListPageAccounts(tb testing.TB, ctx context.Context, accounts *relational.AccountRepository, audits *relational.AuditRepository, count int) {
	tb.Helper()
	credentials := make([]accountdomain.Credential, count)
	for index := range credentials {
		credentials[index] = accountdomain.Credential{
			Provider: accountdomain.ProviderBuild, AuthType: accountdomain.AuthTypeOAuth,
			Name: fmt.Sprintf("list-page-%04d", index), SourceKey: fmt.Sprintf("list-page-source-%04d", index),
			EncryptedAccessToken: "list-page-access-token", Enabled: true, AuthStatus: accountdomain.AuthStatusActive,
		}
	}
	created, err := accounts.UpsertManyByIdentity(ctx, credentials)
	if err != nil {
		tb.Fatal(err)
	}
	now := time.Now().UTC()
	records := make([]audit.Record, 0, count)
	for index, result := range created {
		seedListPageAccountState(tb, ctx, accounts, result.ID, now)
		records = append(records, listPageAuditRecord(index, result.ID, now))
	}
	if err := audits.CreateBatch(ctx, records); err != nil {
		tb.Fatal(err)
	}
}

// seedListPageAccountState 写入一个账号的 billing、额度恢复、额度窗口与模型封锁快照。
func seedListPageAccountState(tb testing.TB, ctx context.Context, accounts *relational.AccountRepository, accountID uint64, now time.Time) {
	tb.Helper()
	resetAt := now.Add(time.Hour)
	if err := accounts.SaveBilling(ctx, accountdomain.Billing{
		AccountID: accountID, PlanName: "SuperGrok", MonthlyLimit: 100, Used: 10, SyncedAt: now,
	}); err != nil {
		tb.Fatal(err)
	}
	if err := accounts.SaveQuotaRecovery(ctx, accountdomain.QuotaRecovery{
		AccountID: accountID, Kind: accountdomain.QuotaRecoveryKindFree, Status: accountdomain.QuotaRecoveryStatusExhausted,
		ConfirmedUsed: 1_000_000, ConfirmedLimit: 1_000_000, ExhaustedAt: &now, NextProbeAt: &resetAt,
		LastConfirmedAt: &now, UpdatedAt: now,
	}); err != nil {
		tb.Fatal(err)
	}
	if err := accounts.SaveQuotaWindows(ctx, accountID, "", now, []accountdomain.QuotaWindow{{
		AccountID: accountID, Mode: "weekly", Remaining: 10, Total: 20,
		ResetAt: &resetAt, SyncedAt: &now, Source: accountdomain.QuotaSourceUpstream,
	}}); err != nil {
		tb.Fatal(err)
	}
	if err := accounts.UpsertModelQuotaBlock(ctx, accountdomain.ModelQuotaBlock{
		AccountID: accountID, UpstreamModel: "grok-4.5", Reason: "model_quota_depleted",
		CooldownUntil: resetAt, UpdatedAt: now,
	}); err != nil {
		tb.Fatal(err)
	}
}

// listPageAuditRecord 构造一条 24 小时内计入 token 汇总的成功审计记录。
func listPageAuditRecord(index int, accountID uint64, now time.Time) audit.Record {
	return audit.Record{
		EventID: fmt.Sprintf("list-page-event-%08d", index), RequestID: fmt.Sprintf("list-page-request-%08d", index),
		ClientKeyID: 1, ModelRouteID: 1, Provider: string(accountdomain.ProviderBuild),
		Operation: audit.OperationResponses, UsageSource: audit.UsageSourceUpstream,
		AccountID: &accountID, TotalTokens: 1200, StatusCode: 200, CreatedAt: now.Add(-time.Hour),
	}
}

// BenchmarkServiceListPageAggregation 测量管理端账号列表一页的真实聚合路径：
// 账号分页 + 审计 token 汇总 + billing + 额度恢复 + 额度窗口 + 模型封锁。
func BenchmarkServiceListPageAggregation(b *testing.B) {
	b.StopTimer()
	ctx, database := openAccountTestDatabase(b, "list-page-aggregation.db")
	accounts := relational.NewAccountRepository(database)
	audits := relational.NewAuditRepository(database)
	seedListPageAccounts(b, ctx, accounts, audits, listPageBenchmarkAccounts)
	service := NewService(accounts, audits, nil, nil, nil, nil, nil)
	b.ReportMetric(listPageBenchmarkAccounts, "accounts")
	b.ReportMetric(listPageBenchmarkPageSize, "page")
	b.ReportAllocs()
	b.ResetTimer()
	b.StartTimer()
	for b.Loop() {
		views, total, err := service.List(ctx, 1, listPageBenchmarkPageSize, "", ListFilter{})
		if err != nil {
			b.Fatal(err)
		}
		if len(views) != listPageBenchmarkPageSize || total != listPageBenchmarkAccounts {
			b.Fatalf("views = %d, total = %d", len(views), total)
		}
	}
}
