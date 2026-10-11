package relational

import (
	"context"
	"fmt"
	"sort"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ResolveLinkedDeleteIDs expands root IDs with linked peers from binding tables only.
// Paths are fixed: Web↔Build and Web↔Console one hop; Build↔Console is two hops via Web
// without deleting the intermediate Web unless it is also a target/root.
// Preview path only — deletes must use DeleteManyWithLinked so resolve+delete share one transaction.
func (r *AccountRepository) ResolveLinkedDeleteIDs(ctx context.Context, providerValue account.Provider, rootIDs []uint64, targets []account.Provider) (repository.LinkedDeleteResolution, error) {
	return resolveLinkedDeleteIDs(r.db.db.WithContext(ctx), providerValue, rootIDs, targets)
}

// resolveLinkedDeleteIDs is the shared expander used by preview and by the delete transactions.
// It also returns RootGroups for group-level skips and PeerProviders for per-provider delete counts.
func resolveLinkedDeleteIDs(db *gorm.DB, providerValue account.Provider, rootIDs []uint64, targets []account.Provider) (repository.LinkedDeleteResolution, error) {
	result := repository.LinkedDeleteResolution{
		LinkedByProvider: map[account.Provider]int{},
		RootGroups:       map[uint64][]uint64{},
		PeerProviders:    map[uint64]account.Provider{},
	}
	if !providerValue.IsValid() {
		return result, fmt.Errorf("账号来源无效")
	}
	roots := uniqueSortedIDs(rootIDs)
	result.RootIDs = append([]uint64(nil), roots...)
	if len(roots) == 0 {
		result.FinalIDs = nil
		return result, nil
	}
	targetSet := make(map[account.Provider]struct{}, len(targets))
	for _, target := range targets {
		if !target.IsValid() {
			return result, fmt.Errorf("关联删除目标无效")
		}
		if target == providerValue {
			return result, fmt.Errorf("关联删除目标不能包含当前号池")
		}
		targetSet[target] = struct{}{}
	}
	if len(targetSet) == 0 {
		result.FinalIDs = append([]uint64(nil), roots...)
		return result, nil
	}

	finalSet := make(map[uint64]struct{}, len(roots)*2)
	for _, id := range roots {
		finalSet[id] = struct{}{}
	}
	linkedCounts := map[account.Provider]int{}
	addPairs := func(peerProvider account.Provider, pairs []accountLinkPair) {
		for _, pair := range pairs {
			if pair.RootID == 0 || pair.PeerID == 0 {
				continue
			}
			// Skip roots and peers already claimed by an earlier 1:1 group.
			if _, exists := finalSet[pair.PeerID]; exists {
				continue
			}
			finalSet[pair.PeerID] = struct{}{}
			linkedCounts[peerProvider]++
			result.RootGroups[pair.RootID] = append(result.RootGroups[pair.RootID], pair.PeerID)
			result.PeerProviders[pair.PeerID] = peerProvider
		}
	}

	switch providerValue {
	case account.ProviderWeb:
		if _, ok := targetSet[account.ProviderBuild]; ok {
			pairs, err := listWebBuildPairs(db, roots)
			if err != nil {
				return result, err
			}
			addPairs(account.ProviderBuild, pairs)
		}
		if _, ok := targetSet[account.ProviderConsole]; ok {
			pairs, err := listWebConsolePairs(db, roots)
			if err != nil {
				return result, err
			}
			addPairs(account.ProviderConsole, pairs)
		}
	case account.ProviderBuild:
		if _, ok := targetSet[account.ProviderWeb]; ok {
			pairs, err := listBuildWebPairs(db, roots)
			if err != nil {
				return result, err
			}
			addPairs(account.ProviderWeb, pairs)
		}
		if _, ok := targetSet[account.ProviderConsole]; ok {
			pairs, err := listBuildConsolePairs(db, roots)
			if err != nil {
				return result, err
			}
			addPairs(account.ProviderConsole, pairs)
		}
	case account.ProviderConsole:
		if _, ok := targetSet[account.ProviderWeb]; ok {
			pairs, err := listConsoleWebPairs(db, roots)
			if err != nil {
				return result, err
			}
			addPairs(account.ProviderWeb, pairs)
		}
		if _, ok := targetSet[account.ProviderBuild]; ok {
			pairs, err := listConsoleBuildPairs(db, roots)
			if err != nil {
				return result, err
			}
			addPairs(account.ProviderBuild, pairs)
		}
	default:
		return result, fmt.Errorf("账号来源无效")
	}

	for provider, count := range linkedCounts {
		if count > 0 {
			result.LinkedByProvider[provider] = count
		}
	}
	result.FinalIDs = make([]uint64, 0, len(finalSet))
	for id := range finalSet {
		result.FinalIDs = append(result.FinalIDs, id)
	}
	sort.Slice(result.FinalIDs, func(i, j int) bool { return result.FinalIDs[i] < result.FinalIDs[j] })
	return result, nil
}

// deleteLinkedGroupsTx expands links, locks the final set, checks media jobs, and deletes rows while roots are locked.
// skipMedia=false rejects the operation; skipMedia=true skips each blocked root group as a unit.
func deleteLinkedGroupsTx(tx *gorm.DB, providerValue account.Provider, lockedRoots []uint64, targets []account.Provider, skipMedia bool) (repository.LinkedDeleteOutcome, error) {
	outcome := repository.LinkedDeleteOutcome{
		LinkedDeletedByProvider: map[account.Provider]int64{},
	}

	// 1) Expand links while the caller holds root row locks.
	var resolution repository.LinkedDeleteResolution
	var err error
	if len(targets) == 0 {
		resolution = repository.LinkedDeleteResolution{
			RootIDs:          append([]uint64(nil), lockedRoots...),
			FinalIDs:         append([]uint64(nil), lockedRoots...),
			LinkedByProvider: map[account.Provider]int{},
			RootGroups:       map[uint64][]uint64{},
			PeerProviders:    map[uint64]account.Provider{},
		}
	} else {
		if !providerValue.IsValid() {
			return outcome, fmt.Errorf("账号来源无效")
		}
		resolution, err = resolveLinkedDeleteIDs(tx, providerValue, lockedRoots, targets)
		if err != nil {
			return outcome, err
		}
	}
	outcome.Resolution = resolution
	if len(resolution.FinalIDs) == 0 {
		return outcome, nil
	}

	// 2) Lock roots and linked peers in the final set.
	var lockedFinal []uint64
	if err := tx.Model(&accountModel{}).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id IN ?", resolution.FinalIDs).Order("id ASC").Pluck("id", &lockedFinal).Error; err != nil {
		return outcome, err
	}
	if len(lockedFinal) == 0 {
		return outcome, nil
	}
	outcome.Resolution.FinalIDs = append([]uint64(nil), lockedFinal...)

	// 3) Apply active-media protection.
	deletable := lockedFinal
	if skipMedia {
		var blocked []uint64
		if err := tx.Model(&mediaJobModel{}).
			Where("account_id IN ? AND status IN ?", lockedFinal, activeMediaJobStatuses()).
			Pluck("account_id", &blocked).Error; err != nil {
			return outcome, err
		}
		if len(blocked) > 0 {
			// Map blocked peers back to roots and remove each complete group.
			peerRoot := make(map[uint64]uint64, len(resolution.PeerProviders))
			for root, peers := range resolution.RootGroups {
				for _, peer := range peers {
					peerRoot[peer] = root
				}
			}
			skippedRootSet := map[uint64]struct{}{}
			for _, id := range blocked {
				if root, ok := peerRoot[id]; ok {
					skippedRootSet[root] = struct{}{}
				} else {
					skippedRootSet[id] = struct{}{}
				}
			}
			removed := map[uint64]struct{}{}
			for root := range skippedRootSet {
				removed[root] = struct{}{}
				for _, peer := range resolution.RootGroups[root] {
					removed[peer] = struct{}{}
				}
				outcome.SkippedRoots = append(outcome.SkippedRoots, root)
			}
			sort.Slice(outcome.SkippedRoots, func(i, j int) bool { return outcome.SkippedRoots[i] < outcome.SkippedRoots[j] })
			filtered := make([]uint64, 0, len(lockedFinal))
			for _, id := range lockedFinal {
				if _, skip := removed[id]; !skip {
					filtered = append(filtered, id)
				}
			}
			deletable = filtered
		}
	} else {
		if err := rejectAccountsWithMediaJobs(tx, lockedFinal); err != nil {
			return outcome, err
		}
	}
	if len(deletable) == 0 {
		return outcome, nil
	}

	// 4) Delete remaining rows and count them by provider.
	result := tx.Where("id IN ?", deletable).Delete(&accountModel{})
	if result.Error != nil {
		return outcome, result.Error
	}
	outcome.Deleted = result.RowsAffected
	outcome.DeletedIDs = append([]uint64(nil), deletable...)
	rootSet := make(map[uint64]struct{}, len(resolution.RootIDs))
	for _, id := range resolution.RootIDs {
		rootSet[id] = struct{}{}
	}
	for _, id := range deletable {
		if _, isRoot := rootSet[id]; isRoot {
			outcome.RootsDeleted++
		} else if provider, ok := resolution.PeerProviders[id]; ok {
			outcome.LinkedDeletedByProvider[provider]++
		}
	}
	return outcome, nil
}

