package app

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	accountsyncapp "github.com/chenyme/grok2api/backend/internal/application/accountsync"
	"github.com/chenyme/grok2api/backend/internal/application/adminauth"
	auditapp "github.com/chenyme/grok2api/backend/internal/application/audit"
	clientkeyapp "github.com/chenyme/grok2api/backend/internal/application/clientkey"
	dashboardapp "github.com/chenyme/grok2api/backend/internal/application/dashboard"
	egressapp "github.com/chenyme/grok2api/backend/internal/application/egress"
	"github.com/chenyme/grok2api/backend/internal/application/gateway"
	invalidationapp "github.com/chenyme/grok2api/backend/internal/application/invalidation"
	mediaapp "github.com/chenyme/grok2api/backend/internal/application/media"
	modelapp "github.com/chenyme/grok2api/backend/internal/application/model"
	quotarecoveryapp "github.com/chenyme/grok2api/backend/internal/application/quotarecovery"
	settingsapp "github.com/chenyme/grok2api/backend/internal/application/settings"
	updatecheckapp "github.com/chenyme/grok2api/backend/internal/application/updatecheck"
	"github.com/chenyme/grok2api/backend/internal/buildinfo"
	"github.com/chenyme/grok2api/backend/internal/domain/account"
	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	"github.com/chenyme/grok2api/backend/internal/infra/config"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	inframedia "github.com/chenyme/grok2api/backend/internal/infra/media"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
	providerregistry "github.com/chenyme/grok2api/backend/internal/infra/provider"
	cliprovider "github.com/chenyme/grok2api/backend/internal/infra/provider/cli"
	consoleprovider "github.com/chenyme/grok2api/backend/internal/infra/provider/console"
	webprovider "github.com/chenyme/grok2api/backend/internal/infra/provider/web"
	infraqualityguard "github.com/chenyme/grok2api/backend/internal/infra/qualityguard"
	"github.com/chenyme/grok2api/backend/internal/infra/runtime/memory"
	redisruntime "github.com/chenyme/grok2api/backend/internal/infra/runtime/redis"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/pkg/batch"
	"github.com/chenyme/grok2api/backend/internal/pkg/reasoningreplay"
	"github.com/chenyme/grok2api/backend/internal/repository"
	httpserver "github.com/chenyme/grok2api/backend/internal/transport/http"
	httpmiddleware "github.com/chenyme/grok2api/backend/internal/transport/http/middleware"
)

// assembly 承载 New 各装配步骤之间的中间产物。步骤按固定顺序执行，任一步失败都通过
// fail 释放已建立的资源，保持与拆分前一致的清理顺序。
type assembly struct {
	ctx    context.Context
	cfg    config.Config
	logger *slog.Logger

	qualityGuardDirectory string

	database *relational.Database
	cipher   *security.Cipher

	adminRepo             *relational.AdminRepository
	sessionRepo           *relational.AdminSessionRepository
	accountRepo           *relational.AccountRepository
	modelRepo             *relational.ModelRepository
	clientKeyRepo         *relational.ClientKeyRepository
	auditRepo             *relational.AuditRepository
	responseRepo          *relational.ResponseRepository
	dashboardRepo         *relational.DashboardRepository
	runtimeSettingsRepo   *relational.RuntimeSettingsRepository
	egressRepo            *relational.EgressRepository
	mediaJobRepo          *relational.MediaJobRepository
	mediaAssetRepo        *relational.MediaAssetRepository
	mediaUploadTicketRepo *relational.MediaUploadTicketRepository

	settingsUpdatedAt time.Time
	settingsRevision  uint64
	mediaStore        *inframedia.LocalStore

	runtimeStore         io.Closer
	runtimeHealth        func(context.Context) error
	rateLimiter          repository.RateLimiter
	concurrency          repository.ConcurrencyLimiter
	sticky               repository.StickySessionRepository
	reasoningReplayStore repository.ReasoningReplayRepository
	deviceSessions       repository.DeviceSessionRepository
	refreshLock          repository.DistributedLock
	settingsBus          repository.SettingsChangeBus
	quotaQueue           repository.QuotaRecoveryQueue
	quotaRefreshState    repository.QuotaRefreshCoordinator
	observedModelStore   repository.ObservedModelStateRepository
	invalidationBus      repository.InvalidationBus

	mediaService    *mediaapp.Service
	egressManager   *infraegress.Manager
	cliAdapter      *cliprovider.Adapter
	reasoningReplay *reasoningreplay.ReasoningReplay
	webAdapter      *webprovider.Adapter
	consoleAdapter  *consoleprovider.Adapter
	providers       *providerregistry.Registry

	adminService *adminauth.Service

	bulkPool       *batch.Pool
	importPool     *batch.Pool
	conversionPool *batch.Pool
	syncPool       *batch.Pool
	refreshPool    *batch.Pool
	detectPool     *batch.Pool

	accountService          *accountapp.Service
	restoredQuotaRecoveries int

	modelService         *modelapp.Service
	accountSyncService   *accountsyncapp.Service
	egressService        *egressapp.Service
	clientKeyService     *clientkeyapp.Service
	qualityGuardIdentity clientkeydomain.Key
	qualityGuardToken    string

	auditService     *auditapp.Service
	dashboardService *dashboardapp.Service

	selector             *gateway.Selector
	invalidationService  *invalidationapp.Service
	gatewayService       *gateway.Service
	quotaRecoveryService *quotarecoveryapp.Service
	inferenceConcurrency *httpmiddleware.ConcurrencyGate

	settingsService *settingsapp.Service
	updateService   *updatecheckapp.Service
	startup         *startupState

	server *http.Server
}

