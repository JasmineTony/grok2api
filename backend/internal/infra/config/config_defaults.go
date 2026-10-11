package config

import (
	"strings"
	"time"

	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	settingsdomain "github.com/chenyme/grok2api/backend/internal/domain/settings"
)

// NormalizeBuildFallbackBaseURL 在旧配置缺字段时填入默认 XAI 备用地址。
func NormalizeBuildFallbackBaseURL(value string) string {
	if strings.TrimSpace(value) == "" {
		return DefaultBuildFallbackBaseURL
	}
	return strings.TrimSpace(value)
}

func defaultConfig() Config {
	return Config{
		Server:            defaultServerConfig(),
		Frontend:          FrontendConfig{PublicAPIBaseURL: DefaultPublicAPIBaseURL, StaticPath: "./frontend/dist"},
		Database:          defaultDatabaseConfig(),
		RuntimeStore:      defaultRuntimeStoreConfig(),
		Deployment:        DeploymentConfig{Replicas: 1, ClusterID: "grok2api"},
		Auth:              defaultAuthConfig(),
		Provider:          defaultProviderConfig(),
		Batch:             defaultBatchConfig(),
		Media:             defaultMediaConfig(),
		Routing:           defaultRoutingConfig(),
		Audit:             defaultAuditConfig(),
		QualityGuard:      defaultQualityGuardConfig(),
		ClientKeyDefaults: ClientKeyDefaultsConfig{RPMLimit: clientkeydomain.DefaultRPMLimit, MaxConcurrent: clientkeydomain.DefaultMaxConcurrent},
		Accounts:          defaultAccountsConfig(),
	}
}

func defaultServerConfig() ServerConfig {
	return ServerConfig{
		Listen:                "127.0.0.1:8000",
		MaxBodyBytes:          32 << 20,
		MaxConcurrentRequests: 1024,
		ReadTimeout:           Duration(15 * time.Minute),
		RequestTimeout:        Duration(2 * time.Hour),
	}
}

func defaultDatabaseConfig() DatabaseConfig {
	return DatabaseConfig{
		Driver:   "sqlite",
		SQLite:   SQLiteDatabaseConfig{Path: "./data/backend.db"},
		Postgres: PostgresDatabaseConfig{MaxOpenConns: 50, MaxIdleConns: 10},
	}
}

func defaultRuntimeStoreConfig() RuntimeStoreConfig {
	return RuntimeStoreConfig{
		Driver: "memory",
		Redis:  RedisRuntimeConfig{Address: "127.0.0.1:6379", KeyPrefix: "grok2api:"},
	}
}

func defaultAuthConfig() AuthConfig {
	return AuthConfig{
		AccessTokenTTL:  Duration(15 * time.Minute),
		RefreshTokenTTL: Duration(30 * 24 * time.Hour),
	}
}

func defaultProviderConfig() ProviderConfig {
	return ProviderConfig{
		Build: BuildProviderConfig{
			BaseURL: "https://cli-chat-proxy.grok.com/v1", FallbackBaseURL: DefaultBuildFallbackBaseURL,
			ClientVersion: RecommendedBuildClientVersion, ClientIdentifier: "grok-shell", TokenAuth: "xai-grok-cli",
			UserAgent: RecommendedBuildUserAgent, ResponseHeaderTimeout: Duration(settingsdomain.DefaultBuildResponseHeaderTimeout),
			StreamIdleTimeout: Duration(settingsdomain.DefaultBuildStreamIdleTimeout),
		},
		Web: WebProviderConfig{
			BaseURL: "https://grok.com", StatsigMode: StatsigModeURL, StatsigSignerURL: DefaultStatsigSignerURL,
			ClearanceMode: ClearanceModeManual, FlareSolverrURL: DefaultFlareSolverrURL,
			ClearanceTimeout: Duration(time.Minute), ClearanceRefresh: Duration(10 * time.Minute),
			QuotaTimeout: Duration(25 * time.Second),
			ChatTimeout:  Duration(2 * time.Minute), StreamIdleTimeout: Duration(settingsdomain.DefaultWebStreamIdleTimeout),
			ImageTimeout:     Duration(3 * time.Minute),
			VideoTimeout:     Duration(15 * time.Minute),
			MediaConcurrency: 4, FreeVideoDurationCap: settingsdomain.DefaultWebFreeVideoDurationCap, RecoveryBackoffBase: Duration(30 * time.Second),
			RecoveryBackoffMax: Duration(30 * time.Minute),
		},
		Console: ConsoleProviderConfig{BaseURL: "https://console.x.ai", ChatTimeout: Duration(5 * time.Minute), StreamIdleTimeout: Duration(settingsdomain.DefaultConsoleStreamIdleTimeout)},
	}
}

