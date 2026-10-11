package account

import "time"

// RoutingCandidate 聚合账号选择热路径所需的持久化快照。
type RoutingCandidate struct {
	Credential           Credential
	Billing              *Billing
	QuotaWindow          *QuotaWindow
	QuotaRecovery        *QuotaRecovery
	EgressLeaseBlock     *EgressLeaseBlock
	ModelQuotaBlock      *ModelQuotaBlock
	ModelCapabilityKnown bool
	SupportsModel        bool
}

// RoutingAccountBase contains provider-level routing state reusable across
// models. Credential material is hydrated only after an account is selected.
type RoutingAccountBase struct {
	Credential       Credential
	Billing          *Billing
	QuotaRecovery    *QuotaRecovery
	QuotaWindow      *QuotaWindow
	EgressLeaseBlock *EgressLeaseBlock
}

// RoutingAccountOverlay contains model-specific eligibility state.
type RoutingAccountOverlay struct {
	AccountID            uint64
	Bound                bool
	ModelCapabilityKnown bool
	SupportsModel        bool
	ModelQuotaBlock      *ModelQuotaBlock
}

type RoutingOverlaySnapshot struct {
	HasBindings bool
	Values      []RoutingAccountOverlay
}

// ModelQuotaBlock 表示账号的单模型配额暂不可用，不影响该账号上的其他模型。
type ModelQuotaBlock struct {
	AccountID     uint64
	UpstreamModel string
	Reason        string
	CooldownUntil time.Time
	UpdatedAt     time.Time
}

// EgressLeaseBlock temporarily removes one account-bound proxy lease from
// routing without changing the account's health or disabling the physical
// egress node shared by other leases.
type EgressLeaseBlock struct {
	AccountID     uint64
	NodeID        uint64
	Reason        string
	Version       string
	CooldownUntil time.Time
	UpdatedAt     time.Time
}

// EgressLeaseBlockCursor is the stable keyset position used to scan durable
// lease state while rows may be renewed or removed concurrently.
type EgressLeaseBlockCursor struct {
	CooldownUntil time.Time
	AccountID     uint64
	NodeID        uint64
}
