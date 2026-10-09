package egress

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	application "github.com/chenyme/grok2api/backend/internal/application/egress"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	domain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

type Lease struct {
	NodeID           uint64
	NodeName         string
	Scope            domain.Scope
	ProxyURL         string
	UserAgent        string
	CFCookies        string
	client           requestClient
	browser          *browserClient
	sticky           bool
	proxyPool        bool
	freshTunnel      bool
	clearanceKey     string
	clearanceManager *Manager
	release          func()
}

type requestClient interface {
	Do(*http.Request) (*http.Response, error)
	CloseIdleConnections()
}

func (l *Lease) Do(request *http.Request) (*http.Response, error) {
	return l.doRequest(request, true)
}

// DoDeferredForbidden executes an HTTP request while leaving 403 clearance
// invalidation to the caller after it has classified the response body.
func (l *Lease) DoDeferredForbidden(request *http.Request) (*http.Response, error) {
	return l.doRequest(request, false)
}

func (l *Lease) doRequest(request *http.Request, invalidateForbidden bool) (*http.Response, error) {
	if l == nil || l.client == nil {
		return nil, errors.New("出口客户端未初始化")
	}
	// Rotating proxy endpoints choose an exit when a new CONNECT tunnel is
	// established. Reusing a Build keep-alive/HTTP2 connection would pin many
	// otherwise independent requests to one exit and defeat proxy-pool
	// rotation. Proxy-pool mode is explicit, so trade the extra handshake for a
	// fresh tunnel without changing fixed-proxy, direct, Web, or Console paths.
	if l.Scope == domain.ScopeBuild && l.freshTunnel {
		request.Close = true
	}
	response, err := l.do(request)
	recordPhysicalCall(request.Context(), response, err)
	if invalidateForbidden && err == nil && response != nil && response.StatusCode == http.StatusForbidden {
		l.InvalidateClearance()
	}
	return response, err
}

// InvalidateClearance invalidates the exact browser-session binding used by
// this lease after a 403 has been classified as egress-related.
func (l *Lease) InvalidateClearance() {
	if l != nil && l.clearanceManager != nil && l.clearanceKey != "" {
		l.clearanceManager.invalidateClearanceKey(l.clearanceKey, l.client)
	}
}

func (l *Lease) Release() {
	if l != nil && l.release != nil {
		l.release()
		l.release = nil
	}
}

func isolationAccountIdentity(ctx context.Context, scope domain.Scope, affinity string) string {
	identity := accountFromContext(ctx)
	if identity != "" {
		return identity
	}
	affinity = strings.TrimSpace(affinity)
	if affinity != "" {
		return string(scope) + "_" + affinity
	}
	return "shared"
}

func (m *Manager) Acquire(ctx context.Context, scope domain.Scope, affinity string) (*Lease, error) {
	lease, _, err := m.acquire(ctx, scope, affinity, true, "", egressNodeFromContext(ctx))
	return lease, err
}

// AcquireBuildEnvironmentDirectIfIsolated creates an account-partitioned direct
// Build lease while preserving the legacy direct transport's environment-proxy
// semantics. The bool is false when isolation was disabled before the lease was
// acquired, allowing the caller to retain its original fallback transport.
func (m *Manager) AcquireBuildEnvironmentDirectIfIsolated(ctx context.Context, affinity string) (*Lease, bool, error) {
	selected := domain.Node{ID: 0, Name: "direct", Scope: domain.ScopeBuild, Enabled: true, Health: 1}
	lease, _, err := m.leaseForNodeWithOptions(ctx, domain.ScopeBuild, affinity, "", false, selected, clientOptions{
		buildEnvironmentProxy:   true,
		requireAccountIsolation: true,
	})
	if errors.Is(err, errAccountConnectionIsolationDisabled) {
		return nil, false, nil
	}
	return lease, err == nil, err
}

