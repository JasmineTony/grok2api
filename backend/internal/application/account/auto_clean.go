package account

import (
	"context"
	"fmt"
	"time"

	"github.com/chenyme/grok2api/backend/internal/repository"
)

// AutoCleanConfig 是账号自动清理策略；由 app 层从运行设置映射，不依赖 infra/config。
type AutoCleanConfig struct {
	Enabled         bool
	Interval        time.Duration
	MinAge          time.Duration
	IncludeDisabled bool
}

const (
	autoCleanReauthBatchSize   = 100
	autoCleanReauthMaxScans    = 50
	autoCleanReauthMaxDeletes  = 10
	autoCleanReauthLockKey     = "account-auto-clean:reauth"
	autoCleanReauthLockTTL     = 5 * time.Minute
	autoCleanReauthRunTimeout  = 4 * time.Minute
	autoCleanRuntimeWriteLimit = 3 * time.Second
)

// UpdateAutoCleanConfig 热更新账号自动清理策略。
// 仅在策略实际变化时唤醒调度器；唤醒只重排 timer，不会直接硬删。
func (s *Service) UpdateAutoCleanConfig(value AutoCleanConfig) {
	value = normalizeAutoCleanConfig(value)
	s.autoCleanMu.Lock()
	if s.autoClean == value {
		s.autoCleanMu.Unlock()
		return
	}
	s.autoClean = value
	s.autoCleanRevision++
	s.autoCleanMu.Unlock()
	select {
	case s.autoCleanWake <- struct{}{}:
	default:
	}
}

func normalizeAutoCleanConfig(value AutoCleanConfig) AutoCleanConfig {
	if value.Interval < time.Minute {
		value.Interval = time.Minute
	}
	if value.Interval > time.Hour {
		value.Interval = time.Hour
	}
	if value.MinAge < time.Minute {
		value.MinAge = time.Minute
	}
	if value.MinAge > 30*24*time.Hour {
		value.MinAge = 30 * 24 * time.Hour
	}
	return value
}

func (s *Service) autoCleanSnapshot() (AutoCleanConfig, uint64) {
	s.autoCleanMu.RLock()
	defer s.autoCleanMu.RUnlock()
	return s.autoClean, s.autoCleanRevision
}

func (s *Service) autoCleanConfig() AutoCleanConfig {
	value, _ := s.autoCleanSnapshot()
	return value
}

func (s *Service) autoCleanRevisionCurrent(expected uint64, cfg AutoCleanConfig) bool {
	current, revision := s.autoCleanSnapshot()
	return revision == expected && current == cfg
}

func autoCleanInterval(cfg AutoCleanConfig) time.Duration {
	if !cfg.Enabled {
		return time.Hour
	}
	return normalizeAutoCleanConfig(cfg).Interval
}

// RunAccountAutoClean 在启用时周期性删除过期的 reauthRequired 账号；默认关闭。
// timer 绑定配置 revision，旧 timer 即使与热更新同时就绪也只能重排，不能使用新配置执行删除。
func (s *Service) RunAccountAutoClean(ctx context.Context) {
	// NewService / 启动接线可能已向 wake 写入；启动时统一按最新快照排程。
	select {
	case <-s.autoCleanWake:
	default:
	}
	cfg, scheduledRevision := s.autoCleanSnapshot()
	timer := time.NewTimer(autoCleanInterval(cfg))
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.autoCleanWake:
			cfg, scheduledRevision = s.autoCleanSnapshot()
			resetCredentialRefreshTimer(timer, autoCleanInterval(cfg))
		case <-timer.C:
			s.handleAutoCleanTimerTick(ctx, scheduledRevision)
			cfg, scheduledRevision = s.autoCleanSnapshot()
			resetCredentialRefreshTimer(timer, autoCleanInterval(cfg))
		}
	}
}

