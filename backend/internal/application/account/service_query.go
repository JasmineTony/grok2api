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
	indexed, hasIndex := s.accounts.(buildBotFlagIndexRepository)
	var flaggedIDs []uint64
	if hasIndex {
		result.Risk, err = indexed.CountBuildBotFlagged(ctx)
	} else {
		flaggedIDs, err = s.buildBotFlaggedAccountIDs(ctx)
		result.Risk = int64(len(flaggedIDs))
	}
	if err != nil {
		return Summary{}, err
	}
	if s.excludeBuildBotFlaggedFromSchedulingEnabled() && result.Risk > 0 {
		var excluded int64
		if hasIndex {
			excluded, err = indexed.CountAvailableBuildBotFlagged(ctx, now)
		} else {
			excluded, err = s.accounts.CountAvailableAmong(ctx, accountdomain.ProviderBuild, flaggedIDs, now)
		}
		if err != nil {
			return Summary{}, err
		}
		if excluded > 0 {
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
	}
	return result, nil
}

func (s *Service) List(ctx context.Context, page, pageSize int, search string, filter ListFilter) ([]View, int64, error) {
	page, pageSize = normalizePage(page, pageSize)
	egressMode, egressNodeID, egressSourceID, egressValid := parseEgressFilter(filter.Egress)
	if (filter.Provider != "" && !accountdomain.Provider(filter.Provider).IsValid()) ||
		!oneOf(filter.QuotaType, "", "free", "paid", "unknown", "auto", "basic", "super", "heavy") ||
		!oneOf(filter.Status, "", "active", "disabled", "reauthRequired", "cooldown", "waitingReset", "probing") ||
		!egressValid ||
		!oneOf(filter.Renewal, "", "refreshable", "unrefreshable") ||
		!oneOf(filter.Risk, "", "flagged", "normal") ||
		(filter.Risk != "" && filter.Provider != string(accountdomain.ProviderBuild)) ||
		!oneOf(filter.Agreement, "", "nsfwEnabled", "nsfwDisabled", "termsAccepted", "termsNotAccepted", "allAccepted", "allNotAccepted") ||
		(filter.Agreement != "" && filter.Provider != string(accountdomain.ProviderWeb)) ||
		!validAssociationFilter(filter.Provider, filter.Association) ||
		!repository.IsValidSort(filter.Sort, "name", "type", "status", "createdAt") {
		return nil, 0, ErrInvalidFilter
	}
	var refreshable *bool
	if filter.Renewal != "" {
		value := filter.Renewal == "refreshable"
		refreshable = &value
	}
	repositoryFilter := repository.AccountListFilter{
		Provider: filter.Provider, QuotaType: filter.QuotaType, Status: filter.Status, Egress: egressMode,
		EgressNodeID: egressNodeID, EgressSourceID: egressSourceID,
		Refreshable: refreshable, Agreement: filter.Agreement, Association: filter.Association, Now: s.now(),
	}
	if filter.Risk != "" {
		if _, ok := s.accounts.(buildBotFlagIndexRepository); ok {
			repositoryFilter.Risk = filter.Risk
		} else {
			flaggedIDs, err := s.buildBotFlaggedAccountIDs(ctx)
			if err != nil {
				return nil, 0, err
			}
			if filter.Risk == "flagged" {
				repositoryFilter.AccountIDs = flaggedIDs
				repositoryFilter.RestrictIDs = true
			} else {
				repositoryFilter.ExcludeIDs = flaggedIDs
			}
		}
	}
	values, total, err := s.accounts.List(ctx, repository.AccountListQuery{
		Page:   repository.PageQuery{Offset: (page - 1) * pageSize, Limit: pageSize, Search: search, Sort: filter.Sort},
		Filter: repositoryFilter,
	})
	if err != nil {
		return nil, 0, err
	}
	accountIDs := make([]uint64, 0, len(values))
	for _, value := range values {
		accountIDs = append(accountIDs, value.ID)
	}
	observedTokens, err := s.audits.SumTokensByAccountsSince(ctx, accountIDs, time.Now().UTC().Add(-freeUsageWindow))
	if err != nil {
		return nil, 0, err
	}
	billings, err := s.accounts.GetBillings(ctx, accountIDs)
	if err != nil {
		return nil, 0, err
	}
	recoveries, err := s.accounts.GetQuotaRecoveries(ctx, accountIDs)
	if err != nil {
		return nil, 0, err
	}
	quotaWindows, err := s.accounts.GetQuotaWindows(ctx, accountIDs)
	if err != nil {
		return nil, 0, err
	}
	modelQuotaBlocks, err := s.accounts.GetModelQuotaBlocks(ctx, accountIDs, s.now())
	if err != nil {
		return nil, 0, err
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
	return views, total, nil
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
	if billing != nil && billing.IsPaid() {
		periodStart, periodEnd := billing.BillingPeriodStart, billing.BillingPeriodEnd
		if billing.UsagePeriodType != "" {
			periodStart, periodEnd = billing.UsagePeriodStart, billing.UsagePeriodEnd
		}
		result := QuotaView{Type: QuotaTypePaid, Source: "upstreamBilling", Confidence: "observed", Unit: "credits", UsagePercent: billing.CreditUsagePercent, Status: QuotaStatusActive, PeriodStart: periodStart, PeriodEnd: periodEnd}
		if recovery != nil && recovery.Kind == accountdomain.QuotaRecoveryKindPaid {
			result.Status = QuotaStatusWaitingReset
			if recovery.Status == accountdomain.QuotaRecoveryStatusProbing {
				result.Status = QuotaStatusProbing
			}
			result.ExhaustedAt = recovery.ExhaustedAt
			result.NextProbeAt = recovery.NextProbeAt
			result.LastConfirmedAt = recovery.LastConfirmedAt
		}
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
		return result
	}
	// 管理员确认的 Build Super entitlement：覆盖 Free recovery / profile / observed free 等弱信号。
	// 不伪造额度、余额、使用率或账期；Billing 数值保持未知/零。
	if buildSuperEntitled {
		return QuotaView{
			Type: QuotaTypePaid, Source: "buildSuperEntitlement", Confidence: "confirmed",
			Confirmed: true, Status: QuotaStatusActive,
		}
	}
	if recovery != nil && recovery.Status != accountdomain.QuotaRecoveryStatusActive && (recovery.Kind == "" || recovery.Kind == accountdomain.QuotaRecoveryKindFree) {
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
		}
	}
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
