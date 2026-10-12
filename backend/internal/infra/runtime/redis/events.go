package redis

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/chenyme/grok2api/backend/internal/repository"
)

// 本文件承载运行设置与失效事件的发布和订阅。

// PublishSettingsChanged 发布运行设置失效通知，不在 Redis 中复制设置内容。
func (s *Store) PublishSettingsChanged(ctx context.Context) error {
	return s.client.Publish(ctx, s.key("events", "settings"), "reload").Err()
}

func (s *Store) PublishInvalidation(ctx context.Context, event repository.InvalidationEvent) error {
	if !event.Valid() {
		return errors.New("invalid invalidation event")
	}
	if event.PublishedAt.IsZero() {
		event.PublishedAt = time.Now().UTC()
	}
	revision, err := s.client.Incr(ctx, s.key("invalidation-revision", string(event.Layer())+":"+string(event.Provider))).Result()
	if err != nil {
		return err
	}
	event.Revision = uint64(revision)
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return s.client.Publish(ctx, s.key("events", "invalidation"), payload).Err()
}

func (s *Store) ListenInvalidations(ctx context.Context, handler func(context.Context, repository.InvalidationEvent) error) error {
	pubsub := s.client.Subscribe(ctx, s.key("events", "invalidation"))
	defer pubsub.Close()
	if _, err := pubsub.Receive(ctx); err != nil {
		return err
	}
	channel := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return nil
		case message, ok := <-channel:
			if !ok {
				return errors.New("Redis invalidation channel closed")
			}
			var event repository.InvalidationEvent
			if err := json.Unmarshal([]byte(message.Payload), &event); err != nil || !event.Valid() {
				continue
			}
			if err := handler(ctx, event); err != nil {
				return err
			}
		}
	}
}

// ListenSettingsChanges 监听设置变更并调用重载函数，go-redis 会在连接中断后自动重连。
func (s *Store) ListenSettingsChanges(ctx context.Context, handler func(context.Context) error) error {
	pubsub := s.client.Subscribe(ctx, s.key("events", "settings"))
	defer pubsub.Close()
	if _, err := pubsub.Receive(ctx); err != nil {
		return err
	}
	channel := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return nil
		case _, ok := <-channel:
			if !ok {
				return errors.New("Redis 设置通知通道已关闭")
			}
			if err := handler(ctx); err != nil {
				return err
			}
		}
	}
}