// New 完成数据库、Provider、应用服务和 HTTP 路由装配。
// 每个装配步骤返回错误，任一步失败都会通过 assembly.fail 释放已建立的资源。
func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*Application, error) {
	build := &assembly{ctx: ctx, cfg: cfg, logger: logger}
	steps := []func() error{
		build.openPersistence,
		build.loadPersistedSettings,
		build.openRuntimeStore,
		build.assembleProviders,
		build.assembleAdminAuth,
		build.assembleBatchPools,
		build.assembleAccountService,
		build.restoreQuotaRecoveryWindows,
		build.assembleModelService,
		build.assembleAccountSyncAndEgress,
		build.assembleClientKeys,
		build.assembleAuditAndDashboard,
		build.assembleGateway,
		build.assembleSettings,
		build.assembleStartupAndReadiness,
		build.assembleHTTPServer,
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return nil, err
		}
	}
	return build.application(), nil
}

// fail 按拆分前的顺序释放已建立的资源：先关闭运行态存储，再关闭数据库。
func (a *assembly) fail(err error) error {
	if a.runtimeStore != nil {
		_ = a.runtimeStore.Close()
	}
	if a.database != nil {
		a.database.Close()
	}
	return err
}

// qualityGuardPath 解析质量守护文件路径；未配置目录时返回空路径。
func (a *assembly) qualityGuardPath(name string) string {
	if a.qualityGuardDirectory == "" {
		return ""
	}
	return filepath.Join(a.qualityGuardDirectory, name)
}

// openPersistence 打开数据库、初始化 Schema、构造加密器与全部仓储。
func (a *assembly) openPersistence() error {
	a.qualityGuardDirectory = strings.TrimSpace(os.Getenv("GROK2API_QUALITY_GUARD_DIR"))
	var database *relational.Database
	var err error
	switch a.cfg.Database.Driver {
	case "sqlite":
		database, err = relational.OpenSQLite(a.ctx, a.cfg.Database.SQLite.Path)
	case "postgres":
		database, err = relational.OpenPostgres(a.ctx, a.cfg.Database.Postgres.DSN, a.cfg.Database.Postgres.MaxOpenConns, a.cfg.Database.Postgres.MaxIdleConns)
	default:
		return fmt.Errorf("不支持的数据库驱动: %s", a.cfg.Database.Driver)
	}
	if err != nil {
		return err
	}
	a.database = database
	if err := a.database.InitializeSchema(a.ctx); err != nil {
		return a.fail(err)
	}
	cipher, err := security.NewCipher(a.cfg.Secrets.CredentialEncryptionKey)
	if err != nil {
		return a.fail(err)
	}
	a.cipher = cipher
	a.adminRepo = relational.NewAdminRepository(a.database)
	a.sessionRepo = relational.NewAdminSessionRepository(a.database)
	a.accountRepo = relational.NewAccountRepository(a.database)
	a.modelRepo = relational.NewModelRepository(a.database)
	a.clientKeyRepo = relational.NewClientKeyRepository(a.database)
	a.auditRepo = relational.NewAuditRepository(a.database)
	a.responseRepo = relational.NewResponseRepository(a.database)
	a.dashboardRepo = relational.NewDashboardRepository(a.database)
	a.runtimeSettingsRepo = relational.NewRuntimeSettingsRepository(a.database, cipher)
	a.egressRepo = relational.NewEgressRepository(a.database)
	a.mediaJobRepo = relational.NewMediaJobRepository(a.database)
	a.mediaAssetRepo = relational.NewMediaAssetRepository(a.database)
	a.mediaUploadTicketRepo = relational.NewMediaUploadTicketRepository(a.database)
	return nil
}

