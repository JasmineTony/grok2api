package requestsnapshot

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	domain "github.com/chenyme/grok2api/backend/internal/domain/requestsnapshot"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"io"
	"strings"
	"time"
)

const maxPayloadBytes = 256 << 10

type ReplaySender func(context.Context, domain.Snapshot, []byte, string, string) error

type Service struct {
	repository        repository.RequestSnapshotRepository
	cipher            *security.Cipher
	enabled           bool
	allowActualReplay bool
	ttl               time.Duration
	now               func() time.Time
	sender            ReplaySender
}

func NewService(repo repository.RequestSnapshotRepository, cipher *security.Cipher, enabled bool, ttl time.Duration, allowActualReplay ...bool) (*Service, error) {
	if repo == nil || cipher == nil {
		return nil, errors.New("request snapshot repository and cipher are required")
	}
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	allowReplay := false
	if len(allowActualReplay) > 0 {
		allowReplay = allowActualReplay[0]
	}
	return &Service{repository: repo, cipher: cipher, enabled: enabled, allowActualReplay: allowReplay, ttl: ttl, now: time.Now}, nil
}
func (s *Service) Capture(ctx context.Context, requestID, protocol, operation, model string, payload []byte) (domain.Snapshot, error) {
	if !s.enabled {
		return domain.Snapshot{}, errors.New("request snapshots are disabled")
	}
	if len(payload) == 0 || len(payload) > maxPayloadBytes {
		return domain.Snapshot{}, errors.New("request snapshot payload exceeds the 256 KiB limit")
	}
	normalized, err := redact(payload)
	if err != nil {
		return domain.Snapshot{}, err
	}
	compressed, err := compress(normalized)
	if err != nil {
		return domain.Snapshot{}, err
	}
	encrypted, err := s.cipher.Encrypt(base64.RawStdEncoding.EncodeToString(compressed))
	if err != nil {
		return domain.Snapshot{}, err
	}
	id, err := security.NewOpaqueToken(18)
	if err != nil {
		return domain.Snapshot{}, err
	}
	hash := sha256.Sum256(normalized)
	now := s.now().UTC()
	return s.repository.CreateRequestSnapshot(ctx, domain.Snapshot{ID: "snap_" + id, RequestID: trim(requestID, 128), Protocol: trim(protocol, 40), Operation: trim(operation, 40), Model: trim(model, 255), EncryptedPayload: encrypted, PayloadSHA256: hex.EncodeToString(hash[:]), PayloadBytes: len(normalized), CreatedAt: now, ExpiresAt: now.Add(s.ttl)})
}
func (s *Service) View(ctx context.Context, id string) (domain.View, error) {
	value, err := s.repository.GetRequestSnapshot(ctx, strings.TrimSpace(id), s.now())
	if err != nil {
		return domain.View{}, err
	}
	encoded, err := s.cipher.Decrypt(value.EncryptedPayload)
	if err != nil {
		return domain.View{}, err
	}
	compressed, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return domain.View{}, err
	}
	payload, err := decompress(compressed)
	if err != nil {
		return domain.View{}, err
	}
	hash := sha256.Sum256(payload)
	if hex.EncodeToString(hash[:]) != value.PayloadSHA256 {
		return domain.View{}, errors.New("request snapshot checksum mismatch")
	}
	var decoded any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return domain.View{}, err
	}
	value.EncryptedPayload = ""
	return domain.View{Snapshot: value, Payload: decoded, DryRun: true}, nil
}
func (s *Service) SetReplaySender(sender ReplaySender) { s.sender = sender }

func (s *Service) Replay(ctx context.Context, id string, confirm bool, clientAPIKey string) (domain.View, error) {
	value, err := s.repository.GetRequestSnapshot(ctx, strings.TrimSpace(id), s.now())
	if err != nil {
		return domain.View{}, err
	}
	encoded, err := s.cipher.Decrypt(value.EncryptedPayload)
	if err != nil {
		return domain.View{}, err
	}
	compressed, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return domain.View{}, err
	}
	payload, err := decompress(compressed)
	if err != nil {
		return domain.View{}, err
	}
	hash := sha256.Sum256(payload)
	if hex.EncodeToString(hash[:]) != value.PayloadSHA256 {
		return domain.View{}, errors.New("request snapshot checksum mismatch")
	}
	var decoded any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return domain.View{}, err
	}
	publicSnapshot := value
	publicSnapshot.EncryptedPayload = ""
	view := domain.View{Snapshot: publicSnapshot, Payload: decoded, DryRun: true}
	if !confirm {
		return view, nil
	}
	if !s.allowActualReplay || s.sender == nil {
		return domain.View{}, errors.New("actual replay is disabled pending a separate security review")
	}
	if strings.TrimSpace(clientAPIKey) == "" {
		return domain.View{}, errors.New("client API key is required for confirmed replay")
	}
	replayID, err := security.NewOpaqueToken(18)
	if err != nil {
		return domain.View{}, err
	}
	replayID = "replay_" + replayID
	if err := s.sender(ctx, value, payload, replayID, clientAPIKey); err != nil {
		return domain.View{}, err
	}
	view.DryRun = false
	view.ReplayRequestID = replayID
	return view, nil
}
func (s *Service) Prune(ctx context.Context, limit int) (int64, error) {
	return s.repository.DeleteExpiredRequestSnapshots(ctx, s.now(), limit)
}
func redact(payload []byte) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("invalid snapshot JSON: %w", err)
	}
	redactValue(value, "")
	return json.Marshal(value)
}
func redactValue(value any, key string) {
	switch current := value.(type) {
	case map[string]any:
		for name, child := range current {
			lower := strings.ToLower(name)
			if sensitiveKey(lower) || contentKey(lower) {
				current[name] = "[redacted]"
				continue
			}
			redactValue(child, lower)
		}
	case []any:
		for _, child := range current {
			redactValue(child, key)
		}
	}
}
func sensitiveKey(key string) bool {
	for _, part := range []string{"authorization", "token", "cookie", "password", "secret", "api_key", "apikey", "proxy_url"} {
		if strings.Contains(key, part) {
			return true
		}
	}
	return false
}
func contentKey(key string) bool {
	switch key {
	case "content", "prompt", "input", "messages", "system", "image", "images", "url":
		return true
	}
	return false
}
func compress(value []byte) ([]byte, error) {
	var out bytes.Buffer
	writer := gzip.NewWriter(&out)
	if _, err := writer.Write(value); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
func decompress(value []byte) ([]byte, error) {
	reader, err := gzip.NewReader(bytes.NewReader(value))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return io.ReadAll(io.LimitReader(reader, maxPayloadBytes+1))
}
func trim(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) > limit {
		return value[:limit]
	}
	return value
}
