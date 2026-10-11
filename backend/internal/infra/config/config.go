package config

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	DatabaseURLEnv                = "GROK2API_DATABASE_URL"
	StatsigModeManual             = "manual"
	StatsigModeURL                = "url"
	ClearanceModeManual           = "manual"
	ClearanceModeFlareSolverr     = "flaresolverr"
	ClearanceModeOnDemand         = "on_demand"
	DefaultStatsigSignerURL       = "https://grok.wodf.de/sign"
	DefaultFlareSolverrURL        = "http://flaresolverr:8191"
	RecommendedBuildClientVersion = "1.0.40"
	RecommendedBuildUserAgent     = "grok-shell/" + RecommendedBuildClientVersion + " (linux; x86_64)"

	maxServerBodyBytes     = 256 << 20
	maxRequestTimeout      = 24 * time.Hour
	maxReadTimeout         = time.Hour
	maxRoutingTTL          = 30 * 24 * time.Hour
	maxRoutingCooldown     = 24 * time.Hour
	maxRoutingCapacityWait = 30 * time.Second
	maxRoutingAttempts     = 65535
	minAuditFlushInterval  = 10 * time.Millisecond
	maxAuditFlushInterval  = time.Minute
	maxAuditBufferSize     = 262144
	maxAuditBatchSize      = 4096
	minAuditCommitDelay    = time.Millisecond
	maxAuditCommitDelay    = 50 * time.Millisecond
	maxDeploymentReplicas  = 1024
)

const unlimitedRoutingAttempts = -1

var buildForbiddenCodePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

// Config 表示后端运行配置。
type Config struct {
	Server            ServerConfig            `yaml:"server"`
	Frontend          FrontendConfig          `yaml:"frontend"`
	Database          DatabaseConfig          `yaml:"database"`
	RuntimeStore      RuntimeStoreConfig      `yaml:"runtimeStore"`
	Deployment        DeploymentConfig        `yaml:"deployment"`
	Auth              AuthConfig              `yaml:"auth"`
	Secrets           Secrets                 `yaml:"secrets"`
	BootstrapAdmin    BootstrapAdminConfig    `yaml:"bootstrapAdmin"`
	Provider          ProviderConfig          `yaml:"provider"`
	Batch             BatchConfig             `yaml:"-"`
	Media             MediaConfig             `yaml:"media"`
	Routing           RoutingConfig           `yaml:"routing"`
	Audit             AuditConfig             `yaml:"audit"`
	QualityGuard      QualityGuardConfig      `yaml:"qualityGuard"`
	ClientKeyDefaults ClientKeyDefaultsConfig `yaml:"clientKeyDefaults"`
	Accounts          AccountsConfig          `yaml:"-"`
}

// Load 从 YAML 加载启动配置，并为非敏感运行参数补充代码默认值。
func Load(path string) (Config, error) {
	cfg := defaultConfig()
	loadedFrom, err := loadConfigFile(path, &cfg)
	if err != nil {
		return Config{}, err
	}
	if loadedFrom != "" {
		if err := resolveRelativePaths(&cfg, loadedFrom); err != nil {
			return Config{}, err
		}
	}
	if err := applyEnvironmentOverrides(&cfg); err != nil {
		return Config{}, err
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// loadConfigFile 用配置文件里显式出现的字段覆盖 cfg，并返回实际读取到的路径。
// 路径为空或文件不存在时返回空路径，表示全部沿用代码默认值。
func loadConfigFile(path string, cfg *Config) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", nil
	}
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("读取配置文件: %w", err)
	}
	if err != nil {
		return "", nil
	}
	decoder := yaml.NewDecoder(bytes.NewReader(data))
	decoder.KnownFields(true)
	if err := decoder.Decode(cfg); err != nil && !errors.Is(err, io.EOF) {
		return "", fmt.Errorf("解析配置文件: %w", err)
	}
	if err := rejectTrailingDocument(decoder); err != nil {
		return "", err
	}
	return path, nil
}

// rejectTrailingDocument 拒绝同一文件中的第二个 YAML 文档。
func rejectTrailingDocument(decoder *yaml.Decoder) error {
	var extra any
	err := decoder.Decode(&extra)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("解析配置文件: %w", err)
	}
	return errors.New("配置文件只能包含一个 YAML 文档")
}

// applyEnvironmentOverrides applies typed, application-owned environment
// overrides after YAML and before CLI overrides. Empty values are ignored so
// Compose can pass an optional variable without changing existing deployments.
func applyEnvironmentOverrides(cfg *Config) error {
	value := strings.TrimSpace(os.Getenv(DatabaseURLEnv))
	if value == "" {
		return nil
	}
	dsn, err := validatePostgresEnvironmentURL(value)
	if err != nil {
		return err
	}
	cfg.Database.Driver = "postgres"
	cfg.Database.Postgres.DSN = dsn
	return nil
}

func validatePostgresEnvironmentURL(value string) (string, error) {
	lower := strings.ToLower(value)
	if strings.HasPrefix(lower, "postgresql+asyncpg://") {
		return "", fmt.Errorf("%s 不支持 SQLAlchemy asyncpg URL；请将 postgresql+asyncpg:// 改为 postgresql://", DatabaseURLEnv)
	}
	if !strings.HasPrefix(lower, "postgres://") && !strings.HasPrefix(lower, "postgresql://") {
		return "", fmt.Errorf("%s 必须使用 postgres:// 或 postgresql:// URL（连接信息已隐藏）", DatabaseURLEnv)
	}
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Scheme == "" || parsed.Fragment != "" {
		return "", fmt.Errorf("%s 不是有效的 PostgreSQL URL（连接信息已隐藏）", DatabaseURLEnv)
	}
	return value, nil
}

func resolveRelativePaths(cfg *Config, configPath string) error {
	absoluteConfigPath, err := filepath.Abs(configPath)
	if err != nil {
		return fmt.Errorf("解析配置文件路径: %w", err)
	}
	baseDir := filepath.Dir(absoluteConfigPath)
	if cfg.Database.Driver == "sqlite" {
		path := strings.TrimSpace(cfg.Database.SQLite.Path)
		if path != "" && !filepath.IsAbs(path) {
			cfg.Database.SQLite.Path = filepath.Clean(filepath.Join(baseDir, path))
		}
	}
	mediaPath := strings.TrimSpace(cfg.Media.Local.Path)
	if mediaPath != "" && !filepath.IsAbs(mediaPath) {
		cfg.Media.Local.Path = filepath.Clean(filepath.Join(baseDir, mediaPath))
	}
	staticPath := strings.TrimSpace(cfg.Frontend.StaticPath)
	if staticPath != "" && !filepath.IsAbs(staticPath) {
		cfg.Frontend.StaticPath = filepath.Clean(filepath.Join(baseDir, staticPath))
	}
	return nil
}
