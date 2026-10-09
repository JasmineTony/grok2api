package account

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/pkg/batch"
	"github.com/chenyme/grok2api/backend/internal/pkg/resultcache"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"golang.org/x/sync/singleflight"
)

var (
	ErrDevicePending       = errors.New("Device OAuth 等待用户授权")
	ErrDeviceSlowDown      = errors.New("Device OAuth 轮询过快")
	ErrDeviceDenied        = errors.New("Device OAuth 已拒绝或过期")
	ErrInvalidFilter       = errors.New("账号筛选条件无效")
	ErrInvalidInput        = errors.New("账号参数无效")
	ErrInvalidImport       = errors.New("账号凭据格式无效")
	ErrImportLimit         = errors.New("导入账号数量超过限制")
	ErrExportLimit         = errors.New("导出账号数量超过限制")
	ErrNotFound            = errors.New("账号不存在")
	ErrUnsupported         = errors.New("账号来源不支持该操作")
	ErrConversionBusy      = errors.New("账号正在转换为 Grok Build")
	ErrConflict            = errors.New("账号操作存在冲突")
	ErrAccountPoolMismatch = errors.New("批量操作包含不属于当前号池的账号")
)

var ErrCredentialRefreshPermanent = errors.New("OAuth refresh token 已永久失效")
var errQuotaRefreshBusy = errors.New("额度同步已由其他实例执行")

type RateLimitReconcileState string

const (
	RateLimitReconcileInconclusive RateLimitReconcileState = "inconclusive"
	RateLimitReconcileRefreshing   RateLimitReconcileState = "refreshing"
	RateLimitReconcileAvailable    RateLimitReconcileState = "available"
	RateLimitReconcileExhausted    RateLimitReconcileState = "exhausted"
)

const (
	// estimatedFreeTokenLimit is only a fallback until an upstream exhaustion
	// response supplies the account-specific actual/limit pair.
	estimatedFreeTokenLimit         int64         = 500_000
	freeUsageWindow                 time.Duration = 24 * time.Hour
	forcedRefreshMinInterval        time.Duration = 30 * time.Second
	paidProbeRetryInterval          time.Duration = 15 * time.Minute
	credentialRefreshAdvance        time.Duration = 3 * time.Minute
	credentialRefreshSafetyPoll     time.Duration = time.Minute
	credentialRefreshTimeout        time.Duration = 30 * time.Second
	credentialRefreshStateTTL       time.Duration = 5 * time.Second
	credentialStateWriteTimeout     time.Duration = 5 * time.Second
	credentialConfigurationRetry    time.Duration = 30 * time.Minute
	credentialRefreshBatchSize                    = 100
	credentialUnclassifiedAuthLimit               = 5
	managedTaskWorkerCeiling                      = 50
	quotaRefreshQueueSize                         = 4096
	quotaRefreshTimeout                           = 30 * time.Second
	quotaRefreshDirtyTTL                          = 24 * time.Hour
	quotaRefreshPollInterval                      = 500 * time.Millisecond
	quotaRefreshSharedPoll                        = time.Second
	quotaRefreshBackoffBase                       = time.Second
	quotaRefreshBackoffMax                        = time.Minute
	consoleQuotaRefreshMinInterval                = 30 * time.Second
	unknownRemoteQuotaProbeDelay    time.Duration = 5 * time.Minute
	consolePredictedQuotaProbeDelay time.Duration = 24 * time.Hour
	observedModelPersistInterval                  = 30 * time.Minute
	observedModelLocalCacheTTL                    = 5 * time.Second
	observedModelLockShards                       = 64
	maxCredentialExportAccounts                   = 10000
	maxCredentialImportAccounts                   = 10000
	credentialImportChunkSize                     = 100
	credentialImportPrepareWorkers                = 3
	maxQuotaResetAccounts                         = 10000
	quotaResetChunkSize                           = 500
	maxBatchUpdateAccounts                        = 10000
	maxBuildConversionAccounts                    = 1000
	maxWebConsoleSyncAccounts                     = 1000
	accountTaskBatchSize                          = 1000
	buildBotFlagCacheTTL            time.Duration = 30 * time.Second
	linkedDeleteRuntimeCleanupLimit               = 3 * time.Second
	// buildDetectModel 管理端「检测账号」固定使用的 Grok Build 模型。
	buildDetectModel               = "grok-4.5"
	buildDetectQuotaRecoveryPause  = 24 * time.Hour
	buildDetectModelDeniedCooldown = 5 * time.Minute
	// buildDetectPrompt 探测请求正文，仅用于验证凭据与上游可用性。
	buildDetectPrompt = "hello,test"
)

