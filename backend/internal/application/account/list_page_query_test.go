package account

import (
	"context"
	"sync"
	"testing"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// listAggregationCall 记录一次 List 聚合路径对仓储的调用及其传入的账号 ID 数量。
type listAggregationCall struct {
	method string
	ids    int
}

// listAggregationRecorder 汇总一次 List 调用触发的全部仓储调用。
type listAggregationRecorder struct {
	mu    sync.Mutex
	calls []listAggregationCall
}

func (r *listAggregationRecorder) record(method string, ids int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, listAggregationCall{method: method, ids: ids})
}

func (r *listAggregationRecorder) reset() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = nil
}

func (r *listAggregationRecorder) snapshot() []listAggregationCall {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]listAggregationCall(nil), r.calls...)
}

// countingAccountRepository 统计账号仓储调用；其余方法沿用真实实现。
type countingAccountRepository struct {
	repository.AccountRepository
	recorder *listAggregationRecorder
}

func (c *countingAccountRepository) List(ctx context.Context, query repository.AccountListQuery) ([]accountdomain.Credential, int64, error) {
	c.recorder.record("List", query.Page.Limit)
	return c.AccountRepository.List(ctx, query)
}

func (c *countingAccountRepository) GetBillings(ctx context.Context, accountIDs []uint64) (map[uint64]accountdomain.Billing, error) {
	c.recorder.record("GetBillings", len(accountIDs))
	return c.AccountRepository.GetBillings(ctx, accountIDs)
}

func (c *countingAccountRepository) GetQuotaRecoveries(ctx context.Context, accountIDs []uint64) (map[uint64]accountdomain.QuotaRecovery, error) {
	c.recorder.record("GetQuotaRecoveries", len(accountIDs))
	return c.AccountRepository.GetQuotaRecoveries(ctx, accountIDs)
}

func (c *countingAccountRepository) GetQuotaWindows(ctx context.Context, accountIDs []uint64) (map[uint64][]accountdomain.QuotaWindow, error) {
	c.recorder.record("GetQuotaWindows", len(accountIDs))
	return c.AccountRepository.GetQuotaWindows(ctx, accountIDs)
}

func (c *countingAccountRepository) GetModelQuotaBlocks(ctx context.Context, accountIDs []uint64, now time.Time) (map[uint64][]accountdomain.ModelQuotaBlock, error) {
	c.recorder.record("GetModelQuotaBlocks", len(accountIDs))
	return c.AccountRepository.GetModelQuotaBlocks(ctx, accountIDs, now)
}

// countingAuditRepository 统计审计仓储调用；其余方法沿用真实实现。
type countingAuditRepository struct {
	repository.AuditRepository
	recorder *listAggregationRecorder
}

func (c *countingAuditRepository) SumTokensByAccountsSince(ctx context.Context, accountIDs []uint64, since time.Time) (map[uint64]int64, error) {
	c.recorder.record("SumTokensByAccountsSince", len(accountIDs))
	return c.AuditRepository.SumTokensByAccountsSince(ctx, accountIDs, since)
}

// TestListPageAggregationQueryCountIsPageSizeIndependent 固定 List 一页的仓储调用序列：
// 无论页大小如何，批量聚合始终是「1 次分页 + 1 次审计汇总 + 4 次账号聚合」，
// 每次批量调用都收到整页账号 ID，因此查询次数与页大小无关（不存在 N+1）。
func TestListPageAggregationQueryCountIsPageSizeIndependent(t *testing.T) {
	const accountCount = 300
	ctx, database := openAccountTestDatabase(t, "list-page-query-count.db")
	accounts := relational.NewAccountRepository(database)
	audits := relational.NewAuditRepository(database)
	seedListPageAccounts(t, ctx, accounts, audits, accountCount)
	recorder := &listAggregationRecorder{}
	service := NewService(
		&countingAccountRepository{AccountRepository: accounts, recorder: recorder},
		&countingAuditRepository{AuditRepository: audits, recorder: recorder},
		nil, nil, nil, nil, nil,
	)
	wantMethods := []string{"List", "SumTokensByAccountsSince", "GetBillings", "GetQuotaRecoveries", "GetQuotaWindows", "GetModelQuotaBlocks"}

	for _, pageSize := range []int{1, 20, 50, accountCount} {
		recorder.reset()
		views, total, err := service.List(ctx, 1, pageSize, "", ListFilter{})
		if err != nil {
			t.Fatalf("List(pageSize=%d) error = %v", pageSize, err)
		}
		if len(views) != pageSize || total != accountCount {
			t.Fatalf("List(pageSize=%d) = %d views, total %d; want %d views, total %d", pageSize, len(views), total, pageSize, accountCount)
		}
		calls := recorder.snapshot()
		if len(calls) != len(wantMethods) {
			t.Fatalf("List(pageSize=%d) repository calls = %v; want %d calls", pageSize, calls, len(wantMethods))
		}
		for index, want := range wantMethods {
			if calls[index].method != want {
				t.Fatalf("List(pageSize=%d) call %d = %q; want %q (all calls: %v)", pageSize, index, calls[index].method, want, calls)
			}
			if calls[index].ids != pageSize {
				t.Fatalf("List(pageSize=%d) call %q received %d ids; want the whole page (%d)", pageSize, want, calls[index].ids, pageSize)
			}
		}
	}
}