// loadPersistedSettings 载入持久化设置、准备本地媒体存储并做部署预检。
func (a *assembly) loadPersistedSettings() error {
	loadedConfig, settingsUpdatedAt, settingsRevision, err := settingsapp.LoadPersisted(a.ctx, a.cfg, a.runtimeSettingsRepo)
	if err != nil {
		return a.fail(err)
	}
	a.cfg = loadedConfig
	a.settingsUpdatedAt = settingsUpdatedAt
	a.settingsRevision = settingsRevision
	mediaStore, err := inframedia.NewLocalStore(a.cfg.Media.Local.Path)
	if err != nil {
		return a.fail(err)
	}
	a.mediaStore = mediaStore
	if err := preflightDeployment(a.cfg); err != nil {
		return a.fail(err)
	}
	return nil
}

// openRuntimeStore 按驱动装配限流、粘性会话、分布式锁等运行态依赖并记录部署拓扑。
func (a *assembly) openRuntimeStore() error {
	a.runtimeHealth = func(context.Context) error { return nil }
	switch a.cfg.RuntimeStore.Driver {
	case "redis":
		if err := a.openRedisRuntimeStore(); err != nil {
			return a.fail(err)
		}
	case "memory":
		a.openMemoryRuntimeStore()
	default:
		return a.fail(fmt.Errorf("不支持的运行态驱动: %s", a.cfg.RuntimeStore.Driver))
	}
	a.logger.Info("deployment_topology", "replicas", a.cfg.Deployment.Replicas, "instance_id", a.cfg.Deployment.InstanceID, "cluster_id", a.cfg.Deployment.ClusterID, "database", a.cfg.Database.Driver, "runtime_store", a.cfg.RuntimeStore.Driver, "media_driver", a.cfg.Media.Driver, "shared_media", a.cfg.Deployment.SharedMedia)
	return nil
}

func (a *assembly) openRedisRuntimeStore() error {
	store, err := redisruntime.Open(a.ctx, redisruntime.Config{
		Address: a.cfg.RuntimeStore.Redis.Address, Username: a.cfg.RuntimeStore.Redis.Username,
		Password: a.cfg.RuntimeStore.Redis.Password, Database: a.cfg.RuntimeStore.Redis.Database,
		KeyPrefix: a.cfg.RuntimeStore.Redis.KeyPrefix, TLS: a.cfg.RuntimeStore.Redis.TLS,
		ConcurrencyLease: a.cfg.Server.RequestTimeout.Value() + time.Minute,
	})
	if err != nil {
		return err
	}
	a.runtimeStore = store
	a.invalidationBus = store
	a.runtimeHealth = store.Ping
	a.rateLimiter = store
	a.concurrency = redisruntime.NewConcurrencyLimiter(store)
	a.sticky = store
	a.reasoningReplayStore = redisruntime.NewReasoningReplayStore(store)
	a.deviceSessions = redisruntime.NewDeviceSessionStore(store)
	a.refreshLock = redisruntime.NewLockStore(store)
	a.settingsBus = store
	a.quotaQueue = store
	a.quotaRefreshState = store
	a.observedModelStore = store
	return nil
}

func (a *assembly) openMemoryRuntimeStore() {
	a.rateLimiter = memory.NewRateLimiter()
	a.concurrency = memory.NewConcurrencyLimiter()
	a.sticky = memory.NewStickyStore()
	a.reasoningReplayStore = memory.NewReasoningReplayStore(a.cfg.Routing.ReasoningReplayMaxEntries)
	a.deviceSessions = memory.NewDeviceSessionStore()
	a.refreshLock = memory.NewLockStore()
	a.quotaQueue = memory.NewQuotaRecoveryQueue()
	a.quotaRefreshState = memory.NewQuotaRefreshCoordinator()
}

