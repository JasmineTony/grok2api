package gateway

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// canUseStaleRoutingSnapshot deliberately accepts only errors that carry a
// transient signal. Serving stale data for cancellations, schema/query bugs,
// or repository validation failures would hide correctness problems.
func canUseStaleRoutingSnapshot(ctx context.Context, err error) bool {
	if err == nil || ctx != nil && ctx.Err() != nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	_, transient := transientRoutingStoreFailureClass(err)
	return transient
}

// transientRoutingStoreFailureClass 仅识别带有明确瞬态信号的存储错误，
// 同时返回不包含账号或错误正文的稳定分类，供单次选号的故障放大保护使用。
func transientRoutingStoreFailureClass(err error) (string, bool) {
	if err == nil || errors.Is(err, context.Canceled) {
		return "", false
	}
	if errors.Is(err, repository.ErrNotFound) || errors.Is(err, repository.ErrConflict) || errors.Is(err, repository.ErrLimitExceeded) || errors.Is(err, repository.ErrInvalidRecord) || errors.Is(err, repository.ErrAccountPoolMismatch) {
		return "", false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "deadline", true
	}
	if errors.Is(err, sql.ErrConnDone) || errors.Is(err, driver.ErrBadConn) {
		return "sql_connection", true
	}
	var networkError net.Error
	if errors.As(err, &networkError) && (networkError.Timeout() || networkError.Temporary()) {
		return fmt.Sprintf("network:%T", networkError), true
	}
	var temporary interface{ Temporary() bool }
	if errors.As(err, &temporary) && temporary.Temporary() {
		return fmt.Sprintf("temporary:%T", temporary), true
	}
	// modernc SQLite exposes the primary/extended result through Code().
	// SQLITE_BUSY (5) and SQLITE_LOCKED (6) are safe to retry.
	var sqliteError interface{ Code() int }
	if errors.As(err, &sqliteError) {
		primaryCode := sqliteError.Code() & 0xff
		switch primaryCode {
		case 5, 6:
			return fmt.Sprintf("sqlite:%d", primaryCode), true
		}
	}
	// pgx exposes SQLSTATE without requiring the application layer to depend on
	// a concrete PostgreSQL driver type.
	var postgresError interface{ SQLState() string }
	if errors.As(err, &postgresError) {
		state := postgresError.SQLState()
		switch {
		case strings.HasPrefix(state, "08"), strings.HasPrefix(state, "40"), state == "55P03", state == "57P01", state == "57P02", state == "57P03":
			return "postgres:" + state, true
		}
	}
	return "", false
}

func (s *Selector) logStaleRoutingFallback(layer string, provider account.Provider, now, staleUntil time.Time, err error) {
	key := layer + "\x00" + string(provider)
	s.staleLogMu.Lock()
	if s.staleFallbackLoggedAt == nil {
		s.staleFallbackLoggedAt = make(map[string]time.Time)
	}
	last := s.staleFallbackLoggedAt[key]
	if !last.IsZero() && now.Sub(last) < candidateCacheStaleLogInterval {
		s.staleLogMu.Unlock()
		return
	}
	s.staleFallbackLoggedAt[key] = now
	s.staleLogMu.Unlock()

	staleFor := now.Sub(staleUntil.Add(-candidateCacheStaleTTL))
	if staleFor < 0 {
		staleFor = 0
	}
	logger := s.logger
	if logger == nil {
		logger = slog.Default()
	}
	logger.Warn("routing_snapshot_stale_fallback",
		"provider", provider,
		"layer", layer,
		"stale_for_ms", staleFor.Milliseconds(),
		"retry_after_ms", candidateCacheRetryTTL.Milliseconds(),
		"error_type", fmt.Sprintf("%T", err),
	)
}

type snapshotCacheMetadata struct {
	values     int
	staleUntil time.Time
	accessedAt time.Time
}

func pruneSnapshotCache[K comparable, V any](values map[K]V, protected K, now time.Time, maxSnapshots, maxValues int, metadata func(V) snapshotCacheMetadata) {
	for key, value := range values {
		entry := metadata(value)
		if key != protected && !entry.staleUntil.IsZero() && !now.Before(entry.staleUntil) {
			delete(values, key)
		}
	}
	for {
		total := 0
		for _, value := range values {
			total += metadata(value).values
		}
		// A single oversized provider pool must remain usable. The budget becomes
		// a strict bound as soon as there is another evictable snapshot.
		if len(values) <= maxSnapshots && (total <= maxValues || len(values) == 1) {
			return
		}
		var oldestKey K
		var oldestAt time.Time
		found := false
		for key, value := range values {
			if key == protected {
				continue
			}
			accessedAt := metadata(value).accessedAt
			if !found || accessedAt.Before(oldestAt) {
				oldestKey, oldestAt, found = key, accessedAt, true
			}
		}
		if !found {
			return
		}
		delete(values, oldestKey)
	}
}

