package relational

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *ModelRepository) ReplaceAccountCapabilities(ctx context.Context, accountID uint64, upstreamModels []string, syncedAt time.Time) error {
	unique := make(map[string]struct{}, len(upstreamModels))
	rows := make([]accountModelCapabilityModel, 0, len(upstreamModels))
	for _, value := range upstreamModels {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := unique[value]; ok {
			continue
		}
		unique[value] = struct{}{}
		rows = append(rows, accountModelCapabilityModel{AccountID: accountID, UpstreamModel: value})
	}
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("account_id = ?", accountID).Delete(&accountModelCapabilityModel{}).Error; err != nil {
			return err
		}
		if len(rows) > 0 {
			if err := tx.CreateInBatches(rows, 200).Error; err != nil {
				return err
			}
		}
		state := accountModelSyncStateModel{AccountID: accountID, LastAttemptAt: syncedAt, LastSuccessAt: &syncedAt}
		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "account_id"}}, DoUpdates: clause.AssignmentColumns([]string{"last_attempt_at", "last_success_at", "last_error"})}).Create(&state).Error
	})
	if err == nil {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountCapabilityChanged, AccountID: accountID})
	}
	return err
}

func (r *ModelRepository) MarkAccountCapabilitySyncFailed(ctx context.Context, accountID uint64, attemptedAt time.Time, message string) error {
	state := accountModelSyncStateModel{AccountID: accountID, LastAttemptAt: attemptedAt, LastError: truncate(message, 512)}
	return r.db.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "account_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"last_attempt_at", "last_error"}),
	}).Create(&state).Error
}

func (r *ModelRepository) HasSuccessfulAccountSync(ctx context.Context, accountID uint64) (bool, error) {
	var row struct{ AccountID uint64 }
	err := r.db.db.WithContext(ctx).Model(&accountModelSyncStateModel{}).
		Select("account_id").
		Where("account_id = ? AND last_success_at IS NOT NULL", accountID).
		Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	return row.AccountID > 0, err
}

// ListStaleAccountSyncIDs 返回模型能力快照缺失或过期的启用账号，不扫描已禁用账号。
func (r *ModelRepository) ListStaleAccountSyncIDs(ctx context.Context, before time.Time, limit int) ([]uint64, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	var ids []uint64
	err := r.db.db.WithContext(ctx).
		Table("provider_accounts AS account").
		Select("account.id").
		Joins("LEFT JOIN account_model_sync_states AS sync ON sync.account_id = account.id").
		Where("account.enabled = ? AND account.auth_status = ?", true, account.AuthStatusActive).
		Where("sync.last_success_at IS NULL OR sync.last_success_at < ?", before.UTC()).
		Order("sync.last_success_at ASC, account.id ASC").
		Limit(limit).
		Scan(&ids).Error
	return ids, err
}

type managedRouteKey struct {
	publicID   string
	capability model.Capability
}

func (r *ModelRepository) UpsertDiscovered(ctx context.Context, provider account.Provider, upstreamModels []string) error {
	changed := false
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		publicIDs, err := loadManagedRouteKeys(tx, provider)
		if err != nil {
			return err
		}
		rows, err := buildDiscoveredRouteRows(tx, provider, upstreamModels, publicIDs)
		if err != nil {
			return err
		}
		if len(rows) > 0 {
			// Concurrent discovery is guarded by the managed-route partial unique index.
			result := tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(rows, 200)
			changed = result.Error == nil && result.RowsAffected > 0
			return result.Error
		}
		return nil
	})
	if err == nil && changed {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationRouteChanged, Provider: provider})
	}
	return err
}

func loadManagedRouteKeys(tx *gorm.DB, provider account.Provider) (map[managedRouteKey]bool, error) {
	var existing []modelRouteModel
	if err := tx.Where("provider = ?", provider).Find(&existing).Error; err != nil {
		return nil, err
	}
	publicIDs := make(map[managedRouteKey]bool, len(existing))
	for _, row := range existing {
		if row.Origin != string(model.OriginManual) {
			publicIDs[managedRouteKey{publicID: row.PublicID, capability: model.Capability(row.Capability)}] = true
		}
	}
	return publicIDs, nil
}

func buildDiscoveredRouteRows(tx *gorm.DB, provider account.Provider, upstreamModels []string, publicIDs map[managedRouteKey]bool) ([]modelRouteModel, error) {
	rows := make([]modelRouteModel, 0, len(upstreamModels))
	for _, upstreamModel := range upstreamModels {
		localID, capability := discoveredRouteDefaults(provider, upstreamModel)
		publicID, ok := model.NormalizePublicID(provider, localID)
		if !ok {
			return nil, fmt.Errorf("Provider %s 发现了无效模型 ID %q", provider, localID)
		}
		// Managed routes are idempotent by canonical public_id and capability.
		// Manual targets with the same name remain independent pool members.
		key := managedRouteKey{publicID: publicID, capability: capability}
		if publicIDs[key] {
			continue
		}
		// A discovered model whose canonical public ID is already reserved as
		// another route compatibility alias cannot be inserted. Skip it and
		// keep the rest of the batch: aborting here lets one historical rename
		// permanently hide every future model of this provider.
		if err := ensureModelPublicIDNotAlias(tx, publicID, 0); err != nil {
			if errors.Is(err, repository.ErrConflict) {
				continue
			}
			return nil, err
		}
		publicIDs[key] = true
		rows = append(rows, modelRouteModel{PublicID: publicID, Provider: string(provider), UpstreamModel: upstreamModel, Capability: string(capability), Origin: string(model.OriginDiscovered), Enabled: true})
	}
	return rows, nil
}

func discoveredRouteDefaults(provider account.Provider, upstreamModel string) (string, model.Capability) {
	switch provider {
	case account.ProviderWeb:
		switch upstreamModel {
		case "grok-imagine-image":
			return "grok-imagine-image-lite", model.CapabilityImage
		case "grok-imagine-image-quality":
			return "grok-imagine-image", model.CapabilityImage
		case "grok-imagine-image-2.0":
			return upstreamModel, model.CapabilityImage
		case "imagine-image-edit":
			return "grok-imagine-image-edit", model.CapabilityImageEdit
		case "grok-imagine-video":
			return upstreamModel, model.CapabilityVideo
		default:
			return upstreamModel, model.CapabilityChat
		}
	case account.ProviderBuild:
		if upstreamModel == "grok-imagine-video-1.5" {
			return upstreamModel, model.CapabilityVideo
		}
		return upstreamModel, model.CapabilityResponses
	case account.ProviderConsole:
		switch upstreamModel {
		case "grok-imagine-image", "grok-imagine-image-quality", "grok-imagine-image-2.0":
			// The catalog also registers image_edit for the same public model.
			// Discovery only needs one existing managed capability to remain
			// idempotent and must never synthesize a Responses route.
			return upstreamModel, model.CapabilityImage
		case "grok-imagine-video", "grok-imagine-video-1.5":
			return upstreamModel, model.CapabilityVideo
		case "grok-voice-latest", "grok-voice-think-fast-2.0", "grok-voice-think-fast-1.0":
			return upstreamModel, model.CapabilityRealtime
		case "grok-stt":
			return upstreamModel, model.CapabilitySTT
		default:
			return upstreamModel, model.CapabilityResponses
		}
	default:
		return upstreamModel, model.CapabilityResponses
	}
}
