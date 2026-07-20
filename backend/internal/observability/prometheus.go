package observability

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// PrometheusConfig keeps the listener opt-in and local-only by default.
type PrometheusConfig struct {
	Enabled bool
	Listen  string
}

func (c PrometheusConfig) normalized() PrometheusConfig {
	if strings.TrimSpace(c.Listen) == "" {
		c.Listen = "127.0.0.1:9090"
	}
	return c
}

// Metrics is a low-cardinality, dependency-free Prometheus registry.
// Account IDs, request IDs, credentials and full model names are intentionally not labels.
type Metrics struct {
	mu            sync.RWMutex
	requests      map[string]uint64
	durations     map[string]durationSummary
	accountStates map[string]uint64
	egressHealth  map[string]uint64
	tokens        map[string]uint64
	cost          map[string]float64
}

type durationSummary struct {
	count uint64
	sum   float64
}

func NewMetrics() *Metrics {
	return &Metrics{requests: map[string]uint64{}, durations: map[string]durationSummary{}, accountStates: map[string]uint64{}, egressHealth: map[string]uint64{}, tokens: map[string]uint64{}, cost: map[string]float64{}}
}

func (m *Metrics) IncRequest(result, category string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.requests[fmt.Sprintf("%s|%s", safeLabel(result), safeLabel(category))]++
}

func (m *Metrics) ObserveDuration(kind string, duration time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := safeLabel(kind)
	item := m.durations[key]
	item.count++
	item.sum += duration.Seconds()
	m.durations[key] = item
}

func (m *Metrics) SetAccountState(state string, count uint64) {
	m.setGauge(m.accountStates, state, count)
}
func (m *Metrics) SetEgressHealth(state string, count uint64) {
	m.setGauge(m.egressHealth, state, count)
}
func (m *Metrics) AddTokens(kind string, count uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tokens[safeLabel(kind)] += count
}
func (m *Metrics) AddCost(kind string, amount float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cost[safeLabel(kind)] += amount
}

func (m *Metrics) setGauge(target map[string]uint64, key string, value uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	target[safeLabel(key)] = value
}

func (m *Metrics) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		_, _ = w.Write([]byte(m.Snapshot()))
	})
}

func (m *Metrics) Snapshot() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var b strings.Builder
	b.WriteString("# TYPE grok2api_requests_total counter\n")
	writeSorted2(&b, "grok2api_requests_total", m.requests, "result", "category")
	b.WriteString("# TYPE grok2api_request_duration_seconds summary\n")
	for _, key := range sortedKeys(m.durations) {
		item := m.durations[key]
		fmt.Fprintf(&b, "grok2api_request_duration_seconds_count{kind=\"%s\"} %d\n", key, item.count)
		fmt.Fprintf(&b, "grok2api_request_duration_seconds_sum{kind=\"%s\"} %f\n", key, item.sum)
	}
	b.WriteString("# TYPE grok2api_account_states gauge\n")
	writeSorted1(&b, "grok2api_account_states", m.accountStates, "state")
	b.WriteString("# TYPE grok2api_egress_health gauge\n")
	writeSorted1(&b, "grok2api_egress_health", m.egressHealth, "state")
	b.WriteString("# TYPE grok2api_tokens_total counter\n")
	writeSorted1(&b, "grok2api_tokens_total", m.tokens, "kind")
	b.WriteString("# TYPE grok2api_cost_usd_total counter\n")
	for _, key := range sortedFloatKeys(m.cost) {
		fmt.Fprintf(&b, "grok2api_cost_usd_total{kind=\"%s\"} %f\n", key, m.cost[key])
	}
	return b.String()
}

func writeSorted1(b *strings.Builder, metric string, values map[string]uint64, label string) {
	for _, key := range sortedKeys(values) {
		fmt.Fprintf(b, "%s{%s=\"%s\"} %d\n", metric, label, key, values[key])
	}
}
func writeSorted2(b *strings.Builder, metric string, values map[string]uint64, label1, label2 string) {
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		parts := strings.SplitN(k, "|", 2)
		fmt.Fprintf(b, "%s{%s=\"%s\",%s=\"%s\"} %d\n", metric, label1, parts[0], label2, parts[1], values[k])
	}
}
func sortedKeys[T any](values map[string]T) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
func sortedFloatKeys(values map[string]float64) []string { return sortedKeys(values) }
func safeLabel(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "unknown"
	}
	return strings.NewReplacer("\\", "\\\\", "\"", "\\\"", "\n", " ").Replace(value)
}

// Serve starts the opt-in listener. It returns immediately when disabled.
func Serve(ctx context.Context, cfg PrometheusConfig, metrics *Metrics) error {
	cfg = cfg.normalized()
	if !cfg.Enabled {
		return nil
	}
	if metrics == nil {
		metrics = NewMetrics()
	}
	server := &http.Server{Addr: cfg.Listen, Handler: metrics.Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() { <-ctx.Done(); _ = server.Shutdown(context.Background()) }()
	err := server.ListenAndServe()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
