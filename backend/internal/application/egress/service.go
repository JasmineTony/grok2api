package egress

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	domain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

var (
	ErrInvalidInput            = errors.New("代理节点参数无效")
	ErrInvalidFilter           = errors.New("出口代理筛选条件无效")
	ErrInvalidSort             = errors.New("代理节点排序条件无效")
	ErrNotFound                = errors.New("代理节点不存在")
	ErrProbeStale              = errors.New("代理配置在探测期间已更新，请重新测试")
	ErrQualityProbeUnavailable = errors.New("出口质量探测不可用")
	ErrQualityProbeNoAccount   = errors.New("质量检测暂无可调度账号")
	ErrQualityLeaseUnavailable = errors.New("租约级质量隔离不可用")
	ErrQualityLeaseConflict    = errors.New("租约状态已变化")
	ErrClearanceUnavailable    = errors.New("Clearance 刷新不可用")
	ErrProxyProfileUnavailable = errors.New("共享代理配置功能不可用")
	ErrProxyProfileInUse       = errors.New("共享代理配置仍被节点使用")
	ErrProxyProfileNotFound    = errors.New("共享代理配置不存在")
)

const (
	DefaultQualityProbePrompt          = "Reply with exactly QUALITY_OK."
	DefaultQualityProbeExpected        = "QUALITY_OK"
	DefaultQualityProbeMaxOutputTokens = 64
	MaxQualityProbePromptBytes         = 4096
	MaxQualityProbeExpectedBytes       = 512
	MaxQualityProbeOutputTokens        = 2048
)

type QualityProbeInput struct {
	ClientKeyID     uint64
	AccountID       uint64
	Model           string
	Prompt          string
	Expected        string
	MatchMode       string
	RequireThinking bool
	MaxOutputTokens int
}

type QualityProbeResult struct {
	RequestID             string
	NodeID                uint64
	Model                 string
	StatusCode            int
	FirstTokenMS          int64
	DurationMS            int64
	GenerationMS          int64
	ChunkCount            int
	OutputTokens          int64
	ReasoningTokens       int64
	VisibleTokens         int64
	VisibleCharacters     int
	OutputTokensPerSecond float64
	ExpectedMatched       bool
	ThinkingRequired      bool
	ResponseSHA256        string
}

type QualityProber interface {
	ProbeEgressQuality(context.Context, uint64, QualityProbeInput) (QualityProbeResult, error)
}

const (
	maxProxyURLBytes         = 8192
	maxCloudflareCookieBytes = 16 << 10
	ProxyAccountPlaceholder  = "{account}"
	proxyAccountSentinel     = "grok2api_account_placeholder"
)

type Input struct {
	Name              string
	Scope             domain.Scope
	Enabled           bool
	ProxyPool         *bool
	AccountCapacity   *int
	ProxyURL          *string
	ProxyProfileID    *uint64
	ClearProxyURL     bool
	UserAgent         string
	CloudflareCookies *string
	ClearCookies      bool
}

type ListFilter struct {
	Scope       domain.Scope
	Enabled     string
	ProbeStatus string
	Assignment  string
	Sort        repository.SortQuery
}

type ServiceRepository interface {
	repository.EgressRepository
	repository.EgressNodePageRepository
}

type Service struct {
	repository                  ServiceRepository
	proxyProfiles               repository.EgressProxyProfileRepository
	accounts                    AccountBindingRepository
	qualityLeases               QualityLeaseRepository
	operations                  OperationsRepository
	cipher                      *security.Cipher
	mu                          sync.RWMutex
	browserUA                   string
	clearance                   ClearanceManager
	prober                      NodeProber
	operationsCache             OperationsConfigInvalidator
	qualityProber               QualityProber
	assignmentMu                sync.Mutex
	lastAssignmentRun           time.Time
	assignmentRunning           bool
	autoAssignMaxNodeShare      float64
	autoAssignMaxMigrationShare float64
}

func (s *Service) SetQualityProber(value QualityProber) {
	s.mu.Lock()
	s.qualityProber = value
	s.mu.Unlock()
}

