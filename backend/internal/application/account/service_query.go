package account

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

func (s *Service) Summary(ctx context.Context) (Summary, error) {
	now := s.now()
	rows, err := s.accounts.Summarize(ctx, now)
	if err != nil {
		return Summary{}, err
	}
	result := summarizeAccounts(rows)
	if err := s.applyBuildBotFlagRisk(ctx, now, &result); err != nil {
		return Summary{}, err
	}
	return result, nil
}

// summarizeAccounts 汇总各 provider 的账号统计并推导恢复与关注计数。
func summarizeAccounts(rows []repository.AccountSummary) Summary {
	result := Summary{Providers: make(map[string]ProviderSummary, len(accountdomain.Providers()))}
	for _, providerValue := range accountdomain.Providers() {
		result.Providers[string(providerValue)] = ProviderSummary{}
	}
	for _, row := range rows {
		result.Total += row.Total
		result.Available += row.Available
		result.Recovery.Cooldown += row.Cooldown
		result.Recovery.WaitingReset += row.WaitingReset
		result.Recovery.Probing += row.Probing
		result.Issues.Disabled += row.Disabled
		result.Issues.ReauthRequired += row.ReauthRequired
		result.Providers[row.Provider] = ProviderSummary{Total: row.Total, Available: row.Available}
	}
	result.Recovering = result.Recovery.Cooldown + result.Recovery.WaitingReset + result.Recovery.Probing
	result.Attention = result.Issues.Disabled + result.Issues.ReauthRequired
	return result
}

// applyBuildBotFlagRisk 统计 Build bot 风控账号，并按配置扣减可调度可用数。
func (s *Service) applyBuildBotFlagRisk(ctx context.Context, now time.Time, result *Summary) error {
	indexed, hasIndex := s.accounts.(buildBotFlagIndexRepository)
	var flaggedIDs []uint64
	var err error
	if hasIndex {
		result.Risk, err = indexed.CountBuildBotFlagged(ctx)
	} else {
		flaggedIDs, err = s.buildBotFlaggedAccountIDs(ctx)
		result.Risk = int64(len(flaggedIDs))
	}
	if err != nil {
		return err
	}
	if !s.excludeBuildBotFlaggedFromSchedulingEnabled() || result.Risk <= 0 {
		return nil
	}
	excluded, err := s.countExcludedBuildBotFlagged(ctx, indexed, hasIndex, flaggedIDs, now)
	if err != nil {
		return err
	}
	if excluded > 0 {
		subtractBuildBotFlaggedAvailability(result, excluded)
	}
	return nil
}

// countExcludedBuildBotFlagged 统计被 bot 风控排除在调度之外的可用 Build 账号数。
func (s *Service) countExcludedBuildBotFlagged(ctx context.Context, indexed buildBotFlagIndexRepository, hasIndex bool, flaggedIDs []uint64, now time.Time) (int64, error) {
	if hasIndex {
		return indexed.CountAvailableBuildBotFlagged(ctx, now)
	}
	return s.accounts.CountAvailableAmong(ctx, accountdomain.ProviderBuild, flaggedIDs, now)
}

// subtractBuildBotFlaggedAvailability 从 Build provider 与总可用数中扣减被排除的账号。
func subtractBuildBotFlaggedAvailability(result *Summary, excluded int64) {
	buildKey := string(accountdomain.ProviderBuild)
	build := result.Providers[buildKey]
	if excluded > build.Available {
		excluded = build.Available
	}
	build.Available -= excluded
	result.Providers[buildKey] = build
	if excluded > result.Available {
		excluded = result.Available
	}
	result.Available -= excluded
}

