package relational

import (
	"context"
	"fmt"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/media"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *AccountRepository) UpdateMany(ctx context.Context, providerValue account.Provider, ids []uint64, updates repository.AccountUpdates) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	values := make(map[string]any, 4)
	if updates.Enabled != nil {
		values["enabled"] = *updates.Enabled
	}
	if updates.Priority != nil {
		values["priority"] = *updates.Priority
	}
	if updates.MaxConcurrent != nil {
		values["max_concurrent"] = *updates.MaxConcurrent
	}
	if updates.MinimumRemaining != nil {
		values["minimum_remaining"] = *updates.MinimumRemaining
	}
	if len(values) == 0 {
		return 0, nil
	}
	var updated int64
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for start := 0; start < len(ids); start += accountUpdateBatchSize {
			end := min(start+accountUpdateBatchSize, len(ids))
			var rows []accountModel
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "provider").Where("id IN ?", ids[start:end]).Order("id ASC").Find(&rows).Error; err != nil {
				return err
			}
			if len(rows) != end-start {
				return repository.ErrAccountPoolMismatch
			}
			for _, row := range rows {
				if account.Provider(row.Provider) != providerValue {
					return repository.ErrAccountPoolMismatch
				}
			}
		}
		for start := 0; start < len(ids); start += accountUpdateBatchSize {
			end := min(start+accountUpdateBatchSize, len(ids))
			result := tx.Model(&accountModel{}).Where("provider = ? AND id IN ?", providerValue, ids[start:end]).Updates(values)
			if result.Error != nil {
				return result.Error
			}
			updated += result.RowsAffected
		}
		if providerValue == account.ProviderBuild && updates.Enabled != nil && !*updates.Enabled {
			if err := tx.Where("account_id IN ?", ids).Delete(&accountEgressLeaseBlockModel{}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	if updated > 0 {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged})
	}
	return updated, nil
}

// UpdateEgressBindings assigns one egress node to multiple accounts of one
// provider. A nil node clears the binding and restores normal pool selection.
func (r *AccountRepository) UpdateEgressBindings(ctx context.Context, providerValue account.Provider, ids []uint64, nodeID *uint64, mode account.EgressAssignmentMode, assignedAt time.Time) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	values := map[string]any{
		"egress_node_id": nodeID,
	}
	if nodeID == nil {
		values["egress_assignment_mode"] = ""
		values["egress_assigned_at"] = nil
	} else {
		values["egress_assignment_mode"] = string(mode)
		values["egress_assigned_at"] = assignedAt.UTC()
	}
	var updated int64
	var clearedLeaseBlocks int64
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&accountModel{}).Where("provider = ? AND id IN ?", providerValue, ids).Updates(values)
		if result.Error != nil {
			return result.Error
		}
		updated = result.RowsAffected
		if providerValue != account.ProviderBuild {
			return nil
		}
		query := tx.Where("account_id IN ?", ids)
		if nodeID != nil {
			query = query.Where("node_id <> ?", *nodeID)
		}
		deleted := query.Delete(&accountEgressLeaseBlockModel{})
		if deleted.Error != nil {
			return deleted.Error
		}
		clearedLeaseBlocks = deleted.RowsAffected
		return nil
	})
	if err == nil && clearedLeaseBlocks > 0 {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountEgressLeaseChanged, Provider: providerValue})
	}
	return updated, mapError(err)
}

// ListEgressAssignments returns all accounts for one provider with their
// binding metadata. It deliberately includes disabled accounts so capacity
// reporting reflects every account that reserves a proxy slot.
func (r *AccountRepository) ListEgressAssignments(ctx context.Context, providerValue account.Provider) ([]account.Credential, error) {
	var rows []accountModel
	if err := r.db.db.WithContext(ctx).Preload("Credential").Preload("WebProfile").
		Where("provider = ?", providerValue).Order("id ASC").Find(&rows).Error; err != nil {
		return nil, mapError(err)
	}
	values := make([]account.Credential, 0, len(rows))
	for _, row := range rows {
		values = append(values, toAccountDomain(row))
	}
	return values, nil
}

