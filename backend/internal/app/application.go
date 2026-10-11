package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	auditapp "github.com/chenyme/grok2api/backend/internal/application/audit"
	clientkeyapp "github.com/chenyme/grok2api/backend/internal/application/clientkey"
	egressapp "github.com/chenyme/grok2api/backend/internal/application/egress"
	"github.com/chenyme/grok2api/backend/internal/application/gateway"
	invalidationapp "github.com/chenyme/grok2api/backend/internal/application/invalidation"
	mediaapp "github.com/chenyme/grok2api/backend/internal/application/media"
	modelapp "github.com/chenyme/grok2api/backend/internal/application/model"
	quotarecoveryapp "github.com/chenyme/grok2api/backend/internal/application/quotarecovery"
	settingsapp "github.com/chenyme/grok2api/backend/internal/application/settings"
	updatecheckapp "github.com/chenyme/grok2api/backend/internal/application/updatecheck"
	"github.com/chenyme/grok2api/backend/internal/infra/config"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
	providerregistry "github.com/chenyme/grok2api/backend/internal/infra/provider"
	consoleprovider "github.com/chenyme/grok2api/backend/internal/infra/provider/console"
	webprovider "github.com/chenyme/grok2api/backend/internal/infra/provider/web"
	"github.com/chenyme/grok2api/backend/internal/pkg/batch"
	"github.com/chenyme/grok2api/backend/internal/pkg/perfmetrics"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

const (
	responseOwnershipCleanupBatchSize = 1000
	webResponseStateCleanupBatchSize  = 50
	responseCleanupMaxBatches         = 100
	responseCleanupInterval           = 5 * time.Minute
	responseCleanupBudget             = 30 * time.Second
	responseCleanupLockTTL            = 2 * time.Minute
)

// Application 管理后端进程生命周期和本地后台任务。
type Application struct {
	logger          *slog.Logger
	database        *relational.Database
	server          *http.Server
	audits          *auditapp.Service
	responses       repository.ResponseRepository
	cleanupLock     repository.DistributedLock
	runtime         io.Closer
	settingsBus     repository.SettingsChangeBus
	invalidationBus repository.InvalidationBus
	settings        *settingsapp.Service
	gateway         *gateway.Service
	media           *mediaapp.Service
	quotaRecovery   *quotarecoveryapp.Service
	accounts        *accountapp.Service
	models          *modelapp.Service
	clientKeys      *clientkeyapp.Service
	updates         *updatecheckapp.Service
	invalidations   *invalidationapp.Service
	accountRepo     repository.AccountRepository
	modelRepo       repository.ModelRepository
	providers       *providerregistry.Registry
	web             *webprovider.Adapter
	egress          *infraegress.Manager
	egressOps       *egressapp.Service
	startup         *startupState
}

func invalidationSourceInstance(cfg config.Config) string {
	if value := strings.TrimSpace(cfg.Deployment.InstanceID); value != "" {
		return value
	}
	return fmt.Sprintf("process-%d", time.Now().UnixNano())
}

func maxBatchConcurrency(value config.BatchConfig) int {
	return max(value.ImportConcurrency, value.ConversionConcurrency, value.SyncConcurrency, value.RefreshConcurrency)
}

func webProviderConfig(cfg config.Config) webprovider.Config {
	return webprovider.Config{
		BaseURL: cfg.Provider.Web.BaseURL, QuotaTimeoutSeconds: int(cfg.Provider.Web.QuotaTimeout.Value().Seconds()),
		StatsigMode: cfg.Provider.Web.StatsigMode, StatsigManualValue: cfg.Provider.Web.StatsigManualValue,
		StatsigSignerURL:   cfg.Provider.Web.StatsigSignerURL,
		ChatTimeoutSeconds: int(cfg.Provider.Web.ChatTimeout.Value().Seconds()), StreamIdleTimeoutSeconds: int(cfg.Provider.Web.StreamIdleTimeout.Value().Seconds()),
		ImageTimeoutSeconds: int(cfg.Provider.Web.ImageTimeout.Value().Seconds()),
		VideoTimeoutSeconds: int(cfg.Provider.Web.VideoTimeout.Value().Seconds()), MaxInputImageBytes: cfg.Media.MaxImageBytes,
		AllowNSFW:            cfg.Provider.Web.AllowNSFW,
		FreeVideoDurationCap: cfg.Provider.Web.FreeVideoDurationCap,
	}
}

func clearanceConfig(cfg config.Config) infraegress.ClearanceConfig {
	return infraegress.ClearanceConfig{
		Mode: cfg.Provider.Web.ClearanceMode, FlareSolverrURL: cfg.Provider.Web.FlareSolverrURL,
		TargetURL: cfg.Provider.Web.BaseURL, Timeout: cfg.Provider.Web.ClearanceTimeout.Value(),
		RefreshInterval: cfg.Provider.Web.ClearanceRefresh.Value(),
	}
}

func consoleProviderConfig(cfg config.Config) consoleprovider.Config {
	return consoleprovider.Config{
		BaseURL: cfg.Provider.Console.BaseURL, SessionBaseURL: cfg.Provider.Web.BaseURL,
		TimeoutSeconds: int(cfg.Provider.Console.ChatTimeout.Value().Seconds()), StreamIdleTimeoutSeconds: int(cfg.Provider.Console.StreamIdleTimeout.Value().Seconds()),
	}
}

func accountAutoCleanConfig(value config.AccountsConfig) accountapp.AutoCleanConfig {
	return accountapp.AutoCleanConfig{
		Enabled:         value.AutoCleanReauthEnabled,
		Interval:        value.AutoCleanReauthInterval.Value(),
		MinAge:          value.AutoCleanReauthMinAge.Value(),
		IncludeDisabled: value.AutoCleanIncludeDisabled,
	}
}

