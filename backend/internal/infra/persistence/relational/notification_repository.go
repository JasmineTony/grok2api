package relational

import (
	"context"
	"errors"
	"time"

	notificationdomain "github.com/chenyme/grok2api/backend/internal/domain/notification"
	"gorm.io/gorm"
)

type NotificationRepository struct{ db *Database }

func NewNotificationRepository(db *Database) *NotificationRepository { return &NotificationRepository{db: db} }

func (r *NotificationRepository) PublishNotification(ctx context.Context, value notificationdomain.Event, cooldown time.Duration) (notificationdomain.Event, bool, error) {
	if value.EventKey == "" || value.DedupKey == "" || value.Title == "" {
		return notificationdomain.Event{}, false, errors.New("notification event is incomplete")
	}
	if value.Status == "" {
		value.Status = notificationdomain.StatusUnread
	}
	now := value.CreatedAt.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	var existing notificationModel
	query := r.db.db.WithContext(ctx).Where("dedup_key = ?", value.DedupKey).Order("created_at DESC, id DESC")
	if cooldown > 0 {
		query = query.Where("created_at >= ?", now.Add(-cooldown))
	}
	if err := query.First(&existing).Error; err == nil {
		return toNotificationDomain(existing), false, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return notificationdomain.Event{}, false, err
	}
	row := notificationModel{EventKey: value.EventKey, Severity: string(value.Severity), Title: value.Title, Body: value.Body, DedupKey: value.DedupKey, Status: string(value.Status), CreatedAt: now, ReadAt: value.ReadAt, AcknowledgedAt: value.AcknowledgedAt, ExpiresAt: value.ExpiresAt}
	if err := r.db.db.WithContext(ctx).Create(&row).Error; err != nil {
		return notificationdomain.Event{}, false, err
	}
	return toNotificationDomain(row), true, nil
}

func (r *NotificationRepository) ListNotifications(ctx context.Context, offset, limit int, includeExpired bool) ([]notificationdomain.Event, int64, error) {
	if limit < 1 { limit = 50 }
	if limit > 200 { limit = 200 }
	query := r.db.db.WithContext(ctx).Model(&notificationModel{})
	if !includeExpired {
		query = query.Where("expires_at IS NULL OR expires_at > ?", time.Now().UTC())
	}
	var total int64
	if err := query.Count(&total).Error; err != nil { return nil, 0, err }
	var rows []notificationModel
	if err := query.Order("created_at DESC, id DESC").Offset(max(0, offset)).Limit(limit).Find(&rows).Error; err != nil { return nil, 0, err }
	result := make([]notificationdomain.Event, 0, len(rows))
	for _, row := range rows { result = append(result, toNotificationDomain(row)) }
	return result, total, nil
}

func (r *NotificationRepository) MarkNotificationRead(ctx context.Context, id uint64, at time.Time) error {
	return r.db.db.WithContext(ctx).Model(&notificationModel{}).Where("id = ? AND status = ?", id, notificationdomain.StatusUnread).Updates(map[string]any{"status": notificationdomain.StatusRead, "read_at": at.UTC()}).Error
}

func (r *NotificationRepository) AcknowledgeNotification(ctx context.Context, id uint64, at time.Time) error {
	return r.db.db.WithContext(ctx).Model(&notificationModel{}).Where("id = ? AND status <> ?", id, notificationdomain.StatusAcknowledged).Updates(map[string]any{"status": notificationdomain.StatusAcknowledged, "acknowledged_at": at.UTC()}).Error
}

func (r *NotificationRepository) PruneNotifications(ctx context.Context, before time.Time, limit int) (int64, error) {
	if limit < 1 { limit = 500 }
	var rows []notificationModel
	if err := r.db.db.WithContext(ctx).Where("expires_at IS NOT NULL AND expires_at < ?", before.UTC()).Order("id ASC").Limit(limit).Find(&rows).Error; err != nil { return 0, err }
	if len(rows) == 0 { return 0, nil }
	var deleted int64
	for _, row := range rows {
		result := r.db.db.WithContext(ctx).Delete(&notificationModel{}, row.ID)
		if result.Error != nil { return deleted, result.Error }
		deleted += result.RowsAffected
	}
	return deleted, nil
}

func toNotificationDomain(value notificationModel) notificationdomain.Event {
	return notificationdomain.Event{ID: value.ID, EventKey: value.EventKey, Severity: notificationdomain.Severity(value.Severity), Title: value.Title, Body: value.Body, DedupKey: value.DedupKey, Status: notificationdomain.Status(value.Status), CreatedAt: value.CreatedAt, ReadAt: value.ReadAt, AcknowledgedAt: value.AcknowledgedAt, ExpiresAt: value.ExpiresAt}
}
