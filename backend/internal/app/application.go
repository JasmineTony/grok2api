package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	accountsyncapp "github.com/chenyme/grok2api/backend/internal/application/accountsync"
	"github.com/chenyme/grok2api/backend/internal/application/adminauth"
	auditapp "github.com/chenyme/grok2api/backend/internal/application/audit"
	backupapp "github.com/chenyme/grok2api/backend/internal/application/backup"
	clientkeyapp "github.com/chenyme/grok2api/backend/internal/application/clientkey"
	dashboardapp "github.com/chenyme/grok2api/backend/internal/application/dashboard"
	egressapp "github.com/chenyme/grok2api/backend/internal/application/egress"
	"github.com/chenyme/grok2api/backend/internal/application/gateway"
	mediaapp "github.com/chenyme/grok2api/backend/internal/application/media"
	modelapp "github.com/chenyme/grok2api/backend/internal/application/model"
	notificationapp "github.com/chenyme/grok2api/backend/internal/application/notification"
	quotarecoveryapp "github.com/chenyme/grok2api/backend/internal/application/quotarecovery"
	requestpolicyapp "github.com/chenyme/grok2api/backend/internal/application/requestpolicy"
	requestsnapshotapp "github.com/chenyme/grok2api/backend/internal/application/requestsnapshot"
	settingsapp "github.com/chenyme/grok2api/backend/internal/application/settings"
	updatecheckapp "github.com/chenyme/grok2api/backend/internal/application/updatecheck"
	"github.com/chenyme/grok2api/backend/internal/buildinfo"
	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	notificationdomain "github.com/chenyme/grok2api/backend/internal/domain/notification"
	requestpolicydomain "github.com/chenyme/grok2api/backend/internal/domain/requestpolicy"
	requestsnapshotdomain "github.com/chenyme/grok2api/backend/internal/domain/requestsnapshot"
	"github.com/chenyme/grok2api/backend/internal/infra/config"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	inframedia "github.com/chenyme/grok2api/backend/internal/infra/media"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
	"github.com/chenyme/grok2api/backend/internal/infra/provider"
	cliprovider "github.com/chenyme/grok2api/backend/internal/infra/provider/cli"
	consoleprovider "github.com/chenyme/grok2api/backend/internal/infra/provider/console"
	webprovider "github.com/chenyme/grok2api/backend/internal/infra/provider/web"
	"github.com/chenyme/grok2api/backend/internal/infra/runtime/memory"
	redisruntime "github.com/chenyme/grok2api/backend/internal/infra/runtime/redis"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	metricsobs "github.com/chenyme/grok2api/backend/internal/observability"
	"github.com/chenyme/grok2api/backend/internal/pkg/batch"
	"github.com/chenyme/grok2api/backend/internal/pkg/reasoningreplay"
	"github.com/chenyme/grok2api/backend/internal/repository"
	httpserver "github.com/chenyme/grok2api/backend/internal/transport/http"
	httpmiddleware "github.com/chenyme/grok2api/backend/internal/transport/http/middleware"
)

// Application 管理后端进程生命周期和本地后台任务。
type Application struct {
	logger          *slog.Logger
	database        *relational.Database
	server          *http.Server
	metrics         *metricsobs.Metrics
	metricsConfig   metricsobs.PrometheusConfig
	audits          *auditapp.Service
	responses       repository.ResponseRepository
	runtime         io.Closer
	settingsBus     repository.SettingsChangeBus
	settings        *settingsapp.Service
	gateway         *gateway.Service
	media           *mediaapp.Service
	quotaRecovery   *quotarecoveryapp.Service
	accounts        *accountapp.Service
	models          *modelapp.Service
	clientKeys      *clientkeyapp.Service
	updates         *updatecheckapp.Service
	egress          *egressapp.Service
	usageRollups    repository.UsageRollupRepository
	backup          *backupapp.Service
	notifications   *notificationapp.Service
	requestPolicies *requestpolicyapp.Service
	accountRepo     repository.AccountRepository
	modelRepo       repository.ModelRepository
	providers       *provider.Registry
	web             *webprovider.Adapter
	startup         *startupState
}

