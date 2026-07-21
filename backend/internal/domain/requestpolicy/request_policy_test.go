package requestpolicy

import (
	"net"
	"reflect"
	"testing"
)

func TestEvaluateDefaultsToAllowAndAppliesStableOrder(t *testing.T) {
	maxTokens := 100
	rules := []Rule{
		{ID: 20, Name: "deny later", Priority: 20, Enabled: true, Match: Match{Model: "grok-*"}, Action: Action{Kind: ActionDeny}},
		{ID: 10, Name: "limit first", Priority: 10, Enabled: true, Match: Match{Model: "grok-*"}, Action: Action{Kind: ActionLimitTokens, MaxTokens: &maxTokens}},
	}
	decision := Evaluate(rules, Request{Model: "grok-4", SourceIP: net.ParseIP("127.0.0.1")})
	if decision.Allowed || decision.RuleID != 20 || decision.MaxTokens == nil || *decision.MaxTokens != 100 {
		t.Fatalf("decision = %#v", decision)
	}
	if !reflect.DeepEqual(decision.MatchedRuleIDs, []uint64{10, 20}) {
		t.Fatalf("matched = %#v", decision.MatchedRuleIDs)
	}
}

func TestEvaluateDryRunNeverBlocks(t *testing.T) {
	decision := Evaluate([]Rule{{ID: 1, Name: "observe", Enabled: true, DryRun: true, Action: Action{Kind: ActionDeny}}}, Request{})
	if !decision.Allowed || !decision.DryRun || !reflect.DeepEqual(decision.MatchedRuleIDs, []uint64{1}) {
		t.Fatalf("decision = %#v", decision)
	}
}

func TestEvaluateCIDRAndMedia(t *testing.T) {
	media := true
	decision := Evaluate([]Rule{{ID: 1, Name: "media", Enabled: true, Match: Match{SourceCIDRs: []string{"10.0.0.0/8"}, Media: &media}, Action: Action{Kind: ActionDeny}}}, Request{SourceIP: net.ParseIP("10.1.2.3"), Media: true})
	if decision.Allowed {
		t.Fatal("expected request to be denied")
	}
	other := Evaluate([]Rule{{ID: 1, Name: "media", Enabled: true, Match: Match{SourceCIDRs: []string{"10.0.0.0/8"}, Media: &media}, Action: Action{Kind: ActionDeny}}}, Request{SourceIP: net.ParseIP("192.0.2.1"), Media: true})
	if !other.Allowed {
		t.Fatal("unexpected denial")
	}
}

func TestValidateRuleRejectsInvalidCIDRAndActionPayload(t *testing.T) {
	if err := ValidateRule(Rule{Name: "bad", Action: Action{Kind: ActionAllow}, Match: Match{SourceCIDRs: []string{"not-cidr"}}}); err == nil {
		t.Fatal("expected invalid CIDR")
	}
	if err := ValidateRule(Rule{Name: "bad", Action: Action{Kind: ActionLimitTokens}}); err == nil {
		t.Fatal("expected invalid token limit")
	}
}