func (s *Service) ProbeQuality(ctx context.Context, nodeID uint64, input QualityProbeInput) (QualityProbeResult, error) {
	if nodeID == 0 || input.ClientKeyID == 0 {
		return QualityProbeResult{}, fmt.Errorf("%w: nodeId 和 clientKeyId 必填", ErrInvalidInput)
	}
	input.Model = strings.TrimSpace(input.Model)
	input.Prompt = strings.TrimSpace(input.Prompt)
	input.Expected = strings.TrimSpace(input.Expected)
	rawMatchMode := strings.TrimSpace(input.MatchMode)
	input.MatchMode = NormalizeMatchMode(input.MatchMode)
	if input.Model == "" {
		return QualityProbeResult{}, fmt.Errorf("%w: model 必填", ErrInvalidInput)
	}
	if input.Prompt == "" {
		input.Prompt = DefaultQualityProbePrompt
	}
	if input.Expected == "" && rawMatchMode == "" {
		input.Expected = DefaultQualityProbeExpected
	}
	if len(input.Prompt) > MaxQualityProbePromptBytes || len(input.Expected) > MaxQualityProbeExpectedBytes {
		return QualityProbeResult{}, fmt.Errorf("%w: 探测文本过长", ErrInvalidInput)
	}
	if input.MaxOutputTokens == 0 {
		input.MaxOutputTokens = DefaultQualityProbeMaxOutputTokens
	}
	if input.MaxOutputTokens < 1 || input.MaxOutputTokens > MaxQualityProbeOutputTokens {
		return QualityProbeResult{}, fmt.Errorf("%w: maxOutputTokens 必须在 1 到 %d 之间", ErrInvalidInput, MaxQualityProbeOutputTokens)
	}
	node, err := s.repository.GetEgressNode(ctx, nodeID)
	if errors.Is(err, repository.ErrNotFound) {
		return QualityProbeResult{}, ErrNotFound
	}
	if err != nil {
		return QualityProbeResult{}, err
	}
	if node.Scope != domain.ScopeBuild || strings.TrimSpace(node.EncryptedProxyURL) == "" {
		return QualityProbeResult{}, fmt.Errorf("%w: 质量探测仅支持已配置代理的 grok_build 节点", ErrInvalidInput)
	}
	if input.AccountID != 0 {
		if !s.accountBoundProxy(node) || s.qualityLeases == nil {
			return QualityProbeResult{}, fmt.Errorf("%w: 账号定向探测仅支持按账号派生代理的节点", ErrInvalidInput)
		}
		credential, loadErr := s.qualityLeases.Get(ctx, input.AccountID)
		if loadErr != nil || credential.Provider != accountdomain.ProviderBuild || !credential.Enabled || credential.AuthStatus != accountdomain.AuthStatusActive || !qualityLeaseCredentialMayUseNode(credential, nodeID) {
			return QualityProbeResult{}, ErrQualityProbeNoAccount
		}
	}
	s.mu.RLock()
	prober := s.qualityProber
	s.mu.RUnlock()
	if prober == nil {
		return QualityProbeResult{}, ErrQualityProbeUnavailable
	}
	// A profile may request the thinking guard, but only a known reasoning-capable
	// Build model can make zero reasoning tokens meaningful. Unknown/custom and
	// non-reasoning models stay observable without being falsely quarantined.
	input.RequireThinking = input.RequireThinking && modeldomain.SupportsReasoningForProvider(accountdomain.ProviderBuild, input.Model)
	result, err := prober.ProbeEgressQuality(ctx, nodeID, input)
	if err != nil {
		return QualityProbeResult{}, err
	}
	result.ThinkingRequired = input.RequireThinking
	return result, nil
}

// AccountBindingRepository is intentionally narrow so existing account
// repository consumers do not gain egress concerns.
type AccountBindingRepository interface {
	CountProviderAccountsByIDs(context.Context, accountdomain.Provider, []uint64) (int64, error)
	UpdateEgressBindings(context.Context, accountdomain.Provider, []uint64, *uint64, accountdomain.EgressAssignmentMode, time.Time) (int64, error)
	ListEgressAssignments(context.Context, accountdomain.Provider) ([]accountdomain.Credential, error)
	ListEgressBindingProviders(context.Context, uint64) ([]accountdomain.Provider, error)
	ListEgressSourceBindingProviders(context.Context, uint64) ([]accountdomain.Provider, error)
}

type AssignmentResult struct {
	Assigned int
}

type UnhealthyCleanupPreview struct {
	Nodes               int64
	BoundAccounts       int64
	SubscriptionManaged int64
}

// BatchNodeDeleter is optional so lightweight repository adapters only need
// the single-node contract unless they can provide an atomic bulk operation.
type BatchNodeDeleter interface {
	DeleteEgressNodes(context.Context, []uint64) (int, error)
}

type BatchNodeEnabledUpdater interface {
	UpdateEgressNodesEnabled(context.Context, []uint64, bool) (int, error)
}

type ClearanceManager interface {
	RefreshClearance(context.Context, uint64) error
	ForgetClearance(uint64)
}

type BatchClearanceManager interface {
	ForgetClearances([]uint64)
}

