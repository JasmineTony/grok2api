package egress

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	application "github.com/chenyme/grok2api/backend/internal/application/egress"
	domain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	settingsdomain "github.com/chenyme/grok2api/backend/internal/domain/settings"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"golang.org/x/sync/singleflight"
)

const DefaultUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"

const nodeSnapshotTTL = time.Second

const operationsConfigSnapshotTTL = time.Second

const proxyPoolRetryLimit = 2

const clientCacheIdleTTL = 30 * time.Minute

const clientCacheCleanupInterval = time.Minute

const clientCacheTouchInterval = time.Minute

const maxCachedClients = 4096

const clearanceLockGrace = 30 * time.Second

const clearanceCacheCleanupInterval = time.Minute

const clearanceCacheMinIdleTTL = 30 * time.Minute

const maxCachedClearances = 16384

const clearanceCacheEvictionBatch = 256

// clientClosedRequestStatus is the conventional proxy status for a client-aborted request.
const clientClosedRequestStatus = 499

const egressIPv4ProbeEndpoint = "https://ipinfo.io/json"

const egressIPv6ProbeEndpoint = "https://v6.ipinfo.io/json"

const cloudflareIPv4ProbeEndpoint = "https://1.1.1.1/cdn-cgi/trace"

const cloudflareIPv6ProbeEndpoint = "https://[2606:4700:4700::1111]/cdn-cgi/trace"

const egressProbeTimeout = 15 * time.Second

const failureProbeCompletionGrace = 5 * time.Second

const failureProbeTimeout = 20 * time.Second

const failureProbeWaitTimeout = 5 * time.Second

const clientCreationRetryLimit = 3

const maxClientVersionEntries = 4096

var errNodeSnapshotInvalidated = errors.New("egress node snapshot invalidated")

var errClientCacheInvalidated = errors.New("egress client cache invalidated")

var errAccountConnectionIsolationDisabled = errors.New("egress account connection isolation disabled")

type FailureProber func(context.Context, uint64) (domain.ProbeResult, error)

type failureProbeState struct {
	running       bool
	lastCompleted time.Time
	done          chan struct{}
}

type Manager struct {
	repository             repository.EgressRepository
	cipher                 *security.Cipher
	logger                 *slog.Logger
	nodeMu                 sync.RWMutex
	clientMu               sync.RWMutex
	clearanceMu            sync.Mutex
	operationsMu           sync.RWMutex
	clients                map[clientCacheKey]cachedClient
	inflight               sync.Map
	nodes                  map[domain.Scope]cachedNodeSnapshot
	healthyNodes           map[uint64]time.Time
	nodeVersions           map[domain.Scope]uint64
	nodeLoads              singleflight.Group
	clientLoads            singleflight.Group
	clientVersions         map[uint64]uint64
	clientGeneration       uint64
	buildHeaderTimeout     atomic.Int64
	buildStreamIdleTimeout atomic.Int64
	accountIsolated        atomic.Bool
	operationsConfig       cachedOperationsConfig
	operationsConfigLoad   singleflight.Group
	operationsConfigVer    uint64
	failureProbeMu         sync.Mutex
	failureProber          FailureProber
	failureProbes          map[uint64]failureProbeState
	lastClientCleanup      time.Time
	clearanceLoads         singleflight.Group
	clearanceConfig        ClearanceConfig
	clearanceVersion       uint64
	clearances             map[string]clearanceState
	lastClearanceCleanup   time.Time
	solver                 clearanceSolver
	clearanceLock          repository.DistributedLock
	newBuildClient         func(string, time.Duration) (requestClient, error)
	newBuildEnvClient      func(time.Duration) (requestClient, error)
	newBrowserClient       func(string, string) (*browserClient, error)
}

type egressStateRepository interface {
	UpdateEgressNodeClearance(context.Context, uint64, string, string, string, string, time.Time) error
	UpdateEgressNodeHealth(context.Context, uint64, float64, int, *time.Time, string) error
	UpdateEgressNodeLastError(context.Context, uint64, string) error
}

// operationsConfigRepository is optional so lightweight routing repositories
// retain their narrow contract. The relational implementation supplies it,
// allowing fallback policy to be read only when primary selection fails.
type operationsConfigRepository interface {
	GetEgressOperationsConfig(context.Context) (domain.OperationsConfig, error)
}

type cachedNodeSnapshot struct {
	values    []domain.Node
	expiresAt time.Time
}

type cachedOperationsConfig struct {
	value     domain.OperationsConfig
	expiresAt time.Time
}

