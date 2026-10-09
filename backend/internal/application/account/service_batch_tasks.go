package account

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/pkg/batch"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// SyncAllBilling 尽力刷新全部启用账号，单个账号失败不阻断其他账号。
func (s *Service) SyncAllBilling(ctx context.Context) (int, int, error) {
	return s.SyncAllBillingWithProgress(ctx, nil)
}

func (s *Service) SyncAllBillingWithProgress(ctx context.Context, progress BatchProgressObserver) (int, int, error) {
	if s.providers == nil {
		return 0, 0, fmt.Errorf("Provider 注册表未初始化")
	}
	ids := make([]uint64, 0)
	for _, providerValue := range s.providers.Providers() {
		quotaKind, ok := s.providers.QuotaKind(providerValue)
		if !ok || quotaKind != provider.QuotaBilling {
			continue
		}
		providerIDs, err := s.accounts.ListEnabledAccountIDs(ctx, providerValue, false)
		if err != nil {
			return 0, 0, err
		}
		ids = append(ids, providerIDs...)
	}
	return s.refreshBillings(ctx, ids, progress)
}

// SyncAllWebQuotas 尽力同步全部启用 Grok Web 账号的分模式额度。
func (s *Service) SyncAllWebQuotas(ctx context.Context) (int, int, error) {
	return s.SyncAllWebQuotasWithProgress(ctx, nil)
}

func (s *Service) SyncAllWebQuotasWithProgress(ctx context.Context, progress BatchProgressObserver) (int, int, error) {
	return s.syncAllQuotasWithProgress(ctx, accountdomain.ProviderWeb, "web_quota_sync", progress)
}

func (s *Service) SyncAllConsoleQuotas(ctx context.Context) (int, int, error) {
	return s.SyncAllConsoleQuotasWithProgress(ctx, nil)
}

func (s *Service) SyncAllConsoleQuotasWithProgress(ctx context.Context, progress BatchProgressObserver) (int, int, error) {
	return s.syncAllQuotasWithProgress(ctx, accountdomain.ProviderConsole, "console_quota_sync", progress)
}

// SyncIncompleteConsoleQuotas replaces pre-/usage synthetic windows and
// partial snapshots without refreshing accounts that already have all three
// authoritative Console quota kinds. It is safe to run periodically and uses
// the shared sync pool to preserve the deployment-wide upstream limit.
func (s *Service) SyncIncompleteConsoleQuotas(ctx context.Context) (int, int, error) {
	const batchSize = 1000
	var succeeded, failed int
	var afterID uint64
	for {
		values, _, err := s.accounts.ListProviderAccountBatch(ctx, accountdomain.ProviderConsole, afterID, batchSize)
		if err != nil {
			return succeeded, failed, err
		}
		if len(values) == 0 {
			return succeeded, failed, nil
		}
		ids := make([]uint64, 0, len(values))
		for _, value := range values {
			if value.Enabled && value.AuthStatus == accountdomain.AuthStatusActive {
				ids = append(ids, value.ID)
			}
		}
		windows, err := s.accounts.GetQuotaWindows(ctx, ids)
		if err != nil {
			return succeeded, failed, err
		}
		pending := make([]uint64, 0, len(ids))
		for _, id := range ids {
			if !completeConsoleUsageSnapshot(windows[id]) {
				pending = append(pending, id)
			}
		}
		var batchSucceeded, batchFailed int
		if len(pending) > 0 {
			batchSucceeded, batchFailed, err = s.syncConsoleQuotaAccounts(ctx, "console_usage_migration", pending)
		}
		succeeded += batchSucceeded
		failed += batchFailed
		if err != nil {
			return succeeded, failed, err
		}
		afterID = values[len(values)-1].ID
		if len(values) < batchSize {
			return succeeded, failed, nil
		}
	}
}