// New 完成数据库、Provider、应用服务和 HTTP 路由装配。
func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*Application, error) {
	var database *relational.Database
	var err error
	switch cfg.Database.Driver {
	case "sqlite":
		database, err = relational.OpenSQLite(ctx, cfg.Database.SQLite.Path)
	case "postgres":
		database, err = relational.OpenPostgres(ctx, cfg.Database.Postgres.DSN, cfg.Database.Postgres.MaxOpenConns, cfg.Database.Postgres.MaxIdleConns)
	default:
		return nil, fmt.Errorf("不支持的数据库驱动: %s", cfg.Database.Driver)
	}
	if err != nil {
		return nil, err
	}
	if err := database.InitializeSchema(ctx); err != nil {
		database.Close()
		return nil, err
	}
	cipher, err := security.NewCipher(cfg.Secrets.CredentialEncryptionKey)
	if err != nil {
		database.Close()
		return nil, err
	}

	adminRepo := relational.NewAdminRepository(database)
	sessionRepo := relational.NewAdminSessionRepository(database)
	accountRepo := relational.NewAccountRepository(database)
	modelRepo := relational.NewModelRepository(database)
	clientKeyRepo := relational.NewClientKeyRepository(database)
	auditRepo := relational.NewAuditRepository(database)
	responseRepo := relational.NewResponseRepository(database)
	dashboardRepo := relational.NewDashboardRepository(database)
	usageRollupRepo := relational.NewUsageRollupRepository(database)
	notificationRepo := relational.NewNotificationRepository(database)
	requestPolicyRepo := relational.NewRequestPolicyRepository(database)
	requestSnapshotRepo := relational.NewRequestSnapshotRepository(database)
	backupService := backupapp.NewService(database, cfg.Media.Local.Path, buildinfo.CurrentVersion())
	notificationConfig := notificationapp.Config{Cooldown: cfg.Notifications.Cooldown.Value(), Retention: cfg.Notifications.Retention.Value()}
	if cfg.Notifications.Enabled {
		notificationConfig.WebhookURL = cfg.Notifications.WebhookURL
		notificationConfig.WebhookSecret = cfg.Notifications.WebhookSecret
	}
	notificationService, err := notificationapp.NewService(notificationRepo, notificationConfig, nil)
	if err != nil {
		database.Close()
		return nil, err
	}
	requestPolicyService, err := requestpolicyapp.NewService(requestPolicyRepo)
	if err != nil {
		database.Close()
		return nil, err
	}
	if err := requestPolicyService.Refresh(ctx); err != nil {
		database.Close()
		return nil, err
	}
	requestPolicyService.SetNotifications(notificationService)
	requestSnapshotService, err := requestsnapshotapp.NewService(requestSnapshotRepo, cipher, cfg.RequestSnapshots.Enabled, cfg.RequestSnapshots.TTL.Value(), cfg.RequestSnapshots.AllowActualReplay)
	if err != nil {
		database.Close()
		return nil, err
	}
	runtimeSettingsRepo := relational.NewRuntimeSettingsRepository(database, cipher)
	egressRepo := relational.NewEgressRepository(database)
	mediaJobRepo := relational.NewMediaJobRepository(database)
	mediaAssetRepo := relational.NewMediaAssetRepository(database)
	mediaUploadTicketRepo := relational.NewMediaUploadTicketRepository(database)
	loadedConfig, settingsUpdatedAt, settingsRevision, err := settingsapp.LoadPersisted(ctx, cfg, runtimeSettingsRepo)
	if err != nil {
		database.Close()
		return nil, err
	}
	cfg = loadedConfig
	localMediaStore, err := inframedia.NewLocalStore(cfg.Media.Local.Path)
	if err != nil {
		database.Close()
		return nil, err
	}
	var rateLimiter repository.RateLimiter
	var concurrency repository.ConcurrencyLimiter
	var sticky repository.StickySessionRepository
	var reasoningReplayStore repository.ReasoningReplayRepository
	var deviceSessions repository.DeviceSessionRepository
	var refreshLock repository.DistributedLock
	var settingsBus repository.SettingsChangeBus
	var quotaQueue repository.QuotaRecoveryQueue
	var runtimeStore io.Closer
	runtimeHealth := func(context.Context) error { return nil }
	switch cfg.RuntimeStore.Driver {
	case "redis":
		redisStore, openErr := redisruntime.Open(ctx, redisruntime.Config{
			Address: cfg.RuntimeStore.Redis.Address, Username: cfg.RuntimeStore.Redis.Username,
			Password: cfg.RuntimeStore.Redis.Password, Database: cfg.RuntimeStore.Redis.Database,
			KeyPrefix: cfg.RuntimeStore.Redis.KeyPrefix, TLS: cfg.RuntimeStore.Redis.TLS,
			ConcurrencyLease: cfg.Server.RequestTimeout.Value() + time.Minute,
		})
		if openErr != nil {
			database.Close()
			return nil, openErr
		}
		runtimeStore = redisStore
		runtimeHealth = redisStore.Ping
		rateLimiter = redisStore
		concurrency = redisruntime.NewConcurrencyLimiter(redisStore)
		sticky = redisStore
		reasoningReplayStore = redisruntime.NewReasoningReplayStore(redisStore)
		deviceSessions = redisruntime.NewDeviceSessionStore(redisStore)
		refreshLock = redisruntime.NewLockStore(redisStore)
		settingsBus = redisStore
		quotaQueue = redisStore
	case "memory":
		rateLimiter = memory.NewRateLimiter()
		concurrency = memory.NewConcurrencyLimiter()
		sticky = memory.NewStickyStore()
		reasoningReplayStore = memory.NewReasoningReplayStore(cfg.Routing.ReasoningReplayMaxEntries)
		deviceSessions = memory.NewDeviceSessionStore()
		refreshLock = memory.NewLockStore()
		quotaQueue = memory.NewQuotaRecoveryQueue()
	default:
		database.Close()
		return nil, fmt.Errorf("不支持的运行态驱动: %s", cfg.RuntimeStore.Driver)
	}
	if hook := strings.TrimSpace(cfg.Backup.ExternalHook); hook != "" {
		hookTimeout := cfg.Backup.HookTimeout.Value()
		if hookTimeout <= 0 {
			hookTimeout = 2 * time.Minute
		}
		backupService.SetExternalBackupCheck(func(hookCtx context.Context) error {
			callCtx, cancel := context.WithTimeout(hookCtx, hookTimeout)
			defer cancel()
			command := exec.CommandContext(callCtx, hook, "verify", cfg.Database.Driver, cfg.RuntimeStore.Driver)
			command.Env = append(os.Environ(), "GROK2API_BACKUP_DRIVER="+cfg.Database.Driver, "GROK2API_RUNTIME_STORE="+cfg.RuntimeStore.Driver)
			if err := command.Run(); err != nil {
				return fmt.Errorf("external backup hook failed: %w", err)
			}
			return nil
		})
	}
	mediaService := mediaapp.NewServiceWithTickets(mediaAssetRepo, mediaJobRepo, mediaUploadTicketRepo, localMediaStore, refreshLock, mediaConfig(cfg))

	egressManager := infraegress.NewManager(egressRepo, cipher)
	cliAdapter := cliprovider.NewAdapter(cliprovider.Config{
		BaseURL: cfg.Provider.Build.BaseURL, FallbackBaseURL: config.NormalizeBuildFallbackBaseURL(cfg.Provider.Build.FallbackBaseURL),
		ClientVersion: cfg.Provider.Build.ClientVersion, ClientIdentifier: cfg.Provider.Build.ClientIdentifier,
		TokenAuth: cfg.Provider.Build.TokenAuth, UserAgent: cfg.Provider.Build.UserAgent,
	}, cipher)
	cliAdapter.SetEgress(egressManager)
	cliAdapter.SetVideoUploadIssuer(mediaService)
	reasoningReplay := reasoningreplay.New(reasoningReplayStore, reasoningreplay.Config{
		Enabled: cfg.Routing.ReasoningReplayEnabled,
		TTL:     cfg.Routing.ReasoningReplayTTL.Value(),
	}, logger)
	cliAdapter.SetReasoningReplay(reasoningReplay)
	webAdapter := webprovider.NewAdapter(webProviderConfig(cfg), egressManager, cipher, responseRepo, mediaService)
	webAdapter.SetLogger(logger)
	consoleAdapter := consoleprovider.NewAdapter(consoleProviderConfig(cfg), egressManager, cipher)
	providers := provider.NewRegistry(cliAdapter, webAdapter, consoleAdapter)
	if err := providers.Validate(); err != nil {
		if runtimeStore != nil {
			_ = runtimeStore.Close()
		}
		database.Close()
		return nil, fmt.Errorf("校验 Provider 注册表: %w", err)
	}
	adminService := adminauth.NewService(adminRepo, sessionRepo, security.NewTokenService(cfg.Secrets.JWTSecret), cfg.Auth.AccessTokenTTL.Value(), cfg.Auth.RefreshTokenTTL.Value())
	adminService.SetLoginRateLimiter(rateLimiter)
	if err := adminService.Bootstrap(ctx, cfg.BootstrapAdmin.Username, cfg.BootstrapAdmin.Password); err != nil {
		if runtimeStore != nil {
			_ = runtimeStore.Close()
		}
		database.Close()
		return nil, err
	}
	bulkPool := batch.NewSharedPool(maxBatchConcurrency(cfg.Batch), concurrency, "bulk:upstream")
	importPool := batch.NewSharedChildPool(cfg.Batch.ImportConcurrency, concurrency, "bulk:import", bulkPool)
	conversionPool := batch.NewSharedChildPool(cfg.Batch.ConversionConcurrency, concurrency, "bulk:conversion", bulkPool)
	syncPool := batch.NewSharedChildPool(cfg.Batch.SyncConcurrency, concurrency, "bulk:sync", bulkPool)
	refreshPool := batch.NewSharedChildPool(cfg.Batch.RefreshConcurrency, concurrency, "bulk:refresh", bulkPool)
	for _, pool := range []*batch.Pool{importPool, conversionPool, syncPool, refreshPool} {
		pool.UpdateJitter(cfg.Batch.RandomDelay.Value())
	}
	accountService := accountapp.NewService(accountRepo, auditRepo, deviceSessions, sticky, providers, cipher, refreshLock)
	cliAdapter.SetFallbackMarker(accountService)
	accountService.SetLogger(logger)
	accountService.SetQuotaRecoveryQueue(quotaQueue)
	accountService.SetTaskPools(conversionPool, syncPool, refreshPool)
	windows, err := accountRepo.ListQuotaRecoveryWindows(ctx, 100000)
	if err != nil {
		if runtimeStore != nil {
			_ = runtimeStore.Close()
		}
		database.Close()
		return nil, fmt.Errorf("加载 Web 额度恢复事件: %w", err)
	}
	for _, window := range windows {
		if window.ResetAt != nil {
			if err := quotaQueue.ScheduleQuotaRecovery(ctx, account.QuotaRecoveryEvent{AccountID: window.AccountID, Mode: window.Mode, DueAt: *window.ResetAt}); err != nil {
				if runtimeStore != nil {
					_ = runtimeStore.Close()
				}
				database.Close()
				return nil, fmt.Errorf("恢复 Web 额度事件: %w", err)
			}
		}
	}
	modelService := modelapp.NewService(modelRepo, accountRepo, accountService, providers)
	modelService.SetBulkPool(syncPool)
	modelService.SetLogger(logger)
	if err := modelRepo.ReplaceProviderRoutes(ctx, account.ProviderWeb, webprovider.Routes()); err != nil {
		if runtimeStore != nil {
			_ = runtimeStore.Close()
		}
		database.Close()
		return nil, fmt.Errorf("初始化 Grok Web 模型目录: %w", err)
	}
	if err := modelRepo.ReplaceProviderRoutes(ctx, account.ProviderConsole, consoleprovider.Routes()); err != nil {
		if runtimeStore != nil {
			_ = runtimeStore.Close()
		}
		database.Close()
		return nil, fmt.Errorf("初始化 Grok Console 模型目录: %w", err)
	}
	accountSyncService := accountsyncapp.NewService(logger, accountService, accountService, accountService, modelService)
	accountSyncService.SetBulkPool(importPool)
	accountSyncService.UpdateConcurrency(cfg.Batch.ImportConcurrency)
	egressService := egressapp.NewService(egressRepo, cipher, infraegress.DefaultUserAgent)
	egressService.SetNotifications(notificationService)
	clientKeyService := clientkeyapp.NewService(clientKeyRepo, rateLimiter, concurrency, cfg.ClientKeyDefaults.RPMLimit, cfg.ClientKeyDefaults.MaxConcurrent, cipher)
	auditService := auditapp.NewService(auditRepo, logger, cfg.Audit.BufferSize, cfg.Audit.BatchSize, cfg.Audit.FlushInterval.Value())
	dashboardService := dashboardapp.NewService(dashboardRepo)
	selector := gateway.NewSelector(accountRepo, concurrency, sticky, providers, cfg.Routing.StickyTTL.Value(), cfg.Routing.CooldownBase.Value(), cfg.Routing.CooldownMax.Value(), cfg.Routing.CapacityWait.Value())
	selector.UpdatePreferFreeBuild(cfg.Routing.PreferFreeBuild)
	selector.SetNotifications(notificationService)
	gatewayService := gateway.NewService(modelService, auditService, accountService, clientKeyService, providers, selector, responseRepo, cfg.Routing.MaxAttempts)
	gatewayService.SetLogger(logger)
	gatewayService.ConfigureMedia(mediaJobRepo, cfg.Provider.Web.MediaConcurrency)
	gatewayService.ConfigureMediaAssets(mediaService)
	requestSnapshotService.SetReplaySender(func(replayCtx context.Context, snapshot requestsnapshotdomain.Snapshot, payload []byte, replayID, rawClientKey string) error {
		clientKey, release, authErr := clientKeyService.Authenticate(replayCtx, rawClientKey)
		if authErr != nil {
			return errors.New("replay client authentication failed")
		}
		defer release()
		var envelope struct {
			Model string `json:"model"`
		}
		if err := json.Unmarshal(payload, &envelope); err != nil || strings.TrimSpace(envelope.Model) == "" {
			return errors.New("replay payload does not contain a valid model")
		}
		operation := audit.OperationResponses
		switch snapshot.Protocol {
		case "openai_chat_completions":
			operation = audit.OperationChat
		case "anthropic_messages":
			operation = audit.OperationMessages
		case "openai_responses":
		default:
			return errors.New("unsupported replay protocol")
		}
		decision, policyErr := requestPolicyService.Evaluate(replayCtx, requestpolicydomain.Request{ClientKeyID: clientKey.ID, Model: envelope.Model, Operation: string(operation)})
		if policyErr != nil {
			return errors.New("replay policy evaluation failed")
		}
		if !decision.Allowed {
			return errors.New("replay denied by request policy")
		}
		var bodyMap map[string]any
		if json.Unmarshal(payload, &bodyMap) == nil {
			bodyMap["stream"] = false
			if normalized, err := json.Marshal(bodyMap); err == nil {
				payload = normalized
			}
		}
		input := gateway.Input{RequestID: replayID, ClientKey: clientKey, PublicModel: envelope.Model, Body: payload, Streaming: false, ForcedProvider: decision.ForcedProvider}
		var result *gateway.Result
		var callErr error
		switch snapshot.Protocol {
		case "openai_chat_completions":
			result, callErr = gatewayService.CreateChatCompletion(replayCtx, input)
		case "anthropic_messages":
			result, callErr = gatewayService.CreateMessage(replayCtx, input)
		default:
			result, callErr = gatewayService.CreateResponse(replayCtx, input)
		}
		if callErr != nil {
			return callErr
		}
		if result == nil || result.Body == nil {
			return errors.New("replay returned no result")
		}
		defer result.Body.Close()
		_, _ = io.Copy(io.Discard, io.LimitReader(result.Body, 1<<20))
		result.Finalize(gateway.Usage{}, "", "")
		if result.StatusCode < 200 || result.StatusCode >= 300 {
			return fmt.Errorf("replay upstream returned HTTP %d", result.StatusCode)
		}
		return nil
	})
	quotaRecoveryService := quotarecoveryapp.NewService(logger, quotaQueue, accountService, cfg.Provider.Web.RecoveryBackoffBase.Value(), cfg.Provider.Web.RecoveryBackoffMax.Value())
	quotaRecoveryService.SetBulkPool(syncPool)
	inferenceConcurrency := httpmiddleware.NewConcurrencyGate(cfg.Server.MaxConcurrentRequests)
	var notifySettings func(context.Context)
	if settingsBus != nil {
		notifySettings = func(notifyCtx context.Context) {
			publishCtx, cancel := context.WithTimeout(context.WithoutCancel(notifyCtx), 3*time.Second)
			defer cancel()
			if err := settingsBus.PublishSettingsChanged(publishCtx); err != nil {
				logger.Warn("settings_change_publish_failed", "error", err)
			}
		}
	}
	settingsService := settingsapp.NewService(cfg, settingsUpdatedAt, settingsRevision, runtimeSettingsRepo, notifySettings, func(next config.Config) {
		inferenceConcurrency.UpdateLimit(next.Server.MaxConcurrentRequests)
		bulkPool.UpdateLimit(maxBatchConcurrency(next.Batch))
		importPool.UpdateLimit(next.Batch.ImportConcurrency)
		conversionPool.UpdateLimit(next.Batch.ConversionConcurrency)
		syncPool.UpdateLimit(next.Batch.SyncConcurrency)
		refreshPool.UpdateLimit(next.Batch.RefreshConcurrency)
		for _, pool := range []*batch.Pool{importPool, conversionPool, syncPool, refreshPool} {
			pool.UpdateJitter(next.Batch.RandomDelay.Value())
		}
		cliAdapter.UpdateConfig(cliprovider.Config{
			BaseURL: next.Provider.Build.BaseURL, FallbackBaseURL: config.NormalizeBuildFallbackBaseURL(next.Provider.Build.FallbackBaseURL),
			ClientVersion: next.Provider.Build.ClientVersion, ClientIdentifier: next.Provider.Build.ClientIdentifier,
			TokenAuth: next.Provider.Build.TokenAuth, UserAgent: next.Provider.Build.UserAgent,
		})
		webAdapter.UpdateConfig(webProviderConfig(next))
		consoleAdapter.UpdateConfig(consoleProviderConfig(next))
		mediaService.UpdateConfig(mediaConfig(next))
		quotaRecoveryService.UpdateConfig(next.Provider.Web.RecoveryBackoffBase.Value(), next.Provider.Web.RecoveryBackoffMax.Value())
		accountSyncService.UpdateConcurrency(next.Batch.ImportConcurrency)
		selector.UpdateConfig(next.Routing.StickyTTL.Value(), next.Routing.CooldownBase.Value(), next.Routing.CooldownMax.Value(), next.Routing.CapacityWait.Value())
		selector.UpdatePreferFreeBuild(next.Routing.PreferFreeBuild)
		reasoningReplay.UpdateConfig(reasoningreplay.Config{Enabled: next.Routing.ReasoningReplayEnabled, TTL: next.Routing.ReasoningReplayTTL.Value()})
		gatewayService.UpdateMaxAttempts(next.Routing.MaxAttempts)
		auditService.UpdateConfig(next.Audit.BatchSize, next.Audit.FlushInterval.Value())
		clientKeyService.UpdateDefaults(next.ClientKeyDefaults.RPMLimit, next.ClientKeyDefaults.MaxConcurrent)
	})
	updateService := updatecheckapp.NewService(buildinfo.CurrentVersion(), nil)

	startup := newStartupState(len(windows))
	readiness := func(readyCtx context.Context) httpserver.ReadinessSnapshot {
		return readinessSnapshot(readyCtx, startup, runtimeHealth, modelRepo, accountRepo, providers)
	}
	metrics := metricsobs.NewMetrics()
	gatewayService.ConfigureMetrics(metrics)
	router := httpserver.New(httpserver.Dependencies{Logger: logger, Metrics: metrics, RequestTimeout: cfg.Server.RequestTimeout.Value(), MaxBodyBytes: cfg.Server.MaxBodyBytes, ConcurrencyGate: inferenceConcurrency, SecureCookies: cfg.Auth.SecureCookies, SwaggerEnabled: cfg.Server.SwaggerEnabled, PublicAPIBaseURL: cfg.Frontend.EffectivePublicAPIBaseURL(), FrontendStaticPath: cfg.Frontend.StaticPath, Readiness: readiness, TrafficReady: startup.acceptsTraffic, AdminAuth: adminService, Accounts: accountService, AccountSync: accountSyncService, Models: modelService, ClientKeys: clientKeyService, Audits: auditService, Dashboard: dashboardService, Gateway: gatewayService, Media: mediaService, Settings: settingsService, Egress: egressService, Updates: updateService, Notifications: notificationService, Backup: backupService, RequestPolicies: requestPolicyService, RequestSnapshots: requestSnapshotService})
	server := &http.Server{Addr: cfg.Server.Listen, Handler: router, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: cfg.Server.ReadTimeout.Value(), IdleTimeout: 2 * time.Minute, MaxHeaderBytes: 64 << 10}
	return &Application{
		logger: logger, database: database, server: server,
		metrics: metrics, metricsConfig: metricsobs.PrometheusConfig{Enabled: cfg.Observability.Prometheus.Enabled, Listen: cfg.Observability.Prometheus.Listen},
		audits: auditService, responses: responseRepo, runtime: runtimeStore,
		settingsBus: settingsBus, settings: settingsService, gateway: gatewayService, media: mediaService, quotaRecovery: quotaRecoveryService, accounts: accountService, models: modelService, clientKeys: clientKeyService, updates: updateService, egress: egressService,
		accountRepo: accountRepo, modelRepo: modelRepo, providers: providers, web: webAdapter, usageRollups: usageRollupRepo, backup: backupService, notifications: notificationService, requestPolicies: requestPolicyService, startup: startup,
	}, nil
}

