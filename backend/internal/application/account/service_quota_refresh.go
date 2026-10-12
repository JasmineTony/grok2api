package account

import (
	"context"
	"errors"
	"math/rand/v2"
	"strconv"
	"strings"
	"sync"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/pkg/batch"
	"github.com/chenyme/grok2api/backend/internal/pkg/perfmetrics"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// QueueQuotaRefresh asynchronously refreshes the remote quota window after a successful request.
func (s *Service) QueueQuotaRefresh(id uint64, mode string) {
	mode = strings.TrimSpace(mode)
	if isWebImagineQuotaMode(mode) {
		mode = accountdomain.QuotaGroupWebImagine
	}
	if id == 0 || (!isConsoleUsageQuotaMode(mode) && mode != "weekly" && mode != accountdomain.QuotaGroupWebImagine && !isWebChatQuotaMode(mode)) {
		return
	}
	key := strconv.FormatUint(id, 10) + ":" + mode
	s.quotaRefreshMu.Lock()
	state := s.quotaRefreshes[key]
	now := s.now().UTC()
	if state != nil && !state.pending && !state.queued && !state.running && !now.Before(state.nextAttemptAt) {
		delete(s.quotaRefreshes, key)
		state = nil
	}
	if state == nil {
		state = &quotaRefreshState{}
		s.quotaRefreshes[key] = state
	}
	state.generation++
	state.pending = true
	enqueued := state.queued || state.running || now.Before(state.nextAttemptAt) || s.enqueueQuotaRefreshLocked(quotaRefreshRequest{key: key, accountID: id, mode: mode}, state)
	s.quotaRefreshMu.Unlock()
	if !enqueued {
		perfmetrics.Default.Add("quota_refresh_events", perfmetrics.Labels{Subsystem: "quota", Stage: "enqueue", Outcome: "queue_full"}, 1)
		s.logger.Warn("quota_refresh_queue_full", "account_id", id, "mode", mode)
		s.wakeQuotaRefreshRecovery()
	}
}

func (s *Service) enqueueQuotaRefreshLocked(request quotaRefreshRequest, state *quotaRefreshState) bool {
	if state == nil || state.queued || state.running {
		return state != nil
	}
	select {
	case s.quotaRefreshQueue <- request:
		state.queued = true
		return true
	default:
		return false
	}
}

func (s *Service) wakeQuotaRefreshRecovery() {
	select {
	case s.quotaRefreshWake <- struct{}{}:
	default:
	}
}

// RunQuotaRefresh uses a fixed worker set to avoid unbounded goroutine creation.
func (s *Service) RunQuotaRefresh(ctx context.Context) {
	var workers sync.WaitGroup
	workers.Add(managedTaskWorkerCeiling + 1)
	for range managedTaskWorkerCeiling {
		go func() {
			defer workers.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case request := <-s.quotaRefreshQueue:
					s.processQuotaRefreshRequest(ctx, request)
				}
			}
		}()
	}
	go func() {
		defer workers.Done()
		s.runQuotaRefreshRecovery(ctx)
	}()
	workers.Wait()
}

// processQuotaRefreshRequest 领取一次队列请求执行刷新，失败时回退状态并记录。
func (s *Service) processQuotaRefreshRequest(ctx context.Context, request quotaRefreshRequest) {
	s.quotaRefreshMu.Lock()
	state := s.quotaRefreshes[request.key]
	if state == nil || state.running {
		s.quotaRefreshMu.Unlock()
		return
	}
	state.queued = false
	state.running = true
	state.pending = false
	s.quotaRefreshMu.Unlock()
	if err := batch.Do(ctx, func(workCtx context.Context) error {
		s.runQuotaRefresh(workCtx, request)
		return nil
	}); err != nil {
		s.recoverQuotaRefreshFailure(ctx, request, err)
	}
}