func (s *Service) List(ctx context.Context, page, pageSize int, search string, filter ListFilter) ([]View, int64, error) {
	page, pageSize = normalizePage(page, pageSize)
	egressMode, egressNodeID, egressSourceID, egressValid := parseEgressFilter(filter.Egress)
	if !isValidListFilter(filter, egressValid) {
		return nil, 0, ErrInvalidFilter
	}
	repositoryFilter := listRepositoryFilter(filter, s.now(), egressMode, egressNodeID, egressSourceID)
	if err := s.applyListRiskFilter(ctx, filter, &repositoryFilter); err != nil {
		return nil, 0, err
	}
	values, total, err := s.accounts.List(ctx, repository.AccountListQuery{
		Page:   repository.PageQuery{Offset: (page - 1) * pageSize, Limit: pageSize, Search: search, Sort: filter.Sort},
		Filter: repositoryFilter,
	})
	if err != nil {
		return nil, 0, err
	}
	views, err := s.buildListViews(ctx, values)
	if err != nil {
		return nil, 0, err
	}
	return views, total, nil
}

// isValidListFilter 逐项校验列表筛选取值；任一取值不被支持即返回 false。
func isValidListFilter(filter ListFilter, egressValid bool) bool {
	if filter.Provider != "" && !accountdomain.Provider(filter.Provider).IsValid() {
		return false
	}
	if !oneOf(filter.QuotaType, "", "free", "paid", "unknown", "auto", "basic", "super", "heavy") ||
		!oneOf(filter.Status, "", "active", "disabled", "reauthRequired", "cooldown", "waitingReset", "probing") ||
		!egressValid {
		return false
	}
	if !oneOf(filter.Renewal, "", "refreshable", "unrefreshable") ||
		!oneOf(filter.Risk, "", "flagged", "normal") ||
		(filter.Risk != "" && filter.Provider != string(accountdomain.ProviderBuild)) {
		return false
	}
	if !oneOf(filter.Agreement, "", "nsfwEnabled", "nsfwDisabled", "termsAccepted", "termsNotAccepted", "allAccepted", "allNotAccepted") ||
		(filter.Agreement != "" && filter.Provider != string(accountdomain.ProviderWeb)) ||
		!validAssociationFilter(filter.Provider, filter.Association) {
		return false
	}
	return repository.IsValidSort(filter.Sort, "name", "type", "status", "createdAt")
}

// listRepositoryFilter 把列表筛选与分页条件映射为仓储查询结构。
func listRepositoryFilter(filter ListFilter, now time.Time, egressMode string, egressNodeID, egressSourceID uint64) repository.AccountListFilter {
	var refreshable *bool
	if filter.Renewal != "" {
		value := filter.Renewal == "refreshable"
		refreshable = &value
	}
	return repository.AccountListFilter{
		Provider: filter.Provider, QuotaType: filter.QuotaType, Status: filter.Status, Egress: egressMode,
		EgressNodeID: egressNodeID, EgressSourceID: egressSourceID,
		Refreshable: refreshable, Agreement: filter.Agreement, Association: filter.Association, Now: now,
	}
}

// applyListRiskFilter 按仓储能力下推 bot 风控筛选；不支持索引时改为 ID 白/黑名单。
func (s *Service) applyListRiskFilter(ctx context.Context, filter ListFilter, repositoryFilter *repository.AccountListFilter) error {
	if filter.Risk == "" {
		return nil
	}
	if _, ok := s.accounts.(buildBotFlagIndexRepository); ok {
		repositoryFilter.Risk = filter.Risk
		return nil
	}
	flaggedIDs, err := s.buildBotFlaggedAccountIDs(ctx)
	if err != nil {
		return err
	}
	if filter.Risk == "flagged" {
		repositoryFilter.AccountIDs = flaggedIDs
		repositoryFilter.RestrictIDs = true
		return nil
	}
	repositoryFilter.ExcludeIDs = flaggedIDs
	return nil
}