func maxBatchConcurrency(value config.BatchConfig) int {
	return max(value.ImportConcurrency, value.ConversionConcurrency, value.SyncConcurrency, value.RefreshConcurrency)
}

func webProviderConfig(cfg config.Config) webprovider.Config {
	return webprovider.Config{
		BaseURL: cfg.Provider.Web.BaseURL, QuotaTimeoutSeconds: int(cfg.Provider.Web.QuotaTimeout.Value().Seconds()),
		StatsigMode: cfg.Provider.Web.StatsigMode, StatsigManualValue: cfg.Provider.Web.StatsigManualValue,
		StatsigSignerURL:   cfg.Provider.Web.StatsigSignerURL,
		ChatTimeoutSeconds: int(cfg.Provider.Web.ChatTimeout.Value().Seconds()), ImageTimeoutSeconds: int(cfg.Provider.Web.ImageTimeout.Value().Seconds()),
		VideoTimeoutSeconds: int(cfg.Provider.Web.VideoTimeout.Value().Seconds()), MaxInputImageBytes: cfg.Media.MaxImageBytes,
		AllowNSFW: cfg.Provider.Web.AllowNSFW,
	}
}

func consoleProviderConfig(cfg config.Config) consoleprovider.Config {
	return consoleprovider.Config{
		BaseURL: cfg.Provider.Console.BaseURL, SessionBaseURL: cfg.Provider.Web.BaseURL,
		TimeoutSeconds: int(cfg.Provider.Console.ChatTimeout.Value().Seconds()),
	}
}

