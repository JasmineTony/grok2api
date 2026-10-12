package egress

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptrace"
	"net/netip"
	"strings"
	"sync"
	"time"

	application "github.com/chenyme/grok2api/backend/internal/application/egress"
	domain "github.com/chenyme/grok2api/backend/internal/domain/egress"
)

type preparedEgressProbe struct {
	nodeID    uint64
	nodeName  string
	nodeScope domain.Scope
	proxyURL  string
}

// egressProbeTrace records the connection timing observed by the HTTP client
// trace so a failed probe can report the stage that actually failed.
type egressProbeTrace struct {
	startedAt     time.Time
	mu            sync.Mutex
	connectStart  time.Time
	tlsStart      time.Time
	connectDone   bool
	connectFailed bool
	tlsDone       bool
	tlsFailed     bool
	gotFirstByte  bool
	connectMS     int
	tlsMS         int
	firstByteMS   int
}

func newEgressProbeTrace(startedAt time.Time) *egressProbeTrace {
	return &egressProbeTrace{startedAt: startedAt}
}

func (t *egressProbeTrace) clientTrace() *httptrace.ClientTrace {
	return &httptrace.ClientTrace{
		ConnectStart:         func(_, _ string) { t.startConnect() },
		ConnectDone:          func(_, _ string, traceErr error) { t.finishConnect(traceErr) },
		TLSHandshakeStart:    func() { t.startTLS() },
		TLSHandshakeDone:     func(_ tls.ConnectionState, traceErr error) { t.finishTLS(traceErr) },
		GotFirstResponseByte: func() { t.firstResponseByte() },
	}
}

func (t *egressProbeTrace) startConnect() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.connectStart.IsZero() {
		t.connectStart = time.Now()
	}
}

func (t *egressProbeTrace) finishConnect(traceErr error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.connectDone = true
	t.connectFailed = traceErr != nil
	if !t.connectStart.IsZero() && t.connectMS == 0 {
		t.connectMS = max(1, int(time.Since(t.connectStart).Milliseconds()))
	}
}

func (t *egressProbeTrace) startTLS() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.tlsStart.IsZero() {
		t.tlsStart = time.Now()
	}
}

func (t *egressProbeTrace) finishTLS(traceErr error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.tlsDone = true
	t.tlsFailed = traceErr != nil
	if !t.tlsStart.IsZero() && t.tlsMS == 0 {
		t.tlsMS = max(1, int(time.Since(t.tlsStart).Milliseconds()))
	}
}

func (t *egressProbeTrace) firstResponseByte() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.gotFirstByte = true
	if t.firstByteMS == 0 {
		t.firstByteMS = max(1, int(time.Since(t.startedAt).Milliseconds()))
	}
}

// snapshot resolves the timings observed so far, filling in a stage that never
// reported completion from the total probe duration.
func (t *egressProbeTrace) snapshot(durationMS int, stage string) (int, int, int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.connectStart.IsZero() && t.connectMS == 0 {
		t.connectMS = max(1, int(time.Since(t.connectStart).Milliseconds()))
	}
	if !t.tlsStart.IsZero() && t.tlsMS == 0 {
		t.tlsMS = max(1, int(time.Since(t.tlsStart).Milliseconds()))
	}
	if stage == "first_byte" && t.firstByteMS == 0 {
		t.firstByteMS = durationMS
	}
	return t.connectMS, t.tlsMS, t.firstByteMS
}

// failureStage classifies which handshake stage the transport error belongs to.
func (t *egressProbeTrace) failureStage() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	switch {
	case !t.connectStart.IsZero() && (!t.connectDone || t.connectFailed):
		return "connect"
	case !t.tlsStart.IsZero() && (!t.tlsDone || t.tlsFailed):
		return "tls"
	case (t.connectDone || t.tlsDone) && !t.gotFirstByte:
		return "first_byte"
	default:
		return "execute_request"
	}
}

