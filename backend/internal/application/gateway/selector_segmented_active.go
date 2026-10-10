package gateway

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/pkg/perfmetrics"
)

type segmentedSelectorActiveRequest struct {
	provider   account.Provider
	windowSize int
	cursor     uint64
}

type segmentedSelectorCohortBucket struct {
	cohort  segmentedSelectorCohort
	indexes []int
}

type segmentedCohortSelection struct {
	count   int
	start   int
	take    int
	seen    int
	indexes []int
}

type segmentedClaimResult struct {
	lease          *accountLease
	staleClaims    int
	capacityMisses int
}

const segmentedWindowsBeforeFullFallback = 4

func (s *Selector) nextSegmentedActiveRequest(provider account.Provider, upstreamModel, quotaMode string, candidateCount int) *segmentedSelectorActiveRequest {
	s.configMu.RLock()
	config := s.segmentedConfig
	s.configMu.RUnlock()
	if !config.enabled || candidateCount < config.minCandidates {
		return nil
	}
	shard := segmentedSelectorShard(provider, upstreamModel, quotaMode)
	cursor := s.segmentedState.activeCursors[shard].Add(uint64(config.windowSize)) - uint64(config.windowSize)
	return &segmentedSelectorActiveRequest{provider: provider, windowSize: config.windowSize, cursor: cursor}
}

// segmentedActiveScan 承载一次分段选号扫描的不可变入参、上下文与累计观测计数。
type segmentedActiveScan struct {
	selector         *Selector
	values           []account.RoutingCandidate
	indexes          []int
	quotaMode        string
	tierOrder        []account.WebTier
	request          segmentedSelectorActiveRequest
	materialFailures *credentialMaterialFailureTracker
	preferFreeBuild  bool
	startedAt        time.Time
	windows          int
	candidates       int
}

func (scan *segmentedActiveScan) observe(outcome, stage string) {
	observeSegmentedActive(scan.request.provider, outcome, stage, scan.startedAt, scan.windows, scan.candidates)
}

func (scan *segmentedActiveScan) candidateLength() int {
	if scan.indexes == nil {
		return len(scan.values)
	}
	return len(scan.indexes)
}

func (s *Selector) acquireSegmentedCandidates(ctx context.Context, values []account.RoutingCandidate, indexes []int, quotaMode string, tierOrder []account.WebTier, request segmentedSelectorActiveRequest, materialFailures *credentialMaterialFailureTracker) (*accountLease, error) {
	startedAt := time.Now()
	_, _, _, capacityWait := s.routingConfig()
	waitDeadline := time.Now().Add(capacityWait)
	scan := &segmentedActiveScan{
		selector: s, values: values, indexes: indexes, quotaMode: quotaMode, tierOrder: tierOrder,
		request: request, materialFailures: materialFailures,
		preferFreeBuild: s.preferFreeBuildEnabled(), startedAt: startedAt,
	}
	fullPlannerOnly := false
	for {
		now := time.Now().UTC()
		var (
			lease *accountLease
			done  bool
			err   error
		)
		if fullPlannerOnly {
			lease, done, err = scan.claimFullPlanner(ctx, nil, now)
		} else {
			lease, done, err = scan.claimWindows(ctx, now)
			fullPlannerOnly = true
		}
		if err != nil || done {
			return lease, err
		}
		if capacityWait <= 0 {
			scan.observe("saturated", "exhausted")
			return nil, &SelectionUnavailableError{Reason: SelectionSaturated, RetryAfter: time.Second}
		}
		retry, err := s.awaitLeaseRetry(ctx, waitDeadline)
		if err != nil {
			scan.observe("error", "wait")
			return nil, err
		}
		if !retry {
			scan.observe("saturated", "timeout")
			return nil, &SelectionUnavailableError{Reason: SelectionSaturated, RetryAfter: time.Second}
		}
	}
}

// claimFullPlanner 用完整候选池规划一次，返回 done 表示已有最终结论。
func (scan *segmentedActiveScan) claimFullPlanner(ctx context.Context, concurrencyHints map[int]int, now time.Time) (*accountLease, bool, error) {
	scan.candidates += scan.candidateLength()
	plan, err := scan.selector.planCandidateIndexesWithHints(ctx, scan.values, scan.indexes, now, scan.tierOrder, concurrencyHints, scan.preferFreeBuild)
	if err != nil {
		scan.observe("error", "full_fallback")
		return nil, false, err
	}
	claim, err := scan.selector.claimSegmentedPlan(ctx, plan, scan.request.provider, scan.quotaMode, "full_fallback", scan.materialFailures)
	if err != nil {
		scan.observe("error", "full_fallback")
		return nil, false, err
	}
	if claim.lease != nil {
		scan.observe("selected", "full_fallback")
		return claim.lease, true, nil
	}
	if claim.staleClaims > 0 && claim.capacityMisses == 0 {
		scan.observe("unavailable", "full_fallback")
		return nil, true, &SelectionUnavailableError{Reason: SelectionNoAccounts}
	}
	return nil, false, nil
}

