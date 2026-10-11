package accountsync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/pkg/batch"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
	"golang.org/x/sync/singleflight"
)

const (
	defaultWorkerCount = 25
	operationTimeout   = 2 * time.Minute
)

type billingSynchronizer interface {
	HasBillingSnapshot(ctx context.Context, accountID uint64) (bool, error)
	RefreshBilling(ctx context.Context, accountID uint64) (accountdomain.Billing, error)
}

type modelSynchronizer interface {
	HasSuccessfulAccountSync(ctx context.Context, accountID uint64) (bool, error)
	SyncAccount(ctx context.Context, accountID uint64) (int, error)
}

type accountReader interface {
	Get(ctx context.Context, id uint64) (accountapp.View, error)
}

type providerPolicy interface {
	ProviderDefinition(value accountdomain.Provider) (provider.Definition, bool)
}

type quotaSynchronizer interface {
	HasQuotaWindows(ctx context.Context, accountID uint64) (bool, error)
	RefreshQuota(ctx context.Context, accountID uint64) ([]accountdomain.QuotaWindow, error)
}

type identitySynchronizer interface {
	SyncAccountIdentity(ctx context.Context, accountID uint64) error
}

// Service 对新接入账号执行一次性额度与模型补齐，并限制批量同步并发。
type Service struct {
	logger   *slog.Logger
	accounts accountReader
	billing  billingSynchronizer
	quota    quotaSynchronizer
	models   modelSynchronizer
	syncs    singleflight.Group
	workers  atomic.Int64
	bulkPool *batch.Pool
}

func NewService(logger *slog.Logger, accounts accountReader, billing billingSynchronizer, quota quotaSynchronizer, models modelSynchronizer) *Service {
	service := &Service{logger: logger, accounts: accounts, billing: billing, quota: quota, models: models, bulkPool: batch.NewPool(defaultWorkerCount)}
	service.workers.Store(defaultWorkerCount)
	return service
}

func (s *Service) SetBulkPool(pool *batch.Pool) {
	if pool != nil {
		s.bulkPool = pool
	}
}

func (s *Service) UpdateConcurrency(value int) {
	if value < 1 {
		value = defaultWorkerCount
	}
	s.workers.Store(int64(value))
	s.bulkPool.UpdateLimit(value)
}

// SyncModels 强制刷新指定账号的模型能力，不受初始同步快照跳过规则影响。
func (s *Service) SyncModels(ctx context.Context, accountID uint64) error {
	if accountID == 0 {
		return errors.New("账号 ID 无效")
	}
	if s.models == nil {
		return errors.New("模型同步器未初始化")
	}
	operationCtx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	_, err := s.models.SyncAccount(operationCtx, accountID)
	if err != nil {
		s.logger.Warn("account_model_sync_failed", "account_id", accountID, "error", err)
		return fmt.Errorf("同步模型: %w", err)
	}
	return nil
}

// Result 汇总本次初始同步成功与失败的账号数。
type Result struct {
	Succeeded int
	Failed    int
}

// Sync 等待本次涉及的账号完成额度与模型补齐；已同步数据会跳过，同账号并发请求会合并。
func (s *Service) Sync(ctx context.Context, accountIDs ...uint64) Result {
	input := make(chan uint64, len(accountIDs))
	for _, accountID := range accountIDs {
		input <- accountID
	}
	close(input)
	return s.SyncStream(ctx, input)
}

// SyncStream 以固定 Worker 数消费持续到达的账号，使导入与上游同步形成有界流水线。
func (s *Service) SyncStream(ctx context.Context, accountIDs <-chan uint64) Result {
	return s.syncStream(ctx, accountIDs, nil)
}

// SyncStreamObserved 在每个去重账号完成初始同步后报告进度。
func (s *Service) SyncStreamObserved(ctx context.Context, accountIDs <-chan uint64, observer func(completed, total int)) Result {
	return s.syncStream(ctx, accountIDs, observer)
}

// syncProgress 汇总一次流式同步的账号计数与进度回调。
type syncProgress struct {
	succeeded atomic.Int64
	failed    atomic.Int64
	total     atomic.Int64
	mu        sync.Mutex
	completed int
}

// report 在账号完成后推进进度；未注册观察者时不计数。
func (p *syncProgress) report(observer func(completed, total int)) {
	if observer == nil {
		return
	}
	p.mu.Lock()
	p.completed++
	observer(p.completed, int(p.total.Load()))
	p.mu.Unlock()
}

func (s *Service) syncStream(ctx context.Context, accountIDs <-chan uint64, observer func(completed, total int)) Result {
	jobs := make(chan uint64)
	progress := &syncProgress{}
	var workers sync.WaitGroup
	count := max(1, int(s.workers.Load()))
	workers.Add(count)
	for range count {
		go func() {
			defer workers.Done()
			s.syncWorker(ctx, jobs, progress, observer)
		}()
	}
	s.dispatchSyncJobs(ctx, accountIDs, jobs, progress)
	close(jobs)
	workers.Wait()
	return Result{Succeeded: int(progress.succeeded.Load()), Failed: int(progress.failed.Load())}
}

func (s *Service) syncWorker(ctx context.Context, jobs <-chan uint64, progress *syncProgress, observer func(completed, total int)) {
	for accountID := range jobs {
		if s.syncAccountInPool(ctx, accountID) {
			progress.succeeded.Add(1)
		} else {
			progress.failed.Add(1)
		}
		progress.report(observer)
	}
}

