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
	if shouldIgnoreEgressFeedback(scope, status, transportErr) {
		return
	}
	if nodeID == 0 {
		m.feedbackForDirectNode(scope, status, transportErr)
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
		m.rememberHealthyNode(nodeID)
		return
	}
	updated, stale, applied := m.applyNodeFeedback(scope, status, transportErr, value, time.Now().UTC())
	if !applied {
		return
	}
	closeRequestClients(stale)
	m.persistNodeFeedback(ctx, updated, transportErr)
}

// shouldIgnoreEgressFeedback reports whether the response carries no signal
// about the health of the egress node itself.
func shouldIgnoreEgressFeedback(scope domain.Scope, status int, transportErr error) bool {
	if status == clientClosedRequestStatus || errors.Is(transportErr, context.Canceled) {
		return true
	}
	// Console media hosts are public and do not use clearance credentials. A
	// 403 there commonly describes the object URL (expired, rejected, or
	// missing), not the proxy's ability to reach the origin, so it must not cool
	// or rotate an otherwise healthy primary Console node.
	if scope == domain.ScopeConsoleAsset && transportErr == nil && status == http.StatusForbidden {
		return true
	}
	if neterrorpkg.IsUpstreamStreamIdleTimeout(transportErr) {
		return true
	}
	return scope == domain.ScopeBuild && neterrorpkg.IsResponseHeaderTimeout(transportErr)
}

// feedbackForDirectNode invalidates the direct transport state used when no
// node is bound to the request.
func (m *Manager) feedbackForDirectNode(scope domain.Scope, status int, transportErr error) {
	if transportErr == nil && (scope == domain.ScopeBuild || status != http.StatusForbidden) {
		return
	}
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

func (m *Manager) rememberHealthyNode(nodeID uint64) {
	m.nodeMu.Lock()
	m.healthyNodes[nodeID] = time.Now().UTC().Add(nodeSnapshotTTL)
	m.nodeMu.Unlock()
}

// applyNodeFeedback applies the health transition for one node and reports
// whether the caller must persist the updated node.
func (m *Manager) applyNodeFeedback(scope domain.Scope, status int, transportErr error, value domain.Node, now time.Time) (domain.Node, []requestClient, bool) {
	switch {
	case transportErr == nil && status >= 200 && status < 400:
		value.Health = min(1, value.Health+0.1)
		value.FailureCount = 0
		value.CooldownUntil = nil
		value.LastError = ""
		return value, nil, true
	case status == http.StatusUnauthorized || status == http.StatusTooManyRequests:
		return value, nil, false
	case scope == domain.ScopeBuild && status == http.StatusForbidden:
		// Build 403 may indicate account permissions, quota, token, or egress policy. The gateway classifies the body;
		// status alone must not misclassify standard CLI egress as Web anti-bot behavior.
		return value, nil, false
	case scope == domain.ScopeBuild && status == http.StatusBadRequest:
		// Device OAuth polls with 400 + authorization_pending before user confirmation.
		// This is a normal protocol state and must not cool the egress node.
		return value, nil, false
	case status == http.StatusForbidden:
		if m.isProxyPoolNode(value) {
			// A request-level 403 does not prove that a shared proxy pool is unhealthy.
			return value, nil, false
		}
		updated, stale := m.markNodeAntiBotRejection(scope, value)
		return updated, stale, true
	case transportErr != nil:
		if m.isProxyPoolNode(value) {
			return value, nil, false
		}
		updated, stale := m.markNodeTransportFailure(value, now)
		return updated, stale, true
	default:
		// An HTTP status describes the upstream response, not the health of the
		// configured proxy endpoint. Account routing handles upstream failures.
		return value, nil, false
	}
}

// markNodeAntiBotRejection records a request-level anti-bot rejection and drops
// the clearance binding that was rejected.
func (m *Manager) markNodeAntiBotRejection(scope domain.Scope, value domain.Node) (domain.Node, []requestClient) {
	value.FailureCount++
	value.Health = max(0.05, value.Health*0.7)
	value.CooldownUntil = nil
	value.LastError = "anti-bot rejection"
	m.clearanceMu.Lock()
	if isGrokWebScope(scope) && m.clearanceConfig.Mode == "flaresolverr" {
		key := clearanceCacheKey(value.ID, "", false)
		state := m.clearances[key]
		state.invalid = true
		state.used = true
		m.clearances[key] = state
	}
	m.clearanceMu.Unlock()
	m.clientMu.Lock()
	stale := m.invalidateClientLocked(value.ID)
	m.clientMu.Unlock()
	return value, stale
}

// markNodeTransportFailure cools a node down with the bounded exponential
// backoff reserved for transport failures.
func (m *Manager) markNodeTransportFailure(value domain.Node, now time.Time) (domain.Node, []requestClient) {
	value.FailureCount++
	value.Health = max(0.05, value.Health*0.7)
	cooldown := min(10*time.Minute, 30*time.Second*time.Duration(1<<min(value.FailureCount-1, 4)))
	until := now.Add(cooldown)
	value.CooldownUntil = &until
	value.LastError = domain.LastErrorTransport
	m.clientMu.Lock()
	stale := m.invalidateClientLocked(value.ID)
	m.clientMu.Unlock()
	return value, stale
}

func (m *Manager) persistNodeFeedback(ctx context.Context, value domain.Node, transportErr error) {
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
