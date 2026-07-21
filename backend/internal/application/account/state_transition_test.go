package account

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
	"github.com/chenyme/grok2api/backend/internal/infra/runtime/memory"
)

func TestMarkReauthRequiredUsesStateTransition(t *testing.T) {
	ctx := context.Background()
	database, err := relational.OpenSQLite(ctx, filepath.Join(t.TempDir(), "reauth-state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err := database.InitializeSchema(ctx); err != nil {
		t.Fatal(err)
	}
	repo := relational.NewAccountRepository(database)
	credential, _, err := repo.UpsertByIdentity(ctx, accountdomain.Credential{
		Provider: accountdomain.ProviderBuild, Name: "reauth", SourceKey: "reauth",
		EncryptedAccessToken: "encrypted", Enabled: true, AuthStatus: accountdomain.AuthStatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(repo, nil, nil, memory.NewStickyStore(), nil, nil, nil)
	now := time.Date(2026, 7, 20, 8, 30, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	if err := service.MarkReauthRequired(ctx, credential.ID, "confirmed token rejection"); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.Get(ctx, credential.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.AuthStatus != accountdomain.AuthStatusReauthRequired || stored.State != accountdomain.StateReauthRequired {
		t.Fatalf("credential state = %#v", stored)
	}
	events, err := repo.ListStateEvents(ctx, credential.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Event != accountdomain.EventCredentialRejected || !events[0].CreatedAt.Equal(now) {
		t.Fatalf("state events = %#v", events)
	}
}

func TestUpdateEnabledEmitsStateEvents(t *testing.T) {
	ctx := context.Background()
	database, err := relational.OpenSQLite(ctx, filepath.Join(t.TempDir(), "enabled-state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err := database.InitializeSchema(ctx); err != nil {
		t.Fatal(err)
	}
	repo := relational.NewAccountRepository(database)
	audits := relational.NewAuditRepository(database)
	credential, _, err := repo.UpsertByIdentity(ctx, accountdomain.Credential{
		Provider: accountdomain.ProviderBuild, Name: "toggle", SourceKey: "toggle",
		EncryptedAccessToken: "encrypted", Enabled: true, AuthStatus: accountdomain.AuthStatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(repo, audits, nil, memory.NewStickyStore(), nil, nil, nil)
	now := time.Date(2026, 7, 20, 9, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	disabled := false
	if _, err := service.Update(ctx, credential.ID, UpdateInput{Enabled: &disabled}); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.Get(ctx, credential.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Enabled || stored.State != accountdomain.StateDisabled {
		t.Fatalf("disabled state = %#v", stored)
	}
	now = now.Add(time.Minute)
	enabled := true
	if _, err := service.Update(ctx, credential.ID, UpdateInput{Enabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	stored, err = repo.Get(ctx, credential.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !stored.Enabled || stored.State != accountdomain.StateReady {
		t.Fatalf("enabled state = %#v", stored)
	}
	events, err := repo.ListStateEvents(ctx, credential.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Event != accountdomain.EventEnabled || events[1].Event != accountdomain.EventDisabled {
		t.Fatalf("state events = %#v", events)
	}
}
