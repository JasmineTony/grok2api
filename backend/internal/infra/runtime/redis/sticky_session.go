package redis

import (
	"context"
	"errors"
	"strconv"
	"time"

	redisclient "github.com/redis/go-redis/v9"
)

// 本文件承载账号粘滞路由绑定的读写与按账号清理。

func (s *Store) Get(ctx context.Context, key string, now time.Time) (uint64, bool, error) {
	value, err := s.client.Get(ctx, s.key("sticky", key)).Result()
	if errors.Is(err, redisclient.Nil) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	id, err := strconv.ParseUint(value, 10, 64)
	return id, err == nil, err
}

func (s *Store) Bind(ctx context.Context, key string, proposedAccountID uint64, now, expiresAt time.Time) (uint64, error) {
	if key == "" || proposedAccountID == 0 {
		return proposedAccountID, nil
	}
	ttl := time.Until(expiresAt)
	if ttl <= 0 {
		return proposedAccountID, nil
	}
	id := strconv.FormatUint(proposedAccountID, 10)
	value, err := bindStickyScript.Run(
		ctx,
		s.client,
		[]string{s.key("sticky", key)},
		id,
		ttl.Milliseconds(),
		s.prefix+"sticky-account:",
		now.UnixMilli(),
		expiresAt.UnixMilli(),
		maxStickyBindingsPerAccount,
	).Uint64()
	if err != nil {
		return 0, err
	}
	return value, nil
}

func (s *Store) Set(ctx context.Context, key string, accountID uint64, expiresAt time.Time) error {
	ttl := time.Until(expiresAt)
	if ttl <= 0 {
		return nil
	}
	id := strconv.FormatUint(accountID, 10)
	bindingKey := s.key("sticky", key)
	accountSetPrefix := s.prefix + "sticky-account:"
	accountSetKey := accountSetPrefix + id
	now := time.Now().UTC()
	return setStickyScript.Run(ctx, s.client, []string{bindingKey, accountSetKey}, id, ttl.Milliseconds(), accountSetPrefix, now.UnixMilli(), expiresAt.UnixMilli(), maxStickyBindingsPerAccount).Err()
}

func (s *Store) DeleteByAccount(ctx context.Context, accountID uint64) error {
	id := strconv.FormatUint(accountID, 10)
	return deleteStickyByAccountScript.Run(ctx, s.client, []string{s.key("sticky-account", id)}, id).Err()
}

func (s *Store) DeleteByAccounts(ctx context.Context, accountIDs []uint64) error {
	seen := make(map[uint64]struct{}, len(accountIDs))
	ids := make([]uint64, 0, len(accountIDs))
	for _, accountID := range accountIDs {
		if accountID == 0 {
			continue
		}
		if _, exists := seen[accountID]; exists {
			continue
		}
		seen[accountID] = struct{}{}
		ids = append(ids, accountID)
	}
	for start := 0; start < len(ids); start += stickyDeletePipelineSize {
		end := min(start+stickyDeletePipelineSize, len(ids))
		_, err := s.client.Pipelined(ctx, func(pipe redisclient.Pipeliner) error {
			for _, accountID := range ids[start:end] {
				id := strconv.FormatUint(accountID, 10)
				// EVAL avoids a NOSCRIPT fallback round trip inside the pipeline. Each
				// script remains bounded to one account so bulk maintenance cannot
				// monopolize the shared Redis event loop with one large Lua call.
				deleteStickyByAccountScript.Eval(ctx, pipe, []string{s.key("sticky-account", id)}, id)
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	return nil
}