// claimWindows 先按分段同质窗口扫描，窗口预算耗尽时退化为完整候选池规划。
func (scan *segmentedActiveScan) claimWindows(ctx context.Context, now time.Time) (*accountLease, bool, error) {
	concurrencyHints := make(map[int]int, min(len(scan.indexes), scan.request.windowSize*segmentedWindowsBeforeFullFallback))
	cohorts := segmentedCandidateCohorts(scan.values, scan.indexes, now, scan.tierOrder, scan.preferFreeBuild, scan.request.cursor, scan.request.windowSize, segmentedWindowsBeforeFullFallback)
	lease, fallbackToFull, err := scan.claimWindowWave(ctx, cohorts, concurrencyHints, now)
	if err != nil || lease != nil {
		return lease, lease != nil, err
	}
	if !fallbackToFull {
		return nil, false, nil
	}
	return scan.claimFullPlanner(ctx, concurrencyHints, now)
}

func (scan *segmentedActiveScan) claimWindowWave(ctx context.Context, cohorts []segmentedSelectorCohortBucket, concurrencyHints map[int]int, now time.Time) (*accountLease, bool, error) {
	roundWindows := 0
	for cohortIndex, bucket := range cohorts {
		for windowOffset := 0; windowOffset < len(bucket.indexes); windowOffset += scan.request.windowSize {
			windowIndexes := bucket.indexes[windowOffset:min(windowOffset+scan.request.windowSize, len(bucket.indexes))]
			scan.windows++
			roundWindows++
			scan.candidates += len(windowIndexes)
			plan, err := scan.selector.planCandidateIndexesWithHints(ctx, scan.values, windowIndexes, now, scan.tierOrder, concurrencyHints, scan.preferFreeBuild)
			if err != nil {
				scan.observe("error", "planning")
				return nil, false, err
			}
			stage := segmentedActiveSelectionStage(cohortIndex, windowOffset)
			claim, err := scan.selector.claimSegmentedPlan(ctx, plan, scan.request.provider, scan.quotaMode, stage, scan.materialFailures)
			if err != nil {
				scan.observe("error", "claim")
				return nil, false, err
			}
			if claim.lease != nil {
				scan.observe("selected", stage)
				return claim.lease, false, nil
			}
			if roundWindows >= segmentedWindowsBeforeFullFallback {
				return nil, true, nil
			}
		}
	}
	return nil, false, nil
}

func (s *Selector) claimSegmentedPlan(ctx context.Context, plan *candidatePlan, provider account.Provider, quotaMode, stage string, materialFailures *credentialMaterialFailureTracker) (segmentedClaimResult, error) {
	result := segmentedClaimResult{}
	for candidate, ok := plan.Next(); ok; candidate, ok = plan.Next() {
		lease, err := s.claimAccountSlotTracked(ctx, candidate.Credential, materialFailures)
		if err != nil {
			if errors.Is(err, errRoutingCredentialStale) {
				result.staleClaims++
				continue
			}
			return segmentedClaimResult{}, err
		}
		if lease == nil {
			result.capacityMisses++
			continue
		}
		lease.Billing = candidate.Billing
		lease.QuotaMode = effectiveQuotaMode(candidate, quotaMode)
		selected := candidate
		lease.routingCandidate = &selected
		lease.selectorObservation = &selectorLeaseObservation{provider: provider, stage: stage}
		result.lease = lease
		return result, nil
	}
	return result, nil
}

func segmentedCandidateCohorts(values []account.RoutingCandidate, indexes []int, now time.Time, tierOrder []account.WebTier, preferFreeBuild bool, cursor uint64, windowSize, maxWindows int) []segmentedSelectorCohortBucket {
	if windowSize <= 0 || maxWindows <= 0 {
		return nil
	}
	counts := segmentedCohortCounts(values, indexes, now, tierOrder, preferFreeBuild)
	ordered := segmentedCohortOrder(counts)
	selections := make(map[segmentedSelectorCohort]*segmentedCohortSelection)
	result := planSegmentedCohortWindows(ordered, counts, selections, cursor, windowSize, maxWindows)
	forEachCandidateIndex(values, indexes, func(index int) {
		fillSegmentedCohortIndex(values, index, selections, now, tierOrder, preferFreeBuild)
	})
	return result
}

// forEachCandidateIndex 按快照顺序访问候选下标；indexes 为 nil 时访问全部候选。
func forEachCandidateIndex(values []account.RoutingCandidate, indexes []int, visit func(index int)) {
	if indexes == nil {
		for index := range values {
			visit(index)
		}
		return
	}
	for _, index := range indexes {
		visit(index)
	}
}

