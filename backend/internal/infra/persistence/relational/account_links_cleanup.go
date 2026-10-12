package relational

import (
	"context"
	"fmt"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// DeleteAccountStatusBatchWithLinked selects at most limit roots by state and ID cursor,
// expands links, skips active-media groups, and returns the candidate count and next cursor.
func (r *AccountRepository) DeleteAccountStatusBatchWithLinked(ctx context.Context, providerValue account.Provider, status string, now time.Time, afterID uint64, limit int, targets []account.Provider) (repository.LinkedDeleteOutcome, int, uint64, error) {
	outcome := repository.LinkedDeleteOutcome{
		Resolution:              repository.LinkedDeleteResolution{LinkedByProvider: map[account.Provider]int{}},
		LinkedDeletedByProvider: map[account.Provider]int64{},
	}
	if limit < 1 {
		return outcome, 0, afterID, nil
	}
	if status != "disabled" && status != "reauthRequired" && status != "cooldown" {
		return outcome, 0, afterID, fmt.Errorf("不支持清理账号状态 %q", status)
	}
	candidateCount := 0
	maxCandidateID := afterID
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAccountLinkMutation(tx); err != nil {
			return err
		}
		// Select, filter, and lock roots in one query to revalidate state inside the batch.
		selection := applyAccountStatusFilter(
			tx.Model(&accountModel{}).Clauses(clause.Locking{Strength: "UPDATE"}).Where("provider = ?", providerValue),
			status, now,
		)
		if afterID > 0 {
			selection = selection.Where("id > ?", afterID)
		}
		var candidates []uint64
		if err := selection.Order("id ASC").Limit(limit).Pluck("id", &candidates).Error; err != nil {
			return err
		}
		if len(candidates) == 0 {
			return nil
		}
		candidateCount = len(candidates)
		maxCandidateID = candidates[len(candidates)-1]
		inner, err := deleteLinkedGroupsTx(tx, providerValue, candidates, targets, true)
		if err != nil {
			return err
		}
		outcome = inner
		return nil
	})
	if err != nil {
		return repository.LinkedDeleteOutcome{}, 0, afterID, err
	}
	if outcome.Deleted > 0 {
		// Linked deletion crosses providers, so invalidate all candidate caches.
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged})
	}
	return outcome, candidateCount, maxCandidateID, nil
}

// CountCleanupWithLinked computes preview counts without materializing account IDs.
// Cleanup states are disjoint; linked counts use indexed subqueries and joins for two-hop paths.
func (r *AccountRepository) CountCleanupWithLinked(ctx context.Context, providerValue account.Provider, statuses []string, now time.Time, targets []account.Provider) (repository.CleanupPreview, error) {
	preview := repository.CleanupPreview{
		RootsByStatus:    map[string]int64{},
		LinkedByProvider: map[account.Provider]int64{},
	}
	if !providerValue.IsValid() {
		return preview, fmt.Errorf("账号来源无效")
	}
	db := r.db.db.WithContext(ctx)
	for _, status := range statuses {
		if err := accumulateCleanupStatusCounts(db, providerValue, status, now, targets, &preview); err != nil {
			return preview, err
		}
	}
	preview.Total = preview.RootCount
	for _, linked := range preview.LinkedByProvider {
		preview.Total += linked
	}
	return preview, nil
}

// accumulateCleanupStatusCounts 统计单个清理状态的根账号数，并累加各目标号池的关联账号数。
func accumulateCleanupStatusCounts(db *gorm.DB, providerValue account.Provider, status string, now time.Time, targets []account.Provider, preview *repository.CleanupPreview) error {
	if status != "disabled" && status != "reauthRequired" && status != "cooldown" {
		return fmt.Errorf("不支持清理账号状态 %q", status)
	}
	var rootCount int64
	if err := applyAccountStatusFilter(
		db.Session(&gorm.Session{NewDB: true}).Model(&accountModel{}).Where("provider = ?", providerValue),
		status, now,
	).Count(&rootCount).Error; err != nil {
		return err
	}
	preview.RootsByStatus[status] = rootCount
	preview.RootCount += rootCount

	rootsSub := func() *gorm.DB {
		return cleanupRootIDsQuery(db, providerValue, status, now)
	}
	for _, target := range targets {
		if !target.IsValid() || target == providerValue {
			return fmt.Errorf("关联删除目标无效")
		}
		linked, err := countLinkedCleanupRows(db, providerValue, target, rootsSub)
		if err != nil {
			return err
		}
		preview.LinkedByProvider[target] += linked
	}
	return nil
}

// cleanupRootIDsQuery 构造命中清理状态的根账号 ID 子查询。
func cleanupRootIDsQuery(db *gorm.DB, providerValue account.Provider, status string, now time.Time) *gorm.DB {
	return applyAccountStatusFilter(
		db.Session(&gorm.Session{NewDB: true}).Model(&accountModel{}).Select("id").Where("provider = ?", providerValue),
		status, now,
	)
}

// countLinkedCleanupRows 按根号池到目标号池的固定关联路径统计关联账号数。
func countLinkedCleanupRows(db *gorm.DB, providerValue account.Provider, target account.Provider, rootsSub func() *gorm.DB) (int64, error) {
	var linked int64
	var err error
	switch {
	case providerValue == account.ProviderWeb && target == account.ProviderBuild:
		err = db.Session(&gorm.Session{NewDB: true}).Table("account_provider_links").
			Where("web_account_id IN (?)", rootsSub()).Count(&linked).Error
	case providerValue == account.ProviderWeb && target == account.ProviderConsole:
		err = db.Session(&gorm.Session{NewDB: true}).Table("web_console_account_links").
			Where("web_account_id IN (?)", rootsSub()).Count(&linked).Error
	case providerValue == account.ProviderBuild && target == account.ProviderWeb:
		err = db.Session(&gorm.Session{NewDB: true}).Table("account_provider_links").
			Where("build_account_id IN (?)", rootsSub()).Count(&linked).Error
	case providerValue == account.ProviderBuild && target == account.ProviderConsole:
		err = db.Session(&gorm.Session{NewDB: true}).Table("account_provider_links apl").
			Joins("JOIN web_console_account_links wcal ON wcal.web_account_id = apl.web_account_id").
			Where("apl.build_account_id IN (?)", rootsSub()).Count(&linked).Error
	case providerValue == account.ProviderConsole && target == account.ProviderWeb:
		err = db.Session(&gorm.Session{NewDB: true}).Table("web_console_account_links").
			Where("console_account_id IN (?)", rootsSub()).Count(&linked).Error
	case providerValue == account.ProviderConsole && target == account.ProviderBuild:
		err = db.Session(&gorm.Session{NewDB: true}).Table("web_console_account_links wcal").
			Joins("JOIN account_provider_links apl ON apl.web_account_id = wcal.web_account_id").
			Where("wcal.console_account_id IN (?)", rootsSub()).Count(&linked).Error
	default:
		return 0, fmt.Errorf("关联删除目标无效")
	}
	if err != nil {
		return 0, err
	}
	return linked, nil
}
