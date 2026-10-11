package relational

import (
	"context"
	"errors"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *EgressRepository) CreateEgressNode(ctx context.Context, value egress.Node) (egress.Node, error) {
	row := fromEgressDomain(value)
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := materializeEgressProxyProfile(tx, &row); err != nil {
			return err
		}
		return tx.Create(&row).Error
	})
	if err != nil {
		return egress.Node{}, mapError(err)
	}
	return toEgressDomain(row), nil
}

func (r *EgressRepository) CreateEgressNodes(ctx context.Context, values []egress.Node) (int, error) {
	if len(values) == 0 {
		return 0, nil
	}
	rows := make([]egressNodeModel, 0, len(values))
	for _, value := range values {
		rows = append(rows, fromEgressDomain(value))
	}
	if err := r.db.db.WithContext(ctx).CreateInBatches(&rows, 100).Error; err != nil {
		return 0, mapError(err)
	}
	return len(rows), nil
}

func (r *EgressRepository) UpdateEgressNode(ctx context.Context, value egress.Node) (egress.Node, error) {
	row := fromEgressDomain(value)
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := materializeEgressProxyProfile(tx, &row); err != nil {
			return err
		}
		// Select("*").Updates keeps zero values while avoiding Save's fallback
		// INSERT, which could resurrect a node deleted after the service read it.
		result := tx.Model(&egressNodeModel{}).Where("id = ?", row.ID).Select("*").Updates(&row)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return repository.ErrNotFound
		}
		return nil
	})
	if err != nil {
		return egress.Node{}, mapError(err)
	}
	return toEgressDomain(row), nil
}

// materializeEgressProxyProfile enforces the profile row as the canonical
// source whenever a node is written. Locking the profile in the node write
// transaction serializes this path with profile updates, preventing an older
// application-layer snapshot from restoring stale encrypted proxy data.
func materializeEgressProxyProfile(tx *gorm.DB, row *egressNodeModel) error {
	if row.ProxyProfileID == nil || *row.ProxyProfileID == 0 {
		return nil
	}
	var profile egressProxyProfileModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "encrypted_proxy_url").First(&profile, *row.ProxyProfileID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return repository.ErrEgressProxyProfileNotFound
		}
		return err
	}
	row.EncryptedProxyURL = profile.EncryptedProxyURL
	return nil
}

func (r *EgressRepository) UpdateEgressNodesEnabled(ctx context.Context, ids []uint64, enabled bool) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	if enabled {
		result := r.db.db.WithContext(ctx).Model(&egressNodeModel{}).
			Where("id IN ? AND enabled <> ?", ids, true).
			Updates(map[string]any{"enabled": true, "updated_at": time.Now().UTC()})
		return int(result.RowsAffected), mapError(result.Error)
	}
	var updated int64
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		config, err := lockEgressOperationsConfig(tx)
		if err != nil {
			return err
		}
		var lockedIDs []uint64
		if err := tx.Model(&egressNodeModel{}).Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id IN ?", ids).Order("id ASC").Pluck("id", &lockedIDs).Error; err != nil {
			return err
		}
		if configReferencesAnyFallbackNode(config, lockedIDs) {
			return repository.ErrEgressFallbackInUse
		}
		result := tx.Model(&egressNodeModel{}).
			Where("id IN ? AND enabled <> ?", lockedIDs, false).
			Updates(map[string]any{"enabled": false, "updated_at": time.Now().UTC()})
		updated = result.RowsAffected
		return result.Error
	})
	return int(updated), mapError(err)
}