// ProbeEgressNode verifies IPv4 and IPv6 independently through fixed provider
// endpoints. Both requests share one immutable node snapshot so a concurrent
// administrator edit cannot mix results from different proxy configurations.
func (m *Manager) ProbeEgressNode(ctx context.Context, node domain.Node) (domain.ProbeResult, error) {
	startedAt := time.Now().UTC()
	var provider domain.ProbeProvider
	config, supported, configErr := m.loadOperationsConfig(ctx, time.Now().UTC())
	if configErr != nil {
		message := "读取代理探测服务配置失败"
		result := failedEgressProbeResult(provider, message, startedAt)
		m.logProbeSetupFailure(ctx, node, provider, "load_probe_config", message, configErr, result.LatencyMS)
		return result, configErr
	}
	if supported {
		provider = config.ProbeProvider.Normalized()
	} else {
		provider = domain.ProbeProviderCloudflare
	}
	target, stage, message, prepareErr := m.prepareEgressProbe(node)
	if prepareErr != nil {
		result := failedEgressProbeResult(provider, message, startedAt)
		m.logProbeSetupFailure(ctx, node, provider, stage, message, prepareErr, result.LatencyMS)
		return result, prepareErr
	}
	ipv4, ipv4Err, ipv6, ipv6Err := m.probeBothAddressFamilies(ctx, target, provider)
	return combineEgressProbeResults(provider, ipv4, ipv4Err, ipv6, ipv6Err)
}

func (m *Manager) probeBothAddressFamilies(ctx context.Context, target preparedEgressProbe, provider domain.ProbeProvider) (domain.ProbeFamilyResult, error, domain.ProbeFamilyResult, error) {
	type outcome struct {
		family string
		result domain.ProbeFamilyResult
		err    error
	}
	ipv4Endpoint, ipv6Endpoint := probeEndpoints(provider)
	outcomes := make(chan outcome, 2)
	for _, probe := range []struct{ family, endpoint string }{{"ipv4", ipv4Endpoint}, {"ipv6", ipv6Endpoint}} {
		go func() {
			result, err := m.probeEgressEndpoint(ctx, target, provider, probe.family, probe.endpoint)
			outcomes <- outcome{family: probe.family, result: result, err: err}
		}()
	}
	var ipv4Result, ipv6Result domain.ProbeFamilyResult
	var ipv4Err, ipv6Err error
	for range 2 {
		current := <-outcomes
		if current.family == "ipv4" {
			ipv4Result, ipv4Err = current.result, current.err
		} else {
			ipv6Result, ipv6Err = current.result, current.err
		}
	}
	return ipv4Result, ipv4Err, ipv6Result, ipv6Err
}

func combineEgressProbeResults(provider domain.ProbeProvider, ipv4 domain.ProbeFamilyResult, ipv4Err error, ipv6 domain.ProbeFamilyResult, ipv6Err error) (domain.ProbeResult, error) {
	result := domain.ProbeResult{Status: domain.ProbeStatusUnhealthy, Provider: provider, IPv4: ipv4, IPv6: ipv6}
	result.TestedAt = time.Now().UTC()
	result.LatencyMS = max(result.IPv4.LatencyMS, result.IPv6.LatencyMS)
	if result.IPv4.Status == domain.ProbeStatusHealthy {
		result.Status, result.ExitIP = domain.ProbeStatusHealthy, result.IPv4.ExitIP
	} else if result.IPv6.Status == domain.ProbeStatusHealthy {
		result.Status, result.ExitIP = domain.ProbeStatusHealthy, result.IPv6.ExitIP
	}
	if result.Status == domain.ProbeStatusHealthy {
		return result, nil
	}
	errorsByFamily := make([]string, 0, 2)
	if result.IPv4.Error != "" {
		errorsByFamily = append(errorsByFamily, "IPv4: "+result.IPv4.Error)
	}
	if result.IPv6.Error != "" {
		errorsByFamily = append(errorsByFamily, "IPv6: "+result.IPv6.Error)
	}
	result.Error = strings.Join(errorsByFamily, "; ")
	if result.Error == "" {
		result.Error = "IPv4 和 IPv6 代理探测均失败"
	}
	return result, errors.Join(ipv4Err, ipv6Err, errors.New(result.Error))
}

