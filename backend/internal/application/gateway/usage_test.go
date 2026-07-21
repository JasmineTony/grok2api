package gateway

import "testing"

func TestNormalizeUsageClampsCachedInputToInputSubset(t *testing.T) {
	value := normalizeUsage(Usage{InputTokens: 10, CachedInputTokens: 20, OutputTokens: -1, ReasoningTokens: 3})
	if value.InputTokens != 10 || value.CachedInputTokens != 10 || value.OutputTokens != 0 || value.ReasoningTokens != 3 || value.TotalTokens != 13 {
		t.Fatalf("normalized usage = %#v", value)
	}
}

func TestNormalizeUsagePreservesPositiveUpstreamTotal(t *testing.T) {
	value := normalizeUsage(Usage{InputTokens: 10, CachedInputTokens: 2, OutputTokens: 3, ReasoningTokens: 1, TotalTokens: 99})
	if value.TotalTokens != 99 || value.CachedInputTokens != 2 {
		t.Fatalf("normalized usage = %#v", value)
	}
}