func qualityRetryRuntime(value config.QualityGuardRequestRetryConfig) gateway.QualityRetryRuntime {
	return gateway.QualityRetryRuntime{
		Enabled:                         value.Enabled,
		MaxAttempts:                     value.MaxAttempts,
		HoldTimeout:                     value.HoldTimeout.Value(),
		MinOutputTokens:                 int64(value.MinOutputTokens),
		OnExhausted:                     value.OnExhausted,
		AccountCooldown:                 value.AccountCooldown.Value(),
		IdleAccountCooldown:             value.IdleAccountCooldown.Value(),
		MinEncryptedBytes:               value.MinEncryptedBytes,
		EncryptedBytesPerReasoningToken: value.EncryptedBytesPerReasoningToken,
	}
}

func auditLedgerConfig(value config.AuditConfig) auditapp.LedgerConfig {
	return auditapp.LedgerConfig{
		Mode:                      auditapp.LedgerMode(value.LedgerMode),
		FailureThreshold:          value.LedgerFailureThreshold,
		UnhealthyGrace:            value.LedgerUnhealthyGrace.Value(),
		QueueHighWatermarkPercent: value.LedgerQueueHighWatermarkPct,
	}
}

func mediaConfig(cfg config.Config) mediaapp.Config {
	return mediaapp.Config{
		PublicBaseURL: cfg.Frontend.EffectivePublicAPIBaseURL(),
		MaxImageBytes: cfg.Media.MaxImageBytes, MaxTotalBytes: cfg.Media.MaxTotalBytes,
		CleanupThresholdPercent: cfg.Media.CleanupThresholdPercent, CleanupInterval: cfg.Media.CleanupInterval.Value(),
	}
}

func (a *Application) cleanupExpiredResponses(ctx context.Context, now time.Time) error {
	cleanupCtx, cancel := context.WithTimeout(ctx, responseCleanupBudget)
	defer cancel()
	if a.cleanupLock != nil {
		release, acquired, err := a.cleanupLock.Acquire(cleanupCtx, "response-ownership-cleanup", responseCleanupLockTTL)
		if err != nil {
			return err
		}
		if !acquired {
			return nil
		}
		defer release()
	}
	var totalOwnership, totalWebState int64
	for range responseCleanupMaxBatches {
		if err := cleanupCtx.Err(); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			a.recordResponseCleanup(totalOwnership, totalWebState, true)
			return nil
		}
		result, err := a.responses.DeleteExpired(cleanupCtx, now, responseOwnershipCleanupBatchSize, webResponseStateCleanupBatchSize)
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) && ctx.Err() == nil {
				a.recordResponseCleanup(totalOwnership, totalWebState, true)
				return nil
			}
			return err
		}
		totalOwnership += result.OwnershipDeleted
		totalWebState += result.WebStateDeleted
		if !result.HasMore {
			a.recordResponseCleanup(totalOwnership, totalWebState, false)
			return nil
		}
	}
	a.recordResponseCleanup(totalOwnership, totalWebState, true)
	return nil
}

func (a *Application) recordResponseCleanup(ownershipDeleted, webStateDeleted int64, backlog bool) {
	outcome := "complete"
	if backlog {
		outcome = "backlog"
		a.logger.Warn("response_cleanup_backlog", "ownership_deleted", ownershipDeleted, "web_state_deleted", webStateDeleted)
	}
	labels := perfmetrics.Labels{Subsystem: "response", Operation: "cleanup", Outcome: outcome}
	perfmetrics.Default.Add("response_cleanup_ownership_rows", labels, ownershipDeleted)
	perfmetrics.Default.Add("response_cleanup_web_state_rows", labels, webStateDeleted)
}

func (a *Application) logPerformanceMetrics() {
	stats := a.database.Stats()
	databaseLabels := perfmetrics.Labels{Subsystem: "database", Operation: a.database.Dialect()}
	perfmetrics.Default.SetGauge("db_open_connections", databaseLabels, int64(stats.OpenConnections))
	perfmetrics.Default.SetGauge("db_in_use_connections", databaseLabels, int64(stats.InUse))
	perfmetrics.Default.SetGauge("db_idle_connections", databaseLabels, int64(stats.Idle))
	perfmetrics.Default.SetGauge("db_wait_count", databaseLabels, stats.WaitCount)
	perfmetrics.Default.SetGauge("db_wait_duration_us", databaseLabels, stats.WaitDuration.Microseconds())
	if a.audits != nil {
		a.audits.LedgerSnapshot()
	}
	if a.accounts != nil {
		quota := a.accounts.QuotaRefreshStats()
		labels := perfmetrics.Labels{Subsystem: "quota", Operation: "refresh"}
		perfmetrics.Default.SetGauge("quota_refresh_pending", labels, int64(quota.Pending))
		perfmetrics.Default.SetGauge("quota_refresh_queued", labels, int64(quota.Queued))
		perfmetrics.Default.SetGauge("quota_refresh_running", labels, int64(quota.Running))
	}
	for _, sample := range perfmetrics.Default.CollectAndReset() {
		a.logger.Info("performance_metric",
			"name", sample.Name,
			"subsystem", sample.Labels.Subsystem,
			"operation", sample.Labels.Operation,
			"provider", sample.Labels.Provider,
			"plane", sample.Labels.Plane,
			"stage", sample.Labels.Stage,
			"ordinal", sample.Labels.Ordinal,
			"outcome", sample.Labels.Outcome,
			"count", sample.Count,
			"total", sample.Total,
			"maximum", sample.Maximum,
			"gauge", sample.Gauge,
			"has_gauge", sample.HasGauge,
		)
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
