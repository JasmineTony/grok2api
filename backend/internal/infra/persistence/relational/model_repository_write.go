package relational

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *ModelRepository) UpsertRoutes(ctx context.Context, values []model.Route) error {
	providers := make(map[account.Provider]struct{}, len(values))
	for _, value := range values {
		providers[value.Provider] = struct{}{}
	}
	changedProviders := make(map[account.Provider]struct{}, len(providers))
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, original := range values {
			value := original
			publicID, ok := model.NormalizePublicID(value.Provider, value.PublicID)
			if !ok {
				return fmt.Errorf("模型路由目录包含无效公开 ID %q", value.PublicID)
			}
			value.PublicID = publicID
			if strings.TrimSpace(value.PublicID) == "" || strings.TrimSpace(value.UpstreamModel) == "" || value.Provider == "" || value.Capability == "" {
				return fmt.Errorf("模型路由目录包含无效条目")
			}
			var existing modelRouteModel
			err := tx.Where("public_id = ? AND capability = ? AND origin <> ?", value.PublicID, value.Capability, model.OriginManual).First(&existing).Error
			if err == nil {
				continue
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if err := ensureModelPublicIDNotAlias(tx, value.PublicID, 0); err != nil {
				return err
			}
			fallbackOrigin := model.OriginDiscovered
			if value.Provider == account.ProviderWeb {
				fallbackOrigin = model.OriginCatalog
			}
			row := modelRouteModel{PublicID: value.PublicID, Provider: string(value.Provider), UpstreamModel: value.UpstreamModel, Capability: string(value.Capability), Origin: string(normalizeRouteOrigin(value.Origin, fallbackOrigin)), Enabled: value.Enabled}
			if err := tx.Create(&row).Error; err != nil {
				return mapError(err)
			}
			changedProviders[value.Provider] = struct{}{}
		}
		return nil
	})
	if err == nil {
		for provider := range changedProviders {
			r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationRouteChanged, Provider: provider})
		}
	}
	return err
}

