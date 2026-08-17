package relational

import (
	"context"
	"testing"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

func TestBuildSuperEntitledDefaultsFalseAndSurvivesUpsert(t *testing.T) {
	ctx := context.Background()
	repo := NewAccountRepository(openTestDatabase(t))
	created, wasCreated, err := repo.UpsertByIdentity(ctx, account.Credential{
		Provider: account.ProviderBuild, Name: "entitled", SourceKey: "entitled-upsert",
		EncryptedAccessToken: testEncryptedToken, AuthStatus: account.AuthStatusActive,
	})
	if err != nil || !wasCreated {
		t.Fatalf("create = %#v created=%v err=%v", created, wasCreated, err)
	}
	if created.BuildSuperEntitled {
		t.Fatal("new account must default BuildSuperEntitled=false")
	}
	if created.BuildRouteMode != account.BuildRouteAuto {
		t.Fatalf("new account route mode = %q", created.BuildRouteMode)
	}
	created.BuildSuperEntitled = true
	created.BuildRouteMode = account.BuildRouteXAI
	if _, err := repo.Update(ctx, created); err != nil {
		t.Fatal(err)
	}
	// 普通 upsert 不得清除 entitlement。
	updated, wasCreated, err := repo.UpsertByIdentity(ctx, account.Credential{
		Provider: account.ProviderBuild, Name: "entitled-renamed", SourceKey: "entitled-upsert",
		EncryptedAccessToken: testEncryptedToken, AuthStatus: account.AuthStatusActive,
		BuildSuperEntitled: false,
	})
	if err != nil || wasCreated {
		t.Fatalf("upsert = %#v created=%v err=%v", updated, wasCreated, err)
	}
	if !updated.BuildSuperEntitled || updated.BuildRouteMode != account.BuildRouteXAI || updated.Name != "entitled-renamed" {
		t.Fatalf("entitlement must survive upsert: %#v", updated)
	}
	// token refresh 路径不改 account 表 entitlement 列。
	refreshed, err := repo.UpdateTokens(ctx, updated.ID, "encrypted-new", "encrypted-refresh", time.Now().UTC().Add(time.Hour), 0)
	if err != nil {
		t.Fatal(err)
	}
	if !refreshed.BuildSuperEntitled || refreshed.BuildRouteMode != account.BuildRouteXAI {
		t.Fatalf("token refresh must preserve Build settings: %#v", refreshed)
	}
}

func TestBuildSuperEntitledNonBuildForcedFalse(t *testing.T) {
	ctx := context.Background()
	repo := NewAccountRepository(openTestDatabase(t))
	created, _, err := repo.UpsertByIdentity(ctx, account.Credential{
		Provider: account.ProviderWeb, AuthType: account.AuthTypeSSO, Name: "web", SourceKey: "web-entitled",
		EncryptedAccessToken: testEncryptedToken, AuthStatus: account.AuthStatusActive,
		BuildSuperEntitled: true, BuildRouteMode: account.BuildRouteXAI,
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.BuildSuperEntitled {
		t.Fatal("non-Build must not persist BuildSuperEntitled")
	}
	if created.BuildRouteMode != account.BuildRouteAuto {
		t.Fatalf("non-Build route mode = %q", created.BuildRouteMode)
	}
}

func TestListRoutingCandidatesSharesEntitledBuildModels(t *testing.T) {
	ctx := context.Background()
	database := openTestDatabase(t)
	accounts := NewAccountRepository(database)
	models := NewModelRepository(database)
	observer, _, err := accounts.UpsertByIdentity(ctx, account.Credential{
		Provider: account.ProviderBuild, Name: "observer", SourceKey: "ent-observer",
		EncryptedAccessToken: testEncryptedToken, Enabled: true, AuthStatus: account.AuthStatusActive,
		BuildSuperEntitled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	// re-set after upsert create (fromAccountDomain true only when ProviderBuild — create path uses input)
	observer.BuildSuperEntitled = true
	if _, err := accounts.Update(ctx, observer); err != nil {
		t.Fatal(err)
	}
	peer, _, err := accounts.UpsertByIdentity(ctx, account.Credential{
		Provider: account.ProviderBuild, Name: "peer", SourceKey: "ent-peer",
		EncryptedAccessToken: testEncryptedToken, Enabled: true, AuthStatus: account.AuthStatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	peer.BuildSuperEntitled = true
	if _, err := accounts.Update(ctx, peer); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	const sharedModel = "grok-imagine-video-1.5"
	if err := models.UpsertDiscovered(ctx, account.ProviderBuild, []string{sharedModel}); err != nil {
		t.Fatal(err)
	}
	if err := models.ReplaceAccountCapabilities(ctx, observer.ID, []string{sharedModel}, now); err != nil {
		t.Fatal(err)
	}
	if err := models.ReplaceAccountCapabilities(ctx, peer.ID, []string{"grok-4.5"}, now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	candidates, err := accounts.ListRoutingCandidates(ctx, account.ProviderBuild, 0, sharedModel, "")
	if err != nil {
		t.Fatal(err)
	}
	byID := map[uint64]account.RoutingCandidate{}
	for _, c := range candidates {
		byID[c.Credential.ID] = c
	}
	if c := byID[observer.ID]; !c.SupportsModel {
		t.Fatalf("entitled observer should support model: %#v", c)
	}
	if c := byID[peer.ID]; !c.ModelCapabilityKnown || !c.SupportsModel {
		t.Fatalf("entitled peer should share an active paid observer's model: %#v", c)
	}
	// paid filter includes entitlement
	assertAccountFilterCount(t, ctx, accounts, repository.AccountListFilter{QuotaType: "paid", Now: now}, 2)
	assertAccountFilterCount(t, ctx, accounts, repository.AccountListFilter{QuotaType: "free", Now: now}, 0)
}

func TestListRoutingCandidatesSharesBuildModelsWithinEntitlementOnly(t *testing.T) {
	ctx := context.Background()
	database := openTestDatabase(t)
	accounts := NewAccountRepository(database)
	models := NewModelRepository(database)

	createAccount := func(name string, super bool) account.Credential {
		t.Helper()
		value, _, err := accounts.UpsertByIdentity(ctx, account.Credential{
			Provider: account.ProviderBuild, Name: name, SourceKey: name,
			EncryptedAccessToken: testEncryptedToken, Enabled: true, AuthStatus: account.AuthStatusActive,
		})
		if err != nil {
			t.Fatal(err)
		}
		if super {
			value.BuildSuperEntitled = true
			if _, err := accounts.Update(ctx, value); err != nil {
				t.Fatal(err)
			}
		}
		return value
	}

	regularObserver := createAccount("regular-observer", false)
	regularPeer := createAccount("regular-peer", false)
	superObserver := createAccount("super-observer", true)
	superPeer := createAccount("super-peer", true)
	const regularModel = "grok-4.6"
	const superModel = "grok-imagine-video-1.5"
	now := time.Now().UTC()
	if err := models.UpsertDiscovered(ctx, account.ProviderBuild, []string{regularModel, superModel}); err != nil {
		t.Fatal(err)
	}
	for accountID, capabilities := range map[uint64][]string{
		regularPeer.ID: {"grok-4.5"},
		superPeer.ID:   {"grok-4.5"},
	} {
		if err := models.ReplaceAccountCapabilities(ctx, accountID, capabilities, now.Add(-time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	for accountID, capabilities := range map[uint64][]string{
		regularObserver.ID: {regularModel},
		superObserver.ID:   {superModel},
	} {
		if err := models.ReplaceAccountCapabilities(ctx, accountID, capabilities, now); err != nil {
			t.Fatal(err)
		}
	}

	assertCandidates := func(upstreamModel string, expected map[uint64][2]bool) {
		t.Helper()
		candidates, err := accounts.ListRoutingCandidates(ctx, account.ProviderBuild, 0, upstreamModel, "")
		if err != nil {
			t.Fatal(err)
		}
		byID := make(map[uint64]account.RoutingCandidate, len(candidates))
		for _, candidate := range candidates {
			byID[candidate.Credential.ID] = candidate
		}
		for accountID, flags := range expected {
			candidate, exists := byID[accountID]
			if !exists || candidate.ModelCapabilityKnown != flags[0] || candidate.SupportsModel != flags[1] {
				t.Fatalf("model %s account %d = %#v, want known=%t supports=%t", upstreamModel, accountID, candidate, flags[0], flags[1])
			}
		}
	}

	assertCandidates(regularModel, map[uint64][2]bool{
		regularObserver.ID: {true, true},
		regularPeer.ID:     {false, false},
		superObserver.ID:   {true, false},
		superPeer.ID:       {true, false},
	})
	assertCandidates(superModel, map[uint64][2]bool{
		regularObserver.ID: {true, false},
		regularPeer.ID:     {true, false},
		superObserver.ID:   {true, true},
		superPeer.ID:       {true, true},
	})

	if err := models.ReplaceAccountCapabilities(ctx, regularPeer.ID, []string{"grok-4.5"}, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	assertCandidates(regularModel, map[uint64][2]bool{
		regularObserver.ID: {true, true},
		regularPeer.ID:     {true, false},
		superObserver.ID:   {true, false},
		superPeer.ID:       {true, false},
	})
}