func (m *Manager) prepareEgressProbe(node domain.Node) (preparedEgressProbe, string, string, error) {
	target := preparedEgressProbe{nodeID: node.ID, nodeName: node.Name, nodeScope: node.Scope}
	if node.ID == 0 {
		message := "代理节点 ID 无效"
		return target, "validate_node", message, errors.New(message)
	}
	proxyURL, err := m.cipher.Decrypt(node.EncryptedProxyURL)
	if err != nil {
		return target, "decrypt_proxy", "读取代理配置失败", err
	}
	proxyURL, err = application.NormalizeProxyURL(proxyURL)
	if err != nil {
		return target, "normalize_proxy", "代理地址无效", err
	}
	if proxyURL == "" {
		message := "未配置代理地址"
		return target, "normalize_proxy", message, errors.New(message)
	}
	if strings.Contains(proxyURL, application.ProxyAccountPlaceholder) {
		proxyURL, err = renderAccountProxyURL(proxyURL, "egress_probe")
		if err != nil {
			return target, "render_proxy_identity", "账号代理模板无效", err
		}
	}
	target.proxyURL = proxyURL
	return target, "", "", nil
}

func failedEgressProbeResult(provider domain.ProbeProvider, message string, startedAt time.Time) domain.ProbeResult {
	completedAt := time.Now().UTC()
	latencyMS := max(1, int(completedAt.Sub(startedAt).Milliseconds()))
	family := domain.ProbeFamilyResult{
		Status: domain.ProbeStatusUnhealthy, TestedAt: completedAt, LatencyMS: latencyMS, Error: message,
	}
	return domain.ProbeResult{
		Status: domain.ProbeStatusUnhealthy, TestedAt: completedAt, LatencyMS: latencyMS, Error: message,
		Provider: provider, IPv4: family, IPv6: family,
	}
}

func (m *Manager) logProbeSetupFailure(ctx context.Context, node domain.Node, provider domain.ProbeProvider, stage, message string, err error, durationMS int) {
	attributes := []any{
		"node_id", node.ID, "node_name", node.Name, "scope", node.Scope,
		"probe_provider", provider, "address_family", "all", "endpoint", "",
		"stage", stage, "status_code", 0, "duration_ms", durationMS,
		"connect_ms", 0, "tls_ms", 0, "first_byte_ms", 0,
		"probe_error", message,
	}
	if err != nil {
		attributes = append(attributes, "error", sanitizeFlareSolverrMessage(err.Error()))
	}
	m.log().WarnContext(ctx, "egress_probe_failed", attributes...)
}

func probeEndpoints(provider domain.ProbeProvider) (string, string) {
	if provider.Normalized() == domain.ProbeProviderCloudflare {
		return cloudflareIPv4ProbeEndpoint, cloudflareIPv6ProbeEndpoint
	}
	return egressIPv4ProbeEndpoint, egressIPv6ProbeEndpoint
}

func (m *Manager) probeEgressEndpoint(ctx context.Context, target preparedEgressProbe, provider domain.ProbeProvider, family, targetURL string) (result domain.ProbeFamilyResult, probeErr error) {
	startedAt := time.Now().UTC()
	result = domain.ProbeFamilyResult{Status: domain.ProbeStatusUnhealthy, TestedAt: startedAt}
	stage := "create_client"
	statusCode := 0
	trace := newEgressProbeTrace(startedAt)
	defer func() {
		m.logProbeEndpointOutcome(ctx, target, provider, family, targetURL, stage, statusCode, trace, &result, probeErr)
	}()
	client, err := m.newEgressProbeClient(target.proxyURL)
	if err != nil {
		result.Error = "创建代理连接失败"
		return result, err
	}
	defer client.CloseIdleConnections()
	probeCtx, cancel := context.WithTimeout(ctx, egressProbeTimeout)
	defer cancel()
	probeCtx = httptrace.WithClientTrace(probeCtx, trace.clientTrace())
	stage = "build_request"
	request, err := http.NewRequestWithContext(probeCtx, http.MethodGet, targetURL, nil)
	if err != nil {
		result.Error = "构造探测请求失败"
		return result, err
	}
	request.Header.Set("User-Agent", DefaultUserAgent)
	stage = "execute_request"
	response, err := client.Do(request)
	if err != nil {
		stage = trace.failureStage()
		result.Error = "代理连接失败"
		return result, err
	}
	statusCode = response.StatusCode
	defer response.Body.Close()
	return finishEgressProbeResponse(response, family, startedAt, result, &stage)
}