// buildListViews 汇总当前页账号的用量、账单、恢复与配额窗口并组装视图。
func (s *Service) buildListViews(ctx context.Context, values []accountdomain.Credential) ([]View, error) {
	accountIDs := make([]uint64, 0, len(values))
	for _, value := range values {
		accountIDs = append(accountIDs, value.ID)
	}
	observedTokens, err := s.audits.SumTokensByAccountsSince(ctx, accountIDs, time.Now().UTC().Add(-freeUsageWindow))
	if err != nil {
		return nil, err
	}
	billings, err := s.accounts.GetBillings(ctx, accountIDs)
	if err != nil {
		return nil, err
	}
	recoveries, err := s.accounts.GetQuotaRecoveries(ctx, accountIDs)
	if err != nil {
		return nil, err
	}
	quotaWindows, err := s.accounts.GetQuotaWindows(ctx, accountIDs)
	if err != nil {
		return nil, err
	}
	modelQuotaBlocks, err := s.accounts.GetModelQuotaBlocks(ctx, accountIDs, s.now())
	if err != nil {
		return nil, err
	}
	views := make([]View, 0, len(values))
	for _, value := range values {
		metadata := s.buildBotFlagMetadata(value)
		view := View{Credential: value, BuildBotFlagged: metadata.BuildBotFlagged, BuildBotFlagSource: metadata.BuildBotFlagSource}
		if billing, ok := billings[value.ID]; ok {
			view.Billing = &billing
		}
		var recovery *accountdomain.QuotaRecovery
		if recoveryValue, ok := recoveries[value.ID]; ok {
			recovery = &recoveryValue
		}
		view.Quota = newQuotaView(view.Billing, observedTokens[value.ID], recovery, value.ObservedModel, value.BuildSuperEntitled && value.Provider == accountdomain.ProviderBuild)
		view.QuotaWindows = quotaWindows[value.ID]
		view.ModelQuotaBlocks = modelQuotaBlocks[value.ID]
		views = append(views, view)
	}
	return views, nil
}

func (s *Service) buildBotFlaggedAccountIDs(ctx context.Context) ([]uint64, error) {
	if s.buildBotFlagCache == nil {
		return s.loadBuildBotFlaggedAccountIDs(ctx)
	}
	return s.buildBotFlagCache.Load(ctx, buildBotFlagCacheKey, s.now(), func() ([]uint64, error) {
		return s.loadBuildBotFlaggedAccountIDs(ctx)
	})
}

// ListBuildBotFlaggedAccountIDs returns Build account IDs whose access-token claims
// mark bot_flag_source/bfs as 1 or 2. Used by routing to optionally exclude them.
func (s *Service) ListBuildBotFlaggedAccountIDs(ctx context.Context) ([]uint64, error) {
	return s.buildBotFlaggedAccountIDs(ctx)
}

// UpdateExcludeBuildBotFlaggedFromScheduling hot-updates whether bot-risk Build
// accounts are treated as non-schedulable in account summary available counts.
func (s *Service) UpdateExcludeBuildBotFlaggedFromScheduling(value bool) {
	s.autoCleanMu.Lock()
	s.excludeBuildBotFlagged = value
	s.autoCleanMu.Unlock()
}

func (s *Service) excludeBuildBotFlaggedFromSchedulingEnabled() bool {
	s.autoCleanMu.RLock()
	defer s.autoCleanMu.RUnlock()
	return s.excludeBuildBotFlagged
}

func (s *Service) loadBuildBotFlaggedAccountIDs(ctx context.Context) ([]uint64, error) {
	if indexed, ok := s.accounts.(buildBotFlagIndexRepository); ok {
		return indexed.ListBuildBotFlaggedAccountIDs(ctx)
	}
	const batchSize = 500
	result := make([]uint64, 0)
	var afterID uint64
	for {
		values, _, err := s.accounts.ListProviderAccountBatch(ctx, accountdomain.ProviderBuild, afterID, batchSize)
		if err != nil {
			return nil, err
		}
		for _, value := range values {
			if s.credentialMetadata(value).BuildBotFlagged {
				result = append(result, value.ID)
			}
		}
		if len(values) < batchSize {
			return result, nil
		}
		afterID = values[len(values)-1].ID
	}
}

