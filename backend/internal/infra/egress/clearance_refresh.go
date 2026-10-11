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

// clearanceRefreshSettings is the configuration snapshot that one clearance
// solve runs against.
type clearanceRefreshSettings struct {
	config             ClearanceConfig
	version            uint64
	solver             clearanceSolver
	lock               repository.DistributedLock
	timeout            time.Duration
	fingerprint        string
	bindingFingerprint string
	interval           time.Duration
}

func (m *Manager) refreshNode(ctx context.Context, node domain.Node, proxyURL, key string, persist, force, waitForPeer bool, refreshAfter time.Time) (clearanceSolution, error) {
	settings := m.clearanceRefreshSettingsFor(proxyURL)
	if settings.config.Mode != "flaresolverr" && settings.config.Mode != "on_demand" {
		return clearanceSolution{}, errors.New("FlareSolverr Clearance 未启用")
	}
	if persist && node.ID != 0 && settings.lock != nil {
		release, solution, handled, err := m.acquireClearanceRefreshLock(ctx, settings, node, key, force, waitForPeer, refreshAfter)
		if handled {
			return solution, err
		}
		defer release()
	}
	return m.solveAndPersistClearance(ctx, settings, node, proxyURL, key, persist)
}

func (m *Manager) clearanceRefreshSettingsFor(proxyURL string) clearanceRefreshSettings {
	m.clearanceMu.Lock()
	settings := clearanceRefreshSettings{
		config:  m.clearanceConfig,
		version: m.clearanceVersion,
		solver:  m.solver,
		lock:    m.clearanceLock,
	}
	m.clearanceMu.Unlock()
	settings.timeout = settings.config.Timeout
	if settings.timeout <= 0 {
		settings.timeout = time.Minute
	}
	settings.fingerprint = clearanceFingerprint(settings.config, proxyURL)
	settings.bindingFingerprint = clearanceBindingFingerprint(settings.config, proxyURL)
	settings.interval = clearanceRefreshInterval(settings.config)
	return settings
}

// acquireClearanceRefreshLock coordinates the refresh across instances. handled
// reports that the caller must return the returned values immediately; otherwise
// the returned release function holds the distributed lock for the solve.
func (m *Manager) acquireClearanceRefreshLock(ctx context.Context, settings clearanceRefreshSettings, node domain.Node, key string, force, waitForPeer bool, refreshAfter time.Time) (func(), clearanceSolution, bool, error) {
	release, acquired, err := settings.lock.Acquire(ctx, "egress-clearance:"+strconv.FormatUint(node.ID, 10), settings.timeout+clearanceLockGrace)
	if err != nil {
		return nil, clearanceSolution{}, true, fmt.Errorf("协调 Clearance 刷新: %w", err)
	}
	if !acquired {
		if !force {
			if solution, refreshedAt, ok := m.loadPersistedClearance(ctx, node.ID, settings.fingerprint, settings.bindingFingerprint, settings.interval); ok {
				m.cacheClearance(key, solution, refreshedAt, settings.version, settings.fingerprint, settings.bindingFingerprint, settings.interval)
				return nil, solution, true, nil
			}
		}
		if waitForPeer {
			if solution, refreshedAt, ok := m.waitPersistedClearance(ctx, node.ID, settings.fingerprint, settings.bindingFingerprint, settings.interval, settings.timeout, refreshAfter); ok {
				m.cacheClearance(key, solution, refreshedAt, settings.version, settings.fingerprint, settings.bindingFingerprint, settings.interval)
				return nil, solution, true, nil
			}
		}
		return nil, clearanceSolution{}, true, errors.New("另一个实例正在刷新 Cloudflare Clearance")
	}
	if solution, refreshedAt, ok := m.loadPersistedClearance(ctx, node.ID, settings.fingerprint, settings.bindingFingerprint, settings.interval); ok {
		// A peer may have refreshed the rejected Clearance immediately before
		// this instance acquired the distributed lock. Reuse that newer result
		// instead of performing a duplicate browser solve. A force refresh with
		// no newer persisted generation must still reach the solver.
		if !force || (!refreshAfter.IsZero() && refreshedAt.After(refreshAfter)) {
			m.cacheClearance(key, solution, refreshedAt, settings.version, settings.fingerprint, settings.bindingFingerprint, settings.interval)
			release()
			return nil, solution, true, nil
		}
	}
	return release, clearanceSolution{}, false, nil
}