// handleAutoCleanTimerTick 在 timer 到期时执行一轮自动清理：只有当前快照仍处于排程 revision
// 且已启用才删除，清理失败只记录日志，不影响后续调度。
func (s *Service) handleAutoCleanTimerTick(ctx context.Context, scheduledRevision uint64) {
	current, revision := s.autoCleanSnapshot()
	if revision != scheduledRevision || !current.Enabled {
		return
	}
	if err := s.runAutoCleanReauthRevision(ctx, current, revision); err != nil && ctx.Err() == nil {
		s.logger.Warn("account_auto_clean_failed", "error", err)
	}
}

// runAutoCleanReauth 保留给同包测试与维护调用；生产调度使用带 revision 的实现。
func (s *Service) runAutoCleanReauth(ctx context.Context, cfg AutoCleanConfig) error {
	_, revision := s.autoCleanSnapshot()
	return s.runAutoCleanReauthRevision(ctx, cfg, revision)
}

// autoCleanReauthStats 汇总一轮自动清理的扫描、删除与跳过计数。
type autoCleanReauthStats struct {
	scanned       int
	deleted       int
	skipped       int
	activeSkipped int
	scanBatches   int
	deleteBatches int
	limitReached  bool
	exhausted     bool
}

func (s *Service) runAutoCleanReauthRevision(ctx context.Context, cfg AutoCleanConfig, revision uint64) error {
	if !cfg.Enabled || !s.autoCleanRevisionCurrent(revision, cfg) {
		return nil
	}
	runCtx, cancel := context.WithTimeout(ctx, autoCleanReauthRunTimeout)
	defer cancel()
	release, skip, err := s.acquireAutoCleanReauthLock(runCtx)
	if err != nil {
		return err
	}
	if skip {
		return nil
	}
	if release != nil {
		defer release()
	}
	stats := autoCleanReauthStats{}
	if err := s.runAutoCleanReauthScan(runCtx, cfg, revision, s.now().Add(-cfg.MinAge), &stats); err != nil {
		return err
	}
	stats.limitReached = !stats.exhausted && (stats.scanBatches == autoCleanReauthMaxScans || stats.deleteBatches == autoCleanReauthMaxDeletes)
	if stats.deleted > 0 {
		s.invalidateBuildBotFlagCache()
	}
	if stats.scanned > 0 || stats.deleted > 0 || stats.skipped > 0 {
		s.logger.Info("auto_clean_reauth", "deleted", stats.deleted, "scanned", stats.scanned, "skipped", stats.skipped, "active_skipped", stats.activeSkipped, "scan_batches", stats.scanBatches, "delete_batches", stats.deleteBatches, "limit_reached", stats.limitReached, "min_age", cfg.MinAge.String(), "include_disabled", cfg.IncludeDisabled)
	}
	return nil
}

// acquireAutoCleanReauthLock 获取跨实例自动清理锁；skip 表示其他实例正在执行。
func (s *Service) acquireAutoCleanReauthLock(ctx context.Context) (func(), bool, error) {
	if s.refreshLock == nil {
		return nil, false, nil
	}
	release, acquired, err := s.refreshLock.Acquire(ctx, autoCleanReauthLockKey, autoCleanReauthLockTTL)
	if err != nil {
		return nil, false, err
	}
	if !acquired {
		s.logger.Debug("account_auto_clean_skipped", "reason", "lock_contended")
		return nil, true, nil
	}
	return release, false, nil
}