// AcquireCredential binds the outbound proxy identity to one persisted
// Provider credential. Resin templates use this identity as their Account.
func (m *Manager) AcquireCredential(ctx context.Context, scope domain.Scope, credential accountdomain.Credential) (*Lease, error) {
	identity := strings.TrimSpace(credential.EgressIdentity)
	if identity == "" {
		identity = string(credential.Provider) + "_" + strconv.FormatUint(credential.ID, 10)
	}
	// Web and Console accounts can be two database projections of the same SSO
	// login. Resin must see one stable account identity across both channels;
	// otherwise the proxy rotates the IP while the clearance remains bound to
	// the other lease. The digest is non-reversible and is only used as a proxy
	// template account label.
	if strings.TrimSpace(credential.EgressIdentity) == "" && credential.AuthType == accountdomain.AuthTypeSSO && strings.TrimSpace(credential.EncryptedAccessToken) != "" {
		token, decryptErr := m.cipher.Decrypt(credential.EncryptedAccessToken)
		if decryptErr != nil {
			return nil, decryptErr
		}
		identity = "sso_" + security.HashToken(token)[:32]
	}
	ctx = WithAccountIdentity(ctx, identity)
	ctx = WithEgressNode(ctx, credential.EgressNodeID)
	lease, _, err := m.acquire(ctx, scope, strconv.FormatUint(credential.ID, 10), true, credential.EncryptedCloudflareCookie, credential.EgressNodeID)
	return lease, err
}

func (m *Manager) AcquireIfConfigured(ctx context.Context, scope domain.Scope, affinity string) (*Lease, bool, error) {
	return m.acquire(ctx, scope, affinity, false, "", egressNodeFromContext(ctx))
}

func (m *Manager) acquire(ctx context.Context, scope domain.Scope, affinity string, allowDirect bool, encryptedCredentialCookies string, boundNodeID uint64) (*Lease, bool, error) {
	now := time.Now().UTC()
	clearanceMode := m.clearanceMode()
	managedClearance := isGrokWebScope(scope) && (clearanceMode == "flaresolverr" || clearanceMode == "on_demand")
	configured := false
	var available []domain.Node
	if boundNodeID != 0 {
		waitedForProbe := false
		qualityProbe := qualityProbeFromContext(ctx)
		for {
			now = time.Now().UTC()
			selected, err := m.repository.GetEgressNode(ctx, boundNodeID)
			if err != nil {
				primaryErr := fmt.Errorf("读取绑定出口节点: %w", err)
				if !errors.Is(err, repository.ErrNotFound) {
					return nil, true, primaryErr
				}
				return m.acquireUnavailableFallback(ctx, scope, affinity, allowDirect, encryptedCredentialCookies, managedClearance, primaryErr)
			}
			if !domain.SupportsScope(selected.Scope, scope) {
				return m.acquireUnavailableFallback(ctx, scope, affinity, allowDirect, encryptedCredentialCookies, managedClearance, fmt.Errorf("绑定出口节点 %d 与 %s 作用域不兼容", boundNodeID, scope))
			}
			if !selected.Enabled && !qualityProbe {
				return m.acquireUnavailableFallback(ctx, scope, affinity, allowDirect, encryptedCredentialCookies, managedClearance, fmt.Errorf("绑定出口节点 %d 已禁用", boundNodeID))
			}
			if strings.TrimSpace(selected.EncryptedProxyURL) == "" {
				return m.acquireUnavailableFallback(ctx, scope, affinity, allowDirect, encryptedCredentialCookies, managedClearance, fmt.Errorf("绑定出口节点 %d 未配置代理地址", boundNodeID))
			}
			proxyPool := m.isProxyPoolNode(selected)
			if !qualityProbe && !proxyPool && selected.CooldownUntil != nil && now.Before(*selected.CooldownUntil) {
				if !waitedForProbe && selected.LastError == domain.LastErrorTransport {
					completed, waitErr := m.waitForFailureProbe(ctx, boundNodeID)
					if waitErr != nil {
						return nil, true, waitErr
					}
					if completed {
						waitedForProbe = true
						continue
					}
				}
				return m.acquireUnavailableFallback(ctx, scope, affinity, allowDirect, encryptedCredentialCookies, managedClearance, fmt.Errorf("绑定出口节点 %d 正在冷却", boundNodeID))
			}
			return m.leaseForNode(ctx, scope, affinity, encryptedCredentialCookies, managedClearance, selected)
		}
	}
	fallbackConfig, fallbackSupported, fallbackConfigErr := m.loadOperationsConfig(ctx, now)
	fallback := domain.FallbackConfig{Mode: domain.FallbackModeNone}
	reservedFallbackNodes := make(map[uint64]struct{}, len(allEgressScopes()))
	if fallbackConfigErr == nil && fallbackSupported {
		fallback = fallbackConfig.FallbackFor(scope)
		for _, fallbackScope := range allEgressScopes() {
			configuredFallback := fallbackConfig.FallbackFor(fallbackScope)
			if configuredFallback.Mode == domain.FallbackModeFixed && configuredFallback.NodeID != 0 {
				reservedFallbackNodes[configuredFallback.NodeID] = struct{}{}
			}
		}
	}
	for _, candidateScope := range fallbackScopes(scope) {
		nodes, err := m.listNodes(ctx, candidateScope, now)
		if err != nil {
			return nil, false, err
		}
		candidateAvailable := make([]domain.Node, 0, len(nodes))
		for _, node := range nodes {
			if !node.Enabled {
				continue
			}
			// A fixed fallback is a reserved last resort, not another member of
			// the primary pool. It is validated again immediately before use.
			if _, reserved := reservedFallbackNodes[node.ID]; reserved {
				continue
			}
			configured = true
			proxyPool := m.isProxyPoolNode(node)
			if node.CooldownUntil == nil || !now.Before(*node.CooldownUntil) || proxyPool {
				if proxyPool {
					node.Health, node.FailureCount, node.CooldownUntil, node.LastError = 1, 0, nil, ""
				}
				candidateAvailable = append(candidateAvailable, node)
			}
		}
		if len(candidateAvailable) > 0 {
			available = candidateAvailable
			break
		}
	}
	if len(available) == 0 {
		primaryErr := error(nil)
		if configured {
			primaryErr = fmt.Errorf("当前没有可用的 %s 出口节点", scope)
		}
		lease, fallbackConfigured, applied, err := m.applyFallback(ctx, scope, affinity, allowDirect, encryptedCredentialCookies, managedClearance, primaryErr, fallback, fallbackSupported, fallbackConfigErr)
		if err != nil {
			return nil, fallbackConfigured, err
		}
		if applied {
			return lease, fallbackConfigured, nil
		}
		if primaryErr != nil {
			return nil, false, primaryErr
		}
		if !allowDirect {
			recordSelection(ctx, Selection{NodeName: "direct", Scope: scope})
			return nil, false, nil
		}
		available = []domain.Node{{ID: 0, Name: "direct", Scope: scope, Enabled: true, Health: 1}}
	}
	sort.SliceStable(available, func(i, j int) bool { return available[i].ID < available[j].ID })
	selected := m.selectNode(available, affinity)
	return m.leaseForNode(ctx, scope, affinity, encryptedCredentialCookies, managedClearance, selected)
}