// solveAndPersistClearance solves a new clearance and persists it to the node
// when the caller asked for persistence.
func (m *Manager) solveAndPersistClearance(ctx context.Context, settings clearanceRefreshSettings, node domain.Node, proxyURL, key string, persist bool) (clearanceSolution, error) {
	solveCtx, cancel := context.WithTimeout(ctx, settings.timeout)
	defer cancel()
	solution, err := settings.solver.Solve(solveCtx, settings.config, proxyURL)
	if err != nil {
		m.recordClearanceError(ctx, node, persist)
		return clearanceSolution{}, fmt.Errorf("刷新出口 %q 的 Cloudflare Clearance: %w", node.Name, err)
	}
	now := time.Now().UTC()
	if persist && node.ID != 0 {
		if err := m.persistNodeClearance(ctx, settings, node, solution, now); err != nil {
			return clearanceSolution{}, err
		}
		m.invalidateNodes(node.Scope)
	}
	m.cacheClearance(key, solution, now, settings.version, settings.fingerprint, settings.bindingFingerprint, settings.interval)
	return solution, nil
}

func (m *Manager) persistNodeClearance(ctx context.Context, settings clearanceRefreshSettings, node domain.Node, solution clearanceSolution, now time.Time) error {
	encryptedCookies, encryptErr := m.cipher.Encrypt(solution.Cookies)
	if encryptErr != nil {
		return encryptErr
	}
	if stateRepository, ok := m.repository.(egressStateRepository); ok {
		return stateRepository.UpdateEgressNodeClearance(ctx, node.ID, encryptedCookies, solution.UserAgent, settings.fingerprint, settings.bindingFingerprint, now)
	}
	latest, loadErr := m.repository.GetEgressNode(ctx, node.ID)
	if loadErr != nil {
		return loadErr
	}
	latest.EncryptedCloudflareCookie = encryptedCookies
	latest.UserAgent = solution.UserAgent
	latest.ClearanceFingerprint = settings.fingerprint
	latest.ClearanceBindingFingerprint = settings.bindingFingerprint
	latest.ClearanceRefreshedAt = &now
	latest.LastError = ""
	_, updateErr := m.repository.UpdateEgressNode(ctx, latest)
	return updateErr
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
	ids, prefixes := forgottenClearancePrefixes(nodeIDs)
	if len(ids) == 0 {
		return
	}
	m.clearanceMu.Lock()
	m.nodeMu.Lock()
	m.clientMu.Lock()
	m.evictClearanceEntriesLocked(prefixes)
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
	stale := m.evictNodeClientsLocked(ids)
	m.clientMu.Unlock()
	m.nodeMu.Unlock()
	m.clearanceMu.Unlock()
	closeRequestClients(stale)
}

// forgottenClearancePrefixes deduplicates the requested node IDs and maps each
// one to the clearance cache prefix that stores its runtime state.
func forgottenClearancePrefixes(nodeIDs []uint64) (map[uint64]struct{}, map[string]struct{}) {
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
	return ids, prefixes
}

func (m *Manager) evictClearanceEntriesLocked(prefixes map[string]struct{}) {
	for key := range m.clearances {
		if _, selected := prefixes[clearanceKeyPrefix(key)]; selected {
			delete(m.clearances, key)
		}
	}
}

