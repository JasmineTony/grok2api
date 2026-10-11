package config

import (
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type ServerConfig struct {
	Listen                string   `yaml:"listen"`
	MaxBodyBytes          int64    `yaml:"maxBodyBytes"`
	MaxConcurrentRequests int      `yaml:"maxConcurrentRequests"`
	TrustedProxies        []string `yaml:"trustedProxies"`
	ReadTimeout           Duration `yaml:"readTimeout"`
	RequestTimeout        Duration `yaml:"requestTimeout"`
	SwaggerEnabled        bool     `yaml:"swaggerEnabled"`
}

type FrontendConfig struct {
	PublicAPIBaseURL         string `yaml:"publicApiBaseURL"`
	PublicAPIBaseURLOverride string `yaml:"-"`
	StaticPath               string `yaml:"staticPath"`
}

const DefaultPublicAPIBaseURL = "http://127.0.0.1:8000"

// EffectivePublicAPIBaseURL 按运行设置、配置文件、内置默认值的顺序解析公开地址。
func (c FrontendConfig) EffectivePublicAPIBaseURL() string {
	for _, value := range []string{c.PublicAPIBaseURLOverride, c.PublicAPIBaseURL} {
		if value = strings.TrimRight(strings.TrimSpace(value), "/"); value != "" {
			return value
		}
	}
	return DefaultPublicAPIBaseURL
}

type DatabaseConfig struct {
	Driver   string                 `yaml:"driver"`
	SQLite   SQLiteDatabaseConfig   `yaml:"sqlite"`
	Postgres PostgresDatabaseConfig `yaml:"postgres"`
}

type SQLiteDatabaseConfig struct {
	Path string `yaml:"path"`
}

type PostgresDatabaseConfig struct {
	DSN          string `yaml:"dsn"`
	MaxOpenConns int    `yaml:"maxOpenConns"`
	MaxIdleConns int    `yaml:"maxIdleConns"`
}

type RuntimeStoreConfig struct {
	Driver string             `yaml:"driver"`
	Redis  RedisRuntimeConfig `yaml:"redis"`
}

type DeploymentConfig struct {
	Replicas    int    `yaml:"replicas"`
	InstanceID  string `yaml:"instanceID"`
	ClusterID   string `yaml:"clusterID"`
	SharedMedia bool   `yaml:"sharedMedia"`
}

type RedisRuntimeConfig struct {
	Address   string `yaml:"address"`
	Username  string `yaml:"username"`
	Password  string `yaml:"password"`
	Database  int    `yaml:"database"`
	KeyPrefix string `yaml:"keyPrefix"`
	TLS       bool   `yaml:"tls"`
}

type AuthConfig struct {
	AccessTokenTTL  Duration `yaml:"accessTokenTTL"`
	RefreshTokenTTL Duration `yaml:"refreshTokenTTL"`
	SecureCookies   bool     `yaml:"secureCookies"`
}

type ProviderConfig struct {
	Build   BuildProviderConfig   `yaml:"build"`
	Web     WebProviderConfig     `yaml:"web"`
	Console ConsoleProviderConfig `yaml:"console"`
}

type BuildProviderConfig struct {
	BaseURL               string   `yaml:"baseURL"`
	FallbackBaseURL       string   `yaml:"fallbackBaseURL"`
	ClientVersion         string   `yaml:"clientVersion"`
	ClientIdentifier      string   `yaml:"clientIdentifier"`
	TokenAuth             string   `yaml:"tokenAuth"`
	UserAgent             string   `yaml:"userAgent"`
	ResponseHeaderTimeout Duration `yaml:"-"`
	StreamIdleTimeout     Duration `yaml:"-"`
}

// DefaultBuildFallbackBaseURL 是主 Build API 对可回退推理操作 403 时探测的 XAI API 根地址。
const DefaultBuildFallbackBaseURL = "https://api.x.ai/v1"

type WebProviderConfig struct {
	BaseURL              string   `yaml:"baseURL"`
	StatsigMode          string   `yaml:"-"`
	StatsigManualValue   string   `yaml:"-"`
	StatsigSignerURL     string   `yaml:"-"`
	ClearanceMode        string   `yaml:"-"`
	FlareSolverrURL      string   `yaml:"-"`
	ClearanceTimeout     Duration `yaml:"-"`
	ClearanceRefresh     Duration `yaml:"-"`
	QuotaTimeout         Duration `yaml:"quotaTimeout"`
	ChatTimeout          Duration `yaml:"chatTimeout"`
	StreamIdleTimeout    Duration `yaml:"-"`
	ImageTimeout         Duration `yaml:"imageTimeout"`
	VideoTimeout         Duration `yaml:"videoTimeout"`
	MediaConcurrency     int      `yaml:"mediaConcurrency"`
	AllowNSFW            bool     `yaml:"allowNSFW"`
	FreeVideoDurationCap int      `yaml:"freeVideoDurationCap"`
	RecoveryBackoffBase  Duration `yaml:"recoveryBackoffBase"`
	RecoveryBackoffMax   Duration `yaml:"recoveryBackoffMax"`
}

type ConsoleProviderConfig struct {
	BaseURL           string   `yaml:"baseURL"`
	LegacyUserAgent   string   `yaml:"userAgent"` // Deprecated: 仅用于兼容旧配置文件，不参与请求。
	ChatTimeout       Duration `yaml:"chatTimeout"`
	StreamIdleTimeout Duration `yaml:"-"`
}

// BatchConfig 定义可热加载的账号批量任务并发上限。
type BatchConfig struct {
	ImportConcurrency     int
	ConversionConcurrency int
	SyncConcurrency       int
	RefreshConcurrency    int
	RandomDelay           Duration
}

type MediaConfig struct {
	Driver                  string           `yaml:"driver"`
	MaxImageBytes           int64            `yaml:"-"`
	MaxTotalBytes           int64            `yaml:"-"`
	CleanupThresholdPercent int              `yaml:"-"`
	CleanupInterval         Duration         `yaml:"-"`
	Local                   LocalMediaConfig `yaml:"local"`
}

type LocalMediaConfig struct {
	Path string `yaml:"path"`
}

type RoutingConfig struct {
	StickyTTL        Duration `yaml:"stickyTTL"`
	CooldownBase     Duration `yaml:"cooldownBase"`
	CooldownMax      Duration `yaml:"cooldownMax"`
	CapacityWait     Duration `yaml:"capacityWait"`
	MaxAttempts      int      `yaml:"maxAttempts"`
	VideoMaxAttempts int      `yaml:"videoMaxAttempts"`
	PreferFreeBuild  bool     `yaml:"preferFreeBuild"`
	// MarkBuildChatDeniedAsReauth 为 true 时，Build chat 权限拒绝标 reauthRequired，默认 false。
	MarkBuildChatDeniedAsReauth bool     `yaml:"markBuildChatDeniedAsReauth"`
	AccountIsolatedConnections  bool     `yaml:"accountIsolatedConnections"`
	SegmentedSelectorEnabled    bool     `yaml:"segmentedSelectorEnabled"`
	SegmentedMinCandidates      int      `yaml:"segmentedSelectorMinCandidates"`
	SegmentedWindowSize         int      `yaml:"segmentedSelectorWindowSize"`
	ReasoningReplayEnabled      bool     `yaml:"reasoningReplayEnabled"`
	ReasoningReplayTTL          Duration `yaml:"reasoningReplayTTL"`
	ReasoningReplayMaxEntries   int      `yaml:"reasoningReplayMaxEntries"`
	// AutoAssignMaxNodeShare optionally caps how many active accounts one
	// healthy node may absorb during auto assignment. 0 keeps the historical
	// unbounded first-pass evacuation. Values in [0.05, 1] are a fraction of
	// the active provider pool. GROK2API_AUTO_ASSIGN_MAX_NODE_SHARE overrides
	// this field when set to a valid value.
	AutoAssignMaxNodeShare float64 `yaml:"autoAssignMaxNodeShare"`
	// AutoAssignMaxMigrationShare optionally caps how many already-bound
	// accounts may move in one maintenance cycle. 0 keeps the historical
	// unbounded first-pass evacuation and the existing 200-move ceiling for
	// capacity/rebalance repair. GROK2API_AUTO_ASSIGN_MAX_MIGRATION_SHARE
	// overrides this field when set to a valid value.
	AutoAssignMaxMigrationShare float64 `yaml:"autoAssignMaxMigrationShare"`
}

type AuditConfig struct {
	BufferSize                  int      `yaml:"bufferSize"`
	BatchSize                   int      `yaml:"batchSize"`
	FlushInterval               Duration `yaml:"flushInterval"`
	CommitDelay                 Duration `yaml:"commitDelay"`
	RetentionDays               int      `yaml:"retentionDays"`
	LedgerMode                  string   `yaml:"ledgerMode"`
	LedgerFailureThreshold      int      `yaml:"ledgerFailureThreshold"`
	LedgerUnhealthyGrace        Duration `yaml:"ledgerUnhealthyGrace"`
	LedgerQueueHighWatermarkPct int      `yaml:"ledgerQueueHighWatermarkPercent"`
}

// QualityGuardConfig defines the optional egress-quality sidecar policy.
// Docker Compose controls whether the sidecar process is started; Enabled is a
// separate server-side authorization gate for its internal API.
type QualityGuardConfig struct {
	Enabled bool `yaml:"enabled"`
	// DeprecatedClientKeyID is accepted only so configurations created by the
	// short-lived manual-ID preview continue to load. It is ignored.
	DeprecatedClientKeyID   uint64   `yaml:"clientKeyID"`
	Model                   string   `yaml:"model"`
	NodeIDs                 []uint64 `yaml:"nodeIDs"`
	Mode                    string   `yaml:"mode"`
	ActiveInterval          Duration `yaml:"activeInterval"`
	PassivePollInterval     Duration `yaml:"passivePollInterval"`
	SoftTPS                 float64  `yaml:"softTPS"`
	HardTPS                 float64  `yaml:"hardTPS"`
	ConsecutiveSoft         int      `yaml:"consecutiveSoft"`
	ConsecutiveErrors       int      `yaml:"consecutiveErrors"`
	QuarantineDuration      Duration `yaml:"quarantineDuration"`
	NoAccountBackoff        Duration `yaml:"noAccountBackoff"`
	MinimumHealthyNodes     int      `yaml:"minimumHealthyNodes"`
	MaxOutputTokens         int      `yaml:"maxOutputTokens"`
	FailClosed              bool     `yaml:"failClosed"`
	MinimumGenerationWindow Duration `yaml:"minimumGenerationWindow"`
	RotationURL             string   `yaml:"rotationURL"`
	RotationToken           string   `yaml:"rotationToken"`
	RotationTimeout         Duration `yaml:"rotationTimeout"`
	RotatableNodeIDs        []uint64 `yaml:"rotatableNodeIDs"`
	// RequestRetry withholds a thinking-model stream that already has enough
	// visible output and no reasoning, then retries on another account.
	RequestRetry QualityGuardRequestRetryConfig `yaml:"requestRetry"`
}

// QualityGuardRequestRetryConfig holds the in-process missing-thinking withhold policy.
type QualityGuardRequestRetryConfig struct {
	Enabled         bool     `yaml:"enabled"`
	MaxAttempts     int      `yaml:"maxAttempts"`
	HoldTimeout     Duration `yaml:"holdTimeout"`
	MinOutputTokens int      `yaml:"minOutputTokens"`
	OnExhausted     string   `yaml:"onExhausted"`
	AccountCooldown Duration `yaml:"accountCooldown"`
	// IdleAccountCooldown cools an account after a truly empty upstream
	// stream. Independent of accountCooldown (missing-thinking). Zero uses 15m.
	IdleAccountCooldown             Duration `yaml:"idleAccountCooldown"`
	MinEncryptedBytes               int      `yaml:"minEncryptedBytes"`
	EncryptedBytesPerReasoningToken int      `yaml:"encryptedBytesPerReasoningToken"`
}

type ClientKeyDefaultsConfig struct {
	RPMLimit      int `yaml:"rpmLimit"`
	MaxConcurrent int `yaml:"maxConcurrent"`
}

// AccountsConfig 定义可热加载的账号池维护策略；默认全部关闭。
type AccountsConfig struct {
	MarkBuildForbiddenReauth  bool
	BuildForbiddenReauthCodes []string
	// ExcludeBuildBotFlaggedFromScheduling removes Build accounts with bot_flag_source/bfs in {1,2}
	// from scheduling only. Linked Web/Console accounts are unaffected.
	ExcludeBuildBotFlaggedFromScheduling bool
	AutoCleanReauthEnabled               bool
	AutoCleanReauthInterval              Duration
	AutoCleanReauthMinAge                Duration
	AutoCleanIncludeDisabled             bool
}

type Secrets struct {
	JWTSecret               string `yaml:"jwtSecret"`
	CredentialEncryptionKey string `yaml:"credentialEncryptionKey"`
}

type BootstrapAdminConfig struct {
	Username string `yaml:"username"`
	Password string `yaml:"password"`
}

// Duration 支持在 YAML 中使用 10m、1h 等可读时间格式。
type Duration time.Duration

func (d *Duration) UnmarshalYAML(node *yaml.Node) error {
	parsed, err := time.ParseDuration(node.Value)
	if err != nil {
		return err
	}
	*d = Duration(parsed)
	return nil
}

func (d Duration) MarshalYAML() (any, error) { return d.String(), nil }

func (d Duration) Value() time.Duration { return time.Duration(d) }

func (d Duration) String() string {
	value := d.Value().String()
	if strings.HasSuffix(value, "m0s") {
		value = strings.TrimSuffix(value, "0s")
	}
	if strings.HasSuffix(value, "h0m") {
		value = strings.TrimSuffix(value, "0m")
	}
	return value
}