// recoverQuotaRefreshFailure 回退失败请求的排队状态，并按上下文与错误类型记录日志。
func (s *Service) recoverQuotaRefreshFailure(ctx context.Context, request quotaRefreshRequest, err error) {
	s.quotaRefreshMu.Lock()
	if state := s.quotaRefreshes[request.key]; state != nil {
		state.running = false
		state.pending = true
		state.failures++
		state.nextAttemptAt = s.now().UTC().Add(quotaRefreshRetryDelay(state.failures))
	}
	s.quotaRefreshMu.Unlock()
	s.wakeQuotaRefreshRecovery()
	if ctx.Err() != nil {
		return
	}
	var panicErr *batch.PanicError
	if errors.As(err, &panicErr) {
		s.logger.Error("quota_refresh_worker_panicked", "account_id", request.accountID, "mode", request.mode, "error", panicErr, "stack", string(panicErr.Stack))
		return
	}
	s.logger.Error("quota_refresh_worker_failed", "account_id", request.accountID, "mode", request.mode, "error", err)
}

// quotaRefreshOutcome 表示配额刷新单次迭代的阶段结论。
type quotaRefreshOutcome int

const (
	// quotaRefreshProceed 表示当前阶段正常结束，继续执行下一阶段。
	quotaRefreshProceed quotaRefreshOutcome = iota
	// quotaRefreshStop 表示本次刷新迭代已结束。
	quotaRefreshStop
	// quotaRefreshRestart 表示需要立即重新开始一次迭代。
	quotaRefreshRestart
)

// quotaRefreshIteration 记录单次配额刷新迭代的代数与模式快照。
type quotaRefreshIteration struct {
	request             quotaRefreshRequest
	localGeneration     uint64
	publishedGeneration uint64
	sharedGeneration    uint64
	sharedDirty         bool
	refreshMode         string
	consoleMode         bool
	skipUpstream        bool
}

func (s *Service) runQuotaRefresh(parent context.Context, request quotaRefreshRequest) {
	for s.runQuotaRefreshIteration(parent, request) {
	}
}

// runQuotaRefreshIteration 执行一次配额刷新迭代；返回 true 表示需要立即重新开始。
func (s *Service) runQuotaRefreshIteration(parent context.Context, request quotaRefreshRequest) bool {
	iteration, ok := s.beginQuotaRefreshIteration(request)
	if !ok {
		return false
	}
	ctx, cancel := context.WithTimeout(parent, quotaRefreshTimeout)
	if outcome := s.publishQuotaRefreshDirty(ctx, cancel, &iteration); outcome != quotaRefreshProceed {
		return outcome == quotaRefreshRestart
	}
	if outcome := s.resolveQuotaRefreshSharedGeneration(ctx, cancel, &iteration); outcome != quotaRefreshProceed {
		return outcome == quotaRefreshRestart
	}
	s.resolveQuotaRefreshMode(ctx, &iteration)
	if outcome := s.refreshQuotaUpstream(ctx, cancel, &iteration); outcome != quotaRefreshProceed {
		return outcome == quotaRefreshRestart
	}
	if outcome := s.resolveQuotaRefreshTrailing(parent, &iteration); outcome != quotaRefreshProceed {
		return outcome == quotaRefreshRestart
	}
	if outcome := s.clearQuotaRefreshDirty(parent, &iteration); outcome != quotaRefreshProceed {
		return outcome == quotaRefreshRestart
	}
	return s.finishQuotaRefreshIteration(&iteration) == quotaRefreshRestart
}

// beginQuotaRefreshIteration 读取账号模式的刷新状态快照；状态已被清理时返回 false。
func (s *Service) beginQuotaRefreshIteration(request quotaRefreshRequest) (quotaRefreshIteration, bool) {
	iteration := quotaRefreshIteration{request: request}
	s.quotaRefreshMu.Lock()
	defer s.quotaRefreshMu.Unlock()
	state := s.quotaRefreshes[request.key]
	if state == nil {
		return iteration, false
	}
	iteration.localGeneration = state.generation
	iteration.publishedGeneration = state.publishedGeneration
	iteration.sharedGeneration = state.sharedGeneration
	state.pending = false
	return iteration, true
}