// SyncStaleConsoleQuotas refreshes a bounded batch of complete but old /usage
// snapshots. Active accounts are already refreshed after successful requests;
// this catch-up covers idle pools without turning a large deployment into a
// periodic upstream request burst.
func (s *Service) SyncStaleConsoleQuotas(ctx context.Context, before time.Time, afterID uint64, limit int) (int, int, uint64, error) {
	if limit <= 0 || limit > accountTaskBatchSize {
		limit = 50
	}
	pending := make([]uint64, 0, limit)
	nextAfterID := afterID
	reachedEnd := false
	for len(pending) < limit {
		values, _, err := s.accounts.ListProviderAccountBatch(ctx, accountdomain.ProviderConsole, nextAfterID, accountTaskBatchSize)
		if err != nil {
			return 0, 0, nextAfterID, err
		}
		if len(values) == 0 {
			reachedEnd = true
			break
		}
		ids := make([]uint64, 0, len(values))
		for _, value := range values {
			if value.Enabled && value.AuthStatus == accountdomain.AuthStatusActive {
				ids = append(ids, value.ID)
			}
		}
		windows, err := s.accounts.GetQuotaWindows(ctx, ids)
		if err != nil {
			return 0, 0, nextAfterID, err
		}
		for _, value := range values {
			nextAfterID = value.ID
			if value.Enabled && value.AuthStatus == accountdomain.AuthStatusActive && staleCompleteConsoleUsageSnapshot(windows[value.ID], before) {
				pending = append(pending, value.ID)
				if len(pending) == limit {
					break
				}
			}
		}
		if len(values) < accountTaskBatchSize {
			reachedEnd = len(pending) < limit
			break
		}
	}
	if reachedEnd {
		nextAfterID = 0
	}
	if len(pending) == 0 {
		return 0, 0, nextAfterID, nil
	}
	succeeded, failed, err := s.syncConsoleQuotaAccounts(ctx, "console_quota_stale_catchup", pending)
	return succeeded, failed, nextAfterID, err
}

func staleCompleteConsoleUsageSnapshot(windows []accountdomain.QuotaWindow, before time.Time) bool {
	if !completeConsoleUsageSnapshot(windows) {
		return false
	}
	for _, window := range windows {
		if !isConsoleUsageQuotaMode(window.Mode) {
			continue
		}
		if window.SyncedAt == nil || window.SyncedAt.Before(before) {
			return true
		}
	}
	return false
}

func (s *Service) syncConsoleQuotaAccounts(ctx context.Context, operation string, ids []uint64) (int, int, error) {
	return s.runAccountBatch(ctx, operation, ids, s.syncPool, nil, func(workCtx context.Context, id uint64) error {
		_, refreshErr := s.refreshConsoleQuotaModeLocked(workCtx, id, "console")
		if errors.Is(refreshErr, errQuotaRefreshBusy) {
			// Another replica already owns the refresh. Treat that as accepted work:
			// queuing the same account locally only creates a trailing duplicate probe.
			return nil
		}
		if refreshErr != nil && workCtx.Err() == nil {
			s.QueueQuotaRefresh(id, "console")
		}
		return refreshErr
	})
}

func (s *Service) refreshConsoleQuotaModeLocked(ctx context.Context, id uint64, mode string) (accountdomain.QuotaWindow, error) {
	var release func()
	if s.refreshLock != nil {
		acquiredRelease, acquired, err := s.refreshLock.Acquire(ctx, consoleQuotaRefreshLockKey(id), 2*quotaRefreshTimeout)
		if err != nil {
			return accountdomain.QuotaWindow{}, err
		}
		if !acquired {
			return accountdomain.QuotaWindow{}, errQuotaRefreshBusy
		}
		release = acquiredRelease
		defer release()
	}
	return s.RefreshQuotaMode(ctx, id, mode)
}

func consoleQuotaRefreshLockKey(id uint64) string {
	return "quota-refresh:console:" + strconv.FormatUint(id, 10)
}

func completeConsoleUsageSnapshot(windows []accountdomain.QuotaWindow) bool {
	var present uint8
	for _, window := range windows {
		if window.Source != accountdomain.QuotaSourceUpstream || window.SyncedAt == nil {
			continue
		}
		switch window.Mode {
		case "console":
			present |= 1
		case "console_image":
			present |= 2
		case "console_video":
			present |= 4
		}
	}
	return present == 7
}

func (s *Service) syncAllQuotasWithProgress(ctx context.Context, providerValue accountdomain.Provider, operation string, progress BatchProgressObserver) (int, int, error) {
	ids, err := s.accounts.ListEnabledAccountIDs(ctx, providerValue, false)
	if err != nil {
		return 0, 0, err
	}
	return s.runAccountBatch(ctx, operation, ids, s.syncPool, progress, func(workCtx context.Context, id uint64) error {
		_, err := s.RefreshQuota(workCtx, id)
		return err
	})
}

