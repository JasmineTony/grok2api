package relational

import (
	"context"
	"errors"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	"gorm.io/gorm"
)

type AuditRepository struct{ db *Database }

func NewAuditRepository(db *Database) *AuditRepository { return &AuditRepository{db: db} }

const (
	auditInsertBatchSize   = 20
	auditLookupBatchSize   = 500
	attemptInsertBatchSize = 40
	auditPurgeBatchSize    = 1000
	auditSuccessPredicate  = "status_code >= 200 AND status_code < 300 AND (error_code IS NULL OR error_code = '')"
	auditSuccessAggregate  = "COALESCE(SUM(CASE WHEN " + auditSuccessPredicate + " THEN 1 ELSE 0 END), 0)"
)

var errAuditBatchRequiresFallback = errors.New("audit batch requires idempotent fallback")

type preparedAudit struct {
	row      requestAuditModel
	attempts []requestAuditAttemptModel
}

func (r *AuditRepository) Create(ctx context.Context, value audit.Record) error {
	prepared, err := prepareAudits([]audit.Record{value})
	if err != nil {
		return err
	}
	row := prepared[0].row
	attempts := prepared[0].attempts
	return r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return createAuditAndBill(tx, &row, attempts)
	})
}

func (r *AuditRepository) CreateBatch(ctx context.Context, values []audit.Record) error {
	if len(values) == 0 {
		return nil
	}
	prepared, err := prepareAudits(values)
	if err != nil {
		return err
	}
	err = r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return createPreparedAuditBatchFast(tx, prepared)
	})
	if !errors.Is(err, errAuditBatchRequiresFallback) {
		return err
	}
	return r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return createPreparedAuditBatchSafe(tx, prepared)
	})
}

func (r *AuditRepository) PurgeOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {
	var totalDeleted int64
	for {
		var batchDeleted int64
		var batchSelected int
		err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var ids []uint64
			if err := tx.Model(&requestAuditModel{}).
				Select("id").
				Where("created_at < ?", cutoff).
				Order("id ASC").
				Limit(auditPurgeBatchSize).
				Pluck("id", &ids).Error; err != nil {
				return err
			}
			if len(ids) == 0 {
				return nil
			}
			batchSelected = len(ids)
			if err := tx.Where("audit_id IN ?", ids).Delete(&requestAuditAttemptModel{}).Error; err != nil {
				return err
			}
			res := tx.Where("id IN ? AND created_at < ?", ids, cutoff).Delete(&requestAuditModel{})
			if res.Error != nil {
				return res.Error
			}
			batchDeleted = res.RowsAffected
			return nil
		})
		if err != nil {
			return totalDeleted, err
		}
		totalDeleted += batchDeleted
		// Use the number selected rather than RowsAffected to decide whether
		// another batch may exist. In a multi-instance deployment another
		// cleaner can delete part of this batch between selection and deletion.
		if batchSelected < auditPurgeBatchSize {
			return totalDeleted, nil
		}
		if err := ctx.Err(); err != nil {
			return totalDeleted, err
		}
	}
}
