package notification

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	notificationdomain "github.com/chenyme/grok2api/backend/internal/domain/notification"
)

type notificationRepositoryStub struct{}
func (notificationRepositoryStub) PublishNotification(_ context.Context, value notificationdomain.Event, _ time.Duration) (notificationdomain.Event, bool, error) { value.ID = 1; return value, true, nil }
func (notificationRepositoryStub) ListNotifications(context.Context, int, int, bool) ([]notificationdomain.Event, int64, error) { return nil, 0, nil }
func (notificationRepositoryStub) MarkNotificationRead(context.Context, uint64, time.Time) error { return nil }
func (notificationRepositoryStub) AcknowledgeNotification(context.Context, uint64, time.Time) error { return nil }
func (notificationRepositoryStub) PruneNotifications(context.Context, time.Time, int) (int64, error) { return 0, nil }

func TestWebhookIsSignedAndContainsNoSecrets(t *testing.T) {
	secret := "test-secret"
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body); if err != nil { t.Fatal(err) }
		mac := hmac.New(sha256.New, []byte(secret)); _, _ = mac.Write(body)
		want := "sha256=" + hex.EncodeToString(mac.Sum(nil))
		if request.Header.Get("X-Grok2API-Signature") != want { t.Fatalf("signature = %q want %q", request.Header.Get("X-Grok2API-Signature"), want) }
		if strings.Contains(string(body), secret) || strings.Contains(string(body), "credential") { t.Fatalf("webhook leaked sensitive content: %s", body) }
		response.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	service, err := NewService(notificationRepositoryStub{}, Config{WebhookURL: server.URL, WebhookSecret: secret}, server.Client())
	if err != nil { t.Fatal(err) }
	_, created, err := service.Publish(context.Background(), notificationdomain.Event{EventKey: "version_update_available", Severity: notificationdomain.SeverityInfo, Title: "Update", Body: "v3.0.6", DedupKey: "version:v3.0.6"})
	if err != nil || !created { t.Fatalf("created=%v err=%v", created, err) }
}
