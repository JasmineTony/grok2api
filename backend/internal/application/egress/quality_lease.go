package egress

import (
	"context"
	"errors"
	"strings"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	domain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// QualityLeaseRepository is optional and deliberately separate from account
// binding administration. It exposes only the state required to isolate one
// account-bound proxy lease.
type QualityLeaseRepository interface {
	Get(context.Context, uint64) (accountdomain.Credential, error)
	ListEgressLeaseBlocks(context.Context, int, *accountdomain.EgressLeaseBlockCursor) ([]accountdomain.EgressLeaseBlock, error)
	UpsertEgressLeaseBlock(context.Context, accountdomain.EgressLeaseBlock) (accountdomain.EgressLeaseBlock, error)
	DeleteEgressLeaseBlock(context.Context, uint64, uint64, string) (bool, error)
	DeleteEgressLeaseBlocksByNodes(context.Context, []uint64) (int64, error)
	PruneInvalidEgressLeaseBlocks(context.Context, int) (int64, error)
}

type QualityLeaseInput struct {
	AccountID         uint64
	NodeID            uint64
	Reason            string
	QuarantineSeconds int
}

func (s *Service) ListQualityLeases(ctx context.Context, limit int, cursor *accountdomain.EgressLeaseBlockCursor) ([]accountdomain.EgressLeaseBlock, error) {
	if s.qualityLeases == nil {
		return nil, ErrQualityLeaseUnavailable
	}
	if limit < 1 || limit > 1001 {
		return nil, ErrInvalidInput
	}
	if cursor == nil {
		for range 10 {
			pruned, err := s.qualityLeases.PruneInvalidEgressLeaseBlocks(ctx, 1000)
			if err != nil {
				return nil, err
			}
			if pruned < 1000 {
				break
			}
		}
		nodes, err := s.repository.ListEgressNodes(ctx, domain.ScopeBuild, repository.SortQuery{})
		if err != nil {
			return nil, err
		}
		staleNodeIDs := make([]uint64, 0)
		for _, node := range nodes {
			if !node.Enabled || !s.accountBoundProxy(node) {
				staleNodeIDs = append(staleNodeIDs, node.ID)
			}
		}
		if _, err := s.qualityLeases.DeleteEgressLeaseBlocksByNodes(ctx, staleNodeIDs); err != nil {
			return nil, err
		}
	}
	return s.qualityLeases.ListEgressLeaseBlocks(ctx, limit, cursor)
}

func (s *Service) QuarantineQualityLease(ctx context.Context, input QualityLeaseInput) (accountdomain.EgressLeaseBlock, error) {
	input.Reason = strings.TrimSpace(input.Reason)
	if input.AccountID == 0 || input.NodeID == 0 || input.QuarantineSeconds < 30 || input.QuarantineSeconds > 86400 || !qualityLeaseReasonAllowed(input.Reason) {
		return accountdomain.EgressLeaseBlock{}, ErrInvalidInput
	}
	if s.qualityLeases == nil {
		return accountdomain.EgressLeaseBlock{}, ErrQualityLeaseUnavailable
	}
	node, err := s.repository.GetEgressNode(ctx, input.NodeID)
	if errors.Is(err, repository.ErrNotFound) {
		return accountdomain.EgressLeaseBlock{}, ErrNotFound
	}
	if err != nil {
		return accountdomain.EgressLeaseBlock{}, err
	}
	if !node.Enabled || node.Scope != domain.ScopeBuild || !s.accountBoundProxy(node) {
		return accountdomain.EgressLeaseBlock{}, ErrInvalidInput
	}
	credential, err := s.qualityLeases.Get(ctx, input.AccountID)
	if err != nil || credential.Provider != accountdomain.ProviderBuild || !credential.Enabled || credential.AuthStatus != accountdomain.AuthStatusActive || !qualityLeaseCredentialMayUseNode(credential, input.NodeID) {
		return accountdomain.EgressLeaseBlock{}, ErrQualityLeaseConflict
	}
	version, err := security.NewOpaqueToken(18)
	if err != nil {
		return accountdomain.EgressLeaseBlock{}, err
	}
	now := time.Now().UTC()
	value, err := s.qualityLeases.UpsertEgressLeaseBlock(ctx, accountdomain.EgressLeaseBlock{
		AccountID: input.AccountID, NodeID: input.NodeID, Reason: input.Reason, Version: version,
		CooldownUntil: now.Add(time.Duration(input.QuarantineSeconds) * time.Second), UpdatedAt: now,
	})
	if errors.Is(err, repository.ErrConflict) || errors.Is(err, repository.ErrNotFound) {
		return accountdomain.EgressLeaseBlock{}, ErrQualityLeaseConflict
	}
	return value, err
}

func (s *Service) RestoreQualityLease(ctx context.Context, accountID, nodeID uint64, version string) (bool, error) {
	version = strings.TrimSpace(version)
	if accountID == 0 || nodeID == 0 || version == "" || len(version) > 64 {
		return false, ErrInvalidInput
	}
	if s.qualityLeases == nil {
		return false, ErrQualityLeaseUnavailable
	}
	restored, err := s.qualityLeases.DeleteEgressLeaseBlock(ctx, accountID, nodeID, version)
	if err != nil {
		return false, err
	}
	if !restored {
		return false, ErrQualityLeaseConflict
	}
	return true, nil
}

func qualityLeaseReasonAllowed(value string) bool {
	switch value {
	case "hard_tps", "soft_tps", "buffered_burst", "missing_thinking", "expected_marker_missing", "insufficient_output_tokens", "insufficient_generation_window", "probe_errors", "recovery_probe_error", "rotation_error":
		return true
	default:
		return false
	}
}

// An unbound Build account may be assigned an account-derived proxy node by
// the runtime pool. In that case the quality audit's node ID is the observed
// lease owner. A concrete binding remains authoritative and must never be
// quarantined or probed through a different node.
func qualityLeaseCredentialMayUseNode(credential accountdomain.Credential, nodeID uint64) bool {
	return nodeID != 0 && (credential.EgressNodeID == 0 || credential.EgressNodeID == nodeID)
}

func (s *Service) clearQualityLeasesForNodes(ctx context.Context, nodeIDs []uint64) error {
	if s.qualityLeases == nil || len(nodeIDs) == 0 {
		return nil
	}
	_, err := s.qualityLeases.DeleteEgressLeaseBlocksByNodes(ctx, uniqueIDs(nodeIDs))
	return err
}
