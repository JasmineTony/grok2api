package egress

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	application "github.com/chenyme/grok2api/backend/internal/application/egress"
	domain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

func (m *Manager) refreshNode(ctx context.Context, node domain.Node, proxyURL, key string, persist, force, waitForPeer bool, refreshAfter time.Time) (clearanceSolution, error) {
	m.clearanceMu.Lock()
	cfg := m.clearanceConfig
	solveVersion := m.clearanceVersion
	solver := m.solver
	lock := m.clearanceLock
	m.clearanceMu.Unlock()
	if cfg.Mode != "flaresolverr" && cfg.Mode != "on_demand" {
		return clearanceSolution{}, errors.New("FlareSolverr Clearance 未启用")
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = time.Minute
	}
	fingerprint := clearanceFingerprint(cfg, proxyURL)
	bindingFingerprint := clearanceBindingFingerprint(cfg, proxyURL)
	interval := clearanceRefreshInterval(cfg)
	if persist && node.ID != 0 && lock != nil {
		release, acquired, err := lock.Acquire(ctx, "egress-clearance:"+strconv.FormatUint(node.ID, 10), timeout+clearanceLockGrace)
		if err != nil {
			return clearanceSolution{}, fmt.Errorf("协调 Clearance 刷新: %w", err)
		}
		if !acquired {
			if !force {
				if solution, refreshedAt, ok := m.loadPersistedClearance(ctx, node.ID, fingerprint, bindingFingerprint, interval); ok {
					m.cacheClearance(key, solution, refreshedAt, solveVersion, fingerprint, bindingFingerprint, interval)
					return solution, nil
				}
			}
			if waitForPeer {
				if solution, refreshedAt, ok := m.waitPersistedClearance(ctx, node.ID, fingerprint, bindingFingerprint, interval, timeout, refreshAfter); ok {
					m.cacheClearance(key, solution, refreshedAt, solveVersion, fingerprint, bindingFingerprint, interval)
					return solution, nil
				}
			}
			return clearanceSolution{}, errors.New("另一个实例正在刷新 Cloudflare Clearance")
		}
		defer release()
		if solution, refreshedAt, ok := m.loadPersistedClearance(ctx, node.ID, fingerprint, bindingFingerprint, interval); ok {
			// A peer may have refreshed the rejected Clearance immediately before
			// this instance acquired the distributed lock. Reuse that newer result
			// instead of performing a duplicate browser solve. A force refresh with
			// no newer persisted generation must still reach the solver.
			if !force || (!refreshAfter.IsZero() && refreshedAt.After(refreshAfter)) {
				m.cacheClearance(key, solution, refreshedAt, solveVersion, fingerprint, bindingFingerprint, interval)
				return solution, nil
			}
		}
	}
	solveCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	solution, err := solver.Solve(solveCtx, cfg, proxyURL)
	if err != nil {
		m.recordClearanceError(ctx, node, persist)
		return clearanceSolution{}, fmt.Errorf("刷新出口 %q 的 Cloudflare Clearance: %w", node.Name, err)
	}
	now := time.Now().UTC()
	if persist && node.ID != 0 {
		encryptedCookies, encryptErr := m.cipher.Encrypt(solution.Cookies)
		if encryptErr != nil {
			return clearanceSolution{}, encryptErr
		}
		if stateRepository, ok := m.repository.(egressStateRepository); ok {
			if updateErr := stateRepository.UpdateEgressNodeClearance(ctx, node.ID, encryptedCookies, solution.UserAgent, fingerprint, bindingFingerprint, now); updateErr != nil {
				return clearanceSolution{}, updateErr
			}
		} else {
			latest, loadErr := m.repository.GetEgressNode(ctx, node.ID)
			if loadErr != nil {
				return clearanceSolution{}, loadErr
			}
			latest.EncryptedCloudflareCookie = encryptedCookies
			latest.UserAgent = solution.UserAgent
			latest.ClearanceFingerprint = fingerprint
			latest.ClearanceBindingFingerprint = bindingFingerprint
			latest.ClearanceRefreshedAt = &now
			latest.LastError = ""
			if _, updateErr := m.repository.UpdateEgressNode(ctx, latest); updateErr != nil {
				return clearanceSolution{}, updateErr
			}
		}
		m.invalidateNodes(node.Scope)
	}
	m.cacheClearance(key, solution, now, solveVersion, fingerprint, bindingFingerprint, interval)
	return solution, nil
}

