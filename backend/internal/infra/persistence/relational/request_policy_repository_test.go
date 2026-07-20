package relational

import (
	"context"
	policydomain "github.com/chenyme/grok2api/backend/internal/domain/requestpolicy"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"testing"
	"time"
)

func TestRequestPolicyRepositoryRoundTripAndHits(t *testing.T) {
	ctx := context.Background()
	db := openTestDatabase(t)
	defer db.Close()
	repo := NewRequestPolicyRepository(db)
	max := 100
	value, err := repo.CreateRequestPolicy(ctx, policydomain.Rule{Name: "deny expensive", Priority: 10, Enabled: true, DryRun: false, Match: policydomain.Match{Model: "grok-*"}, Action: policydomain.Action{Kind: policydomain.ActionLimitTokens, MaxTokens: &max}})
	if err != nil || value.ID == 0 {
		t.Fatalf("create=%#v err=%v", value, err)
	}
	values, err := repo.ListRequestPolicies(ctx)
	if err != nil || len(values) != 1 || values[0].Name != "deny expensive" {
		t.Fatalf("values=%#v err=%v", values, err)
	}
	if err := repo.RecordRequestPolicyHits(ctx, []uint64{value.ID, value.ID}, time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.GetRequestPolicy(ctx, value.ID)
	if err != nil || stored.HitCount != 1 || stored.LastHitAt == nil {
		t.Fatalf("stored=%#v err=%v", stored, err)
	}
	if err := repo.DeleteRequestPolicy(ctx, value.ID); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteRequestPolicy(ctx, value.ID); err != repository.ErrNotFound {
		t.Fatalf("delete missing err=%v", err)
	}
}
