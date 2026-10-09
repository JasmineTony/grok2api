package egress

import (
	"context"
	"errors"
	"net/http"
	"time"

	domain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	neterrorpkg "github.com/chenyme/grok2api/backend/internal/pkg/neterror"
)

func (m *Manager) Feedback(ctx context.Context, nodeID uint64, status int, transportErr error) {
	m.FeedbackForScope(ctx, domain.ScopeWeb, nodeID, status, transportErr)
}

func (m *Manager) FeedbackForScope(ctx context.Context, scope domain.Scope, nodeID uint64, status int, transportErr error) {
	if status == clientClosedRequestStatus || errors.Is(transportErr, context.Canceled) {
		return
	}
	// Console media hosts are public and do not use clearance credentials. A
	// 403 there commonly describes the object URL (expired, rejected, or
	// missing), not the proxy's ability to reach the origin, so it must not cool
	// or rotate an otherwise healthy primary Console node.
	if scope == domain.ScopeConsoleAsset && transportErr == nil && status == http.StatusForbidden {
		return
	}
	if neterrorpkg.IsUpstreamStreamIdleTimeout(transportErr) {
		return
	}
	if scope == domain.ScopeBuild && neterrorpkg.IsResponseHeaderTimeout(transportErr) {
		return
	}
	if nodeID == 0 {
		if transportErr != nil || (scope != domain.ScopeBuild && status == http.StatusForbidden) {
			m.clearanceMu.Lock()
			if isGrokWebScope(scope) && status == http.StatusForbidden && m.clearanceConfig.Mode == "flaresolverr" {
				state := m.clearances["direct"]
				state.invalid = true
				state.used = true
				m.clearances["direct"] = state
			}
			m.clearanceMu.Unlock()
			m.clientMu.Lock()
			stale := m.invalidateClientForScopeLocked(0, scope)
			m.clientMu.Unlock()
			closeRequestClients(stale)
		}
		return
	}
	succeeded := transportErr == nil && status >= 200 && status < 400
	if succeeded && m.cachedNodeIsHealthy(nodeID) {
		return
	}
	value, err := m.repository.GetEgressNode(ctx, nodeID)
	if err != nil {
		return
	}
	if succeeded && nodeIsHealthy(value) {
		m.nodeMu.Lock()
		m.healthyNodes[nodeID] = time.Now().UTC().Add(nodeSnapshotTTL)
		m.nodeMu.Unlock()
		return
	}
	now := time.Now().UTC()
	var stale []requestClient
	switch {
	case succeeded:
		value.Health = min(1, value.Health+0.1)
		value.FailureCount = 0
		value.CooldownUntil = nil
		value.LastError = ""
	case status == http.StatusUnauthorized || status == http.StatusTooManyRequests:
		return
	case scope == domain.ScopeBuild && status == http.StatusForbidden:
		// Build 403 may indicate account permissions, quota, token, or egress policy. The gateway classifies the body;
		// status alone must not misclassify standard CLI egress as Web anti-bot behavior.
		return
	case scope == domain.ScopeBuild && status == http.StatusBadRequest:
		// Device OAuth polls with 400 + authorization_pending before user confirmation.
		// This is a normal protocol state and must not cool the egress node.
		return
	case status == http.StatusForbidden:
		if m.isProxyPoolNode(value) {
			// A request-level 403 does not prove that a shared proxy pool is unhealthy.
			return
		}
		value.FailureCount++
		value.Health = max(0.05, value.Health*0.7)
		value.CooldownUntil = nil
		value.LastError = "anti-bot rejection"
		m.clearanceMu.Lock()
		if isGrokWebScope(scope) && m.clearanceConfig.Mode == "flaresolverr" {
			key := clearanceCacheKey(nodeID, "", false)
			state := m.clearances[key]
			state.invalid = true
			state.used = true
			m.clearances[key] = state
		}
		m.clearanceMu.Unlock()
		m.clientMu.Lock()
		stale = m.invalidateClientLocked(nodeID)
		m.clientMu.Unlock()
	case transportErr != nil:
		if m.isProxyPoolNode(value) {
			return
		}
		value.FailureCount++
		value.Health = max(0.05, value.Health*0.7)
		cooldown := min(10*time.Minute, 30*time.Second*time.Duration(1<<min(value.FailureCount-1, 4)))
		until := now.Add(cooldown)
		value.CooldownUntil = &until
		value.LastError = domain.LastErrorTransport
		m.clientMu.Lock()
		stale = m.invalidateClientLocked(nodeID)
		m.clientMu.Unlock()
	default:
		// An HTTP status describes the upstream response, not the health of the
		// configured proxy endpoint. Account routing handles upstream failures.
		return
	}
	closeRequestClients(stale)
	if stateRepository, ok := m.repository.(egressStateRepository); ok {
		if err := stateRepository.UpdateEgressNodeHealth(ctx, value.ID, value.Health, value.FailureCount, value.CooldownUntil, value.LastError); err == nil {
			m.invalidateNodes(value.Scope)
			if transportErr != nil {
				m.scheduleFailureProbe(value)
			}
		}
		return
	}
	if _, err := m.repository.UpdateEgressNode(ctx, value); err == nil {
		m.invalidateNodes(value.Scope)
		if transportErr != nil {
			m.scheduleFailureProbe(value)
		}
	}
}

func (m *Manager) cachedNodeIsHealthy(nodeID uint64) bool {
	m.nodeMu.Lock()
	validUntil, ok := m.healthyNodes[nodeID]
	healthy := ok && time.Now().UTC().Before(validUntil)
	if ok && !healthy {
		delete(m.healthyNodes, nodeID)
	}
	m.nodeMu.Unlock()
	return healthy
}

func nodeIsHealthy(value domain.Node) bool {
	return value.Health >= 1 && value.FailureCount == 0 && value.CooldownUntil == nil && value.LastError == ""
}
