package redis

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	redisclient "github.com/redis/go-redis/v9"
)

// 本文件承载 Redis 运行态存储的共享常量、连接生命周期与通用辅助。

const (
	concurrencyLeaseGrace                = time.Minute
	concurrencyReleaseRetryInterval      = 250 * time.Millisecond
	concurrencyReleaseRetryTimeout       = 3 * time.Second
	concurrencyReleaseRetryBatchSize     = 512
	concurrencyReleaseRetryQueueCapacity = 16384
	maxStickyBindingsPerAccount          = 10000
	maxDeviceSessions                    = 1000
	maxQuotaRecoveryEvents               = 100000
	maxQuotaRefreshDirty                 = 100000
	observedModelStateTTL                = 30 * time.Minute
	// At the per-account cap, one pipeline processes at most 80,000 members.
	stickyDeletePipelineSize = 8
)

// Config 表示 Redis 运行态存储的启动配置。
type Config struct {
	Address          string
	Username         string
	Password         string
	Database         int
	KeyPrefix        string
	TLS              bool
	ConcurrencyLease time.Duration
}

// Store 实现多实例共享的限流、并发租约、粘滞路由、Device OAuth 会话和分布式锁。
type Store struct {
	client                  *redisclient.Client
	prefix                  string
	concurrencyLease        time.Duration
	concurrencyReleaseQueue chan concurrencyReleaseRetry
	concurrencyReleaseStop  chan struct{}
	concurrencyReleaseDone  chan struct{}
	closeOnce               sync.Once
	closeErr                error
}

// Open 连接 Redis；选中的 Redis 不可用时直接返回启动错误。
func Open(ctx context.Context, cfg Config) (*Store, error) {
	options := &redisclient.Options{Addr: cfg.Address, Username: cfg.Username, Password: cfg.Password, DB: cfg.Database}
	if cfg.TLS {
		options.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	client := redisclient.NewClient(options)
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("连接 Redis: %w", err)
	}
	lease := cfg.ConcurrencyLease
	if lease <= 0 {
		lease = 3 * time.Hour
	}
	store := &Store{
		client: client, prefix: cfg.KeyPrefix, concurrencyLease: lease,
		concurrencyReleaseQueue: make(chan concurrencyReleaseRetry, concurrencyReleaseRetryQueueCapacity),
		concurrencyReleaseStop:  make(chan struct{}), concurrencyReleaseDone: make(chan struct{}),
	}
	go store.runConcurrencyReleaseRetries()
	return store, nil
}

func (s *Store) Close() error {
	s.closeOnce.Do(func() {
		close(s.concurrencyReleaseStop)
		s.closeErr = s.client.Close()
		<-s.concurrencyReleaseDone
	})
	return s.closeErr
}

func (s *Store) Ping(ctx context.Context) error { return s.client.Ping(ctx).Err() }

func (s *Store) key(namespace, key string) string { return s.prefix + namespace + ":" + key }

func randomToken() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