// Service 负责 OAuth 账号接入、刷新、额度和持久化生命周期。
type Service struct {
	accounts            repository.AccountRepository
	audits              repository.AuditRepository
	deviceSessions      repository.DeviceSessionRepository
	sticky              repository.StickySessionRepository
	refreshLock         repository.DistributedLock
	concurrency         repository.ConcurrencyLimiter
	quotaQueue          repository.QuotaRecoveryQueue
	quotaRefreshState   repository.QuotaRefreshCoordinator
	providers           provider.Registry
	cipher              *security.Cipher
	refreshes           singleflight.Group
	billingSyncs        singleflight.Group
	quotaSyncs          singleflight.Group
	identitySyncs       singleflight.Group
	observedModelWrites singleflight.Group
	observedModelStore  repository.ObservedModelStateRepository
	refreshMu           sync.Mutex
	lastRefreshAt       map[uint64]time.Time
	observedModelShards [observedModelLockShards]observedModelShard
	quotaRefreshMu      sync.Mutex
	quotaRefreshes      map[string]*quotaRefreshState
	quotaRefreshQueue   chan quotaRefreshRequest
	quotaRefreshWake    chan struct{}
	conversionPool      *batch.Pool
	syncPool            *batch.Pool
	refreshPool         *batch.Pool
	// detectPool 专用于管理端「检测账号」，与额度同步/续期隔离，默认并发 32。
	detectPool             *batch.Pool
	credentialRefreshWake  chan struct{}
	autoCleanMu            sync.RWMutex
	autoClean              AutoCleanConfig
	autoCleanRevision      uint64
	autoCleanWake          chan struct{}
	excludeBuildBotFlagged bool
	buildBotFlagCache      *resultcache.Cache[string, []uint64]
	logger                 *slog.Logger
	now                    func() time.Time
}

func (s *Service) SetQuotaRecoveryQueue(queue repository.QuotaRecoveryQueue) {
	s.quotaQueue = queue
}

func (s *Service) SetQuotaRefreshCoordinator(value repository.QuotaRefreshCoordinator) {
	s.quotaRefreshState = value
}

func (s *Service) QuotaRefreshStats() QuotaRefreshStats {
	s.quotaRefreshMu.Lock()
	defer s.quotaRefreshMu.Unlock()
	result := QuotaRefreshStats{}
	for _, state := range s.quotaRefreshes {
		if state == nil {
			continue
		}
		if state.pending || state.queued || state.running {
			result.Pending++
		}
		if state.queued {
			result.Queued++
		}
		if state.running {
			result.Running++
		}
	}
	return result
}

// SetConcurrencyLimiter 让账号维护任务读取与推理路由相同的活动租约。
func (s *Service) SetConcurrencyLimiter(value repository.ConcurrencyLimiter) {
	s.concurrency = value
}

// SetObservedModelStore enables best-effort cross-instance duplicate suppression.
func (s *Service) SetObservedModelStore(value repository.ObservedModelStateRepository) {
	s.observedModelStore = value
}