func mediaConfig(cfg config.Config) mediaapp.Config {
	return mediaapp.Config{
		PublicBaseURL: cfg.Frontend.EffectivePublicAPIBaseURL(),
		MaxImageBytes: cfg.Media.MaxImageBytes, MaxTotalBytes: cfg.Media.MaxTotalBytes,
		CleanupThresholdPercent: cfg.Media.CleanupThresholdPercent, CleanupInterval: cfg.Media.CleanupInterval.Value(),
	}
}

// Run 启动 HTTP 服务和本地后台维护任务。
func (a *Application) Run(ctx context.Context) error {
	a.audits.Start()
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := a.audits.Close(closeCtx); err != nil {
			a.logger.Warn("audit_shutdown_failed", "error", err)
		}
	}()
	runCtx, cancelBackground := context.WithCancel(ctx)
	var background sync.WaitGroup
	defer func() {
		cancelBackground()
		background.Wait()
	}()
	errCh := make(chan error, 1)
	go func() {
		a.logger.Info("server_started", "listen", a.server.Addr)
		errCh <- a.server.ListenAndServe()
	}()
	a.reconcileStartup(runCtx)
	startBackground := func(name string, task func(context.Context) error) {
		background.Add(1)
		go func() {
			defer background.Done()
			a.runSupervisedTask(runCtx, name, task)
		}()
	}
	if a.metricsConfig.Enabled {
		startBackground("prometheus", func(taskCtx context.Context) error {
			a.logger.Info("prometheus_started", "listen", a.metricsConfig.Listen)
			return metricsobs.Serve(taskCtx, a.metricsConfig, a.metrics)
		})
	}
	startBackground("usage_rollup", func(taskCtx context.Context) error {
		refresh := func(runCtx context.Context) error {
			result, err := a.usageRollups.Refresh(runCtx, time.Now().UTC())
			if err == nil {
				a.logger.Debug("usage_rollup_refreshed", "covered_from", result.CoveredFrom, "covered_until", result.CoveredUntil, "hour_rows", result.HourRows, "day_rows", result.DayRows)
			}
			return err
		}
		if err := refresh(taskCtx); err != nil {
			a.logger.Warn("usage_rollup_startup_failed", "error", err)
		}
		a.runPeriodicTask(taskCtx, 5*time.Minute, "usage_rollup", refresh)
		return nil
	})
	startBackground("metrics_refresh", func(taskCtx context.Context) error {
		a.refreshOperationalMetrics(taskCtx)
		a.runPeriodicTask(taskCtx, 30*time.Second, "metrics_refresh", func(runCtx context.Context) error {
			a.refreshOperationalMetrics(runCtx)
			return nil
		})
		return nil
	})
	startBackground("settings_reconcile", func(taskCtx context.Context) error {
		a.runPeriodicTask(taskCtx, 30*time.Second, "settings_reconcile", func(runCtx context.Context) error {
			return a.settings.ReloadPersisted(runCtx)
		})
		return nil
	})
	startBackground("release_check", func(taskCtx context.Context) error {
		check := func(checkCtx context.Context) error {
			snapshot := a.updates.Check(checkCtx)
			a.updates.CheckUpstream(checkCtx)
			if snapshot.UpdateAvailable && a.notifications != nil {
				_, _, err := a.notifications.Publish(checkCtx, notificationdomain.Event{EventKey: "version_update_available", Severity: notificationdomain.SeverityInfo, Title: "发现可用更新", Body: fmt.Sprintf("维护仓库已发布 %s，当前运行 %s。", snapshot.LatestVersion, snapshot.CurrentVersion), DedupKey: "version:" + snapshot.LatestVersion})
				return err
			}
			return nil
		}
		if err := check(taskCtx); err != nil {
			a.logger.Warn("release_notification_failed", "error", err)
		}
		a.runPeriodicTask(taskCtx, 24*time.Hour, "release_check", check)
		return nil
	})
	if a.notifications != nil {
		startBackground("notification_cleanup", func(taskCtx context.Context) error {
			a.runPeriodicTask(taskCtx, time.Hour, "notification_cleanup", func(runCtx context.Context) error { _, err := a.notifications.Prune(runCtx, 1000); return err })
			return nil
		})
	}
	startBackground("billing_reservation_cleanup", func(taskCtx context.Context) error {
		a.runPeriodicTask(taskCtx, 10*time.Minute, "billing_reservation_cleanup", func(runCtx context.Context) error {
			_, err := a.clientKeys.CleanupExpiredBilling(runCtx, 1000)
			return err
		})
		return nil
	})
	startBackground("model_cooldown_cleanup", func(taskCtx context.Context) error {
		a.runPeriodicTask(taskCtx, 10*time.Minute, "model_cooldown_cleanup", func(runCtx context.Context) error {
			_, err := a.accountRepo.PruneExpiredModelQuotaBlocks(runCtx, time.Now().UTC(), 1000)
			return err
		})
		return nil
	})
	startBackground("response_ownership_cleanup", func(taskCtx context.Context) error {
		a.runPeriodicTask(taskCtx, 24*time.Hour, "response_ownership_cleanup", func(runCtx context.Context) error {
			_, err := a.responses.DeleteExpired(runCtx, time.Now().UTC())
			return err
		})
		return nil
	})
	startBackground("quota_recovery", func(taskCtx context.Context) error {
		a.quotaRecovery.Run(taskCtx)
		return nil
	})
	startBackground("web_quota_refresh", func(taskCtx context.Context) error {
		a.accounts.RunWebQuotaRefresh(taskCtx)
		return nil
	})
	startBackground("credential_refresh", func(taskCtx context.Context) error {
		a.accounts.RunCredentialRefresh(taskCtx)
		return nil
	})
	startBackground("statsig_warmup", func(taskCtx context.Context) error {
		a.runStatsigWarmup(taskCtx)
		return nil
	})
	startBackground("web_quota_startup_catchup", func(taskCtx context.Context) error {
		a.runWebQuotaCatchup(taskCtx)
		return nil
	})
	startBackground("model_catalog_startup_catchup", func(taskCtx context.Context) error {
		a.runModelCatalogCatchup(taskCtx)
		return nil
	})
	startBackground("video_recovery", func(taskCtx context.Context) error {
		a.gateway.RunVideoRecovery(taskCtx)
		return nil
	})
	startBackground("video_workers", func(taskCtx context.Context) error {
		a.gateway.RunVideoWorkers(taskCtx)
		return nil
	})
	startBackground("media_cleanup", func(taskCtx context.Context) error {
		a.media.RunCleanup(taskCtx, func(err error) {
			a.logger.Warn("media_cleanup_failed", "error", err)
		})
		return nil
	})
	if a.settingsBus != nil {
		startBackground("settings_change_listener", func(taskCtx context.Context) error {
			return a.settingsBus.ListenSettingsChanges(taskCtx, func(eventCtx context.Context) error {
				reloadCtx, cancel := context.WithTimeout(eventCtx, 5*time.Second)
				defer cancel()
				if err := a.settings.ReloadPersisted(reloadCtx); err != nil {
					a.logger.Warn("settings_reload_failed", "error", err)
				}
				return nil
			})
		})
	}
	a.queueDueWebQuotaRefresh(runCtx)
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := a.server.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("关闭 HTTP 服务: %w", err)
		}
		return nil
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (a *Application) refreshOperationalMetrics(ctx context.Context) {
	if a.metrics == nil {
		return
	}
	if states, err := a.accountRepo.CountStates(ctx); err == nil {
		for _, state := range account.States() {
			a.metrics.SetAccountState(string(state), states[state])
		}
	} else {
		a.logger.Warn("account_state_metrics_failed", "error", err)
	}
	if a.egress == nil {
		return
	}
	nodes, err := a.egress.List(ctx, "", repository.SortQuery{})
	if err != nil {
		a.logger.Warn("egress_metrics_failed", "error", err)
		return
	}
	counts := map[string]uint64{"healthy": 0, "cooldown": 0, "disabled": 0}
	now := time.Now().UTC()
	for _, node := range nodes {
		switch {
		case !node.Enabled:
			counts["disabled"]++
		case node.CooldownUntil != nil && now.Before(*node.CooldownUntil):
			counts["cooldown"]++
		default:
			counts["healthy"]++
		}
	}
	for state, count := range counts {
		a.metrics.SetEgressHealth(state, count)
	}
}

