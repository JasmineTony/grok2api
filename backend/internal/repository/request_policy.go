package repository

import (
	"context"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/requestpolicy"
)

type RequestPolicyRepository interface {
	ListRequestPolicies(ctx context.Context) ([]requestpolicy.Rule, error)
	GetRequestPolicy(ctx context.Context, id uint64) (requestpolicy.Rule, error)
	CreateRequestPolicy(ctx context.Context, value requestpolicy.Rule) (requestpolicy.Rule, error)
	UpdateRequestPolicy(ctx context.Context, value requestpolicy.Rule) (requestpolicy.Rule, error)
	DeleteRequestPolicy(ctx context.Context, id uint64) error
	RecordRequestPolicyHits(ctx context.Context, ids []uint64, at time.Time) error
}
