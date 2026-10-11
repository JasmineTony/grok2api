package gateway

import (
	"context"
	"errors"
	"fmt"
	"time"

	account "github.com/chenyme/grok2api/backend/internal/domain/account"
	repository "github.com/chenyme/grok2api/backend/internal/repository"
)

type accountLease struct {
	Credential          account.Credential
	Billing             *account.Billing
	QuotaProbe          bool
	QuotaProbeKind      account.QuotaRecoveryKind
	QuotaMode           string
	routingCandidate    *account.RoutingCandidate
	selectorObservation *selectorLeaseObservation
	release             func()
}

const quotaProbeLease = 5 * time.Minute
const successPersistInterval = 30 * time.Second

// Routing writes publish precise invalidation events, so the TTL is only a
// safety net for out-of-process database changes and missed notifications.
// Keeping a one-second TTL made large pools rebuild continuously under load.
const candidateCacheTTL = 30 * time.Second
const candidateCacheStaleTTL = 5 * time.Minute
const candidateCacheRetryTTL = 5 * time.Second
const candidateCacheStaleLogInterval = time.Minute
const maxCandidateCacheSnapshots = 64
const maxCandidateCacheValues = 100_000
const maxRoutingBaseSnapshots = 8
const maxRoutingBaseValues = 150_000
const maxRoutingOverlaySnapshots = 64
const maxRoutingOverlayValues = 250_000
const concurrencySnapshotTTL = 25 * time.Millisecond
const maxConcurrencySnapshots = 256

// Health overrides bridge precise request-path mutations until the immutable
// provider snapshot naturally refreshes. Keep them through the snapshot's
// normal and stale lifetimes so a transient database error cannot resurrect a
// cooled account from an older snapshot.
const routingHealthOverrideTTL = candidateCacheTTL + candidateCacheStaleTTL

const modelAccessDeniedCooldown = 5 * time.Minute

// softNetworkCooldown 网络/超时/5xx 仅短暂隔离本号，避免指数冷却掏空热池。
const softNetworkCooldown = 5 * time.Second

const defaultFreeQuotaRecoveryPause = 24 * time.Hour

var errRoutingCredentialStale = errors.New("routing credential is no longer available")

// credentialMaterialFailureSkipLimit 限制一次选号连续跳过的同类瞬态故障。
// 少量失败仍按单号隔离；超过上限时保留原始存储错误，避免大账号池放大系统性故障。
const credentialMaterialFailureSkipLimit = 8

type credentialMaterialFailureTracker struct {
	class string
	count int
}

func (tracker *credentialMaterialFailureTracker) record(class string) (int, bool) {
	if tracker == nil {
		return 1, true
	}
	if tracker.class != class {
		tracker.class = class
		tracker.count = 0
	}
	tracker.count++
	return tracker.count, tracker.count <= credentialMaterialFailureSkipLimit
}

func (tracker *credentialMaterialFailureTracker) reset() {
	if tracker == nil {
		return
	}
	tracker.class = ""
	tracker.count = 0
}

// skipUnusableCredentialMaterial 只把账号缺失或明确的瞬态存储故障转成可跳过的过期 claim。
// 请求取消、永久错误和无法分类的错误保留根因返回，不能伪装成整池无可用账号。
func (s *Selector) skipUnusableCredentialMaterial(ctx context.Context, value account.Credential, loadErr error, tracker *credentialMaterialFailureTracker) error {
	if ctx != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(loadErr, repository.ErrNotFound) {
		tracker.reset()
		s.ApplyInvalidation(repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged, Provider: value.Provider, AccountID: value.ID})
		return errRoutingCredentialStale
	}
	failureClass, transient := transientRoutingStoreFailureClass(loadErr)
	if !transient {
		return fmt.Errorf("加载账号 %d 的凭据材料: %w", value.ID, loadErr)
	}
	consecutiveFailures, allowed := tracker.record(failureClass)
	if !allowed {
		return fmt.Errorf("连续加载账号凭据材料失败（%s，%d 次）: %w", failureClass, consecutiveFailures, loadErr)
	}
	if s.logger != nil {
		s.logger.Warn(
			"routing_credential_material_skipped",
			"account_id", value.ID,
			"provider", value.Provider,
			"failure_class", failureClass,
			"consecutive_failures", consecutiveFailures,
			"error", loadErr,
		)
	}
	return errRoutingCredentialStale
}

type quotaRecoveryHints struct {
	Billing *account.Billing
}

type quotaConsumptionKey struct {
	provider  account.Provider
	accountID uint64
	mode      string
}

type accountQuotaConsumptionKey struct {
	accountID uint64
	mode      string
}

type routingHealthOverride struct {
	provider      account.Provider
	failureCount  int
	cooldownUntil *time.Time
	lastError     string
	updatedAt     time.Time
	revision      uint64
	expiresAt     time.Time
}

type candidateSnapshot struct {
	values     []account.RoutingCandidate
	byAccount  map[uint64]int
	expiresAt  time.Time
	staleUntil time.Time
	lastAccess time.Time
}

func newCandidateSnapshot(values []account.RoutingCandidate, expiresAt time.Time) candidateSnapshot {
	byAccount := make(map[uint64]int, len(values))
	for index, value := range values {
		if _, exists := byAccount[value.Credential.ID]; !exists {
			byAccount[value.Credential.ID] = index
		}
	}
	now := time.Now().UTC()
	return candidateSnapshot{values: values, byAccount: byAccount, expiresAt: expiresAt, staleUntil: expiresAt.Add(candidateCacheStaleTTL), lastAccess: now}
}