// assembleProviders 装配媒体服务、出口管理器和各 Provider 适配器，并校验注册表。
func (a *assembly) assembleProviders() error {
	a.mediaService = mediaapp.NewServiceWithTickets(a.mediaAssetRepo, a.mediaJobRepo, a.mediaUploadTicketRepo, a.mediaStore, a.refreshLock, mediaConfig(a.cfg))
	a.egressManager = infraegress.NewManager(a.egressRepo, a.cipher)
	a.egressManager.SetLogger(a.logger)
	a.egressManager.SetClearanceLock(a.refreshLock)
	a.egressManager.UpdateClearanceConfig(clearanceConfig(a.cfg))
	a.egressManager.UpdateBuildResponseHeaderTimeout(a.cfg.Provider.Build.ResponseHeaderTimeout.Value())
	a.egressManager.UpdateBuildStreamIdleTimeout(a.cfg.Provider.Build.StreamIdleTimeout.Value())
	a.cliAdapter = cliprovider.NewAdapter(cliprovider.Config{
		BaseURL: a.cfg.Provider.Build.BaseURL, FallbackBaseURL: config.NormalizeBuildFallbackBaseURL(a.cfg.Provider.Build.FallbackBaseURL),
		ClientVersion: a.cfg.Provider.Build.ClientVersion, ClientIdentifier: a.cfg.Provider.Build.ClientIdentifier,
		TokenAuth: a.cfg.Provider.Build.TokenAuth, UserAgent: a.cfg.Provider.Build.UserAgent,
		ResponseHeaderTimeout: a.cfg.Provider.Build.ResponseHeaderTimeout.Value(),
		StreamIdleTimeout:     a.cfg.Provider.Build.StreamIdleTimeout.Value(),
	}, a.cipher)
	a.cliAdapter.SetLogger(a.logger)
	a.cliAdapter.SetEgress(a.egressManager)
	a.cliAdapter.SetVideoUploadIssuer(a.mediaService)
	a.reasoningReplay = reasoningreplay.New(a.reasoningReplayStore, reasoningreplay.Config{
		Enabled: a.cfg.Routing.ReasoningReplayEnabled,
		TTL:     a.cfg.Routing.ReasoningReplayTTL.Value(),
	}, a.logger)
	a.cliAdapter.SetReasoningReplay(a.reasoningReplay)
	a.webAdapter = webprovider.NewAdapter(webProviderConfig(a.cfg), a.egressManager, a.cipher, a.responseRepo, a.mediaService)
	a.webAdapter.SetLogger(a.logger)
	a.consoleAdapter = consoleprovider.NewAdapter(consoleProviderConfig(a.cfg), a.egressManager, a.cipher, a.mediaService)
	a.providers = providerregistry.NewRegistry(a.cliAdapter, a.webAdapter, a.consoleAdapter)
	if err := a.providers.Validate(); err != nil {
		return a.fail(fmt.Errorf("校验 Provider 注册表: %w", err))
	}
	return nil
}

// assembleAdminAuth 装配管理端鉴权服务并完成引导账号初始化。
func (a *assembly) assembleAdminAuth() error {
	a.adminService = adminauth.NewService(a.adminRepo, a.sessionRepo, security.NewTokenService(a.cfg.Secrets.JWTSecret), a.cfg.Auth.AccessTokenTTL.Value(), a.cfg.Auth.RefreshTokenTTL.Value())
	a.adminService.SetLoginRateLimiter(a.rateLimiter)
	if err := a.adminService.Bootstrap(a.ctx, a.cfg.BootstrapAdmin.Username, a.cfg.BootstrapAdmin.Password); err != nil {
		return a.fail(err)
	}
	return nil
}

// assembleBatchPools 装配共享批量池与其子池。
func (a *assembly) assembleBatchPools() error {
	a.bulkPool = batch.NewSharedPool(maxBatchConcurrency(a.cfg.Batch), a.concurrency, "bulk:upstream")
	a.importPool = batch.NewSharedChildPool(a.cfg.Batch.ImportConcurrency, a.concurrency, "bulk:import", a.bulkPool)
	a.conversionPool = batch.NewSharedChildPool(a.cfg.Batch.ConversionConcurrency, a.concurrency, "bulk:conversion", a.bulkPool)
	a.syncPool = batch.NewSharedChildPool(a.cfg.Batch.SyncConcurrency, a.concurrency, "bulk:sync", a.bulkPool)
	a.refreshPool = batch.NewSharedChildPool(a.cfg.Batch.RefreshConcurrency, a.concurrency, "bulk:refresh", a.bulkPool)
	// detectPool 固定 32 并发，与额度同步/续期隔离，避免全量探测挤占维护任务。
	a.detectPool = batch.NewSharedChildPool(32, a.concurrency, "bulk:detect", a.bulkPool)
	for _, pool := range a.childPools() {
		pool.UpdateJitter(a.cfg.Batch.RandomDelay.Value())
	}
	return nil
}

// childPools 返回除共享父池外的批量子池，供抖动与并发配置统一更新。
func (a *assembly) childPools() []*batch.Pool {
	return []*batch.Pool{a.importPool, a.conversionPool, a.syncPool, a.refreshPool, a.detectPool}
}

