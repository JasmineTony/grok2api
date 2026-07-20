package relational

import (
	"context"
	"errors"
	"testing"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	egressdomain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

func TestAccountEgressPolicyRoundTripAndScopeValidation(t *testing.T) {
	ctx := context.Background()
	database := openTestDatabase(t)
	accounts := NewAccountRepository(database)
	egressRepository := NewEgressRepository(database)
	credential, _, err := accounts.UpsertByIdentity(ctx, accountdomain.Credential{
		Provider: accountdomain.ProviderBuild, Name: "policy-account", SourceKey: "policy-account",
		EncryptedAccessToken: testEncryptedToken, AuthStatus: accountdomain.AuthStatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	buildNode, err := egressRepository.CreateEgressNode(ctx, egressdomain.Node{Name: "build", Scope: egressdomain.ScopeBuild, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	webNode, err := egressRepository.CreateEgressNode(ctx, egressdomain.Node{Name: "web", Scope: egressdomain.ScopeWeb, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	defaultPolicy, err := egressRepository.GetAccountEgressPolicy(ctx, credential.ID)
	if err != nil || defaultPolicy.Strategy != egressdomain.AccountPolicyInherit || defaultPolicy.EgressNodeID != nil {
		t.Fatalf("default policy = %#v, err=%v", defaultPolicy, err)
	}
	stored, err := egressRepository.UpsertAccountEgressPolicy(ctx, egressdomain.AccountPolicy{
		AccountID: credential.ID, Strategy: egressdomain.AccountPolicyNode, EgressNodeID: &buildNode.ID, AllowDirectFallback: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if stored.EgressNodeID == nil || *stored.EgressNodeID != buildNode.ID || !stored.AllowDirectFallback {
		t.Fatalf("stored policy = %#v", stored)
	}
	if _, err := egressRepository.UpsertAccountEgressPolicy(ctx, egressdomain.AccountPolicy{
		AccountID: credential.ID, Strategy: egressdomain.AccountPolicyNode, EgressNodeID: &webNode.ID,
	}); !errors.Is(err, repository.ErrConflict) {
		t.Fatalf("cross-provider node err = %v", err)
	}
	direct, err := egressRepository.UpsertAccountEgressPolicy(ctx, egressdomain.AccountPolicy{
		AccountID: credential.ID, Strategy: egressdomain.AccountPolicyDirect, EgressNodeID: &buildNode.ID,
	})
	if err != nil || direct.EgressNodeID != nil || direct.Strategy != egressdomain.AccountPolicyDirect {
		t.Fatalf("direct policy = %#v, err=%v", direct, err)
	}
	if err := database.InitializeSchema(ctx); err != nil {
		t.Fatal(err)
	}
	persisted, err := egressRepository.GetAccountEgressPolicy(ctx, credential.ID)
	if err != nil || persisted.Strategy != egressdomain.AccountPolicyDirect {
		t.Fatalf("persisted policy = %#v, err=%v", persisted, err)
	}
	inherit, err := egressRepository.UpsertAccountEgressPolicy(ctx, egressdomain.AccountPolicy{AccountID: credential.ID, Strategy: egressdomain.AccountPolicyInherit})
	if err != nil || inherit.Strategy != egressdomain.AccountPolicyInherit {
		t.Fatalf("inherit policy = %#v, err=%v", inherit, err)
	}
}