type clientOptions struct {
	buildEnvironmentProxy   bool
	requireAccountIsolation bool
}

func (m *Manager) leaseForNode(ctx context.Context, scope domain.Scope, affinity, encryptedCredentialCookies string, managedClearance bool, selected domain.Node) (*Lease, bool, error) {
	return m.leaseForNodeWithOptions(ctx, scope, affinity, encryptedCredentialCookies, managedClearance, selected, clientOptions{})
}

func (m *Manager) leaseForNodeWithOptions(ctx context.Context, scope domain.Scope, affinity, encryptedCredentialCookies string, managedClearance bool, selected domain.Node, options clientOptions) (*Lease, bool, error) {
	credentialCookies := ""
	if !managedClearance && usesBrowserClearance(scope) && strings.TrimSpace(encryptedCredentialCookies) != "" {
		decryptedCookies, decryptErr := m.cipher.Decrypt(encryptedCredentialCookies)
		if decryptErr != nil {
			return nil, true, decryptErr
		}
		credentialCookies = application.SanitizeCloudflareCookies(decryptedCookies)
	}
	proxyURL, err := m.cipher.Decrypt(selected.EncryptedProxyURL)
	if err != nil {
		return nil, false, err
	}
	proxyURL, err = application.NormalizeProxyURL(proxyURL)
	if err != nil {
		return nil, false, err
	}
	sticky := strings.Contains(proxyURL, application.ProxyAccountPlaceholder)
	proxyPool := selected.ProxyPool || sticky
	freshTunnel := selected.ProxyPool && !sticky
	if sticky {
		accountKey := accountFromContext(ctx)
		if accountKey == "" && strings.TrimSpace(affinity) != "" {
			accountKey = string(scope) + "_" + strings.TrimSpace(affinity)
		}
		proxyURL, err = renderAccountProxyURL(proxyURL, accountKey)
		if err != nil {
			return nil, false, err
		}
	}
	cookies := ""
	if usesBrowserClearance(scope) {
		cookies, err = m.cipher.Decrypt(selected.EncryptedCloudflareCookie)
		if err != nil {
			// Managed mode can recover a damaged persisted cookie by asking the
			// solver for a fresh one. Manual mode must still surface the storage
			// error because it has no safe replacement source.
			if !managedClearance {
				return nil, false, err
			}
			cookies = ""
		}
		cookies = application.SanitizeCloudflareCookies(cookies)
		if credentialCookies != "" {
			cookies = credentialCookies
		}
	}
	userAgent := ""
	if scope != domain.ScopeBuild {
		userAgent = strings.TrimSpace(selected.UserAgent)
	}
	if scope != domain.ScopeBuild && userAgent == "" {
		userAgent = DefaultUserAgent
	}
	clearanceKey := ""
	// Manual mode may prefer account-bound cookies. Managed mode always enters
	// the FlareSolverr lifecycle so stale imported cookies cannot bypass refresh.
	if managedClearance {
		clearanceKey = clearanceCacheKey(selected.ID, proxyURL, sticky)
		cookies, userAgent, err = m.ensureClearance(ctx, selected, proxyURL, cookies, userAgent, clearanceKey, !sticky)
		if err != nil {
			return nil, false, err
		}
	}
	// Derive identity independently of the current toggle. clientFor applies one
	// authoritative toggle snapshot, so enabling isolation between these two
	// stages cannot accidentally place an account request in the shared bucket.
	accountIdentity := ""
	if scope != domain.ScopeConsoleAsset {
		accountIdentity = isolationAccountIdentity(ctx, scope, affinity)
	}
	client, err := m.clientForWithOptions(selected.ID, scope, proxyURL, userAgent, cookies, sticky, accountIdentity, options)
	if err != nil {
		return nil, false, err
	}
	m.incrementInflight(selected.ID)
	recordSelection(ctx, Selection{NodeID: selected.ID, NodeName: selected.Name, Scope: scope, Proxied: proxyURL != ""})
	var once sync.Once
	return &Lease{NodeID: selected.ID, NodeName: selected.Name, Scope: scope, ProxyURL: proxyURL, UserAgent: userAgent, CFCookies: cookies, client: client.client, browser: client.browser, sticky: sticky, proxyPool: proxyPool, freshTunnel: freshTunnel, clearanceKey: clearanceKey, clearanceManager: m, release: func() {
		once.Do(func() {
			m.decrementInflight(selected.ID)
		})
	}}, true, nil
}

