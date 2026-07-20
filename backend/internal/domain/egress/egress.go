package egress

import "time"

type Mode string

const (
	ModeDirect Mode = "direct"
	ModeSingle Mode = "single"
	ModePool   Mode = "pool"
)

type Scope string

const (
	ScopeBuild    Scope = "grok_build"
	ScopeWeb      Scope = "grok_web"
	ScopeConsole  Scope = "grok_console"
	ScopeWebAsset Scope = "grok_web_asset"
)

type AccountPolicyStrategy string

const (
	AccountPolicyInherit AccountPolicyStrategy = "inherit"
	AccountPolicyNode    AccountPolicyStrategy = "node"
	AccountPolicyDirect  AccountPolicyStrategy = "direct"
)

func (s AccountPolicyStrategy) IsValid() bool {
	return s == AccountPolicyInherit || s == AccountPolicyNode || s == AccountPolicyDirect
}

// AccountPolicy overrides the provider-scoped node pool for one account.
// Inherit keeps existing behavior; direct and direct fallback are explicit opt-ins.
type AccountPolicy struct {
	AccountID           uint64
	Strategy            AccountPolicyStrategy
	EgressNodeID        *uint64
	AllowDirectFallback bool
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type Node struct {
	ID                        uint64
	Name                      string
	Scope                     Scope
	Enabled                   bool
	EncryptedProxyURL         string
	UserAgent                 string
	EncryptedCloudflareCookie string
	Health                    float64
	FailureCount              int
	CooldownUntil             *time.Time
	LastError                 string
	CreatedAt                 time.Time
	UpdatedAt                 time.Time
}

type PublicNode struct {
	ID               uint64
	Name             string
	Scope            Scope
	Enabled          bool
	ProxyConfigured  bool
	UserAgent        string
	CookieConfigured bool
	Health           float64
	FailureCount     int
	CooldownUntil    *time.Time
	LastError        string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}
