package account

import (
	"crypto/sha256"
	"encoding/binary"
	"time"
)

// Provider 表示上游能力来源。
type Provider string

const (
	ProviderBuild   Provider = "grok_build"
	ProviderWeb     Provider = "grok_web"
	ProviderConsole Provider = "grok_console"
)

// LinkedAccount 表示同一上游用户在另一 Provider 下的弱关联账号。
// 关联只用于出口身份与管理端展示，不共享额度、健康或路由状态。
type LinkedAccount struct {
	ID       uint64
	Provider Provider
	Name     string
	Email    string
	UserID   string
}

var providers = [...]Provider{ProviderBuild, ProviderWeb, ProviderConsole}

// Providers 返回按产品展示和后台维护顺序排列的稳定 Provider 集合。
func Providers() []Provider {
	return append([]Provider(nil), providers[:]...)
}

// IsValid 判断 Provider 是否属于当前系统固定支持的渠道。
func (p Provider) IsValid() bool {
	switch p {
	case ProviderBuild, ProviderWeb, ProviderConsole:
		return true
	default:
		return false
	}
}

// ModelNamespace 返回内部模型路由使用的稳定渠道命名空间。
func (p Provider) ModelNamespace() string {
	switch p {
	case ProviderBuild:
		return "Build"
	case ProviderWeb:
		return "Web"
	case ProviderConsole:
		return "Console"
	default:
		return ""
	}
}

type AuthType string

const (
	AuthTypeOAuth AuthType = "oauth"
	AuthTypeSSO   AuthType = "sso"
)

type WebTier string

const (
	WebTierAuto  WebTier = "auto"
	WebTierBasic WebTier = "basic"
	WebTierSuper WebTier = "super"
	WebTierHeavy WebTier = "heavy"
)

// BuildRouteMode 控制 Build 账号的推理地址；模型、Billing 与 OAuth 不受影响。
type BuildRouteMode string

// CurrentWebTermsVersion 是 Grok Web 当前要求接受的产品服务协议版本。
// accounts.x.ai 的账号协议使用独立版本，不与该值混用。
const CurrentWebTermsVersion = 5

const (
	BuildRouteAuto  BuildRouteMode = "auto"
	BuildRouteBuild BuildRouteMode = "build"
	BuildRouteXAI   BuildRouteMode = "xai"
)

func (m BuildRouteMode) IsValid() bool {
	switch m {
	case BuildRouteAuto, BuildRouteBuild, BuildRouteXAI:
		return true
	default:
		return false
	}
}

const (
	DefaultPriority         = 1
	DefaultMaxConcurrent    = 8
	DefaultMinimumRemaining = 0
	MaxConcurrent           = 256
)

// AuthStatus 表示账号凭据的认证状态。
type AuthStatus string

const (
	AuthStatusActive         AuthStatus = "active"
	AuthStatusReauthRequired AuthStatus = "reauthRequired"
)

// LastErrorMissingThinking values are durable, non-sensitive quality strike
// markers. Unlike arbitrary upstream errors, they may be propagated through
// runtime invalidation events so every gateway instance preserves the strike.
const (
	LastErrorMissingThinking         = "missing_thinking"
	LastErrorMissingThinkingDisabled = "missing_thinking_disabled"
)

// NormalizeHealthMarker admits only durable non-sensitive health markers.
func NormalizeHealthMarker(value string) string {
	switch value {
	case LastErrorMissingThinking, LastErrorMissingThinkingDisabled:
		return value
	default:
		return ""
	}
}

// EgressAssignmentMode 表示账号出口节点的维护方式。手工绑定绝不会被
// 自动均衡任务迁移，自动绑定才允许在健康或容量变化时重新分配。
type EgressAssignmentMode string

const (
	EgressAssignmentManual EgressAssignmentMode = "manual"
	EgressAssignmentAuto   EgressAssignmentMode = "auto"
)

func (value EgressAssignmentMode) IsValid() bool {
	return value == EgressAssignmentManual || value == EgressAssignmentAuto
}

