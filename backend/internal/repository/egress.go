package repository

import (
	"context"

	"github.com/chenyme/grok2api/backend/internal/domain/egress"
)

type EgressRepository interface {
	ListEgressNodes(ctx context.Context, scope egress.Scope, sort SortQuery) ([]egress.Node, error)
	GetEgressNode(ctx context.Context, id uint64) (egress.Node, error)
	CreateEgressNode(ctx context.Context, value egress.Node) (egress.Node, error)
	UpdateEgressNode(ctx context.Context, value egress.Node) (egress.Node, error)
	DeleteEgressNode(ctx context.Context, id uint64) error
}

// AccountEgressPolicyRepository is optional for runtime managers so older test
// doubles and external adapters can continue to provide provider-scoped pools.
type AccountEgressPolicyRepository interface {
	GetAccountEgressPolicy(ctx context.Context, accountID uint64) (egress.AccountPolicy, error)
	UpsertAccountEgressPolicy(ctx context.Context, value egress.AccountPolicy) (egress.AccountPolicy, error)
	DeleteAccountEgressPolicy(ctx context.Context, accountID uint64) error
}


// EgressHealthRepository stores bounded active-check history without secrets.
type EgressHealthRepository interface {
	RecordEgressHealthCheck(ctx context.Context, value egress.HealthCheckResult) error
	ListEgressHealthChecks(ctx context.Context, nodeID uint64, limit int) ([]egress.HealthCheckResult, error)
}
