package egress

import (
	"context"
	"crypto/sha256"
	"fmt"
	"sort"
	"strings"
	"time"

	application "github.com/chenyme/grok2api/backend/internal/application/egress"
	domain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

type clearanceState struct {
	cookies            string
	userAgent          string
	refreshedAt        time.Time
	invalid            bool
	used               bool
	version            uint64
	fingerprint        string
	bindingFingerprint string
	lastUsedAt         time.Time
}

// SetClearanceLock enables cross-instance coordination for shared, fixed egress
// nodes. Account-bound Resin clearances remain process-local because they must
// never be persisted into the node-wide cookie fields.
func (m *Manager) SetClearanceLock(value repository.DistributedLock) {
	m.clearanceMu.Lock()
	m.clearanceLock = value
	m.clearanceMu.Unlock()
}

func (m *Manager) UpdateClearanceConfig(value ClearanceConfig) {
	value.Mode = strings.TrimSpace(value.Mode)
	value.FlareSolverrURL = strings.TrimSpace(value.FlareSolverrURL)
	value.TargetURL = strings.TrimRight(strings.TrimSpace(value.TargetURL), "/")
	m.clearanceMu.Lock()
	previous := m.clearanceConfig
	m.clearanceConfig = value
	configurationChanged := previous.Mode != value.Mode || previous.FlareSolverrURL != value.FlareSolverrURL || previous.TargetURL != value.TargetURL
	if configurationChanged {
		m.clearanceVersion++
		m.clientMu.Lock()
		m.invalidateAllClientVersionsLocked()
		m.clientMu.Unlock()
	}
	m.clearanceMu.Unlock()
}

func (m *Manager) clearanceMode() string {
	m.clearanceMu.Lock()
	defer m.clearanceMu.Unlock()
	return m.clearanceConfig.Mode
}

func (m *Manager) ensureClearance(ctx context.Context, node domain.Node, proxyURL, existingCookies, existingUserAgent, key string, persist bool) (string, string, error) {
	m.clearanceMu.Lock()
	cfg := m.clearanceConfig
	version := m.clearanceVersion
	interval := clearanceRefreshInterval(cfg)
	now := time.Now().UTC()
	fingerprint := clearanceFingerprint(cfg, proxyURL)
	bindingFingerprint := clearanceBindingFingerprint(cfg, proxyURL)
	m.cleanupClearanceCacheLocked(now, interval)
	state, known := m.clearances[key]
	if key == "direct" {
		if !known {
			m.ensureClearanceCacheCapacityLocked()
		}
		state.used = true
		m.clearances[key] = state
	}
	if (!known || state.userAgent == "") && persist && (existingCookies != "" || node.ClearanceRefreshedAt != nil) {
		if !known {
			m.ensureClearanceCacheCapacityLocked()
		}
		state = clearanceState{
			cookies: existingCookies, userAgent: existingUserAgent, used: true, version: version,
			fingerprint: node.ClearanceFingerprint, bindingFingerprint: node.ClearanceBindingFingerprint,
			lastUsedAt: now,
		}
		if node.ClearanceRefreshedAt != nil {
			state.refreshedAt = *node.ClearanceRefreshedAt
		}
		known = true
		m.clearances[key] = state
	}
	// A successful solve may legitimately return no Cloudflare cookies when the
	// selected egress does not trigger a challenge. The solver User-Agent marks
	// that cookie-less result as complete so requests do not block on re-solving.
	fresh := known && !state.invalid && state.userAgent != "" && state.version == version &&
		state.fingerprint == fingerprint && (state.bindingFingerprint == "" || state.bindingFingerprint == bindingFingerprint) &&
		!state.refreshedAt.IsZero() && now.Sub(state.refreshedAt) < interval
	if fresh {
		state.lastUsedAt = now
		m.clearances[key] = state
		cookies, userAgent := state.cookies, state.userAgent
		m.clearanceMu.Unlock()
		return cookies, userAgent, nil
	}
	fallbackAllowed := known && !state.invalid && state.userAgent != "" &&
		(state.bindingFingerprint == "" || state.bindingFingerprint == bindingFingerprint)
	fallback := clearanceSolution{Cookies: state.cookies, UserAgent: state.userAgent}
	forceRefresh := known && state.invalid
	refreshAfter := time.Time{}
	if forceRefresh {
		refreshAfter = state.refreshedAt
	}
	if fallbackAllowed {
		state.lastUsedAt = now
		m.clearances[key] = state
	}
	if cfg.Mode == "on_demand" && !forceRefresh {
		m.clearanceMu.Unlock()
		if fallbackAllowed {
			return fallback.Cookies, fallback.UserAgent, nil
		}
		return existingCookies, existingUserAgent, nil
	}
	if cfg.Mode != "flaresolverr" && cfg.Mode != "on_demand" {
		m.clearanceMu.Unlock()
		return existingCookies, existingUserAgent, nil
	}
	m.clearanceMu.Unlock()

	result, err, _ := m.clearanceLoads.Do(key, func() (any, error) {
		return m.refreshNode(ctx, node, proxyURL, key, persist, forceRefresh, !fallbackAllowed, refreshAfter)
	})
	if err != nil {
		if fallbackAllowed {
			return fallback.Cookies, fallback.UserAgent, nil
		}
		return "", "", err
	}
	solution := result.(clearanceSolution)
	return solution.Cookies, solution.UserAgent, nil
}

func (m *Manager) waitPersistedClearance(ctx context.Context, nodeID uint64, fingerprint, bindingFingerprint string, interval, timeout time.Duration, refreshAfter time.Time) (clearanceSolution, time.Time, bool) {
	waitCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-waitCtx.Done():
			return clearanceSolution{}, time.Time{}, false
		case <-ticker.C:
			if solution, refreshedAt, ok := m.loadPersistedClearance(waitCtx, nodeID, fingerprint, bindingFingerprint, interval); ok &&
				(refreshAfter.IsZero() || refreshedAt.After(refreshAfter)) {
				return solution, refreshedAt, true
			}
		}
	}
}

