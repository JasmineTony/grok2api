package requestpolicy

import (
	"fmt"
	"net"
	"sort"
	"strings"
	"time"
)

type Match struct {
	ClientKeyID uint64   `json:"clientKeyId" yaml:"clientKeyId"`
	Model       string   `json:"model" yaml:"model"`
	Provider    string   `json:"provider" yaml:"provider"`
	Operation   string   `json:"operation" yaml:"operation"`
	SourceCIDRs []string `json:"sourceCidrs" yaml:"sourceCidrs"`
	Media       *bool    `json:"media" yaml:"media"`
}

type Action struct {
	Kind           string `json:"kind" yaml:"kind"`
	MaxTokens      *int   `json:"maxTokens,omitempty" yaml:"maxTokens,omitempty"`
	MaxMedia       *int   `json:"maxMedia,omitempty" yaml:"maxMedia,omitempty"`
	ForcedProvider string `json:"forcedProvider,omitempty" yaml:"forcedProvider,omitempty"`
}

type Rule struct {
	ID        uint64     `json:"id"`
	Name      string     `json:"name"`
	Priority  int        `json:"priority"`
	Enabled   bool       `json:"enabled"`
	DryRun    bool       `json:"dryRun"`
	Match     Match      `json:"match"`
	Action    Action     `json:"action"`
	HitCount  uint64     `json:"hitCount"`
	LastHitAt *time.Time `json:"lastHitAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

type Request struct {
	ClientKeyID uint64
	Model       string
	Provider    string
	Operation   string
	SourceIP    net.IP
	Media       bool
	MediaCount  int
	Tokens      int
}

type Decision struct {
	Allowed        bool     `json:"allowed"`
	DryRun         bool     `json:"dryRun"`
	RuleID         uint64   `json:"ruleId,omitempty"`
	RuleName       string   `json:"ruleName,omitempty"`
	Action         string   `json:"action,omitempty"`
	Reason         string   `json:"reason,omitempty"`
	ForcedProvider string   `json:"forcedProvider,omitempty"`
	MaxTokens      *int     `json:"maxTokens,omitempty"`
	MaxMedia       *int     `json:"maxMedia,omitempty"`
	RequireAudit   bool     `json:"requireAudit"`
	MatchedRuleIDs []uint64 `json:"matchedRuleIds,omitempty"`
}

const (
	ActionAllow         = "allow"
	ActionDeny          = "deny"
	ActionLimitTokens   = "limit_tokens"
	ActionLimitMedia    = "limit_media"
	ActionForceProvider = "force_provider"
	ActionRequireAudit  = "require_audit"
)

func ValidAction(kind string) bool {
	switch kind {
	case ActionAllow, ActionDeny, ActionLimitTokens, ActionLimitMedia, ActionForceProvider, ActionRequireAudit:
		return true
	}
	return false
}

func ValidateRule(rule Rule) error {
	if strings.TrimSpace(rule.Name) == "" || len([]rune(rule.Name)) > 160 {
		return fmt.Errorf("request policy name is invalid")
	}
	if rule.Priority < -100000 || rule.Priority > 100000 {
		return fmt.Errorf("request policy priority is invalid")
	}
	if !ValidAction(rule.Action.Kind) {
		return fmt.Errorf("request policy action is invalid")
	}
	if rule.Action.Kind == ActionLimitTokens && (rule.Action.MaxTokens == nil || *rule.Action.MaxTokens < 1) {
		return fmt.Errorf("limit_tokens requires positive maxTokens")
	}
	if rule.Action.Kind == ActionLimitMedia && (rule.Action.MaxMedia == nil || *rule.Action.MaxMedia < 1) {
		return fmt.Errorf("limit_media requires positive maxMedia")
	}
	if rule.Action.Kind == ActionForceProvider && strings.TrimSpace(rule.Action.ForcedProvider) == "" {
		return fmt.Errorf("force_provider requires forcedProvider")
	}
	for _, value := range rule.Match.SourceCIDRs {
		if _, _, err := net.ParseCIDR(strings.TrimSpace(value)); err != nil {
			return fmt.Errorf("invalid source CIDR %q: %w", value, err)
		}
	}
	return nil
}

func SortRules(rules []Rule) []Rule {
	out := append([]Rule(nil), rules...)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Priority != out[j].Priority {
			return out[i].Priority < out[j].Priority
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func Evaluate(rules []Rule, request Request) Decision {
	decision := Decision{Allowed: true}
	for _, rule := range SortRules(rules) {
		if !rule.Enabled || !matches(rule.Match, request) {
			continue
		}
		decision.MatchedRuleIDs = append(decision.MatchedRuleIDs, rule.ID)
		if rule.DryRun {
			decision.DryRun = true
			continue
		}
		decision.RuleID, decision.RuleName, decision.Action = rule.ID, rule.Name, rule.Action.Kind
		switch rule.Action.Kind {
		case ActionDeny:
			decision.Allowed = false
			decision.Reason = "request policy denied"
		case ActionLimitTokens:
			decision.MaxTokens = rule.Action.MaxTokens
		case ActionLimitMedia:
			decision.MaxMedia = rule.Action.MaxMedia
		case ActionForceProvider:
			decision.ForcedProvider = rule.Action.ForcedProvider
		case ActionRequireAudit:
			decision.RequireAudit = true
		}
		if rule.Action.Kind == ActionDeny {
			break
		}
	}
	return decision
}

func matches(m Match, r Request) bool {
	if m.ClientKeyID != 0 && m.ClientKeyID != r.ClientKeyID {
		return false
	}
	if !wildcardMatch(m.Model, r.Model) || !wildcardMatch(m.Provider, r.Provider) || !wildcardMatch(m.Operation, r.Operation) {
		return false
	}
	if m.Media != nil && *m.Media != r.Media {
		return false
	}
	if len(m.SourceCIDRs) > 0 {
		matched := false
		for _, raw := range m.SourceCIDRs {
			_, network, err := net.ParseCIDR(strings.TrimSpace(raw))
			if err == nil && network.Contains(r.SourceIP) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	return true
}

func wildcardMatch(pattern, value string) bool {
	pattern, value = strings.TrimSpace(pattern), strings.TrimSpace(value)
	if pattern == "" || pattern == "*" {
		return true
	}
	if strings.HasSuffix(pattern, "*") {
		return strings.HasPrefix(value, strings.TrimSuffix(pattern, "*"))
	}
	return pattern == value
}