func NewManager(repository repository.EgressRepository, cipher *security.Cipher) *Manager {
	manager := &Manager{
		repository: repository, cipher: cipher,
		clients: make(map[clientCacheKey]cachedClient),
		nodes:   make(map[domain.Scope]cachedNodeSnapshot), healthyNodes: make(map[uint64]time.Time),
		nodeVersions: make(map[domain.Scope]uint64), clientVersions: make(map[uint64]uint64), clearances: make(map[string]clearanceState),
		failureProbes:  make(map[uint64]failureProbeState),
		newBuildClient: newBuildRequestClient, newBuildEnvClient: newBuildEnvironmentRequestClient, newBrowserClient: newBrowserClient,
		solver:          flaresolverrSolver{},
		clearanceConfig: ClearanceConfig{Mode: "manual", TargetURL: "https://grok.com", Timeout: time.Minute, RefreshInterval: 10 * time.Minute},
	}
	manager.buildHeaderTimeout.Store(int64(settingsdomain.DefaultBuildResponseHeaderTimeout))
	manager.buildStreamIdleTimeout.Store(int64(settingsdomain.DefaultBuildStreamIdleTimeout))
	return manager
}

func (m *Manager) SetLogger(logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}
	m.logger = logger
}

func (m *Manager) log() *slog.Logger {
	if m == nil || m.logger == nil {
		return slog.Default()
	}
	return m.logger
}

// SetFailureProber enables an immediate, deduplicated connectivity probe after
// a fixed proxy reports a transport failure. The callback persists the probe
// result; it must not depend on the failed request context.
func (m *Manager) SetFailureProber(value FailureProber) {
	m.failureProbeMu.Lock()
	m.failureProber = value
	if value == nil {
		clear(m.failureProbes)
	}
	m.failureProbeMu.Unlock()
}

func (m *Manager) scheduleFailureProbe(node domain.Node) {
	m.failureProbeMu.Lock()
	prober := m.failureProber
	state := m.failureProbes[node.ID]
	if prober == nil || state.running {
		m.failureProbeMu.Unlock()
		return
	}
	state.running = true
	state.done = make(chan struct{})
	m.failureProbes[node.ID] = state
	done := state.done
	m.failureProbeMu.Unlock()

	m.log().Info("egress_failure_probe_scheduled", "node_id", node.ID, "node_name", node.Name, "scope", node.Scope)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), failureProbeTimeout)
		result, err := prober(ctx, node.ID)
		cancel()

		m.failureProbeMu.Lock()
		state := m.failureProbes[node.ID]
		if state.done == done {
			state.running = false
			state.lastCompleted = time.Now().UTC()
			m.failureProbes[node.ID] = state
		}
		close(done)
		m.failureProbeMu.Unlock()

		if err != nil {
			m.log().Warn("egress_failure_probe_failed", "node_id", node.ID, "node_name", node.Name, "scope", node.Scope, "error", err)
			return
		}
		if result.Status == domain.ProbeStatusHealthy {
			m.invalidateNodes(node.Scope)
		}
		m.log().Info("egress_failure_probe_completed", "node_id", node.ID, "node_name", node.Name, "scope", node.Scope, "probe_status", result.Status, "latency_ms", result.LatencyMS)
	}()
}

func (m *Manager) waitForFailureProbe(ctx context.Context, nodeID uint64) (bool, error) {
	now := time.Now().UTC()
	m.failureProbeMu.Lock()
	state, exists := m.failureProbes[nodeID]
	m.failureProbeMu.Unlock()
	if !exists {
		return false, nil
	}
	if !state.running {
		return !state.lastCompleted.IsZero() && now.Sub(state.lastCompleted) < failureProbeCompletionGrace, nil
	}
	if state.done == nil {
		return false, nil
	}
	timer := time.NewTimer(failureProbeWaitTimeout)
	defer timer.Stop()
	select {
	case <-state.done:
		return true, nil
	case <-ctx.Done():
		return false, ctx.Err()
	case <-timer.C:
		return false, nil
	}
}

// UpdateBuildResponseHeaderTimeout rebuilds only cached Build clients. Active
// requests keep their current transport and are not interrupted.
func (m *Manager) UpdateBuildResponseHeaderTimeout(value time.Duration) {
	if value <= 0 {
		value = settingsdomain.DefaultBuildResponseHeaderTimeout
	}
	if previous := time.Duration(m.buildHeaderTimeout.Swap(int64(value))); previous == value {
		return
	}
	m.clientMu.Lock()
	var stale []requestClient
	for key, cached := range m.clients {
		if key.scope == domain.ScopeBuild {
			stale = append(stale, m.evictClientLocked(key, cached))
		}
	}
	m.clientMu.Unlock()
	closeRequestClients(stale)
}