func (s *Selector) storeCandidateSnapshotLocked(key candidateCacheKey, snapshot candidateSnapshot, now time.Time) {
	snapshot.lastAccess = now
	if snapshot.staleUntil.IsZero() {
		snapshot.staleUntil = snapshot.expiresAt.Add(candidateCacheStaleTTL)
	}
	s.candidates[key] = snapshot
	pruneSnapshotCache(s.candidates, key, now, maxCandidateCacheSnapshots, maxCandidateCacheValues, func(value candidateSnapshot) snapshotCacheMetadata {
		return snapshotCacheMetadata{values: len(value.values), staleUntil: value.staleUntil, accessedAt: cacheSnapshotAccess(value.lastAccess, value.expiresAt)}
	})
}

func (s *Selector) storeRoutingBaseSnapshotLocked(key routingBaseCacheKey, snapshot routingBaseSnapshot, now time.Time) {
	snapshot.lastAccess = now
	if snapshot.staleUntil.IsZero() {
		snapshot.staleUntil = snapshot.expiresAt.Add(candidateCacheStaleTTL)
	}
	s.routingBases[key] = snapshot
	pruneSnapshotCache(s.routingBases, key, now, maxRoutingBaseSnapshots, maxRoutingBaseValues, func(value routingBaseSnapshot) snapshotCacheMetadata {
		return snapshotCacheMetadata{values: len(value.values), staleUntil: value.staleUntil, accessedAt: cacheSnapshotAccess(value.lastAccess, value.expiresAt)}
	})
}

func (s *Selector) storeRoutingOverlaySnapshotLocked(key routingOverlayCacheKey, snapshot routingOverlaySnapshot, now time.Time) {
	snapshot.lastAccess = now
	if snapshot.staleUntil.IsZero() {
		snapshot.staleUntil = snapshot.expiresAt.Add(candidateCacheStaleTTL)
	}
	s.routingOverlays[key] = snapshot
	pruneSnapshotCache(s.routingOverlays, key, now, maxRoutingOverlaySnapshots, maxRoutingOverlayValues, func(value routingOverlaySnapshot) snapshotCacheMetadata {
		return snapshotCacheMetadata{values: len(value.value.Values), staleUntil: value.staleUntil, accessedAt: cacheSnapshotAccess(value.lastAccess, value.expiresAt)}
	})
}

type routingBaseLoadResult struct {
	values  []account.RoutingAccountBase
	version routingLayerVersion
}

type routingOverlayLoadResult struct {
	value   account.RoutingOverlaySnapshot
	version routingLayerVersion
}

func assembleRoutingCandidates(provider account.Provider, quotaMode string, bases []account.RoutingAccountBase, overlay account.RoutingOverlaySnapshot) []account.RoutingCandidate {
	byAccount := make(map[uint64]account.RoutingAccountOverlay, len(overlay.Values))
	for _, value := range overlay.Values {
		byAccount[value.AccountID] = value
	}
	sharedSuperBuildModel := false
	if provider == account.ProviderBuild && !overlay.HasBindings {
		for _, base := range bases {
			value, exists := byAccount[base.Credential.ID]
			if exists && value.SupportsModel && account.IsBuildSuper(base.Credential, base.Billing) {
				sharedSuperBuildModel = true
				break
			}
		}
	}
	result := make([]account.RoutingCandidate, 0, len(bases))
	staticProviderModel := (provider == account.ProviderConsole && strings.TrimSpace(quotaMode) != "") ||
		(provider == account.ProviderWeb && account.IsWebImagineQuotaMode(quotaMode))
	for _, base := range bases {
		overlayValue := byAccount[base.Credential.ID]
		if overlay.HasBindings && !overlayValue.Bound {
			continue
		}
		known, supports := overlayValue.ModelCapabilityKnown, overlayValue.SupportsModel
		if staticProviderModel {
			known, supports = true, true
		} else if overlay.HasBindings {
			known, supports = true, true
		} else if sharedSuperBuildModel && account.IsBuildSuper(base.Credential, base.Billing) {
			known, supports = true, true
		}
		result = append(result, account.RoutingCandidate{
			Credential: base.Credential, Billing: base.Billing, QuotaWindow: base.QuotaWindow, QuotaRecovery: base.QuotaRecovery,
			EgressLeaseBlock: base.EgressLeaseBlock, ModelQuotaBlock: overlayValue.ModelQuotaBlock, ModelCapabilityKnown: known, SupportsModel: supports,
		})
	}
	return result
}
