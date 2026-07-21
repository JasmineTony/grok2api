package relational

import (
	"context"
	"github.com/chenyme/grok2api/backend/internal/domain/requestsnapshot"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"time"
)

type RequestSnapshotRepository struct{ db *Database }

func NewRequestSnapshotRepository(db *Database) *RequestSnapshotRepository {
	return &RequestSnapshotRepository{db: db}
}
func (r *RequestSnapshotRepository) CreateRequestSnapshot(ctx context.Context, value requestsnapshot.Snapshot) (requestsnapshot.Snapshot, error) {
	row := requestSnapshotModel{ID: value.ID, RequestID: value.RequestID, Protocol: value.Protocol, Operation: value.Operation, Model: value.Model, EncryptedPayload: value.EncryptedPayload, PayloadSHA256: value.PayloadSHA256, PayloadBytes: value.PayloadBytes, CreatedAt: value.CreatedAt, ExpiresAt: value.ExpiresAt}
	if err := r.db.db.WithContext(ctx).Create(&row).Error; err != nil {
		return requestsnapshot.Snapshot{}, mapError(err)
	}
	return toRequestSnapshot(row), nil
}
func (r *RequestSnapshotRepository) GetRequestSnapshot(ctx context.Context, id string, now time.Time) (requestsnapshot.Snapshot, error) {
	var row requestSnapshotModel
	if err := r.db.db.WithContext(ctx).Where("id = ? AND expires_at > ?", id, now.UTC()).First(&row).Error; err != nil {
		return requestsnapshot.Snapshot{}, mapError(err)
	}
	return toRequestSnapshot(row), nil
}
func (r *RequestSnapshotRepository) DeleteExpiredRequestSnapshots(ctx context.Context, now time.Time, limit int) (int64, error) {
	if limit < 1 {
		limit = 500
	}
	var rows []requestSnapshotModel
	if err := r.db.db.WithContext(ctx).Where("expires_at <= ?", now.UTC()).Order("expires_at ASC, id ASC").Limit(limit).Find(&rows).Error; err != nil {
		return 0, err
	}
	var deleted int64
	for _, row := range rows {
		result := r.db.db.WithContext(ctx).Delete(&requestSnapshotModel{}, "id = ?", row.ID)
		if result.Error != nil {
			return deleted, result.Error
		}
		deleted += result.RowsAffected
	}
	return deleted, nil
}
func toRequestSnapshot(row requestSnapshotModel) requestsnapshot.Snapshot {
	return requestsnapshot.Snapshot{ID: row.ID, RequestID: row.RequestID, Protocol: row.Protocol, Operation: row.Operation, Model: row.Model, EncryptedPayload: row.EncryptedPayload, PayloadSHA256: row.PayloadSHA256, PayloadBytes: row.PayloadBytes, CreatedAt: row.CreatedAt, ExpiresAt: row.ExpiresAt}
}

var _ repository.RequestSnapshotRepository = (*RequestSnapshotRepository)(nil)
