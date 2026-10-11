package redis

import (
	"context"
	"strconv"
	"sync"
	"time"

	"github.com/chenyme/grok2api/backend/internal/pkg/perfmetrics"
	redisclient "github.com/redis/go-redis/v9"
)

// 本文件承载并发租约的获取与释放、释放重试队列、并发计数查询及限流器适配。

type concurrencyReleaseRetry struct {
	redisKey  string
	token     string
	expiresAt time.Time
}

func (s *Store) acquireConcurrency(ctx context.Context, key string, limit int) (func(), bool, error) {
	if limit <= 0 {
		return func() {}, true, nil
	}
	token, err := randomToken()
	if err != nil {
		return nil, false, err
	}
	now := time.Now().UTC()
	expiresAt := now.Add(s.concurrencyLease)
	redisKey := s.key("concurrency", key)
	result, err := acquireLeaseScript.Run(ctx, s.client, []string{redisKey}, now.UnixMilli(), limit, expiresAt.UnixMilli(), token, (s.concurrencyLease + concurrencyLeaseGrace).Milliseconds()).Int()
	if err != nil || result != 1 {
		return nil, false, err
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			releaseCtx, cancel := context.WithTimeout(context.Background(), concurrencyReleaseRetryTimeout)
			defer cancel()
			if err := releaseLeaseScript.Run(releaseCtx, s.client, []string{redisKey}, token).Err(); err != nil {
				s.enqueueConcurrencyReleaseRetry(concurrencyReleaseRetry{redisKey: redisKey, token: token, expiresAt: expiresAt})
			}
		})
	}, true, nil
}

func (s *Store) enqueueConcurrencyReleaseRetry(value concurrencyReleaseRetry) {
	select {
	case <-s.concurrencyReleaseStop:
		observeConcurrencyRelease("shutdown", 1)
		return
	default:
	}
	select {
	case s.concurrencyReleaseQueue <- value:
		observeConcurrencyRelease("queued", 1)
	case <-s.concurrencyReleaseStop:
		observeConcurrencyRelease("shutdown", 1)
	default:
		observeConcurrencyRelease("dropped", 1)
	}
}

func (s *Store) runConcurrencyReleaseRetries() {
	defer close(s.concurrencyReleaseDone)
	ticker := time.NewTicker(concurrencyReleaseRetryInterval)
	defer ticker.Stop()
	pending := make(map[string]concurrencyReleaseRetry)
	for {
		select {
		case value := <-s.concurrencyReleaseQueue:
			pending[value.token] = value
		case <-ticker.C:
			s.retryConcurrencyReleases(pending)
		case <-s.concurrencyReleaseStop:
			observeConcurrencyRelease("shutdown", len(pending)+len(s.concurrencyReleaseQueue))
			return
		}
	}
}

func (s *Store) retryConcurrencyReleases(pending map[string]concurrencyReleaseRetry) {
	if len(pending) == 0 {
		return
	}
	now := time.Now().UTC()
	expired := 0
	ctx, cancel := context.WithTimeout(context.Background(), concurrencyReleaseRetryTimeout)
	defer cancel()
	pipeline := s.client.Pipeline()
	type queuedRelease struct {
		token   string
		command *redisclient.IntCmd
	}
	commands := make([]queuedRelease, 0, min(len(pending), concurrencyReleaseRetryBatchSize))
	for token, value := range pending {
		if !now.Before(value.expiresAt) {
			delete(pending, token)
			expired++
			continue
		}
		commands = append(commands, queuedRelease{token: token, command: pipeline.ZRem(ctx, value.redisKey, value.token)})
		if len(commands) >= concurrencyReleaseRetryBatchSize {
			break
		}
	}
	if len(commands) == 0 {
		observeConcurrencyRelease("expired", expired)
		return
	}
	_, _ = pipeline.Exec(ctx)
	recovered := 0
	failed := 0
	for _, value := range commands {
		if value.command.Err() == nil {
			delete(pending, value.token)
			recovered++
		} else {
			failed++
		}
	}
	observeConcurrencyRelease("expired", expired)
	observeConcurrencyRelease("recovered", recovered)
	observeConcurrencyRelease("retry_failed", failed)
}

func observeConcurrencyRelease(outcome string, count int) {
	if count <= 0 {
		return
	}
	perfmetrics.Default.Add("runtime_concurrency_release_total", perfmetrics.Labels{
		Subsystem: "runtime", Operation: "concurrency_lease", Stage: "release", Outcome: outcome,
	}, int64(count))
}

func (s *Store) Current(ctx context.Context, key string) (int, error) {
	redisKey := s.key("concurrency", key)
	now := time.Now().UTC().UnixMilli()
	pipe := s.client.TxPipeline()
	pipe.ZRemRangeByScore(ctx, redisKey, "-inf", strconv.FormatInt(now, 10))
	count := pipe.ZCard(ctx, redisKey)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return int(count.Val()), nil
}

func (s *Store) CurrentMany(ctx context.Context, keys []string) (map[string]int, error) {
	values := make(map[string]int)
	if len(keys) == 0 {
		return values, nil
	}
	now := "(" + strconv.FormatInt(time.Now().UTC().UnixMilli(), 10)
	pipe := s.client.Pipeline()
	counts := make([]*redisclient.IntCmd, len(keys))
	for index, key := range keys {
		redisKey := s.key("concurrency", key)
		counts[index] = pipe.ZCount(ctx, redisKey, now, "+inf")
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}
	for index, count := range counts {
		if value := int(count.Val()); value > 0 {
			values[keys[index]] = value
		}
	}
	return values, nil
}

// ConcurrencyLimiter 适配 ConcurrencyLimiter，避免与 DistributedLock 的 Acquire 签名冲突。
type ConcurrencyLimiter struct{ store *Store }

func NewConcurrencyLimiter(store *Store) *ConcurrencyLimiter {
	return &ConcurrencyLimiter{store: store}
}
func (l *ConcurrencyLimiter) Acquire(ctx context.Context, key string, limit int) (func(), bool, error) {
	return l.store.acquireConcurrency(ctx, key, limit)
}
func (l *ConcurrencyLimiter) Current(ctx context.Context, key string) (int, error) {
	return l.store.Current(ctx, key)
}
func (l *ConcurrencyLimiter) CurrentMany(ctx context.Context, keys []string) (map[string]int, error) {
	return l.store.CurrentMany(ctx, keys)
}