// UpdateBuildStreamIdleTimeout affects subsequent Build streams. Active
// response bodies retain the deadline captured by their existing wrapper and
// are not interrupted; the underlying HTTP connection pool is unchanged.
func (m *Manager) UpdateBuildStreamIdleTimeout(value time.Duration) {
	if value <= 0 {
		value = settingsdomain.DefaultBuildStreamIdleTimeout
	}
	m.buildStreamIdleTimeout.Store(int64(value))
}

// BuildStreamIdleTimeout returns the configured stream idle deadline for Grok
// Build responses. Returns zero when idle enforcement is disabled.
func (m *Manager) BuildStreamIdleTimeout() time.Duration {
	return time.Duration(m.buildStreamIdleTimeout.Load())
}

// UpdateAccountIsolatedConnections toggles per-account upstream connection pools.
// When enabled, different accounts do not share TCP/HTTP clients so upstream
// egress load balancers can spread traffic by connection; the same account still
// reuses its own pool. Changing the setting rebuilds cached clients without
// interrupting in-flight requests.
func (m *Manager) UpdateAccountIsolatedConnections(enabled bool) {
	m.clientMu.Lock()
	if m.accountIsolated.Load() == enabled {
		m.clientMu.Unlock()
		return
	}
	// Change the mode while holding the same lock used to validate client-cache
	// keys. This makes the mode snapshot and cache invalidation one transition.
	m.accountIsolated.Store(enabled)
	stale := make([]requestClient, 0, len(m.clients))
	for key, cached := range m.clients {
		stale = append(stale, m.evictClientLocked(key, cached))
	}
	m.invalidateAllClientVersionsLocked()
	m.clientMu.Unlock()
	closeRequestClients(stale)
	m.log().Info("egress_account_connection_isolation_updated", "enabled", enabled, "evicted_clients", len(stale))
}

// AccountIsolatedConnections reports whether upstream clients are partitioned by account.
func (m *Manager) AccountIsolatedConnections() bool {
	return m != nil && m.accountIsolated.Load()
}

func isGrokWebScope(scope domain.Scope) bool {
	return scope == domain.ScopeWeb || scope == domain.ScopeWebAsset || scope == domain.ScopeConsole
}

func allEgressScopes() []domain.Scope {
	return []domain.Scope{domain.ScopeBuild, domain.ScopeWeb, domain.ScopeConsole, domain.ScopeWebAsset, domain.ScopeConsoleAsset}
}

func (m *Manager) isStickyProxyNode(value domain.Node) bool {
	if m == nil || m.cipher == nil || strings.TrimSpace(value.EncryptedProxyURL) == "" {
		return false
	}
	proxyURL, err := m.cipher.Decrypt(value.EncryptedProxyURL)
	return err == nil && strings.Contains(proxyURL, application.ProxyAccountPlaceholder)
}

func (m *Manager) isProxyPoolNode(value domain.Node) bool {
	return value.ProxyPool || m.isStickyProxyNode(value)
}

func (m *Manager) invalidateClientLocked(nodeID uint64) []requestClient {
	m.invalidateClientVersionLocked(nodeID)
	var stale []requestClient
	for key, cached := range m.clients {
		if key.nodeID != nodeID {
			continue
		}
		delete(m.clients, key)
		stale = append(stale, cached.client)
	}
	return stale
}

func (m *Manager) invalidateClientForScopeLocked(nodeID uint64, scope domain.Scope) []requestClient {
	m.invalidateClientVersionLocked(nodeID)
	if scope == domain.ScopeWebAsset {
		scope = domain.ScopeWeb
	}
	var stale []requestClient
	for key, cached := range m.clients {
		if key.nodeID != nodeID || key.scope != scope {
			continue
		}
		delete(m.clients, key)
		stale = append(stale, cached.client)
	}
	return stale
}

func BuildSSOCookie(token, cloudflareCookies string) string {
	token = strings.TrimSpace(token)
	if strings.HasPrefix(strings.ToLower(token), "sso=") {
		token = strings.TrimSpace(token[len("sso="):])
	}
	if value, _, found := strings.Cut(token, ";"); found {
		token = strings.TrimSpace(value)
	}
	token = strings.NewReplacer("\r", "", "\n", "", "\x00", "").Replace(token)
	cookies := "sso=" + token + "; sso-rw=" + token
	if sanitized := application.SanitizeCloudflareCookies(cloudflareCookies); sanitized != "" {
		cookies += "; " + sanitized
	}
	return cookies
}
