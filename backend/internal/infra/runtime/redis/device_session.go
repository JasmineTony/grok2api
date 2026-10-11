package redis

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
	redisclient "github.com/redis/go-redis/v9"
)

// 本文件承载 Device OAuth 会话的读写与仓储适配。

func (s *Store) Create(ctx context.Context, value account.DeviceSession) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	ttl := time.Until(value.ExpiresAt)
	if ttl <= 0 {
		return repository.ErrNotFound
	}
	now := time.Now().UTC()
	result, err := createDeviceSessionScript.Run(ctx, s.client, []string{s.key("device", value.ID), s.key("device-index", "sessions")}, payload, now.UnixMilli(), ttl.Milliseconds(), maxDeviceSessions, value.ExpiresAt.UnixMilli()).Int()
	if err != nil {
		return err
	}
	if result != 1 {
		return repository.ErrConflict
	}
	return nil
}

func (s *Store) GetDevice(ctx context.Context, id string, now time.Time) (account.DeviceSession, error) {
	payload, err := s.client.Get(ctx, s.key("device", id)).Bytes()
	if errors.Is(err, redisclient.Nil) {
		return account.DeviceSession{}, repository.ErrNotFound
	}
	if err != nil {
		return account.DeviceSession{}, err
	}
	var value account.DeviceSession
	if err := json.Unmarshal(payload, &value); err != nil {
		return account.DeviceSession{}, err
	}
	if !now.Before(value.ExpiresAt) {
		_ = deleteDeviceSessionScript.Run(ctx, s.client, []string{s.key("device", id), s.key("device-index", "sessions")}).Err()
		return account.DeviceSession{}, repository.ErrNotFound
	}
	return value, nil
}

func (s *Store) Update(ctx context.Context, value account.DeviceSession) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	ttl := time.Until(value.ExpiresAt)
	if ttl <= 0 {
		return repository.ErrNotFound
	}
	result, err := updateDeviceSessionScript.Run(ctx, s.client, []string{s.key("device", value.ID), s.key("device-index", "sessions")}, payload, ttl.Milliseconds(), value.ExpiresAt.UnixMilli()).Int()
	if err != nil {
		return err
	}
	if result != 1 {
		return repository.ErrNotFound
	}
	return nil
}

func (s *Store) Delete(ctx context.Context, id string) error {
	return deleteDeviceSessionScript.Run(ctx, s.client, []string{s.key("device", id), s.key("device-index", "sessions")}).Err()
}

// DeviceSessionStore 适配 DeviceSessionRepository，避免与 StickySessionRepository 的 Get 签名冲突。
type DeviceSessionStore struct{ store *Store }

func NewDeviceSessionStore(store *Store) *DeviceSessionStore {
	return &DeviceSessionStore{store: store}
}
func (s *DeviceSessionStore) Create(ctx context.Context, value account.DeviceSession) error {
	return s.store.Create(ctx, value)
}
func (s *DeviceSessionStore) Get(ctx context.Context, id string, now time.Time) (account.DeviceSession, error) {
	return s.store.GetDevice(ctx, id, now)
}
func (s *DeviceSessionStore) Update(ctx context.Context, value account.DeviceSession) error {
	return s.store.Update(ctx, value)
}
func (s *DeviceSessionStore) Delete(ctx context.Context, id string) error {
	return s.store.Delete(ctx, id)
}
