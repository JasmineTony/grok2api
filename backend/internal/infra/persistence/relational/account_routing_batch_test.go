package relational

import (
	"context"
	"testing"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
)

// A large account pool must not be pushed into a single IN (...) clause: SQLite allows
// roughly 32766 bound parameters per statement, so an unbatched routing query fails
// outright instead of paging. The counts here exceed that limit on purpose.
const routingBatchAccountCount = 33_000

func TestGetRoutingBillingsChunksLargeAccountPool(t *testing.T) {
	ctx := context.Background()
	database := openTestDatabase(t)
	repo := NewAccountRepository(database)
	ids := seedRoutingBatchIDs(routingBatchAccountCount)

	billings, err := repo.getRoutingBillings(ctx, ids)
	if err != nil {
		t.Fatalf("getRoutingBillings over %d ids: %v", len(ids), err)
	}
	if len(billings) != 0 {
		t.Fatalf("billings = %d, want 0 for unseeded accounts", len(billings))
	}
}

func TestGetRoutingQuotaWindowsChunksLargeAccountPool(t *testing.T) {
	ctx := context.Background()
	database := openTestDatabase(t)
	repo := NewAccountRepository(database)
	ids := seedRoutingBatchIDs(routingBatchAccountCount)

	windows, err := repo.getRoutingQuotaWindows(ctx, ids, account.ProviderWeb, "weekly")
	if err != nil {
		t.Fatalf("getRoutingQuotaWindows over %d ids: %v", len(ids), err)
	}
	if len(windows) != 0 {
		t.Fatalf("windows = %d, want 0 for unseeded accounts", len(windows))
	}
}

func TestCountProviderAccountsByIDsChunksLargeAccountPool(t *testing.T) {
	ctx := context.Background()
	database := openTestDatabase(t)
	repo := NewAccountRepository(database)
	rows := seedBatchUpdateAccounts(t, database, 1200)
	// Pad with IDs well above the seeded rows so the count reflects only real accounts
	// while the slice still exceeds SQLite's bound-parameter limit.
	ids := accountModelIDs(rows)
	for offset := range routingBatchAccountCount {
		ids = append(ids, uint64(offset)+1_000_000)
	}

	count, err := repo.CountProviderAccountsByIDs(ctx, account.ProviderBuild, ids)
	if err != nil {
		t.Fatalf("CountProviderAccountsByIDs over %d ids: %v", len(ids), err)
	}
	if count != int64(len(rows)) {
		t.Fatalf("count = %d, want %d", count, len(rows))
	}
}

func TestForEachAccountIDBatchCoversEveryIDOnce(t *testing.T) {
	ids := seedRoutingBatchIDs(1051)
	seen := make([]uint64, 0, len(ids))
	batches := 0
	if err := forEachAccountIDBatch(ids, func(batch []uint64) error {
		if len(batch) > accountIDQueryBatchSize {
			t.Fatalf("batch size = %d, want <= %d", len(batch), accountIDQueryBatchSize)
		}
		batches++
		seen = append(seen, batch...)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if batches != 3 {
		t.Fatalf("batches = %d, want 3", batches)
	}
	if len(seen) != len(ids) {
		t.Fatalf("visited %d ids, want %d", len(seen), len(ids))
	}
	for index := range ids {
		if seen[index] != ids[index] {
			t.Fatalf("id at %d = %d, want %d", index, seen[index], ids[index])
		}
	}
}

func TestForEachAccountIDBatchStopsOnError(t *testing.T) {
	calls := 0
	err := forEachAccountIDBatch(seedRoutingBatchIDs(5000), func([]uint64) error {
		calls++
		return context.DeadlineExceeded
	})
	if err == nil {
		t.Fatal("expected the visitor error to propagate")
	}
	if calls != 1 {
		t.Fatalf("calls = %d, want 1", calls)
	}
}

func seedRoutingBatchIDs(count int) []uint64 {
	ids := make([]uint64, count)
	for index := range ids {
		ids[index] = uint64(index) + 1
	}
	return ids
}