// assembleAccountService 装配账号服务并重建 Build 风控路由索引。
func (a *assembly) assembleAccountService() error {
	a.accountService = accountapp.NewService(a.accountRepo, a.auditRepo, a.deviceSessions, a.sticky, a.providers, a.cipher, a.refreshLock)
	a.cliAdapter.SetFallbackMarker(a.accountService)
	a.accountService.SetLogger(a.logger)
	a.accountService.UpdateAutoCleanConfig(accountAutoCleanConfig(a.cfg.Accounts))
	a.accountService.SetConcurrencyLimiter(a.concurrency)
	a.accountService.SetQuotaRecoveryQueue(a.quotaQueue)
	a.accountService.SetQuotaRefreshCoordinator(a.quotaRefreshState)
	a.accountService.SetObservedModelStore(a.observedModelStore)
	a.accountService.SetTaskPools(a.conversionPool, a.syncPool, a.refreshPool)
	a.accountService.SetDetectPool(a.detectPool)
	if err := a.accountService.RebuildBuildBotFlagIndex(a.ctx); err != nil {
		return a.fail(fmt.Errorf("重建 Build 风控路由索引: %w", err))
	}
	return nil
}

// restoreQuotaRecoveryWindows 把持久化的 Web 额度恢复事件重新排入队列。
func (a *assembly) restoreQuotaRecoveryWindows() error {
	windows, err := a.accountRepo.ListQuotaRecoveryWindows(a.ctx, 100000)
	if err != nil {
		return a.fail(fmt.Errorf("加载 Web 额度恢复事件: %w", err))
	}
	for _, window := range windows {
		if window.ResetAt != nil {
			if err := a.quotaQueue.ScheduleQuotaRecovery(a.ctx, account.QuotaRecoveryEvent{AccountID: window.AccountID, Mode: window.Mode, DueAt: *window.ResetAt}); err != nil {
				return a.fail(fmt.Errorf("恢复 Web 额度事件: %w", err))
			}
		}
	}
	a.restoredQuotaRecoveries = len(windows)
	return nil
}

// assembleModelService 装配模型服务并初始化各 Provider 的模型目录。
func (a *assembly) assembleModelService() error {
	a.modelService = modelapp.NewService(a.modelRepo, a.accountRepo, a.accountService, a.providers)
	a.modelService.SetBulkPool(a.syncPool)
	a.modelService.SetLogger(a.logger)
	if err := a.modelRepo.ReplaceProviderRoutes(a.ctx, account.ProviderWeb, webprovider.Routes()); err != nil {
		return a.fail(fmt.Errorf("初始化 Grok Web 模型目录: %w", err))
	}
	if err := a.modelRepo.ReplaceProviderRoutes(a.ctx, account.ProviderConsole, consoleprovider.Routes()); err != nil {
		return a.fail(fmt.Errorf("初始化 Grok Console 模型目录: %w", err))
	}
	return nil
}

// assembleAccountSyncAndEgress 装配账号同步与出口节点服务。
func (a *assembly) assembleAccountSyncAndEgress() error {
	a.accountSyncService = accountsyncapp.NewService(a.logger, a.accountService, a.accountService, a.accountService, a.modelService)
	a.accountSyncService.SetBulkPool(a.importPool)
	a.accountSyncService.UpdateConcurrency(a.cfg.Batch.ImportConcurrency)
	a.egressService = egressapp.NewService(a.egressRepo, a.cipher, infraegress.DefaultUserAgent, a.accountRepo)
	a.egressService.ConfigureAutoAssignBounds(a.cfg.Routing.AutoAssignMaxNodeShare, a.cfg.Routing.AutoAssignMaxMigrationShare)
	a.egressService.SetClearanceManager(a.egressManager)
	a.egressService.SetNodeProber(a.egressManager)
	a.egressService.SetOperationsConfigInvalidator(a.egressManager)
	a.egressManager.SetFailureProber(a.egressService.TestNode)
	return nil
}

// assembleClientKeys 装配客户端密钥服务并准备质量守护身份与引导文件。
func (a *assembly) assembleClientKeys() error {
	a.clientKeyService = clientkeyapp.NewService(a.clientKeyRepo, a.rateLimiter, a.concurrency, a.cfg.ClientKeyDefaults.RPMLimit, a.cfg.ClientKeyDefaults.MaxConcurrent, a.cipher)
	identity, err := a.clientKeyService.EnsureQualityGuardIdentity(a.ctx, a.cfg.QualityGuard.Enabled)
	if err != nil {
		return a.fail(err)
	}
	a.qualityGuardIdentity = identity
	token, err := infraqualityguard.Prepare(a.qualityGuardPath("bootstrap.json"), a.cfg.QualityGuard, a.cfg.Secrets.JWTSecret)
	if err != nil {
		return a.fail(err)
	}
	a.qualityGuardToken = token
	return nil
}