// Console assets are served from public media hosts. They still need the
// selected proxy and browser user agent, but forwarding account or node
// clearance cookies would unnecessarily expose credentials to a different
// origin and make an otherwise anonymous download depend on cookie storage.
func usesBrowserClearance(scope domain.Scope) bool {
	return scope != domain.ScopeBuild && scope != domain.ScopeConsoleAsset
}

func (m *Manager) inflightCounter(nodeID uint64) *atomic.Int64 {
	// Counters remain address-stable for the manager lifetime so a concurrent
	// release can never decrement a replacement counter after an ABA deletion.
	if value, ok := m.inflight.Load(nodeID); ok {
		return value.(*atomic.Int64)
	}
	candidate := &atomic.Int64{}
	actual, _ := m.inflight.LoadOrStore(nodeID, candidate)
	return actual.(*atomic.Int64)
}

func (m *Manager) incrementInflight(nodeID uint64) {
	m.inflightCounter(nodeID).Add(1)
}

func (m *Manager) decrementInflight(nodeID uint64) {
	if value, ok := m.inflight.Load(nodeID); ok {
		value.(*atomic.Int64).Add(-1)
	}
}

func (m *Manager) inflightCount(nodeID uint64) int64 {
	if value, ok := m.inflight.Load(nodeID); ok {
		return value.(*atomic.Int64).Load()
	}
	return 0
}
