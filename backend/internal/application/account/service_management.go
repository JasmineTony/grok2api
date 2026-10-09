package account

import (
	"context"
	"slices"
	"strings"

	egressapp "github.com/chenyme/grok2api/backend/internal/application/egress"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// BatchUpdate 对同一号池的一组账号应用相同路由参数。
func (s *Service) BatchUpdate(ctx context.Context, providerValue accountdomain.Provider, ids []uint64, input UpdateInput) (int64, error) {
	ids, err := normalizeIDs(ids, maxBatchUpdateAccounts)
	if err != nil {
		return 0, err
	}
	if !providerValue.IsValid() {
		return 0, invalidInput("账号来源无效")
	}
	slices.Sort(ids)
	if input.MaxConcurrent != nil && (*input.MaxConcurrent < 1 || *input.MaxConcurrent > accountdomain.MaxConcurrent) {
		return 0, invalidInput("maxConcurrent 必须在 1 到 256 之间")
	}
	if input.MinimumRemaining != nil && *input.MinimumRemaining < 0 {
		return 0, invalidInput("minimumRemaining 不能小于零")
	}
	if input.Name != nil {
		return 0, invalidInput("批量更新不支持修改账号名称")
	}
	updated, err := s.accounts.UpdateMany(ctx, providerValue, ids, repository.AccountUpdates{Enabled: input.Enabled, Priority: input.Priority, MaxConcurrent: input.MaxConcurrent, MinimumRemaining: input.MinimumRemaining})
	if err != nil {
		return 0, mapRepositoryError(err)
	}
	if input.Enabled != nil && !*input.Enabled && s.sticky != nil {
		if batchDeleter, ok := s.sticky.(repository.StickySessionBatchDeleter); ok {
			_ = batchDeleter.DeleteByAccounts(ctx, ids)
		} else {
			for _, id := range ids {
				_ = s.sticky.DeleteByAccount(ctx, id)
			}
		}
	}
	return updated, nil
}

// AccountDeleteResult summarizes a single/batch delete with optional linked peers.
type AccountDeleteResult struct {
	Deleted           int64
	RootsDeleted      int64
	LinkedDeleted     int64
	Skipped           int64
	DeletedByProvider map[accountdomain.Provider]int64
}

// accountDeleteResultFromOutcome converts repository results using rows actually deleted.
func accountDeleteResultFromOutcome(providerValue accountdomain.Provider, outcome repository.LinkedDeleteOutcome) AccountDeleteResult {
	out := AccountDeleteResult{
		Deleted:           outcome.Deleted,
		RootsDeleted:      outcome.RootsDeleted,
		LinkedDeleted:     outcome.Deleted - outcome.RootsDeleted,
		Skipped:           int64(len(outcome.SkippedRoots)),
		DeletedByProvider: map[accountdomain.Provider]int64{},
	}
	if providerValue.IsValid() && outcome.RootsDeleted > 0 {
		out.DeletedByProvider[providerValue] = outcome.RootsDeleted
	}
	for provider, count := range outcome.LinkedDeletedByProvider {
		out.DeletedByProvider[provider] += count
	}
	return out
}

// deleteStickyAccounts uses the optional batch capability and falls back for custom stores.
func (s *Service) deleteStickyAccounts(ctx context.Context, accountIDs []uint64) (int, error) {
	if s.sticky == nil || len(accountIDs) == 0 {
		return 0, nil
	}
	if batchDeleter, ok := s.sticky.(repository.StickySessionBatchDeleter); ok {
		if err := batchDeleter.DeleteByAccounts(ctx, accountIDs); err != nil {
			return len(accountIDs), err
		}
		return 0, nil
	}
	failures := 0
	var firstErr error
	for _, id := range accountIDs {
		if err := s.sticky.DeleteByAccount(ctx, id); err != nil {
			failures++
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return failures, firstErr
}

// finishLinkedDelete clears runtime state after the database transaction commits.
func (s *Service) finishLinkedDelete(ctx context.Context, deletedIDs []uint64) {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), linkedDeleteRuntimeCleanupLimit)
	defer cancel()
	if failures, err := s.deleteStickyAccounts(cleanupCtx, deletedIDs); err != nil && s.logger != nil {
		s.logger.Warn("linked_account_runtime_cleanup_failed", "accounts", len(deletedIDs), "failures", failures, "error", err)
	}
	for _, id := range deletedIDs {
		s.clearRefreshState(id)
	}
}

// BatchDelete atomically removes roots and quota state without expanding linked accounts.
func (s *Service) BatchDelete(ctx context.Context, ids []uint64) (int64, error) {
	result, err := s.batchDeleteWithLinkedMode(ctx, accountdomain.Provider(""), ids, nil, true)
	return result.Deleted, err
}

// BatchDeleteWithLinked deletes root accounts and optional linked peers resolved from binding tables.
// Roots with active video jobs are skipped together with their linked group; other groups are deleted.
func (s *Service) BatchDeleteWithLinked(ctx context.Context, providerValue accountdomain.Provider, ids []uint64, targets []accountdomain.Provider) (AccountDeleteResult, error) {
	return s.batchDeleteWithLinkedMode(ctx, providerValue, ids, targets, true)
}

// batchDeleteWithLinkedMode is the shared atomic path; skipMedia selects reject-all or skip-group behavior.
func (s *Service) batchDeleteWithLinkedMode(ctx context.Context, providerValue accountdomain.Provider, ids []uint64, targets []accountdomain.Provider, skipMedia bool) (AccountDeleteResult, error) {
	var out AccountDeleteResult
	ids, err := normalizeBatchIDs(ids)
	if err != nil {
		return out, err
	}
	if len(ids) == 0 {
		return out, nil
	}
	if len(targets) > 0 && !providerValue.IsValid() {
		return out, invalidInput("账号来源无效")
	}
	// Atomic path: lock roots → expand links → lock final → media handling → delete.
	outcome, err := s.accounts.DeleteManyWithLinked(ctx, providerValue, ids, targets, skipMedia)
	if err != nil {
		return out, mapLinkedDeleteError(err)
	}
	s.finishLinkedDelete(ctx, outcome.DeletedIDs)
	if outcome.Deleted > 0 {
		s.invalidateBuildBotFlagCache()
	}
	return accountDeleteResultFromOutcome(providerValue, outcome), nil
}

// AccountsBelongToProvider 校验批量账号是否全部属于指定号池。
// 该校验只读取账号主表，避免详情页的额度、审计或关联查询影响批量操作。
func (s *Service) AccountsBelongToProvider(ctx context.Context, ids []uint64, providerValue accountdomain.Provider) (bool, error) {
	if !providerValue.IsValid() {
		return false, invalidInput("账号来源无效")
	}
	values, err := normalizeBatchIDs(ids)
	if err != nil {
		return false, err
	}
	count, err := s.accounts.CountProviderAccountsByIDs(ctx, providerValue, values)
	if err != nil {
		return false, err
	}
	return count == int64(len(values)), nil
}

// CleanupResult summarizes rows deleted and root groups skipped by one cleanup operation.
type CleanupResult struct {
	Deleted           int64
	RootsDeleted      int64
	LinkedDeleted     int64
	Skipped           int64
	DeletedByProvider map[accountdomain.Provider]int64
}

// validateCleanupSelection validates cleanup states and linked target providers.
func validateCleanupSelection(providerValue accountdomain.Provider, statuses []CleanupStatus, targets []accountdomain.Provider) (map[CleanupStatus]struct{}, error) {
	if !providerValue.IsValid() {
		return nil, invalidInput("账号来源无效")
	}
	selected := make(map[CleanupStatus]struct{}, len(statuses))
	for _, status := range statuses {
		switch status {
		case CleanupStatusCooldown, CleanupStatusDisabled, CleanupStatusReauthRequired:
			selected[status] = struct{}{}
		default:
			return nil, invalidInput("账号清理状态无效")
		}
	}
	if len(selected) == 0 {
		return nil, invalidInput("至少选择一种账号状态")
	}
	for _, target := range targets {
		if !target.IsValid() {
			return nil, invalidInput("关联删除目标无效")
		}
		if target == providerValue {
			return nil, invalidInput("关联删除目标不能包含当前号池")
		}
	}
	return selected, nil
}

// CleanupAccounts deletes accounts in selected admin states; healthy, waiting-reset, and probing accounts are excluded.
// Linked targets are resolved from binding tables regardless of peer state, and active-media groups are skipped whole.
// The ID cursor always advances, so skipped groups cannot stall a cleanup batch.
func (s *Service) CleanupAccounts(ctx context.Context, providerValue accountdomain.Provider, statuses []CleanupStatus, targets []accountdomain.Provider) (CleanupResult, error) {
	out := CleanupResult{DeletedByProvider: map[accountdomain.Provider]int64{}}
	selected, err := validateCleanupSelection(providerValue, statuses, targets)
	if err != nil {
		return out, err
	}

	const cleanupBatchSize = 500
	now := s.now()
	for _, status := range []CleanupStatus{CleanupStatusDisabled, CleanupStatusReauthRequired, CleanupStatusCooldown} {
		if _, ok := selected[status]; !ok {
			continue
		}
		var afterID uint64
		for {
			outcome, candidates, maxID, err := s.accounts.DeleteAccountStatusBatchWithLinked(ctx, providerValue, string(status), now, afterID, cleanupBatchSize, targets)
			if err != nil {
				return out, mapLinkedDeleteError(err)
			}
			s.finishLinkedDelete(ctx, outcome.DeletedIDs)
			out.Deleted += outcome.Deleted
			out.RootsDeleted += outcome.RootsDeleted
			out.LinkedDeleted += outcome.Deleted - outcome.RootsDeleted
			out.Skipped += int64(len(outcome.SkippedRoots))
			if outcome.RootsDeleted > 0 {
				out.DeletedByProvider[providerValue] += outcome.RootsDeleted
			}
			for provider, count := range outcome.LinkedDeletedByProvider {
				out.DeletedByProvider[provider] += count
			}
			if candidates < cleanupBatchSize {
				break
			}
			afterID = maxID
		}
	}
	if out.Deleted > 0 {
		s.invalidateBuildBotFlagCache()
	}
	return out, nil
}

// PreviewCleanup returns root and linked-peer counts for the cleanup confirmation dialog.
// The preview is informational; deletion revalidates state inside each transaction.
func (s *Service) PreviewCleanup(ctx context.Context, providerValue accountdomain.Provider, statuses []CleanupStatus, targets []accountdomain.Provider) (repository.CleanupPreview, error) {
	selected, err := validateCleanupSelection(providerValue, statuses, targets)
	if err != nil {
		return repository.CleanupPreview{}, err
	}
	raw := make([]string, 0, len(selected))
	for _, status := range []CleanupStatus{CleanupStatusDisabled, CleanupStatusReauthRequired, CleanupStatusCooldown} {
		if _, ok := selected[status]; ok {
			raw = append(raw, string(status))
		}
	}
	preview, err := s.accounts.CountCleanupWithLinked(ctx, providerValue, raw, s.now(), targets)
	if err != nil {
		return repository.CleanupPreview{}, mapLinkedDeleteError(err)
	}
	return preview, nil
}

func (s *Service) Update(ctx context.Context, id uint64, input UpdateInput) (View, error) {
	value, err := s.accounts.Get(ctx, id)
	if err != nil {
		return View{}, mapRepositoryError(err)
	}
	enabledChanged := input.Enabled != nil && value.Enabled != *input.Enabled
	if input.Name != nil {
		value.Name = strings.TrimSpace(*input.Name)
		if value.Name == "" {
			return View{}, invalidInput("账号名称不能为空")
		}
	}
	if input.Enabled != nil {
		value.Enabled = *input.Enabled
	}
	if input.Priority != nil {
		value.Priority = *input.Priority
	}
	if input.MaxConcurrent != nil {
		if *input.MaxConcurrent < 1 || *input.MaxConcurrent > accountdomain.MaxConcurrent {
			return View{}, invalidInput("maxConcurrent 必须在 1 到 256 之间")
		}
		value.MaxConcurrent = *input.MaxConcurrent
	}
	if input.MinimumRemaining != nil {
		if *input.MinimumRemaining < 0 {
			return View{}, invalidInput("minimumRemaining 不能小于零")
		}
		value.MinimumRemaining = *input.MinimumRemaining
	}
	if input.ClearCloudflareCookies {
		value.EncryptedCloudflareCookie = ""
	} else if input.CloudflareCookies != nil {
		if value.Provider == accountdomain.ProviderBuild {
			return View{}, invalidInput("Grok Build 账号不使用 Cloudflare Cookie")
		}
		if len(*input.CloudflareCookies) > 16<<10 {
			return View{}, invalidInput("Cloudflare Cookie 不能超过 16 KiB")
		}
		if strings.TrimSpace(*input.CloudflareCookies) != "" {
			cookies := egressapp.SanitizeCloudflareCookies(*input.CloudflareCookies)
			if cookies == "" {
				return View{}, invalidInput("Cloudflare Cookie 中没有有效字段")
			}
			encrypted, encryptErr := s.cipher.Encrypt(cookies)
			if encryptErr != nil {
				return View{}, encryptErr
			}
			value.EncryptedCloudflareCookie = encrypted
		}
	}
	if input.BuildSuperEntitled != nil {
		if value.Provider != accountdomain.ProviderBuild {
			return View{}, invalidInput("仅 Grok Build 账号支持设置 Build Super entitlement")
		}
		value.BuildSuperEntitled = *input.BuildSuperEntitled
	}
	if input.BuildRouteMode != nil {
		if value.Provider != accountdomain.ProviderBuild {
			return View{}, invalidInput("仅 Grok Build 账号支持设置上游地址")
		}
		if !input.BuildRouteMode.IsValid() {
			return View{}, invalidInput("Build 上游地址必须是 auto、build 或 xai")
		}
		value.BuildRouteMode = *input.BuildRouteMode
	}
	updated, err := s.accounts.Update(ctx, value)
	if err != nil {
		return View{}, mapRepositoryError(err)
	}
	if !updated.Enabled && s.sticky != nil {
		_ = s.sticky.DeleteByAccount(ctx, updated.ID)
	} else if updated.Enabled && s.providers != nil && s.providers.SupportsCredentialRefresh(updated.Provider) {
		s.WakeCredentialRefresh()
	}
	view, err := s.Get(ctx, updated.ID)
	if err != nil {
		return View{}, err
	}
	view.EnabledChanged = enabledChanged
	return view, nil
}

// ClearCooldown resets request-path health so a cooled account can be
// scheduled again. UpdateHealth publishes InvalidationAccountHealthChanged,
// which overwrites the selector memory overlay (runtimeStore=memory).
func (s *Service) ClearCooldown(ctx context.Context, id uint64) (View, error) {
	value, err := s.accounts.Get(ctx, id)
	if err != nil {
		return View{}, mapRepositoryError(err)
	}
	// missing_thinking is a durable quality strike, not a transient cooldown
	// error. Clearing the timer must not turn the next miss into another first
	// strike and bypass the second-miss disable policy.
	healthMarker := accountdomain.NormalizeHealthMarker(value.LastError)
	if err := s.accounts.UpdateHealth(ctx, value.ID, value.Provider, 0, nil, healthMarker, false); err != nil {
		return View{}, mapRepositoryError(err)
	}
	return s.Get(ctx, id)
}

// MarkBuildAPIFallback 幂等写入 Build 账号 XAI 推理回退标记；失败不吞掉，调用方可重试。
func (s *Service) MarkBuildAPIFallback(ctx context.Context, id uint64, enabled bool) error {
	return mapRepositoryError(s.accounts.MarkBuildAPIFallback(ctx, id, enabled))
}

func (s *Service) Delete(ctx context.Context, id uint64) error {
	// Single-account delete must preserve ErrNotFound when the root row is gone
	// (BatchDeleteWithLinked/DeleteMany return deleted=0, nil for missing IDs).
	result, err := s.DeleteWithLinked(ctx, accountdomain.Provider(""), id, nil)
	if err != nil {
		return err
	}
	if result.Deleted == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteWithLinked deletes one account and optional linked peers.
// A single delete is rejected if any account in the final group has an active video job.
func (s *Service) DeleteWithLinked(ctx context.Context, providerValue accountdomain.Provider, id uint64, targets []accountdomain.Provider) (AccountDeleteResult, error) {
	if id == 0 {
		return AccountDeleteResult{}, invalidInput("账号 ID 无效")
	}
	result, err := s.batchDeleteWithLinkedMode(ctx, providerValue, []uint64{id}, targets, false)
	if err != nil {
		return result, err
	}
	// Fail closed for the single-root API: missing root must not report success.
	if result.Deleted == 0 {
		return result, ErrNotFound
	}
	return result, nil
}

// PreviewLinkedDelete returns root/linked counts for the delete confirmation UI.
func (s *Service) PreviewLinkedDelete(ctx context.Context, providerValue accountdomain.Provider, ids []uint64, targets []accountdomain.Provider) (repository.LinkedDeleteResolution, error) {
	ids, err := normalizeBatchIDs(ids)
	if err != nil {
		return repository.LinkedDeleteResolution{}, err
	}
	if !providerValue.IsValid() {
		return repository.LinkedDeleteResolution{}, invalidInput("账号来源无效")
	}
	resolution, err := s.accounts.ResolveLinkedDeleteIDs(ctx, providerValue, ids, targets)
	if err != nil {
		return repository.LinkedDeleteResolution{}, mapLinkedDeleteError(err)
	}
	return resolution, nil
}