// assembleAuditAndDashboard 装配审计与仪表盘服务。
func (a *assembly) assembleAuditAndDashboard() error {
	a.auditService = auditapp.NewService(a.auditRepo, a.logger, a.cfg.Audit.BufferSize, a.cfg.Audit.BatchSize, a.cfg.Audit.FlushInterval.Value())
	a.auditService.UpdateWriterConfig(a.cfg.Audit.BatchSize, a.cfg.Audit.FlushInterval.Value(), a.cfg.Audit.CommitDelay.Value())
	a.auditService.UpdateLedgerConfig(auditLedgerConfig(a.cfg.Audit))
	a.auditService.SetCommitObserver(a.clientKeyService.CompleteBillingBatch)
	a.auditService.SetDropObserver(a.clientKeyService.ReleaseBillingProtectionBatch)
	a.dashboardService = dashboardapp.NewService(a.dashboardRepo)
	return nil
}

// assembleGateway 装配调度选择器、失效广播、网关与额度恢复服务。
func (a *assembly) assembleGateway() error {
	a.selector = gateway.NewSelector(a.accountRepo, a.concurrency, a.sticky, a.providers, a.cfg.Routing.StickyTTL.Value(), a.cfg.Routing.CooldownBase.Value(), a.cfg.Routing.CooldownMax.Value(), a.cfg.Routing.CapacityWait.Value())
	a.selector.SetLogger(a.logger)
	a.selector.UpdatePreferFreeBuild(a.cfg.Routing.PreferFreeBuild)
	a.selector.UpdateSegmentedSelector(a.cfg.Routing.SegmentedSelectorEnabled, a.cfg.Routing.SegmentedMinCandidates, a.cfg.Routing.SegmentedWindowSize)
	a.selector.UpdateExcludeBuildBotFlaggedFromScheduling(a.cfg.Accounts.ExcludeBuildBotFlaggedFromScheduling)
	a.accountService.UpdateExcludeBuildBotFlaggedFromScheduling(a.cfg.Accounts.ExcludeBuildBotFlaggedFromScheduling)
	a.egressManager.UpdateAccountIsolatedConnections(a.cfg.Routing.AccountIsolatedConnections)
	a.invalidationService = invalidationapp.NewService(a.invalidationBus, invalidationSourceInstance(a.cfg), func(event repository.InvalidationEvent) {
		a.selector.ApplyInvalidation(event)
		a.clientKeyService.ApplyInvalidation(event)
	}, a.logger)
	a.accountRepo.SetInvalidationObserver(a.invalidationService.Notify)
	a.modelRepo.SetInvalidationObserver(a.invalidationService.Notify)
	a.clientKeyRepo.SetInvalidationObserver(a.invalidationService.Notify)
	a.gatewayService = gateway.NewService(a.modelService, a.auditService, a.accountService, a.clientKeyService, a.providers, a.selector, a.responseRepo, a.cfg.Routing.MaxAttempts)
	a.gatewayService.UpdateQualityRetry(qualityRetryRuntime(a.cfg.QualityGuard.RequestRetry))
	a.gatewayService.UpdateVideoMaxAttempts(a.cfg.Routing.VideoMaxAttempts)
	a.gatewayService.UpdateMarkBuildChatDeniedAsReauth(a.cfg.Routing.MarkBuildChatDeniedAsReauth)
	a.gatewayService.SetLogger(a.logger)
	a.egressService.SetQualityProber(a.gatewayService)
	a.gatewayService.UpdateBuildForbiddenReauthPolicy(a.cfg.Accounts.MarkBuildForbiddenReauth, a.cfg.Accounts.BuildForbiddenReauthCodes)
	a.gatewayService.UpdateRequestTimeout(a.cfg.Server.RequestTimeout.Value())
	a.gatewayService.ConfigureMedia(a.mediaJobRepo, a.cfg.Provider.Web.MediaConcurrency)
	a.gatewayService.ConfigureMediaAssets(a.mediaService)
	a.quotaRecoveryService = quotarecoveryapp.NewService(a.logger, a.quotaQueue, a.accountService, a.cfg.Provider.Web.RecoveryBackoffBase.Value(), a.cfg.Provider.Web.RecoveryBackoffMax.Value())
	a.quotaRecoveryService.SetBulkPool(a.syncPool)
	a.inferenceConcurrency = httpmiddleware.NewConcurrencyGate(a.cfg.Server.MaxConcurrentRequests)
	return nil
}