func (r *AccountRepository) ListEgressBindingProviders(ctx context.Context, nodeID uint64) ([]account.Provider, error) {
	if nodeID == 0 {
		return []account.Provider{}, nil
	}
	return r.listEgressBindingProviders(r.db.db.WithContext(ctx).Model(&accountModel{}).Where("egress_node_id = ?", nodeID))
}

func (r *AccountRepository) ListEgressSourceBindingProviders(ctx context.Context, sourceID uint64) ([]account.Provider, error) {
	if sourceID == 0 {
		return []account.Provider{}, nil
	}
	query := r.db.db.WithContext(ctx).Model(&accountModel{}).
		Joins("JOIN egress_nodes ON egress_nodes.id = provider_accounts.egress_node_id").
		Where("egress_nodes.source_id = ?", sourceID)
	return r.listEgressBindingProviders(query)
}

func (r *AccountRepository) listEgressBindingProviders(query *gorm.DB) ([]account.Provider, error) {
	var raw []string
	if err := query.Distinct("provider_accounts.provider").Order("provider_accounts.provider ASC").Pluck("provider_accounts.provider", &raw).Error; err != nil {
		return nil, mapError(err)
	}
	result := make([]account.Provider, 0, len(raw))
	for _, value := range raw {
		provider := account.Provider(value)
		if provider.IsValid() {
			result = append(result, provider)
		}
	}
	return result, nil
}

func (r *AccountRepository) Delete(ctx context.Context, id uint64) error {
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAccountLinkMutation(tx); err != nil {
			return err
		}
		var lockedID uint64
		if err := tx.Model(&accountModel{}).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Pluck("id", &lockedID).Error; err != nil {
			return err
		}
		if lockedID == 0 {
			return repository.ErrNotFound
		}
		if err := rejectAccountsWithMediaJobs(tx, []uint64{id}); err != nil {
			return err
		}
		return mapError(tx.Delete(&accountModel{}, id).Error)
	})
	if err == nil {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged})
	}
	return err
}

func (r *AccountRepository) DeleteMany(ctx context.Context, ids []uint64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var deleted int64
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAccountLinkMutation(tx); err != nil {
			return err
		}
		var lockedIDs []uint64
		if err := tx.Model(&accountModel{}).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ?", ids).Pluck("id", &lockedIDs).Error; err != nil {
			return err
		}
		if err := rejectAccountsWithMediaJobs(tx, lockedIDs); err != nil {
			return err
		}
		result := tx.Where("id IN ?", lockedIDs).Delete(&accountModel{})
		deleted = result.RowsAffected
		return result.Error
	})
	if err == nil && deleted > 0 {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged})
	}
	return deleted, err
}

func (r *AccountRepository) ListAutoCleanReauthCandidates(ctx context.Context, markedBefore time.Time, includeDisabled bool, afterID uint64, limit int) ([]uint64, error) {
	if limit < 1 {
		limit = 100
	}
	query := r.db.db.WithContext(ctx).Model(&accountModel{}).
		Select("id").
		Where("auth_status = ? AND reauth_marked_at IS NOT NULL AND reauth_marked_at < ?", account.AuthStatusReauthRequired, markedBefore.UTC()).
		Where(accountUnclassifiedRefreshReauthPredicate).
		Where("NOT EXISTS (SELECT 1 FROM media_jobs job WHERE job.account_id = provider_accounts.id AND job.status IN ?)", []string{string(media.StatusQueued), string(media.StatusInProgress)})
	if afterID > 0 {
		query = query.Where("id > ?", afterID)
	}
	if !includeDisabled {
		query = query.Where("enabled = ?", true)
	}
	var candidates []uint64
	err := query.Order("id ASC").Limit(limit).Pluck("id", &candidates).Error
	return candidates, err
}

