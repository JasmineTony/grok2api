package relational

import (
	"context"
	"encoding/json"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/requestpolicy"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type RequestPolicyRepository struct{ db *Database }

func NewRequestPolicyRepository(db *Database) *RequestPolicyRepository {
	return &RequestPolicyRepository{db: db}
}

func (r *RequestPolicyRepository) ListRequestPolicies(ctx context.Context) ([]requestpolicy.Rule, error) {
	var rows []requestPolicyModel
	if err := r.db.db.WithContext(ctx).Order("priority ASC, id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	values := make([]requestpolicy.Rule, 0, len(rows))
	for _, row := range rows {
		value, err := toRequestPolicyDomain(row)
		if err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, nil
}

func (r *RequestPolicyRepository) GetRequestPolicy(ctx context.Context, id uint64) (requestpolicy.Rule, error) {
	var row requestPolicyModel
	if err := r.db.db.WithContext(ctx).First(&row, id).Error; err != nil {
		return requestpolicy.Rule{}, mapError(err)
	}
	return toRequestPolicyDomain(row)
}

func (r *RequestPolicyRepository) CreateRequestPolicy(ctx context.Context, value requestpolicy.Rule) (requestpolicy.Rule, error) {
	row, err := fromRequestPolicyDomain(value)
	if err != nil {
		return requestpolicy.Rule{}, err
	}
	row.ID, row.HitCount, row.LastHitAt = 0, 0, nil
	if err := r.db.db.WithContext(ctx).Create(&row).Error; err != nil {
		return requestpolicy.Rule{}, mapError(err)
	}
	return toRequestPolicyDomain(row)
}

func (r *RequestPolicyRepository) UpdateRequestPolicy(ctx context.Context, value requestpolicy.Rule) (requestpolicy.Rule, error) {
	if value.ID == 0 {
		return requestpolicy.Rule{}, repository.ErrNotFound
	}
	row, err := fromRequestPolicyDomain(value)
	if err != nil {
		return requestpolicy.Rule{}, err
	}
	var existing requestPolicyModel
	if err := r.db.db.WithContext(ctx).First(&existing, value.ID).Error; err != nil {
		return requestpolicy.Rule{}, mapError(err)
	}
	row.CreatedAt, row.HitCount, row.LastHitAt = existing.CreatedAt, existing.HitCount, existing.LastHitAt
	if err := r.db.db.WithContext(ctx).Save(&row).Error; err != nil {
		return requestpolicy.Rule{}, mapError(err)
	}
	return toRequestPolicyDomain(row)
}

func (r *RequestPolicyRepository) DeleteRequestPolicy(ctx context.Context, id uint64) error {
	result := r.db.db.WithContext(ctx).Delete(&requestPolicyModel{}, id)
	if result.Error != nil {
		return mapError(result.Error)
	}
	if result.RowsAffected == 0 {
		return repository.ErrNotFound
	}
	return nil
}

func (r *RequestPolicyRepository) RecordRequestPolicyHits(ctx context.Context, ids []uint64, at time.Time) error {
	unique := make(map[uint64]struct{}, len(ids))
	for _, id := range ids {
		if id != 0 {
			unique[id] = struct{}{}
		}
	}
	if len(unique) == 0 {
		return nil
	}
	return r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for id := range unique {
			result := tx.Model(&requestPolicyModel{}).Where("id = ?", id).Updates(map[string]any{"hit_count": gorm.Expr("hit_count + 1"), "last_hit_at": at.UTC(), "updated_at": clause.Expr{SQL: "updated_at"}})
			if result.Error != nil {
				return result.Error
			}
		}
		return nil
	})
}

func fromRequestPolicyDomain(value requestpolicy.Rule) (requestPolicyModel, error) {
	matchJSON, err := json.Marshal(value.Match)
	if err != nil {
		return requestPolicyModel{}, err
	}
	actionJSON, err := json.Marshal(value.Action)
	if err != nil {
		return requestPolicyModel{}, err
	}
	return requestPolicyModel{ID: value.ID, Name: value.Name, Priority: value.Priority, Enabled: value.Enabled, DryRun: value.DryRun, MatchJSON: string(matchJSON), ActionJSON: string(actionJSON), HitCount: value.HitCount, LastHitAt: value.LastHitAt, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}, nil
}

func toRequestPolicyDomain(row requestPolicyModel) (requestpolicy.Rule, error) {
	value := requestpolicy.Rule{ID: row.ID, Name: row.Name, Priority: row.Priority, Enabled: row.Enabled, DryRun: row.DryRun, HitCount: row.HitCount, LastHitAt: row.LastHitAt, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
	if err := json.Unmarshal([]byte(row.MatchJSON), &value.Match); err != nil {
		return requestpolicy.Rule{}, err
	}
	if err := json.Unmarshal([]byte(row.ActionJSON), &value.Action); err != nil {
		return requestpolicy.Rule{}, err
	}
	return value, nil
}

var _ repository.RequestPolicyRepository = (*RequestPolicyRepository)(nil)