// settingsChangeNotifier 返回跨实例设置变更发布函数；未启用运行态广播时返回 nil。
func (a *assembly) settingsChangeNotifier() func(context.Context) {
	if a.settingsBus == nil {
		return nil
	}
	return func(notifyCtx context.Context) {
		publishCtx, cancel := context.WithTimeout(context.WithoutCancel(notifyCtx), 3*time.Second)
		defer cancel()
		if err := a.settingsBus.PublishSettingsChanged(publishCtx); err != nil {
			a.logger.Warn("settings_change_publish_failed", "error", err)
		}
	}
}

// assembleSettings 装配设置服务，热更新回调复用 applySettings。
func (a *assembly) assembleSettings() error {
	a.settingsService = settingsapp.NewService(a.cfg, a.settingsUpdatedAt, a.settingsRevision, a.runtimeSettingsRepo, a.settingsChangeNotifier(), a.applySettings)
	return nil
}

// applySettings 把最新配置应用到各运行期组件，顺序与装配时保持一致。
func (a *assembly) applySettings(next config.Config) {
	a.inferenceConcurrency.UpdateLimit(next.Server.MaxConcurrentRequests)
	a.bulkPool.UpdateLimit(maxBatchConcurrency(next.Batch))
	a.importPool.UpdateLimit(next.Batch.ImportConcurrency)
	a.conversionPool.UpdateLimit(next.Batch.ConversionConcurrency)
	a.syncPool.UpdateLimit(next.Batch.SyncConcurrency)
	a.refreshPool.UpdateLimit(next.Batch.RefreshConcurrency)
	a.detectPool.UpdateLimit(32)
	for _, pool := range a.childPools() {
		pool.UpdateJitter(next.Batch.RandomDelay.Value())
	}
	a.cliAdapter.UpdateConfig(cliprovider.Config{
		BaseURL: next.Provider.Build.BaseURL, FallbackBaseURL: config.NormalizeBuildFallbackBaseURL(next.Provider.Build.FallbackBaseURL),
		ClientVersion: next.Provider.Build.ClientVersion, ClientIdentifier: next.Provider.Build.ClientIdentifier,
		TokenAuth: next.Provider.Build.TokenAuth, UserAgent: next.Provider.Build.UserAgent,
		ResponseHeaderTimeout: next.Provider.Build.ResponseHeaderTimeout.Value(),
		StreamIdleTimeout:     next.Provider.Build.StreamIdleTimeout.Value(),
	})
	a.egressManager.UpdateBuildResponseHeaderTimeout(next.Provider.Build.ResponseHeaderTimeout.Value())
	a.egressManager.UpdateBuildStreamIdleTimeout(next.Provider.Build.StreamIdleTimeout.Value())
	a.webAdapter.UpdateConfig(webProviderConfig(next))
	a.egressManager.UpdateClearanceConfig(clearanceConfig(next))
	a.consoleAdapter.UpdateConfig(consoleProviderConfig(next))
	a.mediaService.UpdateConfig(mediaConfig(next))
	a.quotaRecoveryService.UpdateConfig(next.Provider.Web.RecoveryBackoffBase.Value(), next.Provider.Web.RecoveryBackoffMax.Value())
	a.accountSyncService.UpdateConcurrency(next.Batch.ImportConcurrency)
	a.selector.UpdateConfig(next.Routing.StickyTTL.Value(), next.Routing.CooldownBase.Value(), next.Routing.CooldownMax.Value(), next.Routing.CapacityWait.Value())
	a.selector.UpdatePreferFreeBuild(next.Routing.PreferFreeBuild)
	a.selector.UpdateSegmentedSelector(next.Routing.SegmentedSelectorEnabled, next.Routing.SegmentedMinCandidates, next.Routing.SegmentedWindowSize)
	a.egressService.ConfigureAutoAssignBounds(next.Routing.AutoAssignMaxNodeShare, next.Routing.AutoAssignMaxMigrationShare)
	a.selector.UpdateExcludeBuildBotFlaggedFromScheduling(next.Accounts.ExcludeBuildBotFlaggedFromScheduling)
	a.accountService.UpdateExcludeBuildBotFlaggedFromScheduling(next.Accounts.ExcludeBuildBotFlaggedFromScheduling)
	a.egressManager.UpdateAccountIsolatedConnections(next.Routing.AccountIsolatedConnections)
	a.reasoningReplay.UpdateConfig(reasoningreplay.Config{Enabled: next.Routing.ReasoningReplayEnabled, TTL: next.Routing.ReasoningReplayTTL.Value()})
	a.gatewayService.UpdateMaxAttempts(next.Routing.MaxAttempts)
	a.gatewayService.UpdateQualityRetry(qualityRetryRuntime(next.QualityGuard.RequestRetry))
	a.gatewayService.UpdateVideoMaxAttempts(next.Routing.VideoMaxAttempts)
	a.gatewayService.UpdateMarkBuildChatDeniedAsReauth(next.Routing.MarkBuildChatDeniedAsReauth)
	a.gatewayService.UpdateBuildForbiddenReauthPolicy(next.Accounts.MarkBuildForbiddenReauth, next.Accounts.BuildForbiddenReauthCodes)
	a.auditService.UpdateWriterConfig(next.Audit.BatchSize, next.Audit.FlushInterval.Value(), next.Audit.CommitDelay.Value())
	a.auditService.UpdateLedgerConfig(auditLedgerConfig(next.Audit))
	a.clientKeyService.UpdateDefaults(next.ClientKeyDefaults.RPMLimit, next.ClientKeyDefaults.MaxConcurrent)
	a.accountService.UpdateAutoCleanConfig(accountAutoCleanConfig(next.Accounts))
}