func NewService(storage ServiceRepository, cipher *security.Cipher, browserUA string, accounts ...AccountBindingRepository) *Service {
	service := &Service{repository: storage, cipher: cipher, browserUA: strings.TrimSpace(browserUA)}
	if profiles, ok := storage.(repository.EgressProxyProfileRepository); ok {
		service.proxyProfiles = profiles
	}
	if operations, ok := storage.(OperationsRepository); ok {
		service.operations = operations
	}
	if len(accounts) > 0 {
		service.accounts = accounts[0]
		if leases, ok := accounts[0].(QualityLeaseRepository); ok {
			service.qualityLeases = leases
		}
	}
	return service
}

func (s *Service) UpdateDefaults(browserUA string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.browserUA = strings.TrimSpace(browserUA)
}

func (s *Service) SetClearanceManager(value ClearanceManager) {
	s.mu.Lock()
	s.clearance = value
	s.mu.Unlock()
}

func (s *Service) DefaultUserAgents() map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return map[string]string{
		string(domain.ScopeBuild): "", string(domain.ScopeWeb): s.browserUA, string(domain.ScopeConsole): s.browserUA,
		string(domain.ScopeWebAsset): s.browserUA, string(domain.ScopeConsoleAsset): s.browserUA,
	}
}

func (s *Service) publicNodes(values []domain.Node) []domain.PublicNode {
	result := make([]domain.PublicNode, 0, len(values))
	for _, value := range values {
		result = append(result, s.publicNode(value))
	}
	return result
}

func validListScope(scope domain.Scope) bool {
	return scope == "" || scope == domain.ScopeBuild || scope == domain.ScopeWeb || scope == domain.ScopeConsole || scope == domain.ScopeWebAsset || scope == domain.ScopeConsoleAsset
}

func allServiceScopes() []domain.Scope {
	return []domain.Scope{domain.ScopeBuild, domain.ScopeWeb, domain.ScopeConsole, domain.ScopeWebAsset, domain.ScopeConsoleAsset}
}

func validListValue(value string, allowed ...string) bool {
	if value == "" {
		return true
	}
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func (s *Service) publicNode(value domain.Node) domain.PublicNode {
	userAgent := value.UserAgent
	if value.Scope == domain.ScopeBuild {
		userAgent = ""
	}
	proxyDisplay, proxyFingerprint, accountBoundProxy := s.proxyMetadata(value.EncryptedProxyURL)
	proxyPool := value.ProxyPool || accountBoundProxy
	health, failureCount, cooldownUntil, lastError := value.Health, value.FailureCount, value.CooldownUntil, value.LastError
	if proxyPool {
		health, failureCount, cooldownUntil, lastError = 1, 0, nil, ""
	}
	return domain.PublicNode{
		ID: value.ID, Name: value.Name, Scope: value.Scope, Enabled: value.Enabled,
		ProxyConfigured: value.EncryptedProxyURL != "", ProxyDisplay: proxyDisplay, ProxyFingerprint: proxyFingerprint,
		UserAgent: userAgent, CookieConfigured: value.EncryptedCloudflareCookie != "",
		ProxyPool:         proxyPool,
		SourceID:          value.SourceID,
		AccountCapacity:   value.AccountCapacity,
		ProxyProfileID:    value.ProxyProfileID,
		ProxyProfileName:  value.ProxyProfileName,
		AccountBoundProxy: accountBoundProxy,
		Health:            health, FailureCount: failureCount, CooldownUntil: cooldownUntil, LastError: lastError,
		ProbeStatus: value.ProbeStatus, LastProbedAt: value.LastProbedAt, ProbeLatencyMS: value.ProbeLatencyMS, ExitIP: value.ExitIP, ProbeError: value.ProbeError,
		ProbeProvider: value.ProbeProvider,
		IPv4Probe:     value.IPv4Probe, IPv6Probe: value.IPv6Probe,
		AssignedAccountCount: value.AssignedAccountCount,
		CreatedAt:            value.CreatedAt, UpdatedAt: value.UpdatedAt,
	}
}

func (s *Service) proxyMetadata(encrypted string) (string, string, bool) {
	if s == nil || s.cipher == nil || strings.TrimSpace(encrypted) == "" {
		return "", "", false
	}
	proxyURL, err := s.cipher.Decrypt(encrypted)
	if err != nil {
		return "", "", false
	}
	proxyURL, err = NormalizeProxyURL(proxyURL)
	if err != nil || proxyURL == "" {
		return "", "", false
	}
	return ProxyDisplay(proxyURL), security.HashToken(proxyURL)[:12], strings.Contains(proxyURL, ProxyAccountPlaceholder)
}