func (m *Manager) RefreshClearance(ctx context.Context, nodeID uint64) error {
	if nodeID == 0 {
		_, err, _ := m.clearanceLoads.Do("direct", func() (any, error) {
			return m.refreshNode(ctx, domain.Node{Name: "direct", Scope: domain.ScopeWeb, Enabled: true}, "", "direct", false, true, true, time.Time{})
		})
		return err
	}
	node, err := m.repository.GetEgressNode(ctx, nodeID)
	if err != nil {
		return err
	}
	if !isGrokWebScope(node.Scope) {
		return fmt.Errorf("出口节点 %q 不支持 Clearance 刷新", node.Name)
	}
	proxyURL, err := m.cipher.Decrypt(node.EncryptedProxyURL)
	if err != nil {
		return err
	}
	if strings.Contains(proxyURL, application.ProxyAccountPlaceholder) {
		return fmt.Errorf("出口节点 %q 使用账号粘性代理，将在账号请求时按租约自动刷新 Clearance", node.Name)
	}
	proxyURL, err = application.NormalizeProxyURL(proxyURL)
	if err != nil {
		return err
	}
	key := clearanceCacheKey(node.ID, proxyURL, false)
	_, err, _ = m.clearanceLoads.Do(key, func() (any, error) {
		return m.refreshNode(ctx, node, proxyURL, key, true, true, true, time.Time{})
	})
	return err
}

func (m *Manager) InvalidateClearance(nodeID uint64) {
	m.clearanceMu.Lock()
	prefix := "node:" + strconv.FormatUint(nodeID, 10)
	if nodeID == 0 {
		prefix = "direct"
	}
	for key, state := range m.clearances {
		if key == prefix || strings.HasPrefix(key, prefix+":") {
			state.invalid = true
			state.used = true
			m.clearances[key] = state
		}
	}
	m.clearanceMu.Unlock()
	m.clientMu.Lock()
	stale := m.invalidateClientLocked(nodeID)
	m.clientMu.Unlock()
	closeRequestClients(stale)
}

// ForgetClearance evicts runtime state after an administrator changes or
// removes a node. Unlike a 403 rejection, it does not mark the persisted
// last-known-good cookie as invalid; ensureClearance will still verify its
// binding before using it as a solver-failure fallback.
func (m *Manager) ForgetClearance(nodeID uint64) {
	m.ForgetClearances([]uint64{nodeID})
}

// ForgetClearances evicts a batch of node-scoped runtime state with one cache
// scan and one lock acquisition. Administrative bulk updates can contain
// thousands of nodes, so repeating the global snapshot invalidation per ID
// would add avoidable lock contention and CPU work.
func (m *Manager) ForgetClearances(nodeIDs []uint64) {
	ids := make(map[uint64]struct{}, len(nodeIDs))
	prefixes := make(map[string]struct{}, len(nodeIDs))
	for _, nodeID := range nodeIDs {
		if _, exists := ids[nodeID]; exists {
			continue
		}
		ids[nodeID] = struct{}{}
		prefix := "node:" + strconv.FormatUint(nodeID, 10)
		if nodeID == 0 {
			prefix = "direct"
		}
		prefixes[prefix] = struct{}{}
	}
	if len(ids) == 0 {
		return
	}
	m.clearanceMu.Lock()
	m.nodeMu.Lock()
	m.clientMu.Lock()
	for key := range m.clearances {
		prefix := key
		if strings.HasPrefix(key, "node:") {
			if separator := strings.IndexByte(key[len("node:"):], ':'); separator >= 0 {
				prefix = key[:len("node:")+separator]
			}
		} else if strings.HasPrefix(key, "direct:") {
			prefix = "direct"
		}
		if _, selected := prefixes[prefix]; selected {
			delete(m.clearances, key)
		}
	}
	// Node mutations are rare administration operations. Clearing the small
	// one-second snapshots prevents a just-edited proxy from being used once
	// more before its scope cache expires.
	if m.nodeVersions == nil {
		m.nodeVersions = make(map[domain.Scope]uint64)
	}
	for _, scope := range allEgressScopes() {
		m.nodeVersions[scope]++
	}
	clear(m.nodes)
	clear(m.healthyNodes)
	var stale []requestClient
	for nodeID := range ids {
		m.invalidateClientVersionLocked(nodeID)
	}
	for key, cached := range m.clients {
		if _, selected := ids[key.nodeID]; !selected {
			continue
		}
		delete(m.clients, key)
		stale = append(stale, cached.client)
	}
	m.clientMu.Unlock()
	m.nodeMu.Unlock()
	m.clearanceMu.Unlock()
	closeRequestClients(stale)
}