func (a *Application) Close() error {
	var runtimeErr error
	if a.runtime != nil {
		runtimeErr = a.runtime.Close()
	}
	return errors.Join(runtimeErr, a.database.Close())
}

func (a *Application) runPeriodicTask(ctx context.Context, interval time.Duration, name string, task func(context.Context) error) {
	timer := time.NewTimer(interval)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			runCtx, cancel := context.WithTimeout(ctx, minDuration(interval, 5*time.Minute))
			err := task(runCtx)
			cancel()
			if err != nil {
				a.logger.Warn(name+"_failed", "error", err)
			}
			resetTimer(timer, interval)
		}
	}
}

func (a *Application) runSupervisedTask(ctx context.Context, name string, task func(context.Context) error) {
	backoff := time.Second
	for {
		err := batch.Do(ctx, task)
		if ctx.Err() != nil {
			return
		}
		if err == nil {
			err = errors.New("后台任务意外退出")
		}
		var panicErr *batch.PanicError
		if errors.As(err, &panicErr) {
			a.logger.Error("background_task_restarting", "task", name, "backoff", backoff, "error", panicErr, "stack", string(panicErr.Stack))
		} else {
			a.logger.Error("background_task_restarting", "task", name, "backoff", backoff, "error", err)
		}
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		backoff = min(backoff*2, 30*time.Second)
	}
}

func resetTimer(timer *time.Timer, interval time.Duration) {
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
	timer.Reset(interval)
}

func minDuration(left, right time.Duration) time.Duration {
	if left < right {
		return left
	}
	return right
}
