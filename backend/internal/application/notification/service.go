package notification

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	notificationdomain "github.com/chenyme/grok2api/backend/internal/domain/notification"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

type Config struct {
	Cooldown       time.Duration
	Retention      time.Duration
	WebhookURL     string
	WebhookSecret  string
}

type Service struct {
	repository repository.NotificationRepository
	client     *http.Client
	config     Config
	now        func() time.Time
}

func NewService(repository repository.NotificationRepository, config Config, client *http.Client) (*Service, error) {
	if repository == nil { return nil, errors.New("notification repository is required") }
	if config.Cooldown <= 0 { config.Cooldown = 15 * time.Minute }
	if config.Retention <= 0 { config.Retention = 30 * 24 * time.Hour }
	config.WebhookURL = strings.TrimSpace(config.WebhookURL)
	config.WebhookSecret = strings.TrimSpace(config.WebhookSecret)
	if config.WebhookURL != "" {
		parsed, err := url.ParseRequestURI(config.WebhookURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || config.WebhookSecret == "" {
			return nil, errors.New("notification webhook requires an HTTP(S) URL and secret")
		}
	}
	if client == nil { client = &http.Client{Timeout: 5 * time.Second} }
	return &Service{repository: repository, client: client, config: config, now: time.Now}, nil
}

func (s *Service) Publish(ctx context.Context, event notificationdomain.Event) (notificationdomain.Event, bool, error) {
	if err := validateEvent(event); err != nil { return notificationdomain.Event{}, false, err }
	now := s.now().UTC()
	if event.CreatedAt.IsZero() { event.CreatedAt = now }
	if event.ExpiresAt == nil && s.config.Retention > 0 { expiry := now.Add(s.config.Retention); event.ExpiresAt = &expiry }
	stored, created, err := s.repository.PublishNotification(ctx, event, s.config.Cooldown)
	if err != nil || !created || s.config.WebhookURL == "" { return stored, created, err }
	if webhookErr := s.sendWebhook(ctx, stored); webhookErr != nil { return stored, created, fmt.Errorf("notification stored but webhook delivery failed: %w", webhookErr) }
	return stored, created, nil
}

func (s *Service) List(ctx context.Context, offset, limit int, includeExpired bool) ([]notificationdomain.Event, int64, error) { return s.repository.ListNotifications(ctx, offset, limit, includeExpired) }
func (s *Service) MarkRead(ctx context.Context, id uint64) error { return s.repository.MarkNotificationRead(ctx, id, s.now()) }
func (s *Service) Acknowledge(ctx context.Context, id uint64) error { return s.repository.AcknowledgeNotification(ctx, id, s.now()) }
func (s *Service) Prune(ctx context.Context, limit int) (int64, error) { return s.repository.PruneNotifications(ctx, s.now().Add(-s.config.Retention), limit) }

func (s *Service) sendWebhook(ctx context.Context, event notificationdomain.Event) error {
	payload, err := json.Marshal(struct {
		EventKey string `json:"eventKey"`
		Severity string `json:"severity"`
		Title    string `json:"title"`
		Body     string `json:"body"`
		CreatedAt time.Time `json:"createdAt"`
	}{event.EventKey, string(event.Severity), event.Title, event.Body, event.CreatedAt})
	if err != nil { return err }
	mac := hmac.New(sha256.New, []byte(s.config.WebhookSecret)); _, _ = mac.Write(payload)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.config.WebhookURL, bytes.NewReader(payload))
	if err != nil { return err }
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Grok2API-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	response, err := s.client.Do(request)
	if err != nil { return err }
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 { return fmt.Errorf("webhook returned HTTP %d", response.StatusCode) }
	return nil
}

func validateEvent(event notificationdomain.Event) error {
	if strings.TrimSpace(event.EventKey) == "" || len([]rune(event.EventKey)) > 100 { return errors.New("notification event key is invalid") }
	if strings.TrimSpace(event.DedupKey) == "" || len([]rune(event.DedupKey)) > 200 { return errors.New("notification dedup key is invalid") }
	if strings.TrimSpace(event.Title) == "" || len([]rune(event.Title)) > 200 { return errors.New("notification title is invalid") }
	if len([]rune(event.Body)) > 4096 { return errors.New("notification body is too long") }
	if event.Severity != notificationdomain.SeverityInfo && event.Severity != notificationdomain.SeverityWarning && event.Severity != notificationdomain.SeverityError { return errors.New("notification severity is invalid") }
	return nil
}