func (r *AccountRepository) DeleteAutoCleanReauthCandidates(ctx context.Context, markedBefore time.Time, includeDisabled bool, candidateIDs []uint64) ([]uint64, error) {
	if len(candidateIDs) == 0 {
		return []uint64{}, nil
	}
	deletedIDs := make([]uint64, 0, len(candidateIDs))
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAccountLinkMutation(tx); err != nil {
			return err
		}
		deletable, err := excludeAccountsWithActiveMediaJobs(tx, candidateIDs)
		if err != nil {
			return err
		}
		if len(deletable) == 0 {
			return nil
		}

		var lockedIDs []uint64
		lockQuery := tx.Model(&accountModel{}).Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id IN ? AND auth_status = ? AND reauth_marked_at IS NOT NULL AND reauth_marked_at < ?", deletable, account.AuthStatusReauthRequired, markedBefore.UTC()).
			Where(accountUnclassifiedRefreshReauthPredicate)
		if !includeDisabled {
			lockQuery = lockQuery.Where("enabled = ?", true)
		}
		if err := lockQuery.Pluck("id", &lockedIDs).Error; err != nil {
			return err
		}
		// lock 后再过滤活动视频任务，避免 list 与 delete 之间的 TOCTOU。
		lockedIDs, err = excludeAccountsWithActiveMediaJobs(tx, lockedIDs)
		if err != nil {
			return err
		}
		if len(lockedIDs) == 0 {
			return nil
		}
		deletion := tx.Where("id IN ? AND auth_status = ? AND reauth_marked_at IS NOT NULL AND reauth_marked_at < ?", lockedIDs, account.AuthStatusReauthRequired, markedBefore.UTC()).
			Where(accountUnclassifiedRefreshReauthPredicate)
		if !includeDisabled {
			deletion = deletion.Where("enabled = ?", true)
		}
		result := deletion.Delete(&accountModel{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == int64(len(lockedIDs)) {
			deletedIDs = append(deletedIDs, lockedIDs...)
			return nil
		}
		var remaining []uint64
		if err := tx.Model(&accountModel{}).Where("id IN ?", lockedIDs).Pluck("id", &remaining).Error; err != nil {
			return err
		}
		remainingSet := make(map[uint64]struct{}, len(remaining))
		for _, id := range remaining {
			remainingSet[id] = struct{}{}
		}
		for _, id := range lockedIDs {
			if _, exists := remainingSet[id]; !exists {
				deletedIDs = append(deletedIDs, id)
			}
		}
		return nil
	})
	if err == nil && len(deletedIDs) > 0 {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged})
	}
	return deletedIDs, err
}

// excludeAccountsWithActiveMediaJobs 返回无 queued/in_progress 视频任务的账号 ID（顺序保持输入顺序）。
func excludeAccountsWithActiveMediaJobs(db *gorm.DB, ids []uint64) ([]uint64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var blocked []uint64
	if err := db.Model(&mediaJobModel{}).
		Distinct("account_id").
		Where("account_id IN ? AND status IN ?", ids, []string{string(media.StatusQueued), string(media.StatusInProgress)}).
		Pluck("account_id", &blocked).Error; err != nil {
		return nil, err
	}
	if len(blocked) == 0 {
		out := make([]uint64, len(ids))
		copy(out, ids)
		return out, nil
	}
	blockedSet := make(map[uint64]struct{}, len(blocked))
	for _, id := range blocked {
		blockedSet[id] = struct{}{}
	}
	out := make([]uint64, 0, len(ids)-len(blocked))
	for _, id := range ids {
		if _, skip := blockedSet[id]; skip {
			continue
		}
		out = append(out, id)
	}
	return out, nil
}

// activeMediaJobStatuses lists video states that still require the account and block deletion.
func activeMediaJobStatuses() []string {
	return []string{string(media.StatusQueued), string(media.StatusInProgress)}
}

// rejectAccountsWithMediaJobs 仅保护仍需账号继续执行的活动视频任务。
// completed/failed 已保存账号名称等快照，删除账号后由外键 SET NULL 保留历史。
func rejectAccountsWithMediaJobs(db *gorm.DB, ids []uint64) error {
	var count int64
	if err := db.Model(&mediaJobModel{}).
		Where("account_id IN ? AND status IN ?", ids, activeMediaJobStatuses()).
		Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("%w: 账号仍关联 %d 条排队中或进行中的视频任务，请等待任务结束后重试", repository.ErrConflict, count)
	}
	return nil
}