// publishQuotaRefreshDirty 把本地未发布的代数写入共享脏标记，供其他实例接续刷新。
func (s *Service) publishQuotaRefreshDirty(ctx context.Context, cancel context.CancelFunc, iteration *quotaRefreshIteration) quotaRefreshOutcome {
	if s.quotaRefreshState == nil || iteration.publishedGeneration >= iteration.localGeneration {
		return quotaRefreshProceed
	}
	generation, err := s.quotaRefreshState.MarkQuotaRefreshDirty(ctx, iteration.request.accountID, iteration.request.mode, quotaRefreshDirtyTTL)
	if err != nil {
		cancel()
		s.deferQuotaRefresh(iteration.request.key)
		perfmetrics.Default.Add("quota_refresh_events", perfmetrics.Labels{Subsystem: "quota", Stage: "publish", Outcome: "failed"}, 1)
		s.logger.Warn("quota_refresh_dirty_publish_failed", "account_id", iteration.request.accountID, "mode", iteration.request.mode, "error", err)
		return quotaRefreshStop
	}
	iteration.sharedGeneration = generation
	s.quotaRefreshMu.Lock()
	if current := s.quotaRefreshes[iteration.request.key]; current != nil && current.publishedGeneration < iteration.localGeneration {
		current.publishedGeneration = iteration.localGeneration
		current.sharedGeneration = generation
	}
	s.quotaRefreshMu.Unlock()
	return quotaRefreshProceed
}

// resolveQuotaRefreshSharedGeneration 对齐共享代数；已被其他实例刷新完成时提前结束。
func (s *Service) resolveQuotaRefreshSharedGeneration(ctx context.Context, cancel context.CancelFunc, iteration *quotaRefreshIteration) quotaRefreshOutcome {
	if s.quotaRefreshState == nil || iteration.publishedGeneration < iteration.localGeneration || iteration.sharedGeneration <= 0 {
		return quotaRefreshProceed
	}
	generation, dirty, err := s.quotaRefreshState.QuotaRefreshGeneration(ctx, iteration.request.accountID, iteration.request.mode)
	if err != nil {
		cancel()
		s.deferQuotaRefresh(iteration.request.key)
		return quotaRefreshStop
	}
	if generation > iteration.sharedGeneration {
		iteration.sharedGeneration = generation
		s.quotaRefreshMu.Lock()
		if current := s.quotaRefreshes[iteration.request.key]; current != nil {
			current.sharedGeneration = generation
		}
		s.quotaRefreshMu.Unlock()
	}
	if !dirty && generation == iteration.sharedGeneration {
		cancel()
		s.quotaRefreshMu.Lock()
		if current := s.quotaRefreshes[iteration.request.key]; current != nil && current.generation == iteration.localGeneration {
			delete(s.quotaRefreshes, iteration.request.key)
		}
		s.quotaRefreshMu.Unlock()
		return quotaRefreshStop
	}
	return quotaRefreshProceed
}

// resolveQuotaRefreshMode 确定实际刷新的额度模式，并判断是否需要跳过上游探测。
func (s *Service) resolveQuotaRefreshMode(ctx context.Context, iteration *quotaRefreshIteration) {
	iteration.refreshMode = iteration.request.mode
	iteration.consoleMode = isConsoleUsageQuotaMode(iteration.request.mode)
	if windows, err := s.accounts.GetQuotaWindows(ctx, []uint64{iteration.request.accountID}); err == nil {
		s.applyQuotaRefreshWindowMode(iteration, windows[iteration.request.accountID])
	}
}

// applyQuotaRefreshWindowMode 依据已落库窗口决定跳过上游探测或改用 weekly 模式。
func (s *Service) applyQuotaRefreshWindowMode(iteration *quotaRefreshIteration, windows []accountdomain.QuotaWindow) {
	if iteration.consoleMode {
		for _, window := range windows {
			if window.Mode == iteration.request.mode && window.SyncedAt != nil && s.now().UTC().Sub(window.SyncedAt.UTC()) < consoleQuotaRefreshMinInterval {
				iteration.skipUpstream = true
				return
			}
		}
		return
	}
	if iteration.request.mode == accountdomain.QuotaGroupWebImagine {
		return
	}
	// Weekly remains a Grok Web capability. Console never inherits this
	// legacy mode and always refreshes its authoritative /usage snapshot.
	// Imagine 配额组走 /rest/media/imagine/quota_info，不可被改刷 weekly。
	for _, window := range windows {
		if window.Mode == "weekly" {
			iteration.refreshMode = "weekly"
			return
		}
	}
}

