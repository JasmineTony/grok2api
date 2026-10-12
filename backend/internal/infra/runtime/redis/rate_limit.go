package redis

import (
	"context"
	"time"
)

// 本文件承载按 key 的请求限流。

func (s *Store) Allow(ctx context.Context, key string, limit int, _ time.Time) (bool, error) {
	if limit <= 0 {
		return true, nil
	}
	result, err := rateScript.Run(ctx, s.client, []string{s.key("rate", key)}, limit, time.Minute.Milliseconds()).Int()
	return result == 1, err
}