// assembleStartupAndReadiness 装配版本检查与启动状态跟踪。
func (a *assembly) assembleStartupAndReadiness() error {
	a.updateService = updatecheckapp.NewService(buildinfo.CurrentVersion(), nil)
	a.startup = newStartupState(a.restoredQuotaRecoveries)
	return nil
}

// assembleHTTPServer 装配 HTTP 路由与服务器，路由依赖前序装配的全部服务。
func (a *assembly) assembleHTTPServer() error {
	readiness := func(readyCtx context.Context) httpserver.ReadinessSnapshot {
		return readinessSnapshot(readyCtx, a.startup, a.runtimeHealth, a.modelRepo, a.accountRepo, a.providers, a.auditService)
	}
	qualityGuardProbe := egressapp.QualityProbeInput{}
	if a.cfg.QualityGuard.Enabled {
		qualityGuardProbe = egressapp.QualityProbeInput{
			ClientKeyID: a.qualityGuardIdentity.ID, Model: a.cfg.QualityGuard.Model,
			Prompt: infraqualityguard.ProbePrompt, Expected: infraqualityguard.ProbeExpected,
			MaxOutputTokens: a.cfg.QualityGuard.MaxOutputTokens,
		}
	}
	router := httpserver.New(httpserver.Dependencies{Logger: a.logger, RequestTimeout: a.cfg.Server.RequestTimeout.Value(), MaxBodyBytes: a.cfg.Server.MaxBodyBytes, TrustedProxies: a.cfg.Server.TrustedProxies, ConcurrencyGate: a.inferenceConcurrency, SecureCookies: a.cfg.Auth.SecureCookies, SwaggerEnabled: a.cfg.Server.SwaggerEnabled, PublicAPIBaseURL: a.cfg.Frontend.EffectivePublicAPIBaseURL(), FrontendStaticPath: a.cfg.Frontend.StaticPath, Readiness: readiness, TrafficReady: a.startup.acceptsTraffic, AdminAuth: a.adminService, Accounts: a.accountService, AccountSync: a.accountSyncService, Models: a.modelService, ClientKeys: a.clientKeyService, Audits: a.auditService, Dashboard: a.dashboardService, Gateway: a.gatewayService, Media: a.mediaService, Settings: a.settingsService, Egress: a.egressService, QualityGuardStatePath: a.qualityGuardPath("state.json"), QualityGuardConfigPath: a.qualityGuardPath("runtime-config.json"), QualityGuardToken: a.qualityGuardToken, QualityGuardProbe: qualityGuardProbe, Updates: a.updateService})
	a.server = &http.Server{Addr: a.cfg.Server.Listen, Handler: router, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: a.cfg.Server.ReadTimeout.Value(), IdleTimeout: 2 * time.Minute, MaxHeaderBytes: 64 << 10}
	return nil
}

// application 汇总装配结果；字段映射与拆分前一致。
func (a *assembly) application() *Application {
	return &Application{
		logger: a.logger, database: a.database, server: a.server,
		audits: a.auditService, responses: a.responseRepo, cleanupLock: a.refreshLock, runtime: a.runtimeStore,
		settingsBus: a.settingsBus, invalidationBus: a.invalidationBus, settings: a.settingsService, gateway: a.gatewayService, media: a.mediaService, quotaRecovery: a.quotaRecoveryService, accounts: a.accountService, models: a.modelService, clientKeys: a.clientKeyService, updates: a.updateService, invalidations: a.invalidationService,
		accountRepo: a.accountRepo, modelRepo: a.modelRepo, providers: a.providers, web: a.webAdapter, egress: a.egressManager, egressOps: a.egressService, startup: a.startup,
	}
}
