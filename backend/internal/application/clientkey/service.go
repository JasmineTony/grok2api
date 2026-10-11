package clientkey

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

var (
	ErrInvalidKey         = errors.New("客户端 API Key 无效")
	ErrModelNotAllowed    = errors.New("客户端 API Key 无权使用该模型")
	ErrRateLimited        = errors.New("客户端 API Key 已超过 RPM 限制")
	ErrConcurrencyLimit   = errors.New("客户端 API Key 已达到并发上限")
	ErrBillingLimit       = errors.New("客户端 API Key 已达到用量上限")
	ErrRuntimeUnavailable = errors.New("运行态存储暂不可用")
	ErrInvalidFilter      = errors.New("客户端 Key 筛选条件无效")
	ErrInvalidInput       = errors.New("客户端 Key 参数无效")
	ErrNotFound           = errors.New("客户端 Key 不存在")
	ErrConflict           = errors.New("客户端 Key 冲突")
	ErrSecretUnavailable  = errors.New("客户端 Key 明文不可用")
	ErrSystemManaged      = errors.New("系统托管 Client Key 不允许人工操作")
)

const (
	qualityGuardInternalPrefix = "quality-guard-internal"
	qualityGuardInternalName   = "[system] Egress Quality Guard"
)

type CreateInput struct {
	Name                 string
	Enabled              bool
	ExpiresAt            *time.Time
	RPMLimit             int
	RPMUnlimited         bool
	MaxConcurrent        int
	ConcurrencyUnlimited bool
	BillingLimitUSDTicks int64
	AllowModelAliases    bool
	AllowedModels        []uint64
	ProviderScope        clientkeydomain.ProviderScope
	TierScope            clientkeydomain.TierScope
}

type UpdateInput struct {
	Name                 *string
	Enabled              *bool
	ExpiresAt            *time.Time
	ClearExpiresAt       bool
	RPMLimit             *int
	MaxConcurrent        *int
	BillingLimitUSDTicks *int64
	AllowModelAliases    *bool
	AllowedModels        *[]uint64
	ProviderScope        *clientkeydomain.ProviderScope
	TierScope            *clientkeydomain.TierScope
}

type Created struct {
	Key    clientkeydomain.Key
	Secret string
}

type ListFilter struct {
	Status     string
	ModelScope string
	Sort       repository.SortQuery
}

// Service 负责下游 API Key 创建、鉴权和调用限制。
type Service struct {
	keys          repository.ClientKeyRepository
	rateLimiter   repository.RateLimiter
	concurrency   repository.ConcurrencyLimiter
	defaultRPM    atomic.Int64
	defaultMax    atomic.Int64
	authCache     *authKeyCache
	touches       *touchTracker
	cipher        *security.Cipher
	activeMu      sync.RWMutex
	activeBilling map[string]struct{}
}

type billingReservationRepository interface {
	ReserveBillingUsage(ctx context.Context, id uint64, eventID string, amount int64, expiresAt time.Time) (bool, error)
	CancelBillingReservation(ctx context.Context, eventID string) error
	CleanupExpiredBillingReservations(ctx context.Context, now time.Time, limit int, protectedEventIDs ...[]string) (int, error)
}

type internalKeyInspector interface {
	CountInternalKeys(context.Context, []uint64) (int64, error)
}

func NewService(keys repository.ClientKeyRepository, rateLimiter repository.RateLimiter, concurrency repository.ConcurrencyLimiter, defaultRPM, defaultMax int, cipher *security.Cipher) *Service {
	service := &Service{keys: keys, rateLimiter: rateLimiter, concurrency: concurrency, authCache: newAuthKeyCache(), touches: newTouchTracker(), cipher: cipher, activeBilling: make(map[string]struct{})}
	service.UpdateDefaults(defaultRPM, defaultMax)
	return service
}

func (s *Service) UpdateDefaults(defaultRPM, defaultMax int) {
	s.defaultRPM.Store(int64(defaultRPM))
	s.defaultMax.Store(int64(defaultMax))
}

// ApplyInvalidation removes cached authorization policy after a local or remote
// client-key mutation. A zero ID represents a batch-wide invalidation.
func (s *Service) ApplyInvalidation(event repository.InvalidationEvent) {
	if event.Kind != repository.InvalidationClientKeyChanged {
		return
	}
	if event.ClientKeyID == 0 {
		s.authCache.clear()
		return
	}
	s.authCache.deleteID(event.ClientKeyID)
}

func validListFilter(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func normalizePage(page, pageSize int) (int, int) {
	return repository.NormalizePage(page, pageSize, repository.DefaultPageSize)
}

// invalidInput 为可安全返回给管理端的客户端 Key 参数错误附加稳定语义。
func invalidInput(message string) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, message)
}

// mapRepositoryError 将仓储错误转换为客户端 Key 应用错误。
func mapRepositoryError(err error) error {
	if errors.Is(err, repository.ErrNotFound) {
		return ErrNotFound
	}
	if errors.Is(err, repository.ErrConflict) {
		return ErrConflict
	}
	return err
}
