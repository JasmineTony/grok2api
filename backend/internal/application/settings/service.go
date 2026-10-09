package settings

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/chenyme/grok2api/backend/internal/infra/config"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

var (
	ErrInvalidInput = errors.New("运行设置参数无效")
	ErrConflict     = errors.New("运行设置已被其他会话更新")
)

// minSupportedBuildClientVersion 是上游 Grok Build 接口接受的最低客户端版本，
// 来源：issue #1068 上游 426 文案“Please update to version 1.0.13 or later”。
const minSupportedBuildClientVersion = "1.0.13"

// minSupportedBuildClientVersionParts 是上面的版本常量解析结果；常量被写坏时在启动阶段立即失败。
var minSupportedBuildClientVersionParts = mustParseBuildClientVersion(minSupportedBuildClientVersion)

// ProviderBuildConfig 是管理接口使用的 Provider 可编辑输入。
type ProviderBuildConfig struct {
	BaseURL               string
	FallbackBaseURL       string
	ClientVersion         string
	ClientIdentifier      string
	TokenAuth             string
	UserAgent             string
	ResponseHeaderTimeout string
	StreamIdleTimeout     string
}

// ProviderBuildRecommendation 表示当前网关已完成兼容回归的 Grok Build 协议基线。
type ProviderBuildRecommendation struct {
	ClientVersion string
	UserAgent     string
}

type ProviderWebConfig struct {
	BaseURL                      string
	StatsigMode                  string
	StatsigManualValue           string
	StatsigManualConfigured      bool
	StatsigSignerURL             string
	ClearanceMode                string
	FlareSolverrURL              string
	ClearanceTimeout             string
	ClearanceRefresh             string
	QuotaTimeout                 string
	ChatTimeout                  string
	StreamIdleTimeout            string
	ImageTimeout                 string
	VideoTimeout                 string
	MediaConcurrency             int
	AllowNSFW                    bool
	FreeVideoDurationCap         int
	FreeVideoDurationCapProvided bool
	RecoveryBackoffBase          string
	RecoveryBackoffMax           string
	// ClearanceProvided distinguishes older admin clients that predate the
	// managed-clearance fields from an explicit update to those fields.
	ClearanceProvided bool
}

type ProviderConsoleConfig struct {
	BaseURL           string
	ChatTimeout       string
	StreamIdleTimeout string
}

// ServerConfig 是管理接口使用的推理入口容量输入。
type ServerConfig struct {
	MaxConcurrentRequests int
}

// BatchConfig 是管理接口使用的批量任务并发输入。
type BatchConfig struct {
	ImportConcurrency     int
	ConversionConcurrency int
	SyncConcurrency       int
	RefreshConcurrency    int
	RandomDelay           string
}

type MediaConfig struct {
	MaxImageBytes           int64
	MaxTotalBytes           int64
	CleanupThresholdPercent int
	CleanupInterval         string
}

// FrontendConfig 是管理接口使用的公开 API 地址输入。
type FrontendConfig struct {
	PublicAPIBaseURL string
}

// RoutingConfig 是管理接口使用的路由可编辑输入。
type RoutingConfig struct {
	StickyTTL                           string
	CooldownBase                        string
	CooldownMax                         string
	CapacityWait                        string
	MaxAttempts                         int
	VideoMaxAttempts                    int
	PreferFreeBuild                     bool
	MarkBuildChatDeniedAsReauth         bool
	MarkBuildChatDeniedAsReauthProvided bool
	AccountIsolatedConnections          bool
	// AccountIsolatedConnectionsProvided preserves the current value when an
	// older management client omits the newly added field.
	AccountIsolatedConnectionsProvided bool
	SegmentedSelector                  SegmentedSelectorConfig
	SegmentedSelectorProvided          bool
}

type SegmentedSelectorConfig struct {
	Enabled       bool
	MinCandidates int
	WindowSize    int
}

// AuditConfig 是管理接口使用的审计可编辑输入。
type AuditConfig struct {
	BufferSize            int
	BatchSize             int
	FlushInterval         string
	CommitDelayMS         int
	RetentionDays         int
	RetentionDaysProvided bool
}

// ClientKeyDefaultsConfig 是管理接口使用的密钥默认限制输入。
type ClientKeyDefaultsConfig struct {
	RPMLimit      int
	MaxConcurrent int
}

// AccountsConfig 是管理接口使用的账号池维护策略输入。
type AccountsConfig struct {
	MarkBuildForbiddenReauth  bool
	BuildForbiddenReauthCodes []string
	// ExcludeBuildBotFlaggedFromScheduling drops bot-risk Build accounts from scheduling only.
	ExcludeBuildBotFlaggedFromScheduling bool
	AutoCleanReauthEnabled               bool
	AutoCleanReauthInterval              string
	AutoCleanReauthMinAge                string
	AutoCleanIncludeDisabled             bool
	// MarkBuildForbiddenReauthProvided preserves the value when an older management client omits the field.
	MarkBuildForbiddenReauthProvided bool
	// BuildForbiddenReauthCodesProvided preserves the configured codes when an older management client omits the field.
	BuildForbiddenReauthCodesProvided bool
	// ExcludeBuildBotFlaggedFromSchedulingProvided preserves the value when an older management client omits the field.
	ExcludeBuildBotFlaggedFromSchedulingProvided bool
}