// refreshQuotaUpstream 串行化并执行上游额度刷新；失败时安排重试并结束本次迭代。
func (s *Service) refreshQuotaUpstream(ctx context.Context, cancel context.CancelFunc, iteration *quotaRefreshIteration) quotaRefreshOutcome {
	var refreshErr error
	acquired := true
	var release func()
	if !iteration.skipUpstream && s.refreshLock != nil {
		lockKey := "quota-refresh:" + strconv.FormatUint(iteration.request.accountID, 10) + ":" + iteration.refreshMode
		if iteration.consoleMode {
			// Every Console mode reads the same /usage snapshot. Serialize all
			// three kinds across instances to avoid duplicate upstream probes.
			lockKey = consoleQuotaRefreshLockKey(iteration.request.accountID)
		}
		release, acquired, refreshErr = s.refreshLock.Acquire(ctx, lockKey, quotaRefreshTimeout)
	}
	if !iteration.skipUpstream && refreshErr == nil && acquired {
		if err := s.syncPool.Do(ctx, func(workCtx context.Context) error {
			return s.syncQuotaRefreshUpstream(workCtx, iteration)
		}); err != nil {
			refreshErr = err
		}
	}
	if release != nil {
		release()
	}
	cancel()
	if refreshErr == nil && acquired {
		return quotaRefreshProceed
	}
	if refreshErr != nil && !errors.Is(refreshErr, context.Canceled) {
		s.logger.Warn("quota_refresh_failed", "account_id", iteration.request.accountID, "mode", iteration.refreshMode, "error", refreshErr)
	}
	s.deferQuotaRefresh(iteration.request.key)
	perfmetrics.Default.Add("quota_refresh_events", perfmetrics.Labels{Subsystem: "quota", Stage: "refresh", Outcome: "retry"}, 1)
	return quotaRefreshStop
}

// syncQuotaRefreshUpstream 刷新 Imagine 配额组或常规额度模式并回写窗口。
func (s *Service) syncQuotaRefreshUpstream(ctx context.Context, iteration *quotaRefreshIteration) error {
	if iteration.refreshMode != accountdomain.QuotaGroupWebImagine {
		_, err := s.RefreshQuotaMode(ctx, iteration.request.accountID, iteration.refreshMode)
		return err
	}
	refreshed, err := s.refreshQuotaGroup(ctx, iteration.request.accountID, iteration.refreshMode)
	if err != nil {
		return err
	}
	return s.reconcileQuotaGroupWindows(ctx, refreshed.Credential.Provider, iteration.request.accountID, refreshed.Modes, refreshed.Windows)
}

// resolveQuotaRefreshTrailing 读取共享代数并判断本次刷新期间是否出现新的变更。
func (s *Service) resolveQuotaRefreshTrailing(parent context.Context, iteration *quotaRefreshIteration) quotaRefreshOutcome {
	currentShared := iteration.sharedGeneration
	sharedDirty := s.quotaRefreshState != nil
	if s.quotaRefreshState != nil {
		generationCtx, generationCancel := context.WithTimeout(context.WithoutCancel(parent), 3*time.Second)
		generation, dirty, generationErr := s.quotaRefreshState.QuotaRefreshGeneration(generationCtx, iteration.request.accountID, iteration.request.mode)
		generationCancel()
		if generationErr != nil {
			s.deferQuotaRefresh(iteration.request.key)
			return quotaRefreshStop
		}
		currentShared, sharedDirty = generation, dirty
	}
	s.quotaRefreshMu.Lock()
	state := s.quotaRefreshes[iteration.request.key]
	localChanged := state != nil && state.generation != iteration.localGeneration
	s.quotaRefreshMu.Unlock()
	if !localChanged && (s.quotaRefreshState == nil || currentShared == iteration.sharedGeneration) {
		iteration.sharedDirty = sharedDirty
		return quotaRefreshProceed
	}
	perfmetrics.Default.Add("quota_refresh_events", perfmetrics.Labels{Subsystem: "quota", Stage: "refresh", Outcome: "trailing"}, 1)
	if iteration.consoleMode {
		s.deferSuccessfulQuotaRefresh(iteration.request.key, true)
		return quotaRefreshStop
	}
	return quotaRefreshRestart
}