// RebuildBuildBotFlagIndex backfills persisted non-sensitive routing metadata
// before the gateway begins serving traffic. Subsequent imports and refreshes
// update the source atomically with the encrypted access token.
func (s *Service) RebuildBuildBotFlagIndex(ctx context.Context) error {
	indexed, ok := s.accounts.(buildBotFlagIndexRepository)
	if !ok {
		return nil
	}
	const batchSize = 500
	var afterID uint64
	for {
		values, err := indexed.ListBuildBotFlagCredentialBatch(ctx, afterID, batchSize)
		if err != nil {
			return err
		}
		updates := make([]repository.BuildBotFlagSourceUpdate, 0)
		for _, value := range values {
			credential := accountdomain.Credential{
				ID: value.AccountID, Provider: accountdomain.ProviderBuild, EncryptedAccessToken: value.EncryptedAccessToken,
			}
			metadata := s.credentialMetadata(credential)
			if !metadata.BuildBotFlagInspected {
				continue
			}
			source := metadata.BuildBotFlagSource
			if source != 1 && source != 2 {
				source = 0
			}
			if source != value.StoredSource {
				updates = append(updates, repository.BuildBotFlagSourceUpdate{
					AccountID: value.AccountID, ExpectedEncryptedAccessToken: value.EncryptedAccessToken, Source: source,
				})
			}
		}
		if err := indexed.UpdateBuildBotFlagSources(ctx, updates); err != nil {
			return err
		}
		if len(values) < batchSize {
			s.invalidateBuildBotFlagCache()
			return nil
		}
		afterID = values[len(values)-1].AccountID
	}
}

func (s *Service) invalidateBuildBotFlagCache() {
	if s.buildBotFlagCache != nil {
		s.buildBotFlagCache.Delete(buildBotFlagCacheKey)
	}
}

// parseEgressFilter splits the account egress filter into its bound/unbound mode
// and an optional narrowing target. Accepted values are "", "bound", "unbound",
// "node:<id>" and "source:<id>"; the last two are "bound" narrowed to one egress
// node or to every node owned by one subscription source.
func parseEgressFilter(value string) (mode string, nodeID uint64, sourceID uint64, ok bool) {
	if oneOf(value, "", "bound", "unbound") {
		return value, 0, 0, true
	}
	prefix, raw, found := strings.Cut(value, ":")
	if !found {
		return "", 0, 0, false
	}
	// Relational account and egress IDs are stored in signed BIGINT/INTEGER
	// columns. Reject values outside that range here so malformed filters cannot
	// reach database/sql as unsupported high-bit uint64 arguments and become 500s.
	id, err := strconv.ParseUint(raw, 10, 63)
	if err != nil || id == 0 {
		return "", 0, 0, false
	}
	switch prefix {
	case "node":
		return "bound", id, 0, true
	case "source":
		return "bound", 0, id, true
	default:
		return "", 0, 0, false
	}
}

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

// validAssociationFilter validates association filters against the selected provider.
// Web keeps its six Build/Console/combined values; Build and Console filter only by Web links.
func validAssociationFilter(providerValue, association string) bool {
	if association == "" {
		return true
	}
	switch providerValue {
	case string(accountdomain.ProviderWeb):
		return oneOf(association, "buildLinked", "buildUnlinked", "consoleLinked", "consoleUnlinked", "allLinked", "allUnlinked")
	case string(accountdomain.ProviderBuild), string(accountdomain.ProviderConsole):
		return oneOf(association, "webLinked", "webUnlinked")
	default:
		return false
	}
}

func (s *Service) Get(ctx context.Context, id uint64) (View, error) {
	value, err := s.accounts.Get(ctx, id)
	if err != nil {
		return View{}, mapRepositoryError(err)
	}
	metadata := s.buildBotFlagMetadata(value)
	view := View{Credential: value, BuildBotFlagged: metadata.BuildBotFlagged, BuildBotFlagSource: metadata.BuildBotFlagSource}
	if billing, err := s.accounts.GetBilling(ctx, id); err == nil {
		view.Billing = &billing
	} else if !errors.Is(err, repository.ErrNotFound) {
		return View{}, err
	}
	observedTokens, err := s.audits.SumTokensByAccountsSince(ctx, []uint64{id}, time.Now().UTC().Add(-freeUsageWindow))
	if err != nil {
		return View{}, err
	}
	var recovery *accountdomain.QuotaRecovery
	if recoveryValue, err := s.accounts.GetQuotaRecovery(ctx, id); err == nil {
		recovery = &recoveryValue
	} else if !errors.Is(err, repository.ErrNotFound) {
		return View{}, err
	}
	view.Quota = newQuotaView(view.Billing, observedTokens[id], recovery, value.ObservedModel, value.BuildSuperEntitled && value.Provider == accountdomain.ProviderBuild)
	if windows, err := s.accounts.GetQuotaWindows(ctx, []uint64{id}); err == nil {
		view.QuotaWindows = windows[id]
	} else {
		return View{}, err
	}
	if blocks, err := s.accounts.GetModelQuotaBlocks(ctx, []uint64{id}, s.now()); err == nil {
		view.ModelQuotaBlocks = blocks[id]
	} else {
		return View{}, err
	}
	return view, nil
}