// runAutoCleanReauthScan 分批扫描并删除过期 reauthRequired 账号，直到批次上限或候选耗尽。
func (s *Service) runAutoCleanReauthScan(ctx context.Context, cfg AutoCleanConfig, revision uint64, markedBefore time.Time, stats *autoCleanReauthStats) error {
	var afterID uint64
	for stats.scanBatches < autoCleanReauthMaxScans && stats.deleteBatches < autoCleanReauthMaxDeletes {
		if !s.autoCleanRevisionCurrent(revision, cfg) {
			break
		}
		candidates, err := s.accounts.ListAutoCleanReauthCandidates(ctx, markedBefore, cfg.IncludeDisabled, afterID, autoCleanReauthBatchSize)
		if err != nil {
			s.logAutoCleanReauthPartial(stats, err)
			return err
		}
		if len(candidates) == 0 {
			stats.exhausted = true
			break
		}
		stats.scanBatches++
		stats.scanned += len(candidates)
		afterID = candidates[len(candidates)-1]
		deletable, active, err := s.excludeAccountsWithActiveLeases(ctx, candidates)
		if err != nil {
			return err
		}
		stats.activeSkipped += active
		stats.skipped += active
		if !s.autoCleanRevisionCurrent(revision, cfg) {
			break
		}
		if len(deletable) == 0 {
			if len(candidates) < autoCleanReauthBatchSize {
				stats.exhausted = true
				break
			}
			continue
		}
		stats.deleteBatches++
		if err := s.deleteAutoCleanReauthBatch(ctx, cfg, markedBefore, candidates, deletable, stats); err != nil {
			return err
		}
		if len(candidates) < autoCleanReauthBatchSize {
			stats.exhausted = true
			break
		}
	}
	return nil
}

// deleteAutoCleanReauthBatch 删除一批已确认无活跃租约的候选账号并清理其运行时状态。
func (s *Service) deleteAutoCleanReauthBatch(ctx context.Context, cfg AutoCleanConfig, markedBefore time.Time, candidates, deletable []uint64, stats *autoCleanReauthStats) error {
	ids, err := s.accounts.DeleteAutoCleanReauthCandidates(ctx, markedBefore, cfg.IncludeDisabled, deletable)
	if err != nil {
		s.logAutoCleanReauthPartial(stats, err)
		return err
	}
	stats.deleted += len(ids)
	stats.skipped += len(deletable) - len(ids)
	if len(ids) > 0 {
		s.logger.Debug("auto_clean_reauth_batch_deleted", "account_ids", ids)
		if failures, cleanupErr := s.clearDeletedAccountRuntimeState(ctx, ids); cleanupErr != nil {
			s.logger.Warn("auto_clean_reauth_runtime_cleanup_failed", "failures", failures, "error", cleanupErr)
		}
	}
	return nil
}

// logAutoCleanReauthPartial 在已有删除进展时记录部分失败，便于定位中断的批次。
func (s *Service) logAutoCleanReauthPartial(stats *autoCleanReauthStats, err error) {
	if stats.scanned > 0 || stats.deleted > 0 || stats.skipped > 0 {
		s.logger.Warn("auto_clean_reauth_partial", "deleted", stats.deleted, "scanned", stats.scanned, "skipped", stats.skipped, "error", err)
	}
}

func (s *Service) excludeAccountsWithActiveLeases(ctx context.Context, ids []uint64) ([]uint64, int, error) {
	if len(ids) == 0 || s.concurrency == nil {
		return append([]uint64(nil), ids...), 0, nil
	}
	keys := make([]string, len(ids))
	for index, id := range ids {
		keys[index] = repository.AccountConcurrencyKey(id)
	}
	values := make(map[string]int, len(keys))
	if reader, ok := s.concurrency.(repository.ConcurrencySnapshotReader); ok {
		current, err := reader.CurrentMany(ctx, keys)
		if err != nil {
			return nil, 0, err
		}
		values = current
	} else {
		for _, key := range keys {
			current, err := s.concurrency.Current(ctx, key)
			if err != nil {
				return nil, 0, err
			}
			values[key] = current
		}
	}
	deletable := make([]uint64, 0, len(ids))
	active := 0
	for index, id := range ids {
		if values[keys[index]] > 0 {
			active++
			continue
		}
		deletable = append(deletable, id)
	}
	return deletable, active, nil
}

func (s *Service) clearDeletedAccountRuntimeState(ctx context.Context, ids []uint64) (int, error) {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), autoCleanRuntimeWriteLimit)
	defer cancel()
	failures, firstErr := s.deleteStickyAccounts(cleanupCtx, ids)
	for _, id := range ids {
		s.clearRefreshState(id)
	}
	if failures == 0 {
		return 0, nil
	}
	return failures, fmt.Errorf("清理已删除账号的会话粘滞状态失败: %w", firstErr)
}