func (r *ModelRepository) ReplaceProviderRoutes(ctx context.Context, provider account.Provider, values []model.Route) error {
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		normalizedValues := make([]model.Route, len(values))
		for index, value := range values {
			publicID, ok := model.NormalizePublicID(provider, value.PublicID)
			if !ok {
				return fmt.Errorf("模型路由目录包含无效公开 ID %q", value.PublicID)
			}
			value.PublicID = publicID
			if strings.TrimSpace(value.PublicID) == "" || strings.TrimSpace(value.UpstreamModel) == "" || value.Provider != provider || value.Capability == "" {
				return fmt.Errorf("模型路由目录包含无效条目")
			}
			normalizedValues[index] = value
		}
		values = normalizedValues
		var existing []modelRouteModel
		if err := tx.Where("provider = ?", provider).Find(&existing).Error; err != nil {
			return err
		}

		type catalogRouteKey struct {
			value      string
			capability model.Capability
		}
		byPublicID := make(map[catalogRouteKey]modelRouteModel, len(existing))
		byUpstreamNonManual := make(map[catalogRouteKey][]modelRouteModel, len(existing))
		for _, row := range existing {
			if row.Origin == string(model.OriginManual) {
				continue
			}
			publicKey := catalogRouteKey{value: row.PublicID, capability: model.Capability(row.Capability)}
			if current, exists := byPublicID[publicKey]; !exists || row.ID < current.ID {
				byPublicID[publicKey] = row
			}
			upstreamKey := catalogRouteKey{value: row.UpstreamModel, capability: model.Capability(row.Capability)}
			byUpstreamNonManual[upstreamKey] = append(byUpstreamNonManual[upstreamKey], row)
		}
		matched := make(map[int]modelRouteModel, len(values))
		usedIDs := make(map[uint64]bool, len(values))
		for index, value := range values {
			publicKey := catalogRouteKey{value: value.PublicID, capability: value.Capability}
			if row, ok := byPublicID[publicKey]; ok && !usedIDs[row.ID] {
				matched[index] = row
				usedIDs[row.ID] = true
				continue
			}
			// 仅回退匹配非手动路由，避免把手动别名路由改写成目录项。
			candidates := byUpstreamNonManual[catalogRouteKey{value: value.UpstreamModel, capability: value.Capability}]
			var chosen modelRouteModel
			found := false
			for _, candidate := range candidates {
				if usedIDs[candidate.ID] {
					continue
				}
				if !found || candidate.ID < chosen.ID {
					chosen = candidate
					found = true
				}
			}
			if found {
				matched[index] = chosen
				usedIDs[chosen.ID] = true
			}
		}
		for _, row := range existing {
			if usedIDs[row.ID] || row.Origin == string(model.OriginManual) {
				continue
			}
			if err := tx.Delete(&modelRouteModel{}, row.ID).Error; err != nil {
				return err
			}
		}
		// A catalog name may have multiple capability rows. When a previous
		// catalog rename preserved that name as an alias to one member, restoring
		// it must promote the alias back to the formal group name before every
		// matched capability row is validated. A catalog rename may also move a
		// historical alias from one reconciled route to another (for example when
		// an upstream protocol gains distinct public products). This is safe only
		// when the current owner is itself retained by this same catalog update;
		// aliases owned by manual or unrelated routes remain conflicts.
		matchedIDsByPublicID := make(map[string]map[uint64]struct{}, len(values))
		for index, value := range values {
			ids := matchedIDsByPublicID[value.PublicID]
			if ids == nil {
				ids = make(map[uint64]struct{})
				matchedIDsByPublicID[value.PublicID] = ids
			}
			if row, ok := matched[index]; ok {
				ids[row.ID] = struct{}{}
			}
		}
		for publicID, routeIDs := range matchedIDsByPublicID {
			var alias modelRouteAliasModel
			err := tx.Where("alias = ?", publicID).First(&alias).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			if err != nil {
				return err
			}
			if _, owned := routeIDs[alias.ModelRouteID]; !owned && !usedIDs[alias.ModelRouteID] {
				return fmt.Errorf("%w: 模型公开 ID %q 已被路由 %d 保留为兼容名称", repository.ErrConflict, publicID, alias.ModelRouteID)
			}
			if err := tx.Delete(&modelRouteAliasModel{}, "alias = ?", publicID).Error; err != nil {
				return err
			}
		}
		for index, value := range values {
			routeID := uint64(0)
			if row, ok := matched[index]; ok {
				routeID = row.ID
			}
			if err := ensureModelPublicIDNotAlias(tx, value.PublicID, routeID); err != nil {
				return err
			}
		}
		// Temporary values allow public IDs or upstream identifiers to be swapped while
		// stable route IDs and key permissions survive.
		for index, row := range matched {
			if row.PublicID != values[index].PublicID {
				if row.PublicID != retiredWebImageQualityLitePublicID {
					if err := preserveModelRouteAlias(tx, row.PublicID, row.ID); err != nil {
						return err
					}
				}
			}
		}
		if provider == account.ProviderWeb {
			if err := tx.Delete(&modelRouteAliasModel{}, "alias = ?", retiredWebImageQualityLitePublicID).Error; err != nil {
				return err
			}
		}
		for _, row := range matched {
			updates := map[string]any{
				"public_id":      fmt.Sprintf("__grok2api_reconcile_%d", row.ID),
				"upstream_model": fmt.Sprintf("__grok2api_upstream_reconcile_%d", row.ID),
			}
			if err := tx.Model(&modelRouteModel{}).Where("id = ?", row.ID).Updates(updates).Error; err != nil {
				return mapError(err)
			}
		}
		for index, value := range values {
			updates := map[string]any{
				"public_id":      value.PublicID,
				"upstream_model": value.UpstreamModel,
				"capability":     value.Capability,
				"origin":         model.OriginCatalog,
			}
			if row, ok := matched[index]; ok {
				if err := tx.Model(&modelRouteModel{}).Where("id = ?", row.ID).Updates(updates).Error; err != nil {
					return mapError(err)
				}
				if row.UpstreamModel != value.UpstreamModel {
					if err := renameAccountModelCapability(tx, provider, row.UpstreamModel, value.UpstreamModel); err != nil {
						return err
					}
				}
				continue
			}
			row := modelRouteModel{PublicID: value.PublicID, Provider: string(provider), UpstreamModel: value.UpstreamModel, Capability: string(value.Capability), Origin: string(model.OriginCatalog), Enabled: value.Enabled}
			if err := tx.Create(&row).Error; err != nil {
				return mapError(err)
			}
		}
		return nil
	})
	if err == nil {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationRouteChanged, Provider: provider})
	}
	return err
}

func renameAccountModelCapability(tx *gorm.DB, provider account.Provider, oldModel, newModel string) error {
	providerAccounts := tx.Model(&accountModel{}).Select("id").Where("provider = ?", provider)
	duplicates := tx.Model(&accountModelCapabilityModel{}).
		Select("account_id").
		Where("upstream_model = ? AND account_id IN (?)", newModel, providerAccounts)
	if err := tx.Where("upstream_model = ? AND account_id IN (?) AND account_id IN (?)", oldModel, providerAccounts, duplicates).
		Delete(&accountModelCapabilityModel{}).Error; err != nil {
		return err
	}
	return tx.Model(&accountModelCapabilityModel{}).
		Where("upstream_model = ? AND account_id IN (?)", oldModel, providerAccounts).
		Update("upstream_model", newModel).Error
}

func (r *ModelRepository) Create(ctx context.Context, value model.Route, accountIDs []uint64) (model.Route, error) {
	publicID, ok := model.NormalizePublicID(value.Provider, value.PublicID)
	if !ok {
		return model.Route{}, fmt.Errorf("模型路由公开 ID 无效")
	}
	value.PublicID = publicID
	row := modelRouteModel{
		PublicID: value.PublicID, Provider: string(value.Provider), UpstreamModel: value.UpstreamModel,
		Capability: string(value.Capability), Origin: string(model.OriginManual), Enabled: value.Enabled,
	}
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return mapError(err)
		}
		if err := replaceModelRouteAccounts(tx, row.ID, accountIDs); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return model.Route{}, err
	}
	r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationRouteChanged, Provider: value.Provider, UpstreamModel: value.UpstreamModel})
	if len(accountIDs) > 0 {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationModelBindingChanged, Provider: value.Provider, UpstreamModel: value.UpstreamModel})
	}
	return r.Get(ctx, row.ID)
}