// SyncWebQuotaAccounts 同步指定 Web 账号集合，供启动追赶任务复用共享并发池。
func (s *Service) SyncWebQuotaAccounts(ctx context.Context, ids []uint64) (int, int, error) {
	return s.runAccountBatch(ctx, "web_quota_startup_catchup", ids, s.syncPool, nil, func(workCtx context.Context, id uint64) error {
		_, err := s.RefreshWebQuota(workCtx, id)
		return err
	})
}

// RefreshAllTokens 续期所有声明支持刷新的 Provider 凭据，不可续期账号会被跳过。
func (s *Service) RefreshAllTokens(ctx context.Context) (int, int, int, error) {
	return s.RefreshAllTokensWithProgress(ctx, nil)
}

func (s *Service) RefreshAllTokensWithProgress(ctx context.Context, progress BatchProgressObserver) (int, int, int, error) {
	if s.providers == nil {
		return 0, 0, 0, fmt.Errorf("Provider 注册表未初始化")
	}
	allIDs := make([]uint64, 0)
	ids := make([]uint64, 0)
	for _, providerValue := range s.providers.Providers() {
		if !s.providers.SupportsCredentialRefresh(providerValue) {
			continue
		}
		providerIDs, err := s.accounts.ListEnabledCredentialRefreshAccountIDs(ctx, providerValue, false)
		if err != nil {
			return 0, 0, 0, err
		}
		refreshableIDs, err := s.accounts.ListEnabledCredentialRefreshAccountIDs(ctx, providerValue, true)
		if err != nil {
			return 0, 0, 0, err
		}
		allIDs = append(allIDs, providerIDs...)
		ids = append(ids, refreshableIDs...)
	}
	skipped := max(0, len(allIDs)-len(ids))
	succeeded, failed, err := s.refreshTokens(ctx, ids, progress)
	return succeeded, failed, skipped, err
}

func (s *Service) refreshTokens(ctx context.Context, ids []uint64, progress BatchProgressObserver) (int, int, error) {
	return s.runAccountBatch(ctx, "credential_refresh", ids, s.refreshPool, progress, func(workCtx context.Context, id uint64) error {
		value, err := s.accounts.Get(workCtx, id)
		if err == nil {
			_, err = s.ensureCredential(workCtx, value, ensureCredentialOptions{force: true, bypassCooldown: true, retryPermanentOnce: true})
		}
		return err
	})
}

// BatchRefreshTokens 续期指定账号的凭据；失效账号会强制向上游重试一次，
// 停用、Provider 不支持或缺少刷新凭据的账号会被跳过。
func (s *Service) BatchRefreshTokens(ctx context.Context, ids []uint64) (int, int, int, error) {
	values, err := normalizeBatchIDs(ids)
	if err != nil {
		return 0, 0, 0, err
	}
	if s.providers == nil {
		return 0, 0, 0, fmt.Errorf("Provider 注册表未初始化")
	}
	refreshableIDs := make([]uint64, 0, len(values))
	for _, id := range values {
		value, getErr := s.accounts.Get(ctx, id)
		if getErr != nil {
			return 0, 0, 0, getErr
		}
		if !s.providers.SupportsCredentialRefresh(value.Provider) || !value.Enabled || value.EncryptedRefreshToken == "" {
			continue
		}
		refreshableIDs = append(refreshableIDs, id)
	}
	skipped := len(values) - len(refreshableIDs)
	succeeded, failed, err := s.refreshTokens(ctx, refreshableIDs, nil)
	return succeeded, failed, skipped, err
}

// BatchRefreshBilling 使用有限并发刷新选中账号，避免大量账号同步时串行阻塞或无界创建 goroutine。
func (s *Service) BatchRefreshBilling(ctx context.Context, ids []uint64) (int, int, error) {
	values, err := normalizeBatchIDs(ids)
	if err != nil {
		return 0, 0, err
	}
	return s.refreshBillings(ctx, values, nil)
}