func (r *EgressRepository) UpdateEgressNodeClearance(ctx context.Context, id uint64, encryptedCookie, userAgent, fingerprint, bindingFingerprint string, refreshedAt time.Time) error {
	result := r.db.db.WithContext(ctx).Model(&egressNodeModel{}).Where("id = ?", id).Updates(map[string]any{
		"encrypted_cloudflare_cookie": encryptedCookie, "user_agent": userAgent,
		"clearance_fingerprint": fingerprint, "clearance_refreshed_at": refreshedAt,
		"clearance_binding_fingerprint": bindingFingerprint,
		"last_error":                    "", "updated_at": time.Now().UTC(),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return repository.ErrNotFound
	}
	return nil
}

func (r *EgressRepository) UpdateEgressNodeHealth(ctx context.Context, id uint64, health float64, failureCount int, cooldownUntil *time.Time, lastError string) error {
	result := r.db.db.WithContext(ctx).Model(&egressNodeModel{}).Where("id = ?", id).Updates(map[string]any{
		"health": health, "failure_count": failureCount, "cooldown_until": cooldownUntil, "last_error": lastError, "updated_at": time.Now().UTC(),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return repository.ErrNotFound
	}
	return nil
}

func (r *EgressRepository) UpdateEgressNodeLastError(ctx context.Context, id uint64, lastError string) error {
	result := r.db.db.WithContext(ctx).Model(&egressNodeModel{}).Where("id = ?", id).Updates(map[string]any{
		"last_error": lastError, "updated_at": time.Now().UTC(),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return repository.ErrNotFound
	}
	return nil
}

// UpdateEgressNodeProbe persists a direct proxy probe. A healthy result also
// clears a transport-only request failure because the proxy has just been
// verified independently; anti-bot and other request failures stay intact.
func (r *EgressRepository) UpdateEgressNodeProbe(ctx context.Context, id uint64, expectedEncryptedProxyURL string, value egress.ProbeResult) error {
	updates := map[string]any{
		"probe_status": value.Status, "last_probed_at": value.TestedAt.UTC(),
		"probe_latency_ms": value.LatencyMS, "exit_ip": value.ExitIP, "probe_error": value.Error, "probe_provider": storedProbeProvider(value.Provider),
		"ipv4_probe_status": normalizedProbeStatus(value.IPv4.Status), "ipv4_last_probed_at": probeTestedAt(value.IPv4),
		"ipv4_probe_latency_ms": value.IPv4.LatencyMS, "ipv4_exit_ip": value.IPv4.ExitIP, "ipv4_probe_error": value.IPv4.Error,
		"ipv6_probe_status": normalizedProbeStatus(value.IPv6.Status), "ipv6_last_probed_at": probeTestedAt(value.IPv6),
		"ipv6_probe_latency_ms": value.IPv6.LatencyMS, "ipv6_exit_ip": value.IPv6.ExitIP, "ipv6_probe_error": value.IPv6.Error,
		"updated_at": time.Now().UTC(),
	}
	if value.Status == egress.ProbeStatusHealthy {
		condition := "last_error = ?"
		updates["health"] = gorm.Expr("CASE WHEN "+condition+" THEN ? ELSE health END", egress.LastErrorTransport, 1)
		updates["failure_count"] = gorm.Expr("CASE WHEN "+condition+" THEN ? ELSE failure_count END", egress.LastErrorTransport, 0)
		updates["cooldown_until"] = gorm.Expr("CASE WHEN "+condition+" THEN NULL ELSE cooldown_until END", egress.LastErrorTransport)
		updates["last_error"] = gorm.Expr("CASE WHEN "+condition+" THEN ? ELSE last_error END", egress.LastErrorTransport, "")
	}
	result := r.db.db.WithContext(ctx).Model(&egressNodeModel{}).
		Where("id = ? AND encrypted_proxy_url = ?", id, expectedEncryptedProxyURL).
		Updates(updates)
	if result.Error != nil {
		return mapError(result.Error)
	}
	if result.RowsAffected == 0 {
		var count int64
		if err := r.db.db.WithContext(ctx).Model(&egressNodeModel{}).Where("id = ?", id).Count(&count).Error; err != nil {
			return mapError(err)
		}
		if count == 0 {
			return repository.ErrNotFound
		}
		return repository.ErrConflict
	}
	return nil
}