func (s *Service) credentialMetadata(value accountdomain.Credential) provider.CredentialMetadata {
	if s.providers == nil {
		return provider.CredentialMetadata{}
	}
	return s.providers.CredentialMetadata(value)
}

func (s *Service) buildBotFlagMetadata(value accountdomain.Credential) provider.CredentialMetadata {
	metadata := s.credentialMetadata(value)
	if metadata.BuildBotFlagInspected {
		return metadata
	}
	source := value.BuildBotFlagSource
	if source != 1 && source != 2 {
		source = 0
	}
	metadata.BuildBotFlagSource = source
	metadata.BuildBotFlagged = source != 0
	return metadata
}

func newQuotaView(billing *accountdomain.Billing, observedTokens int64, recovery *accountdomain.QuotaRecovery, observedModel string, buildSuperEntitled bool) QuotaView {
	// Upstream paid billing takes precedence and preserves reported quota values.
	if view, ok := paidQuotaView(billing, recovery); ok {
		return view
	}
	// 管理员确认的 Build Super entitlement：覆盖 Free recovery / profile / observed free 等弱信号。
	// 不伪造额度、余额、使用率或账期；Billing 数值保持未知/零。
	if buildSuperEntitled {
		return QuotaView{
			Type: QuotaTypePaid, Source: "buildSuperEntitlement", Confidence: "confirmed",
			Confirmed: true, Status: QuotaStatusActive,
		}
	}
	if view, ok := exhaustedFreeQuotaView(recovery, observedTokens); ok {
		return view
	}
	return observedFreeQuotaView(billing, observedTokens, observedModel)
}

// paidQuotaView 用上游 billing 生成已付费额度视图；非付费账单返回 false。
func paidQuotaView(billing *accountdomain.Billing, recovery *accountdomain.QuotaRecovery) (QuotaView, bool) {
	if billing == nil || !billing.IsPaid() {
		return QuotaView{}, false
	}
	periodStart, periodEnd := billing.BillingPeriodStart, billing.BillingPeriodEnd
	if billing.UsagePeriodType != "" {
		periodStart, periodEnd = billing.UsagePeriodStart, billing.UsagePeriodEnd
	}
	result := QuotaView{Type: QuotaTypePaid, Source: "upstreamBilling", Confidence: "observed", Unit: "credits", UsagePercent: billing.CreditUsagePercent, Status: QuotaStatusActive, PeriodStart: periodStart, PeriodEnd: periodEnd}
	applyPaidQuotaRecovery(recovery, &result)
	applyPaidQuotaUsage(billing, &result)
	return result, true
}

// applyPaidQuotaRecovery 用付费恢复记录覆盖额度状态与探测时间。
func applyPaidQuotaRecovery(recovery *accountdomain.QuotaRecovery, result *QuotaView) {
	if recovery == nil || recovery.Kind != accountdomain.QuotaRecoveryKindPaid {
		return
	}
	result.Status = QuotaStatusWaitingReset
	if recovery.Status == accountdomain.QuotaRecoveryStatusProbing {
		result.Status = QuotaStatusProbing
	}
	result.ExhaustedAt = recovery.ExhaustedAt
	result.NextProbeAt = recovery.NextProbeAt
	result.LastConfirmedAt = recovery.LastConfirmedAt
}