// segmentedCohortOf 计算单个候选所属的分段同质分组，比较规则与计划排序保持一致。
func segmentedCohortOf(candidate account.RoutingCandidate, now time.Time, tierOrder []account.WebTier, preferFreeBuild bool) segmentedSelectorCohort {
	supportsModel, capabilityKnown := candidate.SupportsModel, candidate.ModelCapabilityKnown
	if candidate.Credential.Provider == account.ProviderWeb && len(tierOrder) > 0 && webTierInOrder(tierOrder, candidate.Credential.WebTier) {
		supportsModel, capabilityKnown = true, true
	}
	cohort := segmentedSelectorCohort{
		supportsModel: supportsModel, capabilityKnown: capabilityKnown,
		preferFreeBuild: preferFreeBuild && candidate.IsKnownFreeBuild(),
		tier:            tierOrderRank(tierOrder, candidate.Credential.WebTier), priority: candidate.Credential.Priority,
	}
	if candidate.QuotaWindow != nil && candidate.QuotaWindow.Source == account.QuotaSourceUpstream {
		cohort.quotaKnown = true
		cohort.quotaAvailable = candidate.QuotaWindow.Remaining > 0
	}
	if candidate.Billing != nil {
		cohort.billingFresh = now.Sub(candidate.Billing.SyncedAt) <= 30*time.Minute
	}
	return cohort
}

func segmentedCohortCounts(values []account.RoutingCandidate, indexes []int, now time.Time, tierOrder []account.WebTier, preferFreeBuild bool) map[segmentedSelectorCohort]int {
	counts := make(map[segmentedSelectorCohort]int)
	forEachCandidateIndex(values, indexes, func(index int) {
		counts[segmentedCohortOf(values[index], now, tierOrder, preferFreeBuild)]++
	})
	return counts
}

func segmentedCohortOrder(counts map[segmentedSelectorCohort]int) []segmentedSelectorCohort {
	ordered := make([]segmentedSelectorCohort, 0, len(counts))
	for cohort := range counts {
		ordered = append(ordered, cohort)
	}
	sort.Slice(ordered, func(left, right int) bool {
		return segmentedSelectorCohortBetter(ordered[left], ordered[right])
	})
	return ordered
}

// planSegmentedCohortWindows 按优先级分配每个分组可占用的窗口预算，
// 并登记各分组在下一次填充时使用的环形窗口位置。
func planSegmentedCohortWindows(ordered []segmentedSelectorCohort, counts map[segmentedSelectorCohort]int, selections map[segmentedSelectorCohort]*segmentedCohortSelection, cursor uint64, windowSize, maxWindows int) []segmentedSelectorCohortBucket {
	remainingWindows := maxWindows
	result := make([]segmentedSelectorCohortBucket, 0, min(len(ordered), maxWindows))
	for _, cohort := range ordered {
		if remainingWindows == 0 {
			break
		}
		count := counts[cohort]
		take := min(count, remainingWindows*windowSize)
		remainingWindows -= (take + windowSize - 1) / windowSize
		selection := &segmentedCohortSelection{
			count: count, start: int(cursor % uint64(count)), take: take, indexes: make([]int, take),
		}
		selections[cohort] = selection
		result = append(result, segmentedSelectorCohortBucket{cohort: cohort, indexes: selection.indexes})
	}
	return result
}

// fillSegmentedCohortIndex 将候选写入其分组窗口内的环形位置，超出 take 的候选被丢弃。
func fillSegmentedCohortIndex(values []account.RoutingCandidate, index int, selections map[segmentedSelectorCohort]*segmentedCohortSelection, now time.Time, tierOrder []account.WebTier, preferFreeBuild bool) {
	selection := selections[segmentedCohortOf(values[index], now, tierOrder, preferFreeBuild)]
	if selection == nil {
		return
	}
	position := selection.seen
	selection.seen++
	relative := position - selection.start
	if relative < 0 {
		relative += selection.count
	}
	if relative < selection.take {
		selection.indexes[relative] = index
	}
}

func segmentedActiveSelectionStage(cohortIndex, windowOffset int) string {
	if cohortIndex > 0 {
		return "later_cohort"
	}
	if windowOffset > 0 {
		return "later_window"
	}
	return "first_window"
}

func observeSegmentedActive(provider account.Provider, outcome, stage string, startedAt time.Time, windows, candidates int) {
	labels := perfmetrics.Labels{
		Subsystem: "selector", Operation: "segmented_active", Provider: string(provider),
		Stage: stage, Outcome: outcome,
	}
	perfmetrics.Default.Inc("selector_segmented_active_total", labels)
	perfmetrics.Default.ObserveDuration("selector_segmented_active_duration_us", labels, time.Since(startedAt))
	perfmetrics.Default.Add("selector_segmented_active_windows", labels, int64(windows))
	perfmetrics.Default.Add("selector_segmented_active_candidates", labels, int64(candidates))
}