func defaultBatchConfig() BatchConfig {
	return BatchConfig{
		ImportConcurrency: 25, ConversionConcurrency: 25, SyncConcurrency: 25,
		RefreshConcurrency: 25, RandomDelay: Duration(500 * time.Millisecond),
	}
}

func defaultMediaConfig() MediaConfig {
	return MediaConfig{
		Driver: "local", MaxImageBytes: 32 << 20, MaxTotalBytes: 1 << 30,
		CleanupThresholdPercent: 80, CleanupInterval: Duration(10 * time.Minute),
		Local: LocalMediaConfig{Path: "./data/media"},
	}
}

func defaultRoutingConfig() RoutingConfig {
	return RoutingConfig{
		StickyTTL:                   Duration(time.Hour),
		CooldownBase:                Duration(30 * time.Second),
		CooldownMax:                 Duration(30 * time.Minute),
		CapacityWait:                Duration(500 * time.Millisecond),
		MaxAttempts:                 999,
		VideoMaxAttempts:            999,
		MarkBuildChatDeniedAsReauth: false,
		PreferFreeBuild:             false,
		AccountIsolatedConnections:  false,
		SegmentedSelectorEnabled:    true,
		SegmentedMinCandidates:      3000,
		SegmentedWindowSize:         64,
		ReasoningReplayEnabled:      true,
		ReasoningReplayTTL:          Duration(time.Hour),
		ReasoningReplayMaxEntries:   10240,
	}
}

func defaultAuditConfig() AuditConfig {
	return AuditConfig{
		BufferSize: 16384, BatchSize: 256, FlushInterval: Duration(250 * time.Millisecond), CommitDelay: Duration(5 * time.Millisecond),
		RetentionDays: 7,
		LedgerMode:    "enforce", LedgerFailureThreshold: 1,
		LedgerUnhealthyGrace: Duration(10 * time.Second), LedgerQueueHighWatermarkPct: 90,
	}
}

func defaultQualityGuardConfig() QualityGuardConfig {
	return QualityGuardConfig{
		Model: "grok-4.6", Mode: "hybrid",
		ActiveInterval: Duration(30 * time.Minute), PassivePollInterval: Duration(5 * time.Second),
		SoftTPS: 500, HardTPS: 1000, ConsecutiveSoft: 2, ConsecutiveErrors: 2,
		QuarantineDuration: Duration(5 * time.Minute), NoAccountBackoff: Duration(5 * time.Minute),
		MinimumHealthyNodes: 3, MaxOutputTokens: 384,
		MinimumGenerationWindow: Duration(time.Second), RotationTimeout: Duration(45 * time.Second),
		RequestRetry: QualityGuardRequestRetryConfig{
			MaxAttempts: 6, HoldTimeout: Duration(30 * time.Second), MinOutputTokens: 8, OnExhausted: "fail_closed",
			AccountCooldown: Duration(12 * time.Hour), IdleAccountCooldown: Duration(15 * time.Minute),
			MinEncryptedBytes: 256, EncryptedBytesPerReasoningToken: 4,
		},
	}
}

func defaultAccountsConfig() AccountsConfig {
	return AccountsConfig{
		MarkBuildForbiddenReauth:             false,
		BuildForbiddenReauthCodes:            []string{"permission-denied"},
		ExcludeBuildBotFlaggedFromScheduling: false,
		AutoCleanReauthEnabled:               false,
		AutoCleanReauthInterval:              Duration(10 * time.Minute),
		AutoCleanReauthMinAge:                Duration(time.Hour),
		AutoCleanIncludeDisabled:             false,
	}
}