// applyPaidQuotaUsage 按上游 billing 的额度形态填充用量、限额与剩余量。
func applyPaidQuotaUsage(billing *accountdomain.Billing, result *QuotaView) {
	switch {
	case billing.MonthlyLimit > 0:
		result.Used = billing.Used
		result.Limit = billing.MonthlyLimit
		result.Remaining = billing.Remaining()
		result.UsagePercent = billing.Used / billing.MonthlyLimit * 100
		result.LimitKnown = true
	case billing.OnDemandCap > 0:
		result.Limit = billing.OnDemandCap
		result.Used = billing.OnDemandUsed
		if result.Used == 0 && billing.CreditUsagePercent > 0 {
			result.Used = billing.OnDemandCap * billing.CreditUsagePercent / 100
		}
		result.Remaining = billing.OnDemandCap - result.Used
		result.LimitKnown = true
		if result.Remaining < 0 {
			result.Remaining = 0
		}
	case billing.PrepaidBalance > 0:
		result.Remaining = billing.PrepaidBalance
	case billing.UsagePeriodType != "":
		result.Unit = "percent"
		result.Used = billing.CreditUsagePercent
		result.Limit = 100
		result.Remaining = max(0, 100-billing.CreditUsagePercent)
		result.LimitKnown = true
	}
}

// exhaustedFreeQuotaView 用上游耗尽信号生成已确认耗尽的 Free 额度视图。
func exhaustedFreeQuotaView(recovery *accountdomain.QuotaRecovery, observedTokens int64) (QuotaView, bool) {
	if recovery == nil || recovery.Status == accountdomain.QuotaRecoveryStatusActive || (recovery.Kind != "" && recovery.Kind != accountdomain.QuotaRecoveryKindFree) {
		return QuotaView{}, false
	}
	limit := recovery.ConfirmedLimit
	used := recovery.ConfirmedUsed
	if used <= 0 {
		used = observedTokens
	}
	status := QuotaStatusWaitingReset
	if recovery.Status == accountdomain.QuotaRecoveryStatusProbing {
		status = QuotaStatusProbing
	}
	remaining := int64(0)
	usagePercent := 0.0
	if limit > 0 {
		remaining = limit - used
		if remaining < 0 {
			remaining = 0
		}
		usagePercent = float64(used) / float64(limit) * 100
	}
	return QuotaView{
		Type: QuotaTypeFree, Source: "upstreamExhaustion", Confidence: "confirmed", Unit: "tokens", Used: float64(used), Limit: float64(limit), LimitKnown: limit > 0,
		Remaining: float64(remaining), UsagePercent: usagePercent,
		WindowHours: int(freeUsageWindow / time.Hour), Confirmed: true, Status: status,
		ExhaustedAt: recovery.ExhaustedAt, NextProbeAt: recovery.NextProbeAt, LastConfirmedAt: recovery.LastConfirmedAt,
	}, true
}

// observedFreeQuotaView 用响应模型或 billing profile 弱信号估算 Free 额度视图。
func observedFreeQuotaView(billing *accountdomain.Billing, observedTokens int64, observedModel string) QuotaView {
	freeSource := ""
	confidence := ""
	if strings.HasSuffix(strings.ToLower(strings.TrimSpace(observedModel)), "-build-free") {
		freeSource = "responseModel"
		confidence = "observed"
	} else if isEstimatedFreeBillingProfile(billing) {
		freeSource = "billingProfile"
		confidence = "estimated"
	}
	if freeSource == "" {
		return QuotaView{Type: QuotaTypeUnknown, Source: "unknown", Status: QuotaStatusActive}
	}
	if observedTokens < 0 {
		observedTokens = 0
	}
	remaining := estimatedFreeTokenLimit - observedTokens
	if remaining < 0 {
		remaining = 0
	}
	return QuotaView{
		Type:         QuotaTypeFree,
		Source:       freeSource,
		Confidence:   confidence,
		Unit:         "tokens",
		Used:         float64(observedTokens),
		Limit:        float64(estimatedFreeTokenLimit),
		Remaining:    float64(remaining),
		UsagePercent: float64(observedTokens) / float64(estimatedFreeTokenLimit) * 100,
		LimitKnown:   false,
		WindowHours:  int(freeUsageWindow / time.Hour),
		Observed:     true,
		Status:       QuotaStatusActive,
	}
}

func isEstimatedFreeBillingProfile(billing *accountdomain.Billing) bool {
	return billing != nil && (billing.HasFreeProfileSignal() || billing.HasInferredFreeProfileSignal())
}