func (m *Manager) loadPersistedClearance(ctx context.Context, nodeID uint64, fingerprint, bindingFingerprint string, interval time.Duration) (clearanceSolution, time.Time, bool) {
	latest, err := m.repository.GetEgressNode(ctx, nodeID)
	if err != nil || latest.ClearanceRefreshedAt == nil || latest.ClearanceFingerprint != fingerprint ||
		(latest.ClearanceBindingFingerprint != "" && latest.ClearanceBindingFingerprint != bindingFingerprint) ||
		time.Since(*latest.ClearanceRefreshedAt) >= interval {
		return clearanceSolution{}, time.Time{}, false
	}
	cookies, err := m.cipher.Decrypt(latest.EncryptedCloudflareCookie)
	if err != nil {
		return clearanceSolution{}, time.Time{}, false
	}
	cookies = application.SanitizeCloudflareCookies(cookies)
	userAgent := strings.TrimSpace(latest.UserAgent)
	if userAgent == "" {
		return clearanceSolution{}, time.Time{}, false
	}
	return clearanceSolution{Cookies: cookies, UserAgent: userAgent}, *latest.ClearanceRefreshedAt, true
}

func (m *Manager) cacheClearance(key string, solution clearanceSolution, refreshedAt time.Time, version uint64, fingerprint, bindingFingerprint string, interval time.Duration) {
	m.clearanceMu.Lock()
	now := time.Now().UTC()
	m.cleanupClearanceCacheLocked(now, interval)
	if _, exists := m.clearances[key]; !exists {
		m.ensureClearanceCacheCapacityLocked()
	}
	m.clearances[key] = clearanceState{
		cookies: solution.Cookies, userAgent: solution.UserAgent, refreshedAt: refreshedAt,
		used: true, version: version, fingerprint: fingerprint, bindingFingerprint: bindingFingerprint, lastUsedAt: now,
	}
	m.clearanceMu.Unlock()
}

func (m *Manager) cleanupClearanceCacheLocked(now time.Time, interval time.Duration) {
	if m.clearances == nil {
		m.clearances = make(map[string]clearanceState)
	}
	if !m.lastClearanceCleanup.IsZero() && now.Sub(m.lastClearanceCleanup) < clearanceCacheCleanupInterval {
		return
	}
	m.lastClearanceCleanup = now
	idleTTL := interval * 2
	if idleTTL < clearanceCacheMinIdleTTL {
		idleTTL = clearanceCacheMinIdleTTL
	}
	for key, state := range m.clearances {
		lastUsedAt := state.lastUsedAt
		if lastUsedAt.IsZero() {
			lastUsedAt = state.refreshedAt
		}
		if !lastUsedAt.IsZero() && now.Sub(lastUsedAt) >= idleTTL {
			delete(m.clearances, key)
		}
	}
}

func (m *Manager) ensureClearanceCacheCapacityLocked() {
	if len(m.clearances) < maxCachedClearances {
		return
	}
	type candidate struct {
		key      string
		lastUsed time.Time
	}
	candidates := make([]candidate, 0, len(m.clearances))
	for key, state := range m.clearances {
		lastUsedAt := state.lastUsedAt
		if lastUsedAt.IsZero() {
			lastUsedAt = state.refreshedAt
		}
		candidates = append(candidates, candidate{key: key, lastUsed: lastUsedAt})
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].lastUsed.Before(candidates[j].lastUsed)
	})
	removeCount := min(clearanceCacheEvictionBatch, len(candidates))
	for _, entry := range candidates[:removeCount] {
		delete(m.clearances, entry.key)
	}
}

func clearanceRefreshInterval(cfg ClearanceConfig) time.Duration {
	if cfg.RefreshInterval > 0 {
		return cfg.RefreshInterval
	}
	return 10 * time.Minute
}

func clearanceFingerprint(cfg ClearanceConfig, proxyURL string) string {
	value := strings.TrimSpace(cfg.FlareSolverrURL) + "\x00" + clearanceBindingFingerprint(cfg, proxyURL)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(value)))
}

func clearanceBindingFingerprint(cfg ClearanceConfig, proxyURL string) string {
	value := strings.TrimRight(strings.TrimSpace(cfg.TargetURL), "/") + "\x00" + strings.TrimSpace(proxyURL)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(value)))
}

func (m *Manager) recordClearanceError(ctx context.Context, node domain.Node, persist bool) {
	if node.ID == 0 || !persist {
		return
	}
	if stateRepository, ok := m.repository.(egressStateRepository); ok {
		if err := stateRepository.UpdateEgressNodeLastError(ctx, node.ID, "clearance refresh failed"); err == nil {
			m.invalidateNodes(node.Scope)
			return
		}
	}
	latest, err := m.repository.GetEgressNode(ctx, node.ID)
	if err != nil {
		return
	}
	latest.LastError = "clearance refresh failed"
	if _, err := m.repository.UpdateEgressNode(ctx, latest); err == nil {
		m.invalidateNodes(latest.Scope)
	}
}

func (m *Manager) invalidateClearanceKey(key string, client requestClient) {
	m.clearanceMu.Lock()
	state := m.clearances[key]
	state.invalid = true
	state.used = true
	state.lastUsedAt = time.Now().UTC()
	m.clearances[key] = state
	m.clearanceMu.Unlock()
	if client != nil {
		client.CloseIdleConnections()
	}
}