// syncAccountInPool 在受限并发池内同步单个账号，池内 panic 已转为错误返回。
func (s *Service) syncAccountInPool(ctx context.Context, accountID uint64) bool {
	err := s.bulkPool.Do(ctx, func(workCtx context.Context) error {
		_, syncErr, _ := s.syncs.Do(strconv.FormatUint(accountID, 10), func() (any, error) {
			return nil, s.syncAccount(workCtx, accountID)
		})
		return syncErr
	})
	if err == nil {
		return true
	}
	var panicErr *batch.PanicError
	if errors.As(err, &panicErr) {
		s.logger.Error("account_initial_sync_panicked", "account_id", accountID, "error", panicErr, "stack", string(panicErr.Stack))
	}
	return false
}

// dispatchSyncJobs 去重后把账号送入作业通道；ctx 取消或输入关闭时停止投递。
func (s *Service) dispatchSyncJobs(ctx context.Context, accountIDs <-chan uint64, jobs chan<- uint64, progress *syncProgress) {
	seen := make(map[uint64]struct{})
sendLoop:
	for {
		select {
		case <-ctx.Done():
			break sendLoop
		case accountID, ok := <-accountIDs:
			if !ok {
				break sendLoop
			}
			if accountID == 0 {
				continue
			}
			if _, exists := seen[accountID]; exists {
				continue
			}
			seen[accountID] = struct{}{}
			progress.total.Add(1)
			select {
			case jobs <- accountID:
			case <-ctx.Done():
				break sendLoop
			}
		}
	}
}

func (s *Service) syncAccount(ctx context.Context, accountID uint64) error {
	view, err := s.accounts.Get(ctx, accountID)
	if err != nil {
		return fmt.Errorf("读取账号: %w", err)
	}
	policy, ok := s.accounts.(providerPolicy)
	if !ok {
		return fmt.Errorf("账号读取器未提供 Provider 生命周期策略")
	}
	definition, ok := policy.ProviderDefinition(view.Credential.Provider)
	if !ok {
		return fmt.Errorf("Provider %s 未注册生命周期策略", view.Credential.Provider)
	}
	if err := s.syncAccountIdentity(ctx, accountID, view.Credential.Provider); err != nil {
		return err
	}
	billingSnapshotCreated, syncErr := s.syncAccountUsage(ctx, accountID, definition)
	hasModels, err := s.models.HasSuccessfulAccountSync(ctx, accountID)
	if err != nil {
		s.logger.Warn("account_initial_model_check_failed", "account_id", accountID, "error", err)
		return errors.Join(syncErr, fmt.Errorf("检查模型快照: %w", err))
	}
	if hasModels && !billingSnapshotCreated {
		return syncErr
	}
	operationCtx, cancel := context.WithTimeout(ctx, operationTimeout)
	_, err = s.models.SyncAccount(operationCtx, accountID)
	cancel()
	if err != nil {
		s.logger.Warn("account_initial_model_sync_failed", "account_id", accountID, "error", err)
		syncErr = errors.Join(syncErr, fmt.Errorf("同步模型: %w", err))
	}
	return syncErr
}

// syncAccountIdentity 尽力同步 Web/Console 账号身份；未授权错误需要中断后续同步。
func (s *Service) syncAccountIdentity(ctx context.Context, accountID uint64, providerID accountdomain.Provider) error {
	if providerID != accountdomain.ProviderWeb && providerID != accountdomain.ProviderConsole {
		return nil
	}
	identity, ok := s.accounts.(identitySynchronizer)
	if !ok {
		return nil
	}
	operationCtx, cancel := context.WithTimeout(ctx, operationTimeout)
	identityErr := identity.SyncAccountIdentity(operationCtx, accountID)
	if identityErr != nil {
		s.logger.Warn("account_initial_identity_sync_failed", "account_id", accountID, "error", identityErr)
	}
	cancel()
	if errors.Is(identityErr, provider.ErrUnauthorized) {
		return fmt.Errorf("同步账号身份: %w", identityErr)
	}
	return nil
}

// syncAccountUsage 按 Provider 声明的额度类型补齐额度快照，返回是否新建了计费快照。
func (s *Service) syncAccountUsage(ctx context.Context, accountID uint64, definition provider.Definition) (bool, error) {
	var syncErr error
	billingSnapshotCreated := false
	if definition.Quota == provider.QuotaRemoteWindow || definition.Quota == provider.QuotaLocalWindow {
		hasQuota, quotaErr := s.quota.HasQuotaWindows(ctx, accountID)
		if quotaErr != nil {
			syncErr = errors.Join(syncErr, fmt.Errorf("检查 Provider 额度快照: %w", quotaErr))
		} else if !hasQuota {
			operationCtx, cancel := context.WithTimeout(ctx, operationTimeout)
			_, quotaErr = s.quota.RefreshQuota(operationCtx, accountID)
			cancel()
			if quotaErr != nil {
				syncErr = errors.Join(syncErr, fmt.Errorf("同步 Provider 额度: %w", quotaErr))
			}
		}
	} else {
		hasBilling, err := s.billing.HasBillingSnapshot(ctx, accountID)
		if err != nil {
			s.logger.Warn("account_initial_billing_check_failed", "account_id", accountID, "error", err)
			syncErr = errors.Join(syncErr, fmt.Errorf("检查额度快照: %w", err))
		} else if !hasBilling {
			operationCtx, cancel := context.WithTimeout(ctx, operationTimeout)
			_, err = s.billing.RefreshBilling(operationCtx, accountID)
			cancel()
			if err != nil {
				s.logger.Warn("account_initial_billing_sync_failed", "account_id", accountID, "error", err)
				syncErr = errors.Join(syncErr, fmt.Errorf("同步额度: %w", err))
			} else {
				billingSnapshotCreated = true
			}
		}
	}
	return billingSnapshotCreated, syncErr
}
