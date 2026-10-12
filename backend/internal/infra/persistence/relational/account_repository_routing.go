package relational

import (
	"context"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
)

// ListRoutingCandidates 批量加载账号、额度、恢复状态和目标模型能力，避免推理热路径按账号逐条查询。
func (r *AccountRepository) ListRoutingCandidates(ctx context.Context, provider account.Provider, modelRouteID uint64, upstreamModel, quotaMode string) ([]account.RoutingCandidate, error) {
	values, err := r.listRoutingCredentials(ctx, provider)
	if err != nil {
		return nil, err
	}
	values, bound, err := r.filterRoutingCandidatesByBinding(ctx, provider, modelRouteID, upstreamModel, values)
	if err != nil {
		return nil, err
	}
	billings, err := r.getRoutingBillings(ctx, provider)
	if err != nil {
		return nil, err
	}
	recoveries, err := r.getRoutingQuotaRecoveries(ctx, provider)
	if err != nil {
		return nil, err
	}
	quotaWindows, err := r.getRoutingQuotaWindows(ctx, provider, quotaMode, values)
	if err != nil {
		return nil, err
	}
	egressLeaseBlocks, err := r.getRoutingEgressLeaseBlocks(ctx, provider, values, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	known, supported, modelQuotaBlocks, err := r.loadRoutingModelCapabilities(ctx, provider, upstreamModel, len(values))
	if err != nil {
		return nil, err
	}
	sharedSuperBuildModel := hasSharedSuperBuildModel(provider, values, supported, billings, bound)
	result := make([]account.RoutingCandidate, 0, len(values))
	staticProviderModel := (provider == account.ProviderConsole && strings.TrimSpace(quotaMode) != "") ||
		(provider == account.ProviderWeb && account.IsWebImagineQuotaMode(quotaMode))
	for _, value := range values {
		capabilityKnown, supportsModel := routingCandidateCapability(value, billings, known, supported, bound, staticProviderModel, sharedSuperBuildModel)
		result = append(result, buildRoutingCandidate(value, capabilityKnown, supportsModel, billings, recoveries, quotaWindows, modelQuotaBlocks, egressLeaseBlocks))
	}
	return result, nil
}

// filterRoutingCandidatesByBinding 在指定上游模型时只保留显式绑定到该模型路由的账号。
func (r *AccountRepository) filterRoutingCandidatesByBinding(ctx context.Context, provider account.Provider, modelRouteID uint64, upstreamModel string, values []account.Credential) ([]account.Credential, map[uint64]bool, error) {
	bound := make(map[uint64]bool)
	if strings.TrimSpace(upstreamModel) == "" {
		return values, bound, nil
	}
	boundIDs, err := r.listRoutingBoundAccountIDs(ctx, provider, modelRouteID, upstreamModel)
	if err != nil {
		return nil, nil, err
	}
	if len(boundIDs) == 0 {
		return values, bound, nil
	}
	for _, id := range boundIDs {
		bound[id] = true
	}
	filtered := values[:0]
	for _, value := range values {
		if bound[value.ID] {
			filtered = append(filtered, value)
		}
	}
	return filtered, bound, nil
}

// loadRoutingModelCapabilities 批量加载模型同步状态、模型能力与模型级额度封锁，避免推理热路径逐账号查询。
func (r *AccountRepository) loadRoutingModelCapabilities(ctx context.Context, provider account.Provider, upstreamModel string, accountCount int) (map[uint64]bool, map[uint64]bool, map[uint64]account.ModelQuotaBlock, error) {
	if strings.TrimSpace(upstreamModel) == "" || accountCount == 0 {
		return map[uint64]bool{}, map[uint64]bool{}, map[uint64]account.ModelQuotaBlock{}, nil
	}
	known, err := r.loadRoutingKnownAccountIDs(ctx, provider, accountCount)
	if err != nil {
		return nil, nil, nil, err
	}
	supported, err := r.loadRoutingSupportedAccountIDs(ctx, provider, upstreamModel, accountCount)
	if err != nil {
		return nil, nil, nil, err
	}
	modelQuotaBlocks, err := r.loadRoutingModelQuotaBlocks(ctx, provider, upstreamModel, accountCount)
	if err != nil {
		return nil, nil, nil, err
	}
	return known, supported, modelQuotaBlocks, nil
}

// loadRoutingKnownAccountIDs 加载已成功同步过模型的账号集合。
func (r *AccountRepository) loadRoutingKnownAccountIDs(ctx context.Context, provider account.Provider, capacity int) (map[uint64]bool, error) {
	known := make(map[uint64]bool, capacity)
	var states []accountModelSyncStateModel
	if err := r.db.db.WithContext(ctx).
		Table("account_model_sync_states AS state").
		Select("state.*").
		Joins("JOIN provider_accounts AS account ON account.id = state.account_id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ? AND state.last_success_at IS NOT NULL", provider, true, account.AuthStatusActive).
		Find(&states).Error; err != nil {
		return nil, err
	}
	for _, state := range states {
		known[state.AccountID] = true
	}
	return known, nil
}

// loadRoutingSupportedAccountIDs 加载声明支持目标上游模型的账号集合。
func (r *AccountRepository) loadRoutingSupportedAccountIDs(ctx context.Context, provider account.Provider, upstreamModel string, capacity int) (map[uint64]bool, error) {
	supported := make(map[uint64]bool, capacity)
	var capabilities []accountModelCapabilityModel
	if err := r.db.db.WithContext(ctx).
		Table("account_model_capabilities AS capability").
		Select("capability.*").
		Joins("JOIN provider_accounts AS account ON account.id = capability.account_id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ? AND capability.upstream_model = ?", provider, true, account.AuthStatusActive, upstreamModel).
		Find(&capabilities).Error; err != nil {
		return nil, err
	}
	for _, capability := range capabilities {
		supported[capability.AccountID] = true
	}
	return supported, nil
}

// loadRoutingModelQuotaBlocks 加载仍在冷却中的模型级额度封锁。
func (r *AccountRepository) loadRoutingModelQuotaBlocks(ctx context.Context, provider account.Provider, upstreamModel string, capacity int) (map[uint64]account.ModelQuotaBlock, error) {
	modelQuotaBlocks := make(map[uint64]account.ModelQuotaBlock, capacity)
	var blockRows []accountModelQuotaBlockModel
	if err := r.db.db.WithContext(ctx).
		Table("account_model_quota_blocks AS block").
		Select("block.*").
		Joins("JOIN provider_accounts AS account ON account.id = block.account_id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ? AND block.upstream_model = ? AND block.cooldown_until > ?", provider, true, account.AuthStatusActive, upstreamModel, time.Now().UTC()).
		Find(&blockRows).Error; err != nil {
		return nil, err
	}
	for _, row := range blockRows {
		modelQuotaBlocks[row.AccountID] = account.ModelQuotaBlock{AccountID: row.AccountID, UpstreamModel: row.UpstreamModel, Reason: row.Reason, CooldownUntil: row.CooldownUntil.UTC(), UpdatedAt: row.UpdatedAt.UTC()}
	}
	return modelQuotaBlocks, nil
}

// hasSharedSuperBuildModel 判断 Build 号池在无显式绑定时是否存在共享的 Super 模型账号。
func hasSharedSuperBuildModel(provider account.Provider, values []account.Credential, supported map[uint64]bool, billings map[uint64]account.Billing, bound map[uint64]bool) bool {
	if provider != account.ProviderBuild || len(bound) > 0 {
		return false
	}
	for _, value := range values {
		if !supported[value.ID] {
			continue
		}
		if account.IsBuildSuper(value, routingBillingPointer(value, billings)) {
			return true
		}
	}
	return false
}

// routingCandidateCapability 决定候选账号在当前请求下的模型能力标记。
func routingCandidateCapability(value account.Credential, billings map[uint64]account.Billing, known, supported, bound map[uint64]bool, staticProviderModel, sharedSuperBuildModel bool) (bool, bool) {
	capabilityKnown, supportsModel := known[value.ID], supported[value.ID]
	switch {
	case staticProviderModel:
		// Console and Web Imagine expose provider-wide static catalogs.
		// Historical account snapshots may predate newly shipped catalog
		// entries, but must not make those routes unroutable. A recognized
		// quota mode proves the adapter knows the model; unknown/manual models
		// keep snapshot-based gating.
		return true, true
	case len(bound) > 0:
		return true, true
	case sharedSuperBuildModel && account.IsBuildSuper(value, routingBillingPointer(value, billings)):
		return true, true
	}
	return capabilityKnown, supportsModel
}

// buildRoutingCandidate 组装候选账号及其计费、恢复、额度窗口、模型与出口覆盖信息。
func buildRoutingCandidate(value account.Credential, capabilityKnown, supportsModel bool, billings map[uint64]account.Billing, recoveries map[uint64]account.QuotaRecovery, quotaWindows map[uint64]account.QuotaWindow, modelQuotaBlocks map[uint64]account.ModelQuotaBlock, egressLeaseBlocks map[uint64]account.EgressLeaseBlock) account.RoutingCandidate {
	candidate := account.RoutingCandidate{Credential: value, ModelCapabilityKnown: capabilityKnown, SupportsModel: supportsModel}
	if billing, ok := billings[value.ID]; ok {
		candidate.Billing = &billing
	}
	if recovery, ok := recoveries[value.ID]; ok {
		candidate.QuotaRecovery = &recovery
	}
	if window, ok := quotaWindows[value.ID]; ok {
		candidate.QuotaWindow = &window
	}
	if block, ok := modelQuotaBlocks[value.ID]; ok {
		candidate.ModelQuotaBlock = &block
	}
	if block, ok := egressLeaseBlocks[value.ID]; ok {
		candidate.EgressLeaseBlock = &block
	}
	return candidate
}

// routingBillingPointer 返回账号的计费快照指针，缺失时返回 nil。
func routingBillingPointer(value account.Credential, billings map[uint64]account.Billing) *account.Billing {
	snapshot, exists := billings[value.ID]
	if !exists {
		return nil
	}
	return &snapshot
}

func (r *AccountRepository) ListRoutingAccountBases(ctx context.Context, provider account.Provider, quotaMode string) ([]account.RoutingAccountBase, error) {
	values, err := r.listRoutingCredentials(ctx, provider)
	if err != nil {
		return nil, err
	}
	billings, err := r.getRoutingBillings(ctx, provider)
	if err != nil {
		return nil, err
	}
	recoveries, err := r.getRoutingQuotaRecoveries(ctx, provider)
	if err != nil {
		return nil, err
	}
	quotaWindows, err := r.getRoutingQuotaWindows(ctx, provider, quotaMode, values)
	if err != nil {
		return nil, err
	}
	egressLeaseBlocks, err := r.getRoutingEgressLeaseBlocks(ctx, provider, values, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	result := make([]account.RoutingAccountBase, 0, len(values))
	for _, value := range values {
		base := account.RoutingAccountBase{Credential: value}
		if billing, ok := billings[value.ID]; ok {
			base.Billing = &billing
		}
		if recovery, ok := recoveries[value.ID]; ok {
			base.QuotaRecovery = &recovery
		}
		if window, ok := quotaWindows[value.ID]; ok {
			base.QuotaWindow = &window
		}
		if block, ok := egressLeaseBlocks[value.ID]; ok {
			base.EgressLeaseBlock = &block
		}
		result = append(result, base)
	}
	return result, nil
}

func (r *AccountRepository) getRoutingEgressLeaseBlocks(ctx context.Context, provider account.Provider, values []account.Credential, now time.Time) (map[uint64]account.EgressLeaseBlock, error) {
	result := make(map[uint64]account.EgressLeaseBlock)
	if len(values) == 0 {
		return result, nil
	}
	var rows []accountEgressLeaseBlockModel
	if err := r.db.db.WithContext(ctx).
		Table("account_egress_lease_blocks AS block").
		Select("block.*").
		Joins("JOIN provider_accounts AS account ON account.id = block.account_id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ? AND (account.egress_node_id IS NULL OR account.egress_node_id = block.node_id) AND block.cooldown_until > ?", provider, true, account.AuthStatusActive, now.UTC()).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		block := egressLeaseBlockFromModel(row)
		current, exists := result[row.AccountID]
		if !exists || block.CooldownUntil.After(current.CooldownUntil) {
			result[row.AccountID] = block
		}
	}
	return result, nil
}

// listRoutingCredentials loads only the account state required to decide which
// account to use. Provider secrets deliberately stay in account_credentials
// until a selected account is hydrated for the upstream call.
func (r *AccountRepository) listRoutingCredentials(ctx context.Context, provider account.Provider) ([]account.Credential, error) {
	rows, err := r.listActiveProviderAccountRows(ctx, provider, routingCredentialMetadataColumns)
	if err != nil {
		return nil, err
	}
	values := make([]account.Credential, 0, len(rows))
	for _, row := range rows {
		values = append(values, toAccountDomain(row))
	}
	if err := r.attachRoutingEgressIdentities(ctx, provider, values); err != nil {
		return nil, err
	}
	return values, nil
}

func (r *AccountRepository) ListRoutingAccountOverlays(ctx context.Context, provider account.Provider, modelRouteID uint64, upstreamModel string) (account.RoutingOverlaySnapshot, error) {
	upstreamModel = strings.TrimSpace(upstreamModel)
	if upstreamModel == "" {
		return account.RoutingOverlaySnapshot{}, nil
	}
	boundIDs, err := r.listRoutingBoundAccountIDs(ctx, provider, modelRouteID, upstreamModel)
	if err != nil {
		return account.RoutingOverlaySnapshot{}, err
	}
	values := make(map[uint64]account.RoutingAccountOverlay)
	for _, id := range boundIDs {
		values[id] = account.RoutingAccountOverlay{AccountID: id, Bound: true, ModelCapabilityKnown: true, SupportsModel: true}
	}
	if err := r.loadRoutingOverlayCapabilityKnown(ctx, provider, values); err != nil {
		return account.RoutingOverlaySnapshot{}, err
	}
	if err := r.loadRoutingOverlaySupportsModel(ctx, provider, upstreamModel, values); err != nil {
		return account.RoutingOverlaySnapshot{}, err
	}
	if err := r.loadRoutingOverlayModelQuotaBlocks(ctx, provider, upstreamModel, values); err != nil {
		return account.RoutingOverlaySnapshot{}, err
	}
	result := account.RoutingOverlaySnapshot{HasBindings: len(boundIDs) > 0, Values: make([]account.RoutingAccountOverlay, 0, len(values))}
	for _, value := range values {
		result.Values = append(result.Values, value)
	}
	return result, nil
}

// loadRoutingOverlayCapabilityKnown 在覆盖快照上标记已成功同步过模型的账号。
func (r *AccountRepository) loadRoutingOverlayCapabilityKnown(ctx context.Context, provider account.Provider, values map[uint64]account.RoutingAccountOverlay) error {
	var states []accountModelSyncStateModel
	if err := r.db.db.WithContext(ctx).
		Table("account_model_sync_states AS state").
		Select("state.account_id").
		Joins("JOIN provider_accounts AS account ON account.id = state.account_id").
		Where("account.provider = ? AND account.enabled = TRUE AND state.last_success_at IS NOT NULL", provider).
		Find(&states).Error; err != nil {
		return err
	}
	for _, state := range states {
		overlay := values[state.AccountID]
		overlay.AccountID = state.AccountID
		overlay.ModelCapabilityKnown = true
		values[state.AccountID] = overlay
	}
	return nil
}

// loadRoutingOverlaySupportsModel 在覆盖快照上标记声明支持目标上游模型的账号。
func (r *AccountRepository) loadRoutingOverlaySupportsModel(ctx context.Context, provider account.Provider, upstreamModel string, values map[uint64]account.RoutingAccountOverlay) error {
	var capabilities []accountModelCapabilityModel
	if err := r.db.db.WithContext(ctx).
		Table("account_model_capabilities AS capability").
		Select("capability.account_id").
		Joins("JOIN provider_accounts AS account ON account.id = capability.account_id").
		Where("account.provider = ? AND account.enabled = TRUE AND capability.upstream_model = ?", provider, upstreamModel).
		Find(&capabilities).Error; err != nil {
		return err
	}
	for _, capability := range capabilities {
		overlay := values[capability.AccountID]
		overlay.AccountID = capability.AccountID
		overlay.SupportsModel = true
		values[capability.AccountID] = overlay
	}
	return nil
}

// loadRoutingOverlayModelQuotaBlocks 在覆盖快照上标记仍在冷却中的模型级额度封锁。
func (r *AccountRepository) loadRoutingOverlayModelQuotaBlocks(ctx context.Context, provider account.Provider, upstreamModel string, values map[uint64]account.RoutingAccountOverlay) error {
	var blockRows []accountModelQuotaBlockModel
	if err := r.db.db.WithContext(ctx).
		Table("account_model_quota_blocks AS block").
		Select("block.account_id", "block.upstream_model", "block.reason", "block.cooldown_until", "block.updated_at").
		Joins("JOIN provider_accounts AS account ON account.id = block.account_id").
		Where("account.provider = ? AND account.enabled = TRUE AND block.upstream_model = ? AND block.cooldown_until > ?", provider, upstreamModel, time.Now().UTC()).
		Find(&blockRows).Error; err != nil {
		return err
	}
	for _, row := range blockRows {
		overlay := values[row.AccountID]
		overlay.AccountID = row.AccountID
		overlay.ModelQuotaBlock = &account.ModelQuotaBlock{AccountID: row.AccountID, UpstreamModel: row.UpstreamModel, Reason: row.Reason, CooldownUntil: row.CooldownUntil.UTC(), UpdatedAt: row.UpdatedAt.UTC()}
		values[row.AccountID] = overlay
	}
	return nil
}

func (r *AccountRepository) listRoutingBoundAccountIDs(ctx context.Context, provider account.Provider, modelRouteID uint64, upstreamModel string) ([]uint64, error) {
	query := r.db.db.WithContext(ctx).
		Table("model_route_accounts AS binding").
		Select("binding.account_id").
		Joins("JOIN model_routes AS route ON route.id = binding.model_route_id")
	if modelRouteID > 0 {
		query = query.Where("route.id = ? AND route.provider = ? AND route.upstream_model = ?", modelRouteID, provider, upstreamModel)
	} else {
		query = query.Where("route.provider = ? AND route.upstream_model = ?", provider, upstreamModel)
	}
	var accountIDs []uint64
	if err := query.Scan(&accountIDs).Error; err != nil {
		return nil, err
	}
	return accountIDs, nil
}

// attachRoutingEgressIdentities 只补充推理路由需要的稳定出口身份。
// 管理端展示所需的账号名称和 linkedAccounts 仍由 attachAccountLinks 加载，
// 避免路由候选缓存刷新时额外查询两类完整关系。
func (r *AccountRepository) attachRoutingEgressIdentities(ctx context.Context, provider account.Provider, values []account.Credential) error {
	if len(values) == 0 || provider == account.ProviderWeb {
		return nil
	}
	positions := make(map[uint64]int, len(values))
	for index := range values {
		positions[values[index].ID] = index
	}
	type identityRow struct {
		AccountID      uint64
		WebSourceKey   string
		EgressIdentity string
	}
	var rows []identityRow
	query := r.db.db.WithContext(ctx)
	switch provider {
	case account.ProviderBuild:
		query = query.Table("account_provider_links AS link").
			Select("link.build_account_id AS account_id, web.source_key AS web_source_key, profile.egress_identity").
			Joins("JOIN provider_accounts AS target ON target.id = link.build_account_id").
			Joins("JOIN provider_accounts AS web ON web.id = link.web_account_id").
			Joins("LEFT JOIN web_account_profiles AS profile ON profile.account_id = web.id").
			Where("target.provider = ? AND target.enabled = ? AND target.auth_status = ?", provider, true, account.AuthStatusActive)
	case account.ProviderConsole:
		query = query.Table("web_console_account_links AS link").
			Select("link.console_account_id AS account_id, web.source_key AS web_source_key, profile.egress_identity").
			Joins("JOIN provider_accounts AS target ON target.id = link.console_account_id").
			Joins("JOIN provider_accounts AS web ON web.id = link.web_account_id").
			Joins("LEFT JOIN web_account_profiles AS profile ON profile.account_id = web.id").
			Where("target.provider = ? AND target.enabled = ? AND target.auth_status = ?", provider, true, account.AuthStatusActive)
	default:
		return nil
	}
	if err := query.Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		if index, ok := positions[row.AccountID]; ok {
			values[index].EgressIdentity = linkedWebEgressIdentity(row.EgressIdentity, row.WebSourceKey)
		}
	}
	return nil
}

func linkedWebEgressIdentity(stored, sourceKey string) string {
	if value := strings.TrimSpace(stored); value != "" {
		return value
	}
	value, _ := egressIdentityFromWebSourceKey(sourceKey)
	return value
}
