package account

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/repository"
)

func (s *Service) ObserveResponseModel(ctx context.Context, id uint64, model string) error {
	model = strings.TrimSpace(model)
	if model == "" {
		return nil
	}
	_, err, _ := s.observedModelWrites.Do(strconv.FormatUint(id, 10)+"\x00"+model, func() (any, error) {
		return nil, s.persistObservedResponseModel(ctx, id, model)
	})
	return err
}

// persistObservedResponseModel 在 singleflight 内落库观察到的模型：先查本地分片缓存与共享缓存，再按需写入。
func (s *Service) persistObservedResponseModel(ctx context.Context, id uint64, model string) error {
	now := s.now()
	shard := s.observedModelShard(id)
	shard.Lock()
	if shard.values == nil {
		shard.values = make(map[uint64]observedModelState)
	}
	pruneObservedModelShard(shard, now)
	state, exists := shard.values[id]
	localFresh := exists && state.model == model && observedModelStateIsFresh(now, state.persistedAt)
	if localFresh && (s.observedModelStore == nil || now.Sub(state.persistedAt) < observedModelLocalCacheTTL) {
		shard.Unlock()
		return nil
	}
	shard.Unlock()
	if s.observedModelStore != nil {
		shared, ok, sharedErr := s.observedModelStore.GetObservedModelState(ctx, id)
		if sharedErr == nil && ok && shared.Model == model && observedModelStateIsFresh(now, shared.ObservedAt) {
			shard.Lock()
			shard.values[id] = observedModelState{model: model, persistedAt: now}
			shard.Unlock()
			return nil
		}
	}
	updated := true
	if writer, ok := s.accounts.(repository.ObservedModelWriter); ok {
		var err error
		updated, err = writer.UpdateObservedModelIfNewer(ctx, id, model, now)
		if err != nil {
			return err
		}
	} else if err := s.accounts.UpdateObservedModel(ctx, id, model, now); err != nil {
		return err
	}
	if updated && s.observedModelStore != nil {
		_ = s.observedModelStore.SetObservedModelState(ctx, id, repository.ObservedModelState{Model: model, ObservedAt: now}, observedModelPersistInterval)
	}
	shard.Lock()
	current, exists := shard.values[id]
	if !exists || !current.persistedAt.After(now) {
		shard.values[id] = observedModelState{model: model, persistedAt: now}
	}
	shard.Unlock()
	return nil
}

// pruneObservedModelShard 清理超过持久化间隔的分片缓存条目；调用方必须持有分片锁。
func pruneObservedModelShard(shard *observedModelShard, now time.Time) {
	if !shard.lastCleanupAt.IsZero() && now.Sub(shard.lastCleanupAt) < observedModelPersistInterval {
		return
	}
	for accountID, state := range shard.values {
		if now.Sub(state.persistedAt) >= observedModelPersistInterval {
			delete(shard.values, accountID)
		}
	}
	shard.lastCleanupAt = now
}

func (s *Service) observedModelShard(id uint64) *observedModelShard {
	return &s.observedModelShards[id%observedModelLockShards]
}

func observedModelStateIsFresh(now, persistedAt time.Time) bool {
	elapsed := now.Sub(persistedAt)
	return elapsed >= 0 && elapsed < observedModelPersistInterval
}
