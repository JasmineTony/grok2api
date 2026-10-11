package clientkey

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"time"

	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// Authenticate 校验 API Key、RPM 和并发限制，并返回请求结束时必须调用的 release。
func (s *Service) Authenticate(ctx context.Context, raw string) (clientkeydomain.Key, func(), error) {
	prefix, ok := security.SplitClientKey(raw)
	if !ok {
		return clientkeydomain.Key{}, nil, ErrInvalidKey
	}
	now := time.Now().UTC()
	value, err := s.resolveAuthKey(ctx, prefix, now)
	if err != nil {
		return clientkeydomain.Key{}, nil, err
	}
	if err := verifyAuthKey(raw, value, now); err != nil {
		return clientkeydomain.Key{}, nil, err
	}
	release, err := s.acquireAuthQuota(ctx, value, now)
	if err != nil {
		return clientkeydomain.Key{}, nil, err
	}
	if s.touches.shouldTouch(value.ID, now) {
		_ = s.keys.Touch(ctx, value.ID)
	}
	return value, release, nil
}

// resolveAuthKey 优先命中鉴权缓存，未命中时回源仓储并写入缓存。
func (s *Service) resolveAuthKey(ctx context.Context, prefix string, now time.Time) (clientkeydomain.Key, error) {
	if value, cached := s.authCache.get(prefix, now); cached {
		return value, nil
	}
	value, err := s.keys.GetByPrefix(ctx, prefix)
	if err != nil {
		if !errors.Is(err, repository.ErrNotFound) {
			return clientkeydomain.Key{}, fmt.Errorf("%w: 客户端 Key 仓储: %v", ErrRuntimeUnavailable, err)
		}
		return clientkeydomain.Key{}, ErrInvalidKey
	}
	s.authCache.put(prefix, value, now)
	return value, nil
}

// verifyAuthKey 校验托管标识、可用性与鉴权哈希，任何失败都按无效 Key 处理。
func verifyAuthKey(raw string, value clientkeydomain.Key, now time.Time) error {
	if value.InternalKind != "" {
		return ErrInvalidKey
	}
	if !value.IsAvailable(now) {
		return ErrInvalidKey
	}
	want := security.HashToken(raw)
	if subtle.ConstantTimeCompare([]byte(want), []byte(value.SecretHash)) != 1 {
		return ErrInvalidKey
	}
	return nil
}

// acquireAuthQuota 依次校验计费余额、RPM 与并发上限，成功时返回请求结束后的释放函数。
func (s *Service) acquireAuthQuota(ctx context.Context, value clientkeydomain.Key, now time.Time) (func(), error) {
	if value.BillingLimitUSDTicks > 0 {
		remaining := value.BillingLimitUSDTicks - value.BilledUsageUSDTicks
		if remaining <= 0 || value.ReservedUsageUSDTicks >= remaining {
			return nil, ErrBillingLimit
		}
	}
	if value.RPMLimit > 0 {
		allowed, err := s.rateLimiter.Allow(ctx, fmt.Sprintf("client:%d", value.ID), value.RPMLimit, now)
		if err != nil {
			return nil, fmt.Errorf("%w: RPM 限流器: %v", ErrRuntimeUnavailable, err)
		}
		if !allowed {
			return nil, ErrRateLimited
		}
	}
	// 与拆分前一致：仅当上限为正数时才申请并发租约；非正数（含负值）一律不调用 Acquire。
	if value.MaxConcurrent <= 0 {
		return func() {}, nil
	}
	release, acquired, err := s.concurrency.Acquire(ctx, fmt.Sprintf("client:%d", value.ID), value.MaxConcurrent)
	if err != nil {
		return nil, fmt.Errorf("%w: 并发租约: %v", ErrRuntimeUnavailable, err)
	}
	if !acquired {
		return nil, ErrConcurrencyLimit
	}
	return release, nil
}

// CanUseModel 判断空权限列表代表全部模型，否则要求显式授权。
func (s *Service) CanUseModel(value clientkeydomain.Key, modelID uint64) bool {
	return value.AllowsModel(modelID)
}