func (m *Manager) RefreshDueClearances(ctx context.Context, force bool) error {
	m.clearanceMu.Lock()
	cfg := m.clearanceConfig
	direct := m.clearances["direct"]
	version := m.clearanceVersion
	m.clearanceMu.Unlock()
	if cfg.Mode != "flaresolverr" {
		return nil
	}
	interval := clearanceRefreshInterval(cfg)
	now := time.Now().UTC()
	nodes, err := m.repository.ListEgressNodes(ctx, "", repository.SortQuery{})
	if err != nil {
		return err
	}
	var refreshErrors []error
	webNodeCount := 0
	for _, node := range nodes {
		if !node.Enabled || !isGrokWebScope(node.Scope) {
			continue
		}
		webNodeCount++
		proxyURL, decryptErr := m.cipher.Decrypt(node.EncryptedProxyURL)
		if decryptErr != nil {
			refreshErrors = append(refreshErrors, decryptErr)
			continue
		}
		if strings.Contains(proxyURL, application.ProxyAccountPlaceholder) {
			// Resin clearance is account/IP bound and has no safe node-wide value
			// for a background task to solve or persist.
			continue
		}
		proxyURL, normalizeErr := application.NormalizeProxyURL(proxyURL)
		if normalizeErr != nil {
			refreshErrors = append(refreshErrors, normalizeErr)
			continue
		}
		m.clearanceMu.Lock()
		key := clearanceCacheKey(node.ID, proxyURL, false)
		state, known := m.clearances[key]
		m.clearanceMu.Unlock()
		fingerprint := clearanceFingerprint(cfg, proxyURL)
		memoryFresh := known && !state.invalid && state.version == version && state.fingerprint == fingerprint && now.Sub(state.refreshedAt) < interval
		persistedFresh := (!known || !state.invalid) && node.ClearanceRefreshedAt != nil && node.ClearanceFingerprint == fingerprint && now.Sub(*node.ClearanceRefreshedAt) < interval
		if !force && (memoryFresh || persistedFresh) {
			continue
		}
		refreshForce := force || (known && state.invalid)
		refreshAfter := time.Time{}
		if refreshForce && known && state.invalid {
			refreshAfter = state.refreshedAt
		}
		_, refreshErr, _ := m.clearanceLoads.Do(key, func() (any, error) {
			return m.refreshNode(ctx, node, proxyURL, key, true, refreshForce, false, refreshAfter)
		})
		if refreshErr != nil {
			refreshErrors = append(refreshErrors, refreshErr)
		}
	}
	shouldUseDirect := direct.used || force && webNodeCount == 0
	if shouldUseDirect && (force || direct.invalid || direct.userAgent == "" || direct.version != version || now.Sub(direct.refreshedAt) >= interval) {
		_, err, _ := m.clearanceLoads.Do("direct", func() (any, error) {
			return m.refreshNode(ctx, domain.Node{Name: "direct", Scope: domain.ScopeWeb, Enabled: true}, "", "direct", false, force, false, time.Time{})
		})
		if err != nil {
			refreshErrors = append(refreshErrors, err)
		}
	}
	return errors.Join(refreshErrors...)
}
