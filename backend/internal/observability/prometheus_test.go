package observability

import (
	"strings"
	"testing"
)

func TestMetricsUseLowCardinalityLabels(t *testing.T) {
	m := NewMetrics()
	m.IncRequest("error", "timeout")
	m.SetAccountState("reauth_required", 2)
	m.AddTokens("input", 10)
	m.AddCost("estimated", 0.2)
	snapshot := m.Snapshot()
	if !strings.Contains(snapshot, `category="timeout"`) || !strings.Contains(snapshot, `state="reauth_required"`) {
		t.Fatalf("snapshot missing metrics: %s", snapshot)
	}
	if strings.Contains(snapshot, "request_id") || strings.Contains(snapshot, "account_id") {
		t.Fatalf("high-cardinality labels leaked: %s", snapshot)
	}
}
