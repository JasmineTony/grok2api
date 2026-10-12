package redis

import (
	"context"
	"strings"
	"sync"
	"time"
)

// 本文件承载分布式锁的获取、释放与适配。

func (s *Store) acquireLock(ctx context.Context, key string, ttl time.Duration) (func(), bool, error) {
	token, err := randomToken()
	if err != nil {
		return nil, false, err
	}
	redisKey := s.key("lock", key)
	acquired, err := s.client.SetNX(ctx, redisKey, token, ttl).Result()
	if err != nil || !acquired {
		return nil, acquired, err
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			releaseCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_ = releaseLockScript.Run(releaseCtx, s.client, []string{redisKey}, token).Err()
		})
	}, true, nil
}

// LockStore 适配 DistributedLock。
type LockStore struct{ store *Store }

func NewLockStore(store *Store) *LockStore { return &LockStore{store: store} }
func (l *LockStore) Acquire(ctx context.Context, key string, ttl time.Duration) (func(), bool, error) {
	return l.store.acquireLock(ctx, strings.TrimSpace(key), ttl)
}
