package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/pkg/batch"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

const syncFailurePersistTimeout = 5 * time.Second

// Sync 从全部启用账号同步模型能力，并按 Provider 幂等更新公开路由表。
func (s *Service) Sync(ctx context.Context) (int, error) {
	return s.SyncObserved(ctx, nil)
}

// SyncObserved 执行全量模型同步，并按已完成账号数报告进度。
func (s *Service) SyncObserved(ctx context.Context, observer SyncProgressObserver) (int, error) {
	result := s.syncAll.DoChan("all", func() (any, error) {
		return s.syncAllAccounts(ctx, observer)
	})
	select {
	case <-ctx.Done():
		return 0, ctx.Err()
	case value := <-result:
		if value.Err != nil {
			return 0, value.Err
		}
		return value.Val.(int), nil
	}
}

func (s *Service) syncAllAccounts(ctx context.Context, observer SyncProgressObserver) (int, error) {
	if s.providers == nil {
		return 0, fmt.Errorf("Provider 注册表未初始化")
	}
	providerValues := s.providers.Providers()
	if len(providerValues) == 0 {
		return 0, fmt.Errorf("没有已注册的 Provider")
	}
	credentials, err := s.collectSyncCredentials(ctx, providerValues)
	if err != nil {
		return 0, err
	}
	if len(credentials) == 0 {
		return 0, fmt.Errorf("没有可用于模型同步的账号")
	}
	if observer != nil {
		observer(0, len(credentials))
	}
	results, runErr := s.runModelSyncBatch(ctx, credentials, observer)
	if runErr != nil {
		return 0, runErr
	}
	uniqueModels, succeeded, lastErr := s.aggregateSyncResults(results, credentials, providerValues)
	if succeeded == 0 {
		if lastErr != nil {
			return 0, lastErr
		}
		return 0, fmt.Errorf("没有账号成功同步模型")
	}
	return s.persistDiscoveredModels(ctx, providerValues, uniqueModels)
}

// collectSyncCredentials 按 Provider 顺序汇总全部启用账号凭据，任一 Provider 查询失败立即返回。
func (s *Service) collectSyncCredentials(ctx context.Context, providerValues []account.Provider) ([]account.Credential, error) {
	credentials := make([]account.Credential, 0)
	for _, providerValue := range providerValues {
		values, err := s.accounts.ListEnabled(ctx, providerValue)
		if err != nil {
			return nil, err
		}
		credentials = append(credentials, values...)
	}
	return credentials, nil
}

// runModelSyncBatch 在共享批量池中并发同步账号能力，并记录批量执行摘要。
func (s *Service) runModelSyncBatch(ctx context.Context, credentials []account.Credential, observer SyncProgressObserver) ([]batch.Result[[]string], error) {
	var completed atomic.Int64
	results, summary, runErr := batch.MapObserved(ctx, credentials, batch.Options{Workers: s.bulkPool.Limit(), Pool: s.bulkPool}, func(workCtx context.Context, value account.Credential) ([]string, error) {
		adapter, ok := s.providers.Models(value.Provider)
		if !ok {
			return nil, fmt.Errorf("Provider %s 未注册模型同步能力", value.Provider)
		}
		return s.syncAccountCapabilities(workCtx, value, adapter)
	}, func(_ int, _ batch.Result[[]string]) {
		if observer != nil {
			observer(int(completed.Add(1)), len(credentials))
		}
	})
	pool := s.bulkPool.Snapshot()
	s.logger.Info("model_bulk_sync_completed", "total", summary.Total, "submitted", summary.Submitted, "succeeded", summary.Succeeded, "failed", summary.Failed, "panicked", summary.Panicked, "duration_ms", summary.Duration.Milliseconds(), "canceled", summary.Canceled, "pool_limit", pool.Limit, "pool_active", pool.Active, "pool_queued", pool.Queued, "pool_peak", pool.Peak, "error", runErr)
	return results, runErr
}

// aggregateSyncResults 汇总各账号发现的上游模型并去重，同时统计成功数与最后一个失败原因。
func (s *Service) aggregateSyncResults(results []batch.Result[[]string], credentials []account.Credential, providerValues []account.Provider) (map[account.Provider]map[string]struct{}, int, error) {
	uniqueModels := make(map[account.Provider]map[string]struct{}, len(providerValues))
	succeeded := 0
	var lastErr error
	for index, result := range results {
		if result.Err != nil {
			var panicErr *batch.PanicError
			if errors.As(result.Err, &panicErr) {
				s.logger.Error("model_sync_panicked", "account_id", credentials[index].ID, "error", panicErr, "stack", string(panicErr.Stack))
			}
			lastErr = result.Err
			continue
		}
		succeeded++
		providerModels := uniqueModels[credentials[index].Provider]
		if providerModels == nil {
			providerModels = make(map[string]struct{})
			uniqueModels[credentials[index].Provider] = providerModels
		}
		for _, value := range result.Value {
			value = strings.TrimSpace(value)
			if value != "" {
				providerModels[value] = struct{}{}
			}
		}
	}
	return uniqueModels, succeeded, lastErr
}

