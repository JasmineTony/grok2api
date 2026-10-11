package redis

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/repository"
)

// 本文件承载已观测模型状态的读写。

func (s *Store) GetObservedModelState(ctx context.Context, accountID uint64) (repository.ObservedModelState, bool, error) {
	if accountID == 0 {
		return repository.ObservedModelState{}, false, nil
	}
	values, err := s.client.HMGet(ctx, s.key("observed-model", strconv.FormatUint(accountID, 10)), "model", "observed_at").Result()
	if err != nil {
		return repository.ObservedModelState{}, false, err
	}
	if len(values) != 2 || values[0] == nil || values[1] == nil {
		return repository.ObservedModelState{}, false, nil
	}
	model, ok := values[0].(string)
	if !ok || strings.TrimSpace(model) == "" {
		return repository.ObservedModelState{}, false, nil
	}
	observedMillis, err := strconv.ParseInt(fmt.Sprint(values[1]), 10, 64)
	if err != nil || observedMillis <= 0 {
		return repository.ObservedModelState{}, false, nil
	}
	return repository.ObservedModelState{Model: model, ObservedAt: time.UnixMilli(observedMillis).UTC()}, true, nil
}

func (s *Store) SetObservedModelState(ctx context.Context, accountID uint64, value repository.ObservedModelState, ttl time.Duration) error {
	if accountID == 0 || strings.TrimSpace(value.Model) == "" || value.ObservedAt.IsZero() {
		return nil
	}
	if ttl <= 0 {
		ttl = observedModelStateTTL
	}
	return setObservedModelStateScript.Run(ctx, s.client,
		[]string{s.key("observed-model", strconv.FormatUint(accountID, 10))},
		strings.TrimSpace(value.Model), value.ObservedAt.UTC().UnixMilli(), ttl.Milliseconds()).Err()
}