func (r *ModelRepository) Update(ctx context.Context, value model.Route, accountIDs *[]uint64) (model.Route, error) {
	var storedProvider account.Provider
	var storedUpstreamModel string
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing modelRouteModel
		if err := tx.Where("id = ?", value.ID).First(&existing).Error; err != nil {
			return mapError(err)
		}
		storedProvider = account.Provider(existing.Provider)
		storedUpstreamModel = existing.UpstreamModel
		publicID, ok := model.NormalizePublicID(storedProvider, value.PublicID)
		if !ok {
			return fmt.Errorf("模型路由公开 ID 无效")
		}
		value.PublicID = publicID
		if existing.Origin != string(model.OriginManual) {
			if err := ensureModelPublicIDNotAlias(tx, value.PublicID, existing.ID); err != nil {
				return err
			}
		}
		if existing.PublicID != value.PublicID {
			if err := preserveModelRouteAlias(tx, existing.PublicID, existing.ID); err != nil {
				return err
			}
		}
		result := tx.Model(&modelRouteModel{}).Where("id = ?", value.ID).Updates(map[string]any{
			"public_id": value.PublicID,
			"enabled":   value.Enabled,
		})
		if result.Error != nil {
			return mapError(result.Error)
		}
		if result.RowsAffected == 0 {
			var count int64
			if err := tx.Model(&modelRouteModel{}).Where("id = ?", value.ID).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				return repository.ErrNotFound
			}
		}
		if accountIDs != nil {
			return replaceModelRouteAccounts(tx, value.ID, *accountIDs)
		}
		return nil
	})
	if err != nil {
		return model.Route{}, err
	}
	r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationRouteChanged, Provider: storedProvider, UpstreamModel: storedUpstreamModel})
	if accountIDs != nil {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationModelBindingChanged, Provider: storedProvider, UpstreamModel: storedUpstreamModel})
	}
	return r.Get(ctx, value.ID)
}

func (r *ModelRepository) Delete(ctx context.Context, id uint64) error {
	var existing modelRouteModel
	if err := r.db.db.WithContext(ctx).First(&existing, id).Error; err != nil {
		return mapError(err)
	}
	result := r.db.db.WithContext(ctx).Delete(&modelRouteModel{}, id)
	if result.Error != nil {
		return mapError(result.Error)
	}
	if result.RowsAffected == 0 {
		return repository.ErrNotFound
	}
	r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationRouteChanged, Provider: account.Provider(existing.Provider), UpstreamModel: existing.UpstreamModel})
	return nil
}

func (r *ModelRepository) DeleteMany(ctx context.Context, ids []uint64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var existing []modelRouteModel
	if err := r.db.db.WithContext(ctx).Where("id IN ?", ids).Find(&existing).Error; err != nil {
		return 0, err
	}
	result := r.db.db.WithContext(ctx).Where("id IN ?", ids).Delete(&modelRouteModel{})
	if result.Error == nil && result.RowsAffected > 0 {
		providers := make(map[account.Provider]struct{}, len(existing))
		for _, row := range existing {
			providers[account.Provider(row.Provider)] = struct{}{}
		}
		for provider := range providers {
			r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationRouteChanged, Provider: provider})
		}
	}
	return result.RowsAffected, mapError(result.Error)
}

func replaceModelRouteAccounts(tx *gorm.DB, routeID uint64, accountIDs []uint64) error {
	if err := tx.Where("model_route_id = ?", routeID).Delete(&modelRouteAccountModel{}).Error; err != nil {
		return err
	}
	if len(accountIDs) == 0 {
		return nil
	}
	rows := make([]modelRouteAccountModel, 0, len(accountIDs))
	for _, accountID := range accountIDs {
		rows = append(rows, modelRouteAccountModel{ModelRouteID: routeID, AccountID: accountID})
	}
	return tx.CreateInBatches(rows, 200).Error
}

func (r *ModelRepository) UpdateManyEnabled(ctx context.Context, ids []uint64, enabled bool) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	providers := make(map[account.Provider]struct{})
	var updated int64
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing []modelRouteModel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ?", ids).Order("id ASC").Find(&existing).Error; err != nil {
			return err
		}
		for _, row := range existing {
			providers[account.Provider(row.Provider)] = struct{}{}
		}
		result := tx.Model(&modelRouteModel{}).Where("id IN ? AND enabled <> ?", ids, enabled).Update("enabled", enabled)
		updated = result.RowsAffected
		return result.Error
	})
	if err == nil && updated > 0 {
		for provider := range providers {
			r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationRouteChanged, Provider: provider})
		}
	}
	return updated, err
}
