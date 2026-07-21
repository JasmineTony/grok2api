package relational

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	notificationdomain "github.com/chenyme/grok2api/backend/internal/domain/notification"
)

func TestNotificationRepositoryDeduplicatesAndTracksStatus(t *testing.T) {
	ctx := context.Background()
	database, err := OpenSQLite(ctx, filepath.Join(t.TempDir(), "notifications.db"))
	if err != nil { t.Fatal(err) }
	defer database.Close()
	if err := database.InitializeSchema(ctx); err != nil { t.Fatal(err) }
	repository := NewNotificationRepository(database)
	now := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
	event := notificationdomain.Event{EventKey: "version_update_available", Severity: notificationdomain.SeverityInfo, Title: "Update", Body: "v3.0.6", DedupKey: "version:v3.0.6", CreatedAt: now}
	first, created, err := repository.PublishNotification(ctx, event, time.Hour)
	if err != nil || !created || first.ID == 0 { t.Fatalf("first = %#v created=%v err=%v", first, created, err) }
	second, created, err := repository.PublishNotification(ctx, event, time.Hour)
	if err != nil || created || second.ID != first.ID { t.Fatalf("second = %#v created=%v err=%v", second, created, err) }
	if err := repository.MarkNotificationRead(ctx, first.ID, now.Add(time.Minute)); err != nil { t.Fatal(err) }
	if err := repository.AcknowledgeNotification(ctx, first.ID, now.Add(2*time.Minute)); err != nil { t.Fatal(err) }
	items, total, err := repository.ListNotifications(ctx, 0, 10, false)
	if err != nil || total != 1 || len(items) != 1 || items[0].Status != notificationdomain.StatusAcknowledged { t.Fatalf("items=%#v total=%d err=%v", items, total, err) }
	expired := now.Add(-2 * time.Hour)
	if _, _, err := repository.PublishNotification(ctx, notificationdomain.Event{EventKey: "backup_failed", Severity: notificationdomain.SeverityError, Title: "Backup", Body: "failed", DedupKey: "backup:old", CreatedAt: expired, ExpiresAt: &expired}, 0); err != nil { t.Fatal(err) }
	if deleted, err := repository.PruneNotifications(ctx, now, 10); err != nil || deleted != 1 { t.Fatalf("deleted=%d err=%v", deleted, err) }
}