// EditableConfig 聚合管理端允许修改的运行参数。
type EditableConfig struct {
	Server            ServerConfig
	ProviderBuild     ProviderBuildConfig
	ProviderWeb       ProviderWebConfig
	ProviderConsole   ProviderConsoleConfig
	Batch             BatchConfig
	Media             MediaConfig
	Frontend          FrontendConfig
	Routing           RoutingConfig
	Audit             AuditConfig
	ClientKeyDefaults ClientKeyDefaultsConfig
	Accounts          AccountsConfig
	// AccountsProvided 区分旧管理端未发送 accounts 与显式提交默认值。
	AccountsProvided bool
}

// Snapshot 表示当前运行设置和需要重启才能生效的字段。
type Snapshot struct {
	Config                   EditableConfig
	RecommendedProviderBuild ProviderBuildRecommendation
	UpdatedAt                time.Time
	Revision                 uint64
	RestartRequired          []string
}

// Service 管理允许在线修改的配置，并向后台任务广播配置变更。
type Service struct {
	mu                     sync.RWMutex
	updateMu               sync.Mutex
	cfg                    config.Config
	updatedAt              time.Time
	revision               uint64
	activeBufferSize       int
	activeMediaConcurrency int
	repository             repository.RuntimeSettingsRepository
	notify                 func(context.Context)
	apply                  func(config.Config)
}

func NewService(cfg config.Config, updatedAt time.Time, revision uint64, repository repository.RuntimeSettingsRepository, notify func(context.Context), apply func(config.Config)) *Service {
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	return &Service{cfg: cfg, updatedAt: updatedAt, revision: revision, activeBufferSize: cfg.Audit.BufferSize, activeMediaConcurrency: cfg.Provider.Web.MediaConcurrency, repository: repository, notify: notify, apply: apply}
}

// LoadPersisted 将数据库运行设置覆盖到代码默认配置，并执行完整边界校验。
func LoadPersisted(ctx context.Context, base config.Config, repository repository.RuntimeSettingsRepository) (config.Config, time.Time, uint64, error) {
	value, updatedAt, revision, found, err := repository.Get(ctx)
	if err != nil {
		return config.Config{}, time.Time{}, 0, err
	}
	if !found {
		return base, time.Time{}, 0, nil
	}
	// 持久化层使用强类型时长，避免数据库格式受 HTTP DTO 字符串影响。
	loaded := applyDomainConfig(base, value)
	if err := loaded.Validate(); err != nil {
		return config.Config{}, time.Time{}, 0, fmt.Errorf("校验运行设置: %w", err)
	}
	return loaded, updatedAt, revision, nil
}

// Get 返回当前生效的可编辑设置快照。
func (s *Service) Get() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snapshotLocked()
}

// PublicAPIBaseURL 返回运行设置、配置文件或内置默认值解析后的公开 API 根地址。
func (s *Service) PublicAPIBaseURL() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg.Frontend.EffectivePublicAPIBaseURL()
}

// Update 校验并持久化运行设置，再原子替换进程内配置。
func (s *Service) Update(ctx context.Context, expectedRevision uint64, input EditableConfig) (Snapshot, error) {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()

	s.mu.RLock()
	current := s.cfg
	currentRevision := s.revision
	s.mu.RUnlock()
	if expectedRevision != currentRevision {
		return Snapshot{}, ErrConflict
	}
	next, err := mergeEditable(current, input)
	if err != nil {
		return Snapshot{}, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	updatedAt, revision, err := s.repository.Save(ctx, toDomainConfig(next), currentRevision)
	if err != nil {
		if errors.Is(err, repository.ErrConflict) {
			return Snapshot{}, ErrConflict
		}
		return Snapshot{}, err
	}

	s.mu.Lock()
	s.cfg = next
	s.updatedAt = updatedAt
	s.revision = revision
	result := s.snapshotLocked()
	apply := s.apply
	s.mu.Unlock()

	if apply != nil {
		apply(next)
	}
	if s.notify != nil {
		s.notify(ctx)
	}
	return result, nil
}

// ReloadPersisted 在收到其他实例的变更通知后，从主数据库重载并应用运行设置。
func (s *Service) ReloadPersisted(ctx context.Context) error {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()
	value, updatedAt, revision, found, err := s.repository.Get(ctx)
	if err != nil || !found {
		return err
	}
	s.mu.RLock()
	current := s.cfg
	currentRevision := s.revision
	s.mu.RUnlock()
	if revision <= currentRevision {
		return nil
	}
	next := applyDomainConfig(current, value)
	if err := next.Validate(); err != nil {
		return fmt.Errorf("校验重载运行设置: %w", err)
	}
	s.mu.Lock()
	s.cfg = next
	s.updatedAt = updatedAt
	s.revision = revision
	apply := s.apply
	s.mu.Unlock()
	if apply != nil {
		apply(next)
	}
	return nil
}

func intPointer(value int) *int { return &value }

func (s *Service) snapshotLocked() Snapshot {
	restartRequired := []string{}
	if s.cfg.Audit.BufferSize != s.activeBufferSize {
		restartRequired = append(restartRequired, "audit.bufferSize")
	}
	if s.cfg.Provider.Web.MediaConcurrency != s.activeMediaConcurrency {
		restartRequired = append(restartRequired, "providerWeb.mediaConcurrency")
	}
	return Snapshot{
		Config: toEditable(s.cfg),
		RecommendedProviderBuild: ProviderBuildRecommendation{
			ClientVersion: config.RecommendedBuildClientVersion,
			UserAgent:     config.RecommendedBuildUserAgent,
		},
		UpdatedAt: s.updatedAt, Revision: s.revision, RestartRequired: restartRequired,
	}
}