// persistDiscoveredModels 按 Provider 幂等写入发现到的模型，并返回写入的模型条数。
func (s *Service) persistDiscoveredModels(ctx context.Context, providerValues []account.Provider, uniqueModels map[account.Provider]map[string]struct{}) (int, error) {
	syncedModels := 0
	for _, providerValue := range providerValues {
		providerModels := uniqueModels[providerValue]
		if len(providerModels) == 0 {
			continue
		}
		models := make([]string, 0, len(providerModels))
		for value := range providerModels {
			models = append(models, value)
		}
		if err := s.models.UpsertDiscovered(ctx, providerValue, models); err != nil {
			return 0, err
		}
		syncedModels += len(models)
	}
	return syncedModels, nil
}

// HasSuccessfulAccountSync 判断账号是否已有成功模型能力快照，不触发上游请求。
func (s *Service) HasSuccessfulAccountSync(ctx context.Context, accountID uint64) (bool, error) {
	return s.models.HasSuccessfulAccountSync(ctx, accountID)
}

// SyncAccount 只同步指定账号，并把该账号发现的模型合并到公开路由目录。
func (s *Service) SyncAccount(ctx context.Context, accountID uint64) (int, error) {
	credential, err := s.accounts.Get(ctx, accountID)
	if err != nil {
		return 0, err
	}
	adapter, ok := s.providers.Models(credential.Provider)
	if !ok {
		return 0, fmt.Errorf("Provider %s 未注册", credential.Provider)
	}
	models, err := s.syncAccountCapabilities(ctx, credential, adapter)
	if err != nil {
		return 0, err
	}
	if err := s.models.UpsertDiscovered(ctx, credential.Provider, models); err != nil {
		return 0, err
	}
	return len(models), nil
}

// SyncAccounts 使用共享同步池追赶指定账号的模型能力，不扩大为全量同步。
func (s *Service) SyncAccounts(ctx context.Context, accountIDs []uint64) (int, int, error) {
	ids, err := normalizeBatchIDs(accountIDs)
	if err != nil {
		return 0, 0, err
	}
	results, summary, runErr := batch.Map(ctx, ids, batch.Options{Workers: s.bulkPool.Limit(), Pool: s.bulkPool}, func(workCtx context.Context, id uint64) (int, error) {
		return s.SyncAccount(workCtx, id)
	})
	for index, result := range results {
		if result.Err == nil {
			continue
		}
		var panicErr *batch.PanicError
		if errors.As(result.Err, &panicErr) {
			s.logger.Error("model_startup_sync_panicked", "account_id", ids[index], "error", panicErr, "stack", string(panicErr.Stack))
		}
	}
	s.logger.Info("model_startup_sync_completed", "total", summary.Total, "succeeded", summary.Succeeded, "failed", summary.Failed, "canceled", summary.Canceled, "error", runErr)
	return summary.Succeeded, summary.Failed, runErr
}

func (s *Service) syncAccountCapabilities(ctx context.Context, value account.Credential, adapter provider.ModelCatalogAdapter) ([]string, error) {
	attemptedAt := time.Now().UTC()
	credential, err := s.account.EnsureCredential(ctx, value, false)
	if err != nil {
		s.markCapabilitySyncFailed(value.ID, attemptedAt, err)
		return nil, err
	}
	values, err := adapter.ListModels(ctx, credential)
	if err != nil {
		s.markCapabilitySyncFailed(credential.ID, attemptedAt, err)
		return nil, err
	}
	models := normalizeDiscoveredModels(values)
	if normalizer, ok := adapter.(provider.AccountModelCapabilityNormalizer); ok {
		var billing *account.Billing
		snapshot, billingErr := s.accounts.GetBilling(ctx, credential.ID)
		if billingErr == nil {
			billing = &snapshot
		} else if !errors.Is(billingErr, repository.ErrNotFound) {
			// Billing 不存在按 Unknown 处理；其他仓储错误保留失败语义。
			s.markCapabilitySyncFailed(credential.ID, attemptedAt, billingErr)
			return nil, billingErr
		}
		models = normalizeDiscoveredModels(normalizer.NormalizeAccountModelCapabilities(models, billing, credential))
	}
	if err := s.models.ReplaceAccountCapabilities(ctx, credential.ID, models, attemptedAt); err != nil {
		s.markCapabilitySyncFailed(credential.ID, attemptedAt, err)
		return nil, err
	}
	return models, nil
}

// markCapabilitySyncFailed 使用独立短超时保存失败状态，避免请求取消后丢失账号能力诊断信息。
func (s *Service) markCapabilitySyncFailed(accountID uint64, attemptedAt time.Time, cause error) {
	ctx, cancel := context.WithTimeout(context.Background(), syncFailurePersistTimeout)
	defer cancel()
	_ = s.models.MarkAccountCapabilitySyncFailed(ctx, accountID, attemptedAt, cause.Error())
}