// clearQuotaRefreshDirty 清除本实例已完成刷新对应的共享脏标记。
func (s *Service) clearQuotaRefreshDirty(parent context.Context, iteration *quotaRefreshIteration) quotaRefreshOutcome {
	if s.quotaRefreshState == nil || !iteration.sharedDirty {
		return quotaRefreshProceed
	}
	clearCtx, clearCancel := context.WithTimeout(context.WithoutCancel(parent), 3*time.Second)
	cleared, clearErr := s.quotaRefreshState.ClearQuotaRefreshDirty(clearCtx, iteration.request.accountID, iteration.request.mode, iteration.sharedGeneration)
	clearCancel()
	if clearErr == nil && cleared {
		return quotaRefreshProceed
	}
	if clearErr != nil {
		s.logger.Warn("quota_refresh_dirty_clear_failed", "account_id", iteration.request.accountID, "mode", iteration.request.mode, "error", clearErr)
	}
	if iteration.consoleMode {
		s.deferSuccessfulQuotaRefresh(iteration.request.key, true)
		return quotaRefreshStop
	}
	return quotaRefreshRestart
}

// finishQuotaRefreshIteration 收敛刷新成功后的状态；返回 quotaRefreshRestart 表示需要重新迭代。
func (s *Service) finishQuotaRefreshIteration(iteration *quotaRefreshIteration) quotaRefreshOutcome {
	s.quotaRefreshMu.Lock()
	state := s.quotaRefreshes[iteration.request.key]
	if state != nil && state.generation == iteration.localGeneration {
		if iteration.consoleMode {
			state.running = false
			state.pending = false
			state.failures = 0
			state.nextAttemptAt = s.now().UTC().Add(consoleQuotaRefreshMinInterval)
		} else {
			delete(s.quotaRefreshes, iteration.request.key)
		}
		s.quotaRefreshMu.Unlock()
		perfmetrics.Default.Add("quota_refresh_events", perfmetrics.Labels{Subsystem: "quota", Stage: "refresh", Outcome: "success"}, 1)
		return quotaRefreshStop
	}
	if iteration.consoleMode && state != nil {
		state.running = false
		state.pending = true
		state.failures = 0
		state.nextAttemptAt = s.now().UTC().Add(consoleQuotaRefreshMinInterval)
		s.quotaRefreshMu.Unlock()
		s.wakeQuotaRefreshRecovery()
		return quotaRefreshStop
	}
	s.quotaRefreshMu.Unlock()
	return quotaRefreshRestart
}

func (s *Service) deferQuotaRefresh(key string) {
	s.quotaRefreshMu.Lock()
	if state := s.quotaRefreshes[key]; state != nil {
		state.running = false
		state.pending = true
		state.failures++
		state.nextAttemptAt = s.now().UTC().Add(quotaRefreshRetryDelay(state.failures))
	}
	s.quotaRefreshMu.Unlock()
	s.wakeQuotaRefreshRecovery()
}

func (s *Service) deferSuccessfulQuotaRefresh(key string, pending bool) {
	s.quotaRefreshMu.Lock()
	if state := s.quotaRefreshes[key]; state != nil {
		state.running = false
		state.pending = pending
		state.failures = 0
		state.nextAttemptAt = s.now().UTC().Add(consoleQuotaRefreshMinInterval)
	}
	s.quotaRefreshMu.Unlock()
	s.wakeQuotaRefreshRecovery()
}

func quotaRefreshRetryDelay(failures int) time.Duration {
	if failures < 1 {
		failures = 1
	}
	shift := min(failures-1, 6)
	delay := quotaRefreshBackoffBase * time.Duration(1<<shift)
	if delay > quotaRefreshBackoffMax {
		delay = quotaRefreshBackoffMax
	}
	// Equal jitter keeps retries bounded away from zero while preventing a
	// shared upstream outage from synchronizing every account worker.
	half := delay / 2
	if half <= 0 {
		return delay
	}
	return half + time.Duration(rand.Int64N(int64(half)+1))
}