// BatchResetQuotaState clears local Build quota recovery state without changing
// upstream billing snapshots or historical audit usage.
func (s *Service) BatchResetQuotaState(ctx context.Context, ids []uint64) (int, error) {
	values, err := normalizeIDs(ids, maxQuotaResetAccounts)
	if err != nil {
		return 0, err
	}
	for start := 0; start < len(values); start += quotaResetChunkSize {
		end := min(start+quotaResetChunkSize, len(values))
		count, countErr := s.accounts.CountProviderAccountsByIDs(ctx, accountdomain.ProviderBuild, values[start:end])
		if countErr != nil {
			return 0, countErr
		}
		if count != int64(end-start) {
			return 0, invalidInput("仅 Grok Build 账号支持手动重置额度状态")
		}
	}
	reset := 0
	for start := 0; start < len(values); start += quotaResetChunkSize {
		if err := ctx.Err(); err != nil {
			return reset, err
		}
		end := min(start+quotaResetChunkSize, len(values))
		if err := s.accounts.ResetQuotaState(ctx, accountdomain.ProviderBuild, values[start:end]); err != nil {
			return reset, err
		}
		reset += end - start
	}
	return reset, nil
}

// ResetAllBuildQuotaState clears local quota state for every enabled Build
// account without materializing the complete account ID set in memory.
func (s *Service) ResetAllBuildQuotaState(ctx context.Context) (int64, error) {
	return s.accounts.ResetProviderQuotaState(ctx, accountdomain.ProviderBuild, true)
}

// BatchRefreshQuota 使用有限并发同步选中 Web 或 Console 账号的额度窗口。
func (s *Service) BatchRefreshQuota(ctx context.Context, ids []uint64) (int, int, error) {
	values, err := normalizeBatchIDs(ids)
	if err != nil {
		return 0, 0, err
	}
	return s.runAccountBatch(ctx, "quota_sync", values, s.syncPool, nil, func(workCtx context.Context, id uint64) error {
		_, err := s.RefreshQuota(workCtx, id)
		return err
	})
}

func (s *Service) refreshBillings(ctx context.Context, ids []uint64, progress BatchProgressObserver) (int, int, error) {
	return s.runAccountBatch(ctx, "billing_sync", ids, s.syncPool, progress, func(workCtx context.Context, id uint64) error {
		_, err := s.RefreshBilling(workCtx, id)
		return err
	})
}

func (s *Service) runAccountBatch(ctx context.Context, operation string, ids []uint64, pool *batch.Pool, progress BatchProgressObserver, work func(context.Context, uint64) error) (int, int, error) {
	if progress != nil {
		if err := progress(0, len(ids)); err != nil {
			return 0, 0, err
		}
	}
	var progressMu sync.Mutex
	var progressErr error
	completed := 0
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	results, summary, err := batch.MapObserved(runCtx, ids, batch.Options{Workers: pool.Limit(), Pool: pool}, func(workCtx context.Context, id uint64) (struct{}, error) {
		return struct{}{}, work(workCtx, id)
	}, func(_ int, _ batch.Result[struct{}]) {
		progressMu.Lock()
		defer progressMu.Unlock()
		completed++
		if progress != nil {
			if notifyErr := progress(completed, len(ids)); notifyErr != nil && progressErr == nil {
				progressErr = notifyErr
				cancel()
			}
		}
	})
	for index, result := range results {
		var panicErr *batch.PanicError
		if errors.As(result.Err, &panicErr) {
			s.logger.Error("account_bulk_task_panicked", "operation", operation, "account_id", ids[index], "error", panicErr, "stack", string(panicErr.Stack))
		}
	}
	s.logBatchSummary(operation, pool, summary, err)
	return summary.Succeeded, summary.Failed, errors.Join(err, progressErr)
}

func (s *Service) logBatchSummary(operation string, pool *batch.Pool, summary batch.Summary, err error) {
	snapshot := pool.Snapshot()
	s.logger.Info("account_bulk_completed", "operation", operation, "total", summary.Total, "submitted", summary.Submitted, "succeeded", summary.Succeeded, "failed", summary.Failed, "panicked", summary.Panicked, "duration_ms", summary.Duration.Milliseconds(), "canceled", summary.Canceled, "pool_limit", snapshot.Limit, "pool_active", snapshot.Active, "pool_queued", snapshot.Queued, "pool_peak", snapshot.Peak, "error", err)
}
