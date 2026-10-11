package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// backgroundTaskStarter 注册受监督的后台任务，任务退出时由调用方统一等待。
type backgroundTaskStarter func(name string, task func(context.Context) error)

// Run 启动 HTTP 服务和本地后台维护任务。
func (a *Application) Run(ctx context.Context) error {
	a.audits.Start()
	defer a.closeAudits()
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
	a.startBackgroundTasks(runCtx, &background)
	a.queueDueWebQuotaRefresh(runCtx)
	return a.awaitShutdown(ctx, errCh)
}

// closeAudits 在退出时关闭审计服务，失败只记录告警。
func (a *Application) closeAudits() {
	closeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := a.audits.Close(closeCtx); err != nil {
		a.logger.Warn("audit_shutdown_failed", "error", err)
	}
}

// awaitShutdown 等待外部取消信号或 HTTP 服务退出。
func (a *Application) awaitShutdown(ctx context.Context, errCh <-chan error) error {
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

// startBackgroundTasks 按既有顺序注册后台维护任务；所有任务共享 runCtx 并由 background 统一等待。
func (a *Application) startBackgroundTasks(runCtx context.Context, background *sync.WaitGroup) {
	start := func(name string, task func(context.Context) error) {
		background.Add(1)
		go func() {
			defer background.Done()
			a.runSupervisedTask(runCtx, name, task)
		}()
	}
	if a.invalidationBus != nil {
		start("invalidation_publisher", a.invalidations.RunPublisher)
		start("invalidation_subscriber", a.invalidations.RunSubscriber)
	}
	a.startCoreMaintenanceTasks(start)
	a.startCleanupTasks(start)
	a.startAccountMaintenanceTasks(start)
	a.startStartupCatchupTasks(start)
	a.startProviderTasks(start)
	if a.settingsBus != nil {
		start("settings_change_listener", func(taskCtx context.Context) error {
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
}

// startCoreMaintenanceTasks 注册设置、性能指标与版本检查等核心维护任务。
func (a *Application) startCoreMaintenanceTasks(start backgroundTaskStarter) {
	start("settings_reconcile", func(taskCtx context.Context) error {
		a.runPeriodicTask(taskCtx, 30*time.Second, "settings_reconcile", func(runCtx context.Context) error {
			return a.settings.ReloadPersisted(runCtx)
		})
		return nil
	})
	start("performance_metrics", func(taskCtx context.Context) error {
		a.runPeriodicTask(taskCtx, time.Minute, "performance_metrics", func(context.Context) error {
			a.logPerformanceMetrics()
			return nil
		})
		return nil
	})
	start("release_check", func(taskCtx context.Context) error {
		a.updates.Check(taskCtx)
		a.runPeriodicTask(taskCtx, 24*time.Hour, "release_check", func(checkCtx context.Context) error {
			a.updates.Check(checkCtx)
			return nil
		})
		return nil
	})
}

// startCleanupTasks 注册计费、模型封锁、响应与审计的周期性清理任务。
func (a *Application) startCleanupTasks(start backgroundTaskStarter) {
	start("billing_reservation_cleanup", func(taskCtx context.Context) error {
		a.runPeriodicTask(taskCtx, 10*time.Minute, "billing_reservation_cleanup", func(runCtx context.Context) error {
			_, err := a.clientKeys.CleanupExpiredBilling(runCtx, 1000)
			return err
		})
		return nil
	})
	start("model_cooldown_cleanup", func(taskCtx context.Context) error {
		a.runPeriodicTask(taskCtx, 10*time.Minute, "model_cooldown_cleanup", func(runCtx context.Context) error {
			_, err := a.accountRepo.PruneExpiredModelQuotaBlocks(runCtx, time.Now().UTC(), 1000)
			return err
		})
		return nil
	})
	start("response_ownership_cleanup", func(taskCtx context.Context) error {
		a.runPeriodicTask(taskCtx, responseCleanupInterval, "response_ownership_cleanup", func(runCtx context.Context) error {
			return a.cleanupExpiredResponses(runCtx, time.Now().UTC())
		})
		return nil
	})
	start("audit_retention_cleanup", func(taskCtx context.Context) error {
		a.runPeriodicTask(taskCtx, time.Hour, "audit_retention_cleanup", func(runCtx context.Context) error {
			retentionDays := a.settings.Get().Config.Audit.RetentionDays
			if retentionDays == 0 {
				return nil
			}
			_, err := a.audits.PurgeOutdated(runCtx, retentionDays)
			return err
		})
		return nil
	})
}

// startAccountMaintenanceTasks 注册账号维度的常驻维护任务。
func (a *Application) startAccountMaintenanceTasks(start backgroundTaskStarter) {
	start("quota_recovery", func(taskCtx context.Context) error {
		a.quotaRecovery.Run(taskCtx)
		return nil
	})
	start("quota_refresh", func(taskCtx context.Context) error {
		a.accounts.RunQuotaRefresh(taskCtx)
		return nil
	})
	start("credential_refresh", func(taskCtx context.Context) error {
		a.accounts.RunCredentialRefresh(taskCtx)
		return nil
	})
	start("account_auto_clean", func(taskCtx context.Context) error {
		a.accounts.RunAccountAutoClean(taskCtx)
		return nil
	})
}

// startStartupCatchupTasks 注册启动后补齐历史数据的追赶任务。
func (a *Application) startStartupCatchupTasks(start backgroundTaskStarter) {
	start("statsig_warmup", func(taskCtx context.Context) error {
		a.runStatsigWarmup(taskCtx)
		return nil
	})
	start("web_quota_startup_catchup", func(taskCtx context.Context) error {
		a.runWebQuotaCatchup(taskCtx)
		return nil
	})
	start("console_usage_migration", func(taskCtx context.Context) error {
		a.runConsoleUsageMigration(taskCtx)
		return nil
	})
	start("console_quota_stale_catchup", func(taskCtx context.Context) error {
		a.runConsoleQuotaCatchup(taskCtx)
		return nil
	})
	start("model_catalog_startup_catchup", func(taskCtx context.Context) error {
		a.runModelCatalogCatchup(taskCtx)
		return nil
	})
}

// startProviderTasks 注册视频、媒体、Cloudflare Clearance 与出口运维任务。
func (a *Application) startProviderTasks(start backgroundTaskStarter) {
	start("video_recovery", func(taskCtx context.Context) error {
		a.gateway.RunVideoRecovery(taskCtx)
		return nil
	})
	start("video_workers", func(taskCtx context.Context) error {
		a.gateway.RunVideoWorkers(taskCtx)
		return nil
	})
	start("media_cleanup", func(taskCtx context.Context) error {
		a.media.RunCleanup(taskCtx, func(err error) {
			a.logger.Warn("media_cleanup_failed", "error", err)
		})
		return nil
	})
	start("clearance_refresh", func(taskCtx context.Context) error {
		if err := a.egress.RefreshDueClearances(taskCtx, false); err != nil {
			a.logger.Warn("clearance_initial_refresh_failed", "error", err)
		}
		a.runPeriodicTask(taskCtx, time.Minute, "clearance_refresh", func(runCtx context.Context) error {
			if err := a.egress.RefreshDueClearances(runCtx, false); err != nil {
				a.logger.Warn("clearance_refresh_failed", "error", err)
			}
			return nil
		})
		return nil
	})
	start("egress_operations", func(taskCtx context.Context) error {
		if err := a.egressOps.RunMaintenance(taskCtx); err != nil {
			a.logger.Warn("egress_operations_initial_run_failed", "error", err)
		}
		a.runPeriodicTask(taskCtx, time.Minute, "egress_operations", a.egressOps.RunMaintenance)
		return nil
	})
}