func (s *Service) runQuotaRefreshRecovery(ctx context.Context) {
	retryTicker := time.NewTicker(quotaRefreshPollInterval)
	sharedTicker := time.NewTicker(quotaRefreshSharedPoll)
	defer retryTicker.Stop()
	defer sharedTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.quotaRefreshWake:
			s.requeueQuotaRefreshes()
		case <-retryTicker.C:
			s.requeueQuotaRefreshes()
		case now := <-sharedTicker.C:
			s.recoverSharedQuotaRefreshes(ctx, now.UTC())
			s.requeueQuotaRefreshes()
		}
	}
}

func (s *Service) requeueQuotaRefreshes() {
	now := s.now().UTC()
	s.quotaRefreshMu.Lock()
	for key, state := range s.quotaRefreshes {
		if state == nil {
			delete(s.quotaRefreshes, key)
			continue
		}
		if !state.pending {
			if !state.queued && !state.running && !now.Before(state.nextAttemptAt) {
				delete(s.quotaRefreshes, key)
			}
			continue
		}
		if state.queued || state.running || now.Before(state.nextAttemptAt) {
			continue
		}
		separator := strings.IndexByte(key, ':')
		if separator <= 0 || separator == len(key)-1 {
			continue
		}
		accountID, err := strconv.ParseUint(key[:separator], 10, 64)
		if err != nil {
			continue
		}
		if !s.enqueueQuotaRefreshLocked(quotaRefreshRequest{key: key, accountID: accountID, mode: key[separator+1:]}, state) {
			break
		}
	}
	s.quotaRefreshMu.Unlock()
}

func (s *Service) recoverSharedQuotaRefreshes(parent context.Context, now time.Time) {
	if s.quotaRefreshState == nil {
		return
	}
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	values, err := s.quotaRefreshState.ListQuotaRefreshDirty(ctx, now, 100)
	cancel()
	if err != nil {
		s.logger.Warn("quota_refresh_dirty_list_failed", "error", err)
		return
	}
	s.quotaRefreshMu.Lock()
	for _, value := range values {
		key := strconv.FormatUint(value.AccountID, 10) + ":" + value.Mode
		state := s.quotaRefreshes[key]
		if state == nil {
			state = &quotaRefreshState{generation: 1, publishedGeneration: 1, sharedGeneration: value.Generation, pending: true}
			s.quotaRefreshes[key] = state
		} else {
			if value.Generation > state.sharedGeneration {
				state.sharedGeneration = value.Generation
			}
			state.pending = true
		}
		if !state.queued && !state.running && !now.Before(state.nextAttemptAt) && !s.enqueueQuotaRefreshLocked(quotaRefreshRequest{key: key, accountID: value.AccountID, mode: value.Mode}, state) {
			break
		}
	}
	s.quotaRefreshMu.Unlock()
}

func (s *Service) ListDueWebQuotaWindows(ctx context.Context, now time.Time, limit int) ([]accountdomain.QuotaWindow, error) {
	windows, err := s.ListDueQuotaWindows(ctx, now, limit)
	if err != nil {
		return nil, err
	}
	result := make([]accountdomain.QuotaWindow, 0, len(windows))
	for _, window := range windows {
		credential, getErr := s.accounts.Get(ctx, window.AccountID)
		if errors.Is(getErr, repository.ErrNotFound) {
			continue
		}
		if getErr != nil {
			return nil, getErr
		}
		if credential.Provider == accountdomain.ProviderWeb {
			result = append(result, window)
		}
	}
	return result, nil
}

func (s *Service) ListDueQuotaWindows(ctx context.Context, now time.Time, limit int) ([]accountdomain.QuotaWindow, error) {
	return s.accounts.ListDueQuotaWindows(ctx, now, limit)
}

func isWebChatQuotaMode(mode string) bool {
	switch mode {
	case "auto", "fast", "expert", "heavy":
		return true
	default:
		return false
	}
}

func isConsoleUsageQuotaMode(mode string) bool {
	switch mode {
	case "console", "console_image", "console_video":
		return true
	default:
		return false
	}
}

func isWebImagineQuotaMode(mode string) bool {
	return accountdomain.IsWebImagineQuotaMode(mode)
}

func quotaWindowControlsRouting(providerValue accountdomain.Provider, mode string) bool {
	return providerValue != accountdomain.ProviderConsole || isConsoleUsageQuotaMode(mode)
}