// Credential 表示持久化的上游 OAuth 账号。
type Credential struct {
	ID                        uint64
	Provider                  Provider
	AuthType                  AuthType
	Name                      string
	Email                     string
	UserID                    string
	TeamID                    string
	SourceKey                 string
	OIDCClientID              string
	EncryptedAccessToken      string
	EncryptedRefreshToken     string
	EncryptedCloudflareCookie string
	ExpiresAt                 time.Time
	RefreshDueAt              *time.Time
	LastRefreshAt             *time.Time
	RefreshFailureCount       int
	// RefreshUnclassifiedAuthCount counts consecutive OAuth 400/401 rejections
	// that cannot be classified from a machine-readable error code.
	RefreshUnclassifiedAuthCount int
	LastRefreshErrorStatus       int
	LastRefreshErrorCode         string
	LastRefreshErrorMessage      string
	LastRefreshErrorResponse     string
	RefreshPermanent             bool
	Enabled                      bool
	AuthStatus                   AuthStatus
	// ReauthMarkedAt 仅在切入 reauthRequired 时写入；恢复 active 时清空。自动清理以该时刻为 minAge 锚点。
	ReauthMarkedAt   *time.Time
	Priority         int
	MaxConcurrent    int
	MinimumRemaining float64
	FailureCount     int
	CooldownUntil    *time.Time
	LastError        string
	LastUsedAt       *time.Time
	ObservedModel    string
	ObservedModelAt  *time.Time
	WebTier          WebTier
	WebTierSyncedAt  *time.Time
	// EgressIdentity 是不含凭据和个人信息的稳定出口身份。
	// 关联到同一 Web 账号的 Build/Console 只共享该值，不共享任何运行状态。
	EgressIdentity string
	// EgressNodeID 是账号显式绑定的出口节点。0 表示沿用当前 scope 的
	// 池选择逻辑；非零值必须优先使用该节点，不能悄悄回退到其他代理。
	EgressNodeID         uint64
	EgressAssignmentMode EgressAssignmentMode
	EgressAssignedAt     *time.Time
	// WebNSFWEnabledAt 记录 Grok Web 上游首次确认 NSFW 已成功开启的时间。
	// 普通导入、额度同步和凭据更新不得清除。
	WebNSFWEnabledAt *time.Time
	// WebTermsAcceptedAt 记录 Grok Web 上游确认当前版本完整服务协议已接受的时间。
	// 关联渠道只共享该展示状态，不获得修改 Web 资料的能力。
	WebTermsAcceptedAt *time.Time
	// WebTermsAcceptedVersion 记录已完成的 Grok Web 产品协议版本。
	// 历史数据默认为 0，必须补执行当前版本后才视为完整接受。
	WebTermsAcceptedVersion int
	// WebBirthDateSetAt 记录 Grok Web 上游首次确认生日已设置的时间。
	// 该字段用于避免批量脚本重复请求不可修改的生日接口。
	WebBirthDateSetAt *time.Time
	LinkedAccountID   uint64
	LinkedAccountName string
	LinkedProvider    Provider
	LinkedAccounts    []LinkedAccount
	// BuildAPIFallback 仅记录 grok_build 曾因当次 Build 403 成功回退到 XAI。
	// 它不参与路由；每个新请求仍先走 Build，只有当次严格 403 才可尝试 XAI。
	// token refresh / SSO 转换 / 普通 upsert / 重启不得清除。
	BuildAPIFallback bool
	// BuildRouteMode 是管理员设置的账号级推理地址策略。
	// auto 使用 bot flag / Build 403 自动规则；build 与 xai 分别强制单一地址。
	BuildRouteMode BuildRouteMode
	// BuildSuperEntitled 仅对 grok_build 有效：管理员已确认该账号具备 Super/1.5 entitlement。
	// 不替代 Billing 快照，不等同于 BuildAPIFallback，也不表示请求应走 XAI。
	// 普通导入/upsert/token refresh/SSO 转换不得清除；仅显式管理员 PATCH 可改。
	BuildSuperEntitled bool
	// BuildBotFlagSource 是从 Build access token 提取并持久化的非敏感路由元数据。
	// 仅精确值 1、2 表示风控；0 表示未标记或非 Build 账号。
	BuildBotFlagSource int
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// CredentialMaterial contains the encrypted provider secrets and refresh
// metadata loaded only after routing selects an account.
type CredentialMaterial struct {
	AccountID                    uint64
	Provider                     Provider
	AuthType                     AuthType
	OIDCClientID                 string
	EncryptedAccessToken         string
	EncryptedRefreshToken        string
	EncryptedCloudflareCookie    string
	ExpiresAt                    time.Time
	RefreshDueAt                 *time.Time
	LastRefreshAt                *time.Time
	RefreshFailureCount          int
	RefreshUnclassifiedAuthCount int
	LastRefreshErrorStatus       int
	LastRefreshErrorCode         string
	LastRefreshErrorMessage      string
	LastRefreshErrorResponse     string
	RefreshPermanent             bool
	UpdatedAt                    time.Time
}

// ApplyTo merges credential material into the matching routing account.
// A mismatch leaves the value unchanged so callers cannot attach one
// account's secrets to another account.
func (m CredentialMaterial) ApplyTo(value Credential) (Credential, bool) {
	if m.AccountID == 0 || value.ID != m.AccountID || m.Provider == "" || value.Provider != m.Provider {
		return value, false
	}
	value.AuthType = m.AuthType
	value.OIDCClientID = m.OIDCClientID
	value.EncryptedAccessToken = m.EncryptedAccessToken
	value.EncryptedRefreshToken = m.EncryptedRefreshToken
	value.EncryptedCloudflareCookie = m.EncryptedCloudflareCookie
	value.ExpiresAt = m.ExpiresAt
	value.RefreshDueAt = m.RefreshDueAt
	value.LastRefreshAt = m.LastRefreshAt
	value.RefreshFailureCount = m.RefreshFailureCount
	value.RefreshUnclassifiedAuthCount = m.RefreshUnclassifiedAuthCount
	value.LastRefreshErrorStatus = m.LastRefreshErrorStatus
	value.LastRefreshErrorCode = m.LastRefreshErrorCode
	value.LastRefreshErrorMessage = m.LastRefreshErrorMessage
	value.LastRefreshErrorResponse = m.LastRefreshErrorResponse
	value.RefreshPermanent = m.RefreshPermanent
	return value, true
}

// CredentialRefreshDueAt 将账号稳定地分散到到期前 5~8 分钟，避免同批导入账号同时刷新。
func CredentialRefreshDueAt(accountID uint64, expiresAt time.Time) time.Time {
	if expiresAt.IsZero() {
		return time.Time{}
	}
	var identity [8]byte
	binary.BigEndian.PutUint64(identity[:], accountID)
	digest := sha256.Sum256(identity[:])
	jitterSeconds := binary.BigEndian.Uint16(digest[:2]) % 181
	return expiresAt.UTC().Add(-5*time.Minute - time.Duration(jitterSeconds)*time.Second)
}

// DeviceSession 表示一次短期 Device OAuth 授权流程。
type DeviceSession struct {
	ID                      string
	DeviceCode              string
	UserCode                string
	VerificationURI         string
	VerificationURIComplete string
	Interval                time.Duration
	NextPollAt              time.Time
	ExpiresAt               time.Time
}
