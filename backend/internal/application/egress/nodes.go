package egress

import (
	"context"
	"errors"
	"fmt"
	"strings"

	domain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

func (s *Service) List(ctx context.Context, page, pageSize int, search string, filter ListFilter) ([]domain.PublicNode, int64, error) {
	page, pageSize = repository.NormalizePage(page, pageSize, repository.DefaultPageSize)
	if !validListScope(filter.Scope) || !validListValue(filter.Enabled, "enabled", "disabled") ||
		!validListValue(filter.ProbeStatus, string(domain.ProbeStatusHealthy), string(domain.ProbeStatusUnhealthy), string(domain.ProbeStatusUnknown)) ||
		!validListValue(filter.Assignment, "bound", "unbound") {
		return nil, 0, ErrInvalidFilter
	}
	if !repository.IsValidSort(filter.Sort, "name", "scope", "proxy", "clearance", "health") {
		return nil, 0, ErrInvalidSort
	}
	var enabled *bool
	if filter.Enabled != "" {
		value := filter.Enabled == "enabled"
		enabled = &value
	}
	values, total, err := s.repository.ListEgressNodePage(ctx, repository.EgressNodeListQuery{
		Page: repository.PageQuery{Offset: (page - 1) * pageSize, Limit: pageSize, Search: strings.TrimSpace(search), Sort: filter.Sort},
		Filter: repository.EgressNodeListFilter{
			Scope: filter.Scope, Enabled: enabled, ProbeStatus: domain.ProbeStatus(filter.ProbeStatus), Assignment: filter.Assignment,
		},
	})
	if err != nil {
		return nil, 0, err
	}
	return s.publicNodes(values), total, nil
}

func (s *Service) ListAll(ctx context.Context, scope domain.Scope, sort repository.SortQuery) ([]domain.PublicNode, error) {
	if !validListScope(scope) {
		return nil, ErrInvalidFilter
	}
	if !repository.IsValidSort(sort, "name", "scope", "proxy", "clearance", "health") {
		return nil, ErrInvalidSort
	}
	values, err := s.repository.ListEgressNodes(ctx, scope, sort)
	if err != nil {
		return nil, err
	}
	return s.publicNodes(values), nil
}

func (s *Service) Create(ctx context.Context, input Input) (domain.PublicNode, error) {
	var err error
	input, err = s.resolveProxyProfile(ctx, 0, input)
	if err != nil {
		return domain.PublicNode{}, err
	}
	value, err := s.applyInput(domain.Node{}, input, true)
	if err != nil {
		return domain.PublicNode{}, err
	}
	created, err := s.repository.CreateEgressNode(ctx, value)
	if errors.Is(err, repository.ErrEgressProxyProfileNotFound) {
		return domain.PublicNode{}, ErrProxyProfileNotFound
	}
	if err == nil {
		s.forgetClearance(created.ID)
	}
	return s.publicNode(created), err
}

func (s *Service) Update(ctx context.Context, id uint64, input Input) (domain.PublicNode, error) {
	value, err := s.repository.GetEgressNode(ctx, id)
	if errors.Is(err, repository.ErrNotFound) {
		return domain.PublicNode{}, ErrNotFound
	}
	if err != nil {
		return domain.PublicNode{}, err
	}
	input, err = s.resolveProxyProfile(ctx, value.ProxyProfileID, input)
	if err != nil {
		return domain.PublicNode{}, err
	}
	previousScope := value.Scope
	previousProxyURL := value.EncryptedProxyURL
	value, err = s.applyInput(value, input, false)
	if err != nil {
		return domain.PublicNode{}, err
	}
	if err := s.validateFallbackNodeUpdate(ctx, value); err != nil {
		return domain.PublicNode{}, err
	}
	if previousScope != value.Scope {
		if err := s.validateNodeBindingScope(ctx, value.ID, value.Scope); err != nil {
			return domain.PublicNode{}, err
		}
	}
	updated, err := s.repository.UpdateEgressNode(ctx, value)
	if errors.Is(err, repository.ErrEgressProxyProfileNotFound) {
		return domain.PublicNode{}, ErrProxyProfileNotFound
	}
	if err == nil {
		s.forgetClearance(updated.ID)
		if !updated.Enabled || previousScope != updated.Scope || previousProxyURL != updated.EncryptedProxyURL {
			if clearErr := s.clearQualityLeasesForNodes(ctx, []uint64{updated.ID}); clearErr != nil {
				return s.publicNode(updated), clearErr
			}
		}
	}
	return s.publicNode(updated), err
}

func (s *Service) validateFallbackNodeUpdate(ctx context.Context, node domain.Node) error {
	if s.operations == nil {
		return nil
	}
	config, err := s.operations.GetEgressOperationsConfig(ctx)
	if err != nil {
		return err
	}
	return s.validateFallbackNodeUpdateWithConfig(node, config)
}

func (s *Service) validateFallbackNodeUpdateWithConfig(node domain.Node, config domain.OperationsConfig) error {
	for _, scope := range allServiceScopes() {
		fallback := config.FallbackFor(scope)
		if fallback.Mode != domain.FallbackModeFixed || fallback.NodeID != node.ID {
			continue
		}
		if err := s.validateFixedFallbackNode(scope, node, false); err != nil {
			return fmt.Errorf("节点已配置为 %s 固定回退，无法应用当前修改: %w", scope, err)
		}
	}
	return nil
}

// UpdateManyEnabled changes only the scheduling state, leaving proxy secrets,
// health, probes, and account bindings untouched.
func (s *Service) UpdateManyEnabled(ctx context.Context, nodeIDs []uint64, enabled bool) (int, error) {
	ids := uniqueIDs(nodeIDs)
	if len(ids) == 0 {
		return 0, fmt.Errorf("%w: 代理节点参数无效", ErrInvalidInput)
	}

	// Disabling a fixed fallback would make the persisted routing policy
	// invalid. At most five fallback nodes need point lookups, regardless of
	// the batch size.
	if !enabled && s.operations != nil {
		config, err := s.operations.GetEgressOperationsConfig(ctx)
		if err != nil {
			return 0, err
		}
		selected := make(map[uint64]struct{}, len(ids))
		for _, id := range ids {
			selected[id] = struct{}{}
		}
		fallbackNodeIDs := make(map[uint64]struct{}, len(allServiceScopes()))
		for _, scope := range allServiceScopes() {
			fallback := config.FallbackFor(scope)
			if fallback.Mode == domain.FallbackModeFixed {
				if _, exists := selected[fallback.NodeID]; exists {
					fallbackNodeIDs[fallback.NodeID] = struct{}{}
				}
			}
		}
		for id := range fallbackNodeIDs {
			node, err := s.repository.GetEgressNode(ctx, id)
			if errors.Is(err, repository.ErrNotFound) {
				continue
			}
			if err != nil {
				return 0, err
			}
			node.Enabled = false
			if err := s.validateFallbackNodeUpdateWithConfig(node, config); err != nil {
				return 0, err
			}
		}
	}

	if batch, ok := s.repository.(BatchNodeEnabledUpdater); ok {
		updated, err := batch.UpdateEgressNodesEnabled(ctx, ids, enabled)
		if errors.Is(err, repository.ErrEgressFallbackInUse) {
			return 0, fmt.Errorf("%w: 固定回退节点不能被批量禁用", ErrInvalidInput)
		}
		if err != nil {
			return 0, err
		}
		if updated > 0 {
			s.forgetClearances(ids)
			if !enabled {
				if clearErr := s.clearQualityLeasesForNodes(ctx, ids); clearErr != nil {
					return updated, clearErr
				}
			}
		}
		return updated, nil
	}

	updated := 0
	for _, id := range ids {
		node, err := s.repository.GetEgressNode(ctx, id)
		if errors.Is(err, repository.ErrNotFound) {
			continue
		}
		if err != nil {
			return updated, err
		}
		if node.Enabled == enabled {
			continue
		}
		node.Enabled = enabled
		if _, err := s.repository.UpdateEgressNode(ctx, node); err != nil {
			return updated, err
		}
		s.forgetClearance(id)
		updated++
	}
	if !enabled && updated > 0 {
		if err := s.clearQualityLeasesForNodes(ctx, ids); err != nil {
			return updated, err
		}
	}
	return updated, nil
}

func (s *Service) Delete(ctx context.Context, id uint64) error {
	err := s.repository.DeleteEgressNode(ctx, id)
	if errors.Is(err, repository.ErrNotFound) {
		return ErrNotFound
	}
	if err == nil {
		s.forgetClearance(id)
		s.invalidateOperationsConfig()
	}
	return err
}

// DeleteMany removes nodes in one repository operation when available. The
// relational implementation also clears any account bindings in that same
// transaction, so a deleted node can never remain referenced by an account.
func (s *Service) DeleteMany(ctx context.Context, nodeIDs []uint64) (int, error) {
	ids := uniqueIDs(nodeIDs)
	if len(ids) == 0 {
		return 0, fmt.Errorf("%w: 代理节点参数无效", ErrInvalidInput)
	}
	if batch, ok := s.repository.(BatchNodeDeleter); ok {
		deleted, err := batch.DeleteEgressNodes(ctx, ids)
		if err != nil {
			return 0, err
		}
		for _, id := range ids {
			s.forgetClearance(id)
		}
		s.invalidateOperationsConfig()
		return deleted, nil
	}

	deleted := 0
	for _, id := range ids {
		if err := s.Delete(ctx, id); err != nil {
			if errors.Is(err, ErrNotFound) {
				continue
			}
			return deleted, err
		}
		deleted++
	}
	return deleted, nil
}

func (s *Service) PreviewUnhealthyCleanup(ctx context.Context) (UnhealthyCleanupPreview, error) {
	if cleaner, ok := s.repository.(repository.EgressNodeUnhealthyCleaner); ok {
		value, err := cleaner.PreviewUnhealthyEgressNodes(ctx)
		return UnhealthyCleanupPreview{
			Nodes: value.Nodes, BoundAccounts: value.BoundAccounts, SubscriptionManaged: value.SubscriptionManaged,
		}, err
	}
	values, err := s.repository.ListEgressNodes(ctx, "", repository.SortQuery{})
	if err != nil {
		return UnhealthyCleanupPreview{}, err
	}
	result := UnhealthyCleanupPreview{}
	for _, value := range values {
		if value.IPv4Probe.Status != domain.ProbeStatusUnhealthy || value.IPv6Probe.Status != domain.ProbeStatusUnhealthy {
			continue
		}
		result.Nodes++
		result.BoundAccounts += int64(value.AssignedAccountCount)
		if value.SourceID != 0 {
			result.SubscriptionManaged++
		}
	}
	return result, nil
}

func (s *Service) DeleteUnhealthy(ctx context.Context) (int, error) {
	if cleaner, ok := s.repository.(repository.EgressNodeUnhealthyCleaner); ok {
		ids, err := cleaner.DeleteUnhealthyEgressNodes(ctx)
		if err != nil {
			return 0, err
		}
		for _, id := range ids {
			s.forgetClearance(id)
		}
		if len(ids) > 0 {
			s.invalidateOperationsConfig()
		}
		return len(ids), nil
	}
	values, err := s.repository.ListEgressNodes(ctx, "", repository.SortQuery{})
	if err != nil {
		return 0, err
	}
	ids := make([]uint64, 0)
	for _, value := range values {
		if value.IPv4Probe.Status == domain.ProbeStatusUnhealthy && value.IPv6Probe.Status == domain.ProbeStatusUnhealthy {
			ids = append(ids, value.ID)
		}
	}
	if len(ids) == 0 {
		return 0, nil
	}
	return s.DeleteMany(ctx, ids)
}

func (s *Service) RefreshClearance(ctx context.Context, id uint64) error {
	if _, err := s.repository.GetEgressNode(ctx, id); errors.Is(err, repository.ErrNotFound) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	s.mu.RLock()
	manager := s.clearance
	s.mu.RUnlock()
	if manager == nil {
		return ErrClearanceUnavailable
	}
	return manager.RefreshClearance(ctx, id)
}

func (s *Service) applyInput(value domain.Node, input Input, create bool) (domain.Node, error) {
	proxyPool := value.ProxyPool
	if input.ProxyPool != nil {
		proxyPool = *input.ProxyPool
	}
	profileChanged := input.ProxyProfileID != nil && value.ProxyProfileID != *input.ProxyProfileID
	configurationChanged := create || value.Scope != input.Scope || value.ProxyPool != proxyPool || (!value.Enabled && input.Enabled) || input.ClearProxyURL || input.ProxyURL != nil || profileChanged
	name := strings.TrimSpace(input.Name)
	if name == "" || len(name) > 160 {
		return domain.Node{}, fmt.Errorf("%w: 名称必须在 1 到 160 个字符之间", ErrInvalidInput)
	}
	if !validListScope(input.Scope) || input.Scope == "" {
		return domain.Node{}, fmt.Errorf("%w: scope 必须是 grok_build、grok_web、grok_console、grok_web_asset 或 grok_console_asset", ErrInvalidInput)
	}
	value.Name, value.Scope, value.Enabled, value.ProxyPool = name, input.Scope, input.Enabled, proxyPool
	if input.AccountCapacity != nil {
		if *input.AccountCapacity < 0 || *input.AccountCapacity > 100000 {
			return domain.Node{}, fmt.Errorf("%w: 每个代理的账号容量必须在 0 到 100000 之间", ErrInvalidInput)
		}
		value.AccountCapacity = *input.AccountCapacity
	}
	if input.Scope == domain.ScopeBuild {
		// Build 请求始终沿用 Provider 生成的 CLI User-Agent，出口节点不得覆盖协议身份。
		value.UserAgent = ""
	} else {
		value.UserAgent = strings.TrimSpace(input.UserAgent)
	}
	if input.Scope != domain.ScopeBuild && value.UserAgent == "" {
		s.mu.RLock()
		value.UserAgent = s.browserUA
		s.mu.RUnlock()
	}
	if len(value.UserAgent) > 512 {
		return domain.Node{}, fmt.Errorf("%w: User-Agent 过长", ErrInvalidInput)
	}
	if input.ProxyProfileID != nil {
		if value.SourceID != 0 && *input.ProxyProfileID != 0 {
			return domain.Node{}, fmt.Errorf("%w: 订阅管理的节点不能绑定共享代理配置", ErrInvalidInput)
		}
		value.ProxyProfileID = *input.ProxyProfileID
	} else if input.ClearProxyURL || input.ProxyURL != nil {
		value.ProxyProfileID = 0
	}
	if input.ClearProxyURL {
		value.EncryptedProxyURL = ""
		value.ProxyPool = false
	} else if input.ProxyURL != nil {
		normalized, err := NormalizeProxyURL(*input.ProxyURL)
		if err != nil {
			return domain.Node{}, fmt.Errorf("%w: %v", ErrInvalidInput, err)
		}
		if normalized != "" {
			value.EncryptedProxyURL, err = s.cipher.Encrypt(normalized)
			if err != nil {
				return domain.Node{}, err
			}
		}
	}
	if value.ProxyPool && strings.TrimSpace(value.EncryptedProxyURL) == "" {
		return domain.Node{}, fmt.Errorf("%w: 代理池模式需要配置代理地址", ErrInvalidInput)
	}
	if input.Scope == domain.ScopeBuild || input.Scope == domain.ScopeConsoleAsset {
		value.EncryptedCloudflareCookie = ""
	} else if input.ClearCookies {
		value.EncryptedCloudflareCookie = ""
	} else if input.CloudflareCookies != nil {
		if len(*input.CloudflareCookies) > maxCloudflareCookieBytes {
			return domain.Node{}, fmt.Errorf("%w: Cloudflare Cookie 不能超过 16 KiB", ErrInvalidInput)
		}
		cookies := SanitizeCloudflareCookies(*input.CloudflareCookies)
		if cookies != "" || create {
			var err error
			value.EncryptedCloudflareCookie, err = s.cipher.Encrypt(cookies)
			if err != nil {
				return domain.Node{}, err
			}
		}
	}
	if configurationChanged {
		value.Health = 1
		value.FailureCount = 0
		value.CooldownUntil = nil
		value.LastError = ""
		value.ProbeStatus = domain.ProbeStatusUnknown
		value.LastProbedAt = nil
		value.ProbeLatencyMS = 0
		value.ExitIP = ""
		value.ProbeError = ""
		value.ProbeProvider = ""
		value.IPv4Probe = domain.ProbeFamilyResult{Status: domain.ProbeStatusUnknown}
		value.IPv6Probe = domain.ProbeFamilyResult{Status: domain.ProbeStatusUnknown}
	}
	// Any administrator edit invalidates freshness. Keep the binding fingerprint:
	// managed mode may use the existing cookie as last-known-good only when the
	// target and actual proxy still match the binding that produced it.
	value.ClearanceRefreshedAt = nil
	value.ClearanceFingerprint = ""
	return value, nil
}