// clearanceKeyPrefix reduces a clearance cache key to the node scope that owns
// it, so a batch forget can match every cached variant of one node.
func clearanceKeyPrefix(key string) string {
	if strings.HasPrefix(key, "node:") {
		if separator := strings.IndexByte(key[len("node:"):], ':'); separator >= 0 {
			return key[:len("node:")+separator]
		}
		return key
	}
	if strings.HasPrefix(key, "direct:") {
		return "direct"
	}
	return key
}

// evictNodeClientsLocked drops the cached clients and version tombstones of the
// forgotten nodes and returns the clients that must be closed.
func (m *Manager) evictNodeClientsLocked(ids map[uint64]struct{}) []requestClient {
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
	return stale
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
		if refreshErr := m.refreshDueNodeClearance(ctx, node, cfg, version, interval, now, force); refreshErr != nil {
			refreshErrors = append(refreshErrors, refreshErr)
		}
	}
	refreshErrors = m.appendDirectClearanceRefresh(ctx, refreshErrors, direct, version, interval, now, force, webNodeCount)
	return errors.Join(refreshErrors...)
}

// refreshDueNodeClearance refreshes one node when neither its in-memory nor its
// persisted clearance still satisfies the configured refresh interval.
func (m *Manager) refreshDueNodeClearance(ctx context.Context, node domain.Node, cfg ClearanceConfig, version uint64, interval time.Duration, now time.Time, force bool) error {
	proxyURL, decryptErr := m.cipher.Decrypt(node.EncryptedProxyURL)
	if decryptErr != nil {
		return decryptErr
	}
	if strings.Contains(proxyURL, application.ProxyAccountPlaceholder) {
		// Resin clearance is account/IP bound and has no safe node-wide value
		// for a background task to solve or persist.
		return nil
	}
	proxyURL, normalizeErr := application.NormalizeProxyURL(proxyURL)
	if normalizeErr != nil {
		return normalizeErr
	}
	m.clearanceMu.Lock()
	key := clearanceCacheKey(node.ID, proxyURL, false)
	state, known := m.clearances[key]
	m.clearanceMu.Unlock()
	fingerprint := clearanceFingerprint(cfg, proxyURL)
	memoryFresh := known && !state.invalid && state.version == version && state.fingerprint == fingerprint && now.Sub(state.refreshedAt) < interval
	persistedFresh := (!known || !state.invalid) && node.ClearanceRefreshedAt != nil && node.ClearanceFingerprint == fingerprint && now.Sub(*node.ClearanceRefreshedAt) < interval
	if !force && (memoryFresh || persistedFresh) {
		return nil
	}
	refreshForce := force || (known && state.invalid)
	refreshAfter := time.Time{}
	if refreshForce && known && state.invalid {
		refreshAfter = state.refreshedAt
	}
	_, refreshErr, _ := m.clearanceLoads.Do(key, func() (any, error) {
		return m.refreshNode(ctx, node, proxyURL, key, true, refreshForce, false, refreshAfter)
	})
	return refreshErr
}

// appendDirectClearanceRefresh refreshes the direct-transport clearance when
// web traffic uses it and no web node can cover it.
func (m *Manager) appendDirectClearanceRefresh(ctx context.Context, refreshErrors []error, direct clearanceState, version uint64, interval time.Duration, now time.Time, force bool, webNodeCount int) []error {
	shouldUseDirect := direct.used || force && webNodeCount == 0
	if !shouldUseDirect || (!force && !direct.invalid && direct.userAgent != "" && direct.version == version && now.Sub(direct.refreshedAt) < interval) {
		return refreshErrors
	}
	_, err, _ := m.clearanceLoads.Do("direct", func() (any, error) {
		return m.refreshNode(ctx, domain.Node{Name: "direct", Scope: domain.ScopeWeb, Enabled: true}, "", "direct", false, force, false, time.Time{})
	})
	if err != nil {
		refreshErrors = append(refreshErrors, err)
	}
	return refreshErrors
}
