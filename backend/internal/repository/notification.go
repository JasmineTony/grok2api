package repository

import (
	"context"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/notification"
)

type NotificationRepository interface {
	PublishNotification(ctx context.Context, value notification.Event, cooldown time.Duration) (notification.Event, bool, error)
	ListNotifications(ctx context.Context, offset, limit int, includeExpired bool) ([]notification.Event, int64, error)
	MarkNotificationRead(ctx context.Context, id uint64, at time.Time) error
	AcknowledgeNotification(ctx context.Context, id uint64, at time.Time) error
	PruneNotifications(ctx context.Context, before time.Time, limit int) (int64, error)
}