func NewService(accounts repository.AccountRepository, audits repository.AuditRepository, deviceSessions repository.DeviceSessionRepository, sticky repository.StickySessionRepository, providers provider.Registry, cipher *security.Cipher, refreshLock repository.DistributedLock) *Service {
	return &Service{
		accounts: accounts, audits: audits, deviceSessions: deviceSessions, sticky: sticky,
		providers: providers, cipher: cipher, refreshLock: refreshLock,
		lastRefreshAt: make(map[uint64]time.Time), quotaRefreshes: make(map[string]*quotaRefreshState),
		quotaRefreshQueue:     make(chan quotaRefreshRequest, quotaRefreshQueueSize),
		quotaRefreshWake:      make(chan struct{}, 1),
		credentialRefreshWake: make(chan struct{}, 1),
		autoClean: AutoCleanConfig{
			Enabled: false, Interval: 10 * time.Minute, MinAge: time.Hour, IncludeDisabled: false,
		},
		autoCleanWake:     make(chan struct{}, 1),
		buildBotFlagCache: resultcache.New[string, []uint64](1, buildBotFlagCacheTTL),
		conversionPool:    batch.NewPool(25), syncPool: batch.NewPool(25), refreshPool: batch.NewPool(25), detectPool: batch.NewPool(32),
		logger: slog.Default(),
		now:    func() time.Time { return time.Now().UTC() },
	}
}

func (s *Service) SetBulkPool(pool *batch.Pool) {
	if pool != nil {
		s.conversionPool, s.syncPool, s.refreshPool = pool, pool, pool
	}
}

// SetTaskPools 为转换、同步和凭据刷新绑定独立分类并发池。
func (s *Service) SetTaskPools(conversion, syncPool, refresh *batch.Pool) {
	if conversion != nil {
		s.conversionPool = conversion
	}
	if syncPool != nil {
		s.syncPool = syncPool
	}
	if refresh != nil {
		s.refreshPool = refresh
	}
}

// SetDetectPool 绑定管理端「检测账号」专用并发池；nil 时保留现有池。
func (s *Service) SetDetectPool(pool *batch.Pool) {
	if pool != nil {
		s.detectPool = pool
	}
}

func (s *Service) SetLogger(logger *slog.Logger) {
	if logger != nil {
		s.logger = logger
	}
}

// ProviderDefinition 向账号同步编排层暴露只读生命周期策略，不泄露具体 Adapter。
func (s *Service) ProviderDefinition(value accountdomain.Provider) (provider.Definition, bool) {
	if s.providers == nil {
		return provider.Definition{}, false
	}
	return s.providers.Definition(value)
}

func normalizePage(page, pageSize int) (int, int) {
	return repository.NormalizePage(page, pageSize, repository.DefaultPageSize)
}

func normalizeBatchIDs(ids []uint64) ([]uint64, error) {
	return normalizeIDs(ids, repository.MaxPageSize)
}

func normalizeIDs(ids []uint64, limit int) ([]uint64, error) {
	if len(ids) == 0 {
		return nil, invalidInput("至少选择一个账号")
	}
	if len(ids) > limit {
		return nil, invalidInput(fmt.Sprintf("单次最多处理 %d 个账号", limit))
	}
	seen := make(map[uint64]struct{}, len(ids))
	result := make([]uint64, 0, len(ids))
	for _, id := range ids {
		if id == 0 {
			return nil, invalidInput("账号 ID 无效")
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result, nil
}

// invalidInput 为可安全返回给管理端的账号参数错误附加稳定语义。
func invalidInput(message string) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, message)
}

// mapRepositoryError 隔离持久化层错误，避免 transport 依赖仓储实现语义。
func mapLinkedDeleteError(err error) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	if strings.Contains(msg, "关联删除目标") || strings.Contains(msg, "账号来源无效") || strings.Contains(msg, "不支持清理账号状态") {
		return invalidInput(msg)
	}
	return mapRepositoryError(err)
}

func mapRepositoryError(err error) error {
	if errors.Is(err, repository.ErrAccountPoolMismatch) {
		return ErrAccountPoolMismatch
	}
	if errors.Is(err, repository.ErrNotFound) {
		return ErrNotFound
	}
	if errors.Is(err, repository.ErrConflict) {
		return fmt.Errorf("%w: %s", ErrConflict, strings.TrimPrefix(err.Error(), repository.ErrConflict.Error()+": "))
	}
	return err
}
