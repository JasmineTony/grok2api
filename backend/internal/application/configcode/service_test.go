package configcode

import (
	requestpolicy "github.com/chenyme/grok2api/backend/internal/domain/requestpolicy"
	"testing"
)

func TestValidateRequiresEnvironmentSecretReferences(t *testing.T) {
	value := File{Egress: []EgressSpec{{Name: "proxy", Scope: "grok_web", ProxyURL: "https://user:pass@example.com"}}}
	if err := Validate(value); err == nil {
		t.Fatal("inline proxy secret accepted")
	}
}
func TestPlanIsNonDestructive(t *testing.T) {
	value := File{Policies: []requestpolicy.Rule{{Name: "observe", Action: requestpolicy.Action{Kind: requestpolicy.ActionRequireAudit}}}}
	changes := Plan(value)
	if len(changes) != 1 || changes[0].Action != "ensure" {
		t.Fatalf("changes=%#v", changes)
	}
}