func (m *Manager) newEgressProbeClient(proxyURL string) (requestClient, error) {
	clientFactory := m.newBuildClient
	if clientFactory == nil {
		clientFactory = newBuildRequestClient
	}
	return clientFactory(proxyURL, egressProbeTimeout)
}

// logProbeEndpointOutcome reports one address-family probe result after the
// named return values have been finalized.
func (m *Manager) logProbeEndpointOutcome(ctx context.Context, target preparedEgressProbe, provider domain.ProbeProvider, family, targetURL, stage string, statusCode int, trace *egressProbeTrace, result *domain.ProbeFamilyResult, probeErr error) {
	completedAt := time.Now().UTC()
	durationMS := max(1, int(completedAt.Sub(trace.startedAt).Milliseconds()))
	result.TestedAt = completedAt
	if result.LatencyMS == 0 {
		result.LatencyMS = durationMS
	}
	connectDurationMS, tlsDurationMS, firstByteDurationMS := trace.snapshot(durationMS, stage)
	attributes := []any{
		"node_id", target.nodeID,
		"node_name", target.nodeName,
		"scope", target.nodeScope,
		"probe_provider", provider,
		"address_family", family,
		"endpoint", targetURL,
		"stage", stage,
		"status_code", statusCode,
		"duration_ms", durationMS,
		"connect_ms", connectDurationMS,
		"tls_ms", tlsDurationMS,
		"first_byte_ms", firstByteDurationMS,
	}
	if probeErr != nil || result.Status != domain.ProbeStatusHealthy {
		attributes = append(attributes, "probe_error", result.Error)
		if probeErr != nil {
			attributes = append(attributes, "error", sanitizeFlareSolverrMessage(probeErr.Error()))
		}
		m.log().WarnContext(ctx, "egress_probe_failed", attributes...)
		return
	}
	attributes = append(attributes, "latency_ms", result.LatencyMS, "exit_ip", result.ExitIP)
	m.log().InfoContext(ctx, "egress_probe_succeeded", attributes...)
}

// finishEgressProbeResponse validates one probe response and advances the stage
// pointer so a failure is attributed to the stage that rejected it.
func finishEgressProbeResponse(response *http.Response, family string, startedAt time.Time, result domain.ProbeFamilyResult, stage *string) (domain.ProbeFamilyResult, error) {
	*stage = "read_response"
	body, readErr := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if readErr != nil {
		result.Error = "读取探测响应失败"
		return result, readErr
	}
	*stage = "validate_status"
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		result.Error = fmt.Sprintf("探测服务返回 HTTP %d", response.StatusCode)
		return result, errors.New(result.Error)
	}
	*stage = "decode_response"
	exitIP, err := decodeProbeIP(body)
	if err != nil {
		result.Error = "探测服务响应格式无效"
		return result, err
	}
	*stage = "validate_exit_ip"
	address, err := netip.ParseAddr(exitIP)
	if err != nil || (family == "ipv4" && !address.Is4()) || (family == "ipv6" && !address.Is6()) {
		result.Error = fmt.Sprintf("探测服务未返回有效 %s 出口 IP", strings.ToUpper(family))
		if err == nil {
			err = errors.New(result.Error)
		}
		return result, err
	}
	result.Status = domain.ProbeStatusHealthy
	result.LatencyMS = max(1, int(time.Since(startedAt).Milliseconds()))
	result.ExitIP = address.String()
	result.Error = ""
	*stage = "complete"
	return result, nil
}

func decodeProbeIP(body []byte) (string, error) {
	var payload struct {
		IP string `json:"ip"`
	}
	if json.Unmarshal(body, &payload) == nil && strings.TrimSpace(payload.IP) != "" {
		return strings.TrimSpace(payload.IP), nil
	}
	for line := range strings.SplitSeq(string(body), "\n") {
		key, value, found := strings.Cut(strings.TrimSpace(line), "=")
		if found && key == "ip" && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value), nil
		}
	}
	return "", errors.New("probe response does not contain an IP address")
}
