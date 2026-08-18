package observability

import (
	"strings"
	"testing"

	"github.com/chenyme/grok2api/backend/internal/pkg/perfmetrics"
)

func TestMetricsUseLowCardinalityLabels(t *testing.T) {
	m := NewMetrics()
	m.IncRetry("timeout")
	m.IncRequest("error", "timeout")
	m.SetAccountState("reauth_required", 2)
	m.AddTokens("input", 10)
	m.AddCost("estimated", 0.2)
	snapshot := m.Snapshot()
	if !strings.Contains(snapshot, `grok2api_retries_total{category="timeout"} 1`) || !strings.Contains(snapshot, `category="timeout"`) || !strings.Contains(snapshot, `state="reauth_required"`) {
		t.Fatalf("snapshot missing metrics: %s", snapshot)
	}
	if strings.Contains(snapshot, "request_id") || strings.Contains(snapshot, "account_id") {
		t.Fatalf("high-cardinality labels leaked: %s", snapshot)
	}
}

func TestMetricsExposeWhitelistedOperationalPerformance(t *testing.T) {
	registry := perfmetrics.NewRegistry()
	registry.Inc("account_import_runs_total", perfmetrics.Labels{
		Subsystem: "account", Operation: "credentials", Provider: "grok_web", Outcome: "success",
	})
	registry.Inc("token_refresh_total", perfmetrics.Labels{
		Subsystem: "account", Operation: "credential_refresh", Provider: "grok_build", Outcome: "success",
	})
	registry.Inc("upstream_request_total", perfmetrics.Labels{
		Subsystem: "upstream", Operation: "responses", Provider: "grok_web", Status: "502", Outcome: "response",
	})
	registry.SetGauge("audit_queue_depth", perfmetrics.Labels{Subsystem: "audit", Stage: "queue"}, 3)
	registry.SetGauge("billing_reservation_age_seconds", perfmetrics.Labels{Subsystem: "billing", Operation: "reservation", Stage: "active"}, 45)
	registry.SetGauge("voice_websocket_active", perfmetrics.Labels{Subsystem: "gateway", Operation: "stt", Provider: "grok_console"}, 2)
	registry.Inc("unbounded_internal_detail", perfmetrics.Labels{Operation: "secret-account-id"})

	metrics := NewMetrics()
	metrics.SetPerformanceRegistry(registry)
	snapshot := metrics.Snapshot()
	if !strings.Contains(snapshot, `grok2api_account_import_runs_total{subsystem="account",operation="credentials",provider="grok_web",outcome="success"} 1`) {
		t.Fatalf("snapshot missing account import metric: %s", snapshot)
	}
	if !strings.Contains(snapshot, `grok2api_token_refresh_total{subsystem="account",operation="credential_refresh",provider="grok_build",outcome="success"} 1`) ||
		!strings.Contains(snapshot, `grok2api_upstream_request_total{subsystem="upstream",operation="responses",provider="grok_web",status="502",outcome="response"} 1`) ||
		!strings.Contains(snapshot, `grok2api_audit_queue_depth{subsystem="audit",stage="queue"} 3`) ||
		!strings.Contains(snapshot, `grok2api_billing_reservation_age_seconds{subsystem="billing",operation="reservation",stage="active"} 45`) ||
		!strings.Contains(snapshot, `grok2api_voice_websocket_active{subsystem="gateway",operation="stt",provider="grok_console"} 2`) ||
		!strings.Contains(snapshot, `grok2api_ws_active{path="stt",provider="grok_console"} 2`) {
		t.Fatalf("snapshot missing lifecycle metrics: %s", snapshot)
	}
	if strings.Contains(snapshot, "unbounded_internal_detail") || strings.Contains(snapshot, "secret-account-id") {
		t.Fatalf("non-whitelisted performance metric leaked: %s", snapshot)
	}
}