// DeleteManyWithLinked locks existing roots (optionally filtered by provider), expands linked
// peers from binding tables, re-locks the final set, handles media jobs, and deletes
// everything in one transaction so concurrent re-link/unlink cannot race the snapshot.
func (r *AccountRepository) DeleteManyWithLinked(ctx context.Context, providerValue account.Provider, rootIDs []uint64, targets []account.Provider, skipMedia bool) (repository.LinkedDeleteOutcome, error) {
	outcome := repository.LinkedDeleteOutcome{
		Resolution:              repository.LinkedDeleteResolution{LinkedByProvider: map[account.Provider]int{}},
		LinkedDeletedByProvider: map[account.Provider]int64{},
	}
	roots := uniqueSortedIDs(rootIDs)
	if len(roots) == 0 {
		return outcome, nil
	}

	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAccountLinkMutation(tx); err != nil {
			return err
		}

		// Lock roots in one stable order, then validate their provider without masking missing IDs.
		var lockedRows []struct {
			ID       uint64
			Provider string
		}
		if err := tx.Model(&accountModel{}).Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id", "provider").Where("id IN ?", roots).Order("id ASC").Find(&lockedRows).Error; err != nil {
			return err
		}
		if len(lockedRows) == 0 {
			return nil
		}
		lockedRoots := make([]uint64, 0, len(lockedRows))
		for _, row := range lockedRows {
			if providerValue.IsValid() && account.Provider(row.Provider) != providerValue {
				return fmt.Errorf("%w: 账号不属于指定号池", repository.ErrConflict)
			}
			lockedRoots = append(lockedRoots, row.ID)
		}
		inner, err := deleteLinkedGroupsTx(tx, providerValue, lockedRoots, targets, skipMedia)
		if err != nil {
			return err
		}
		outcome = inner
		return nil
	})
	if err != nil {
		return repository.LinkedDeleteOutcome{}, err
	}
	if outcome.Deleted > 0 {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged})
	}
	return outcome, nil
}
