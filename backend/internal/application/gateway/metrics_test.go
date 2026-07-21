package gateway

import "testing"

type gatewayMetricsRecorder struct {
	tokens map[string]uint64
	costs  map[string]float64
}

func (r *gatewayMetricsRecorder) IncRetry(string)                     {}
func (r *gatewayMetricsRecorder) AddTokens(kind string, count uint64) { r.tokens[kind] += count }
func (r *gatewayMetricsRecorder) AddCost(kind string, amount float64) { r.costs[kind] += amount }

func TestRecordGatewayUsageMetricsClampsCachedInput(t *testing.T) {
	recorder := &gatewayMetricsRecorder{tokens: map[string]uint64{}, costs: map[string]float64{}}
	recordGatewayUsageMetrics(recorder, Usage{InputTokens: 10, CachedInputTokens: 20, OutputTokens: -1, ReasoningTokens: 3}, 5_000_000_000, 2_500_000_000)
	if recorder.tokens["input"] != 10 || recorder.tokens["cached_input"] != 10 || recorder.tokens["output"] != 0 || recorder.tokens["reasoning"] != 3 {
		t.Fatalf("tokens = %#v", recorder.tokens)
	}
	if recorder.costs["actual"] != 0.5 || recorder.costs["estimated"] != 0.25 {
		t.Fatalf("costs = %#v", recorder.costs)
	}
}
