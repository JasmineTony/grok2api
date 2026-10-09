package settings

import (
	"log/slog"
	"strconv"
	"strings"
	"time"

	settingsdomain "github.com/chenyme/grok2api/backend/internal/domain/settings"
	"github.com/chenyme/grok2api/backend/internal/infra/config"
)

func applyDomainConfig(base config.Config, value settingsdomain.Config) config.Config {
	// 旧版运行设置没有 Server 字段，反序列化后为零；升级时沿用当前配置默认值。
	if value.Server.MaxConcurrentRequests > 0 {
		base.Server.MaxConcurrentRequests = value.Server.MaxConcurrentRequests
	}
	capacityWait := value.Routing.CapacityWait
	if capacityWait <= 0 {
		capacityWait = base.Routing.CapacityWait.Value()
	}
	base.Provider.Build = config.BuildProviderConfig{
		BaseURL: value.ProviderBuild.BaseURL, FallbackBaseURL: config.NormalizeBuildFallbackBaseURL(value.ProviderBuild.FallbackBaseURL),
		ClientVersion: value.ProviderBuild.ClientVersion, ClientIdentifier: value.ProviderBuild.ClientIdentifier,
		TokenAuth: value.ProviderBuild.TokenAuth, UserAgent: value.ProviderBuild.UserAgent,
		ResponseHeaderTimeout: config.Duration(value.ProviderBuild.ResponseHeaderTimeout),
		StreamIdleTimeout:     config.Duration(value.ProviderBuild.StreamIdleTimeout),
	}
	// 旧实例持久化的 Build 客户端版本可能低于上游最低要求，升级后仍会被上游以 426 拒绝（issue #1068）；
	// 这里回填为推荐版本，空值、无法解析的值与不低于最低要求的自定义版本保持原样。
	if target, ok := backfillBuildClientVersion(base.Provider.Build.ClientVersion); ok {
		slog.Warn("build_client_version_backfilled", "persisted", base.Provider.Build.ClientVersion, "recommended", target)
		base.Provider.Build.ClientVersion = target
	}
	if value.ProviderBuild.ResponseHeaderTimeout <= 0 {
		base.Provider.Build.ResponseHeaderTimeout = config.Duration(settingsdomain.DefaultBuildResponseHeaderTimeout)
	}
	if value.ProviderBuild.StreamIdleTimeout <= 0 {
		base.Provider.Build.StreamIdleTimeout = config.Duration(settingsdomain.DefaultBuildStreamIdleTimeout)
	}
	clearanceMode := strings.TrimSpace(value.ProviderWeb.ClearanceMode)
	if clearanceMode == "" {
		clearanceMode = base.Provider.Web.ClearanceMode
	}
	flareSolverrURL := strings.TrimSpace(value.ProviderWeb.FlareSolverrURL)
	if flareSolverrURL == "" {
		flareSolverrURL = base.Provider.Web.FlareSolverrURL
	}
	clearanceTimeout := value.ProviderWeb.ClearanceTimeout
	if clearanceTimeout <= 0 {
		clearanceTimeout = base.Provider.Web.ClearanceTimeout.Value()
	}
	clearanceRefresh := value.ProviderWeb.ClearanceRefresh
	if clearanceRefresh <= 0 {
		clearanceRefresh = base.Provider.Web.ClearanceRefresh.Value()
	}
	freeVideoDurationCap := value.ProviderWeb.FreeVideoDurationCap
	if freeVideoDurationCap == 0 {
		freeVideoDurationCap = base.Provider.Web.FreeVideoDurationCap
	}
	base.Provider.Web = config.WebProviderConfig{
		BaseURL: value.ProviderWeb.BaseURL, QuotaTimeout: config.Duration(value.ProviderWeb.QuotaTimeout),
		StatsigMode: value.ProviderWeb.StatsigMode, StatsigManualValue: value.ProviderWeb.StatsigManualValue, StatsigSignerURL: value.ProviderWeb.StatsigSignerURL,
		ClearanceMode: clearanceMode, FlareSolverrURL: flareSolverrURL,
		ClearanceTimeout: config.Duration(clearanceTimeout), ClearanceRefresh: config.Duration(clearanceRefresh),
		ChatTimeout: config.Duration(value.ProviderWeb.ChatTimeout), StreamIdleTimeout: config.Duration(value.ProviderWeb.StreamIdleTimeout),
		ImageTimeout:     config.Duration(value.ProviderWeb.ImageTimeout),
		VideoTimeout:     config.Duration(value.ProviderWeb.VideoTimeout),
		MediaConcurrency: value.ProviderWeb.MediaConcurrency, AllowNSFW: value.ProviderWeb.AllowNSFW,
		FreeVideoDurationCap: settingsdomain.NormalizeWebFreeVideoDurationCap(freeVideoDurationCap),
		RecoveryBackoffBase:  config.Duration(value.ProviderWeb.RecoveryBackoffBase), RecoveryBackoffMax: config.Duration(value.ProviderWeb.RecoveryBackoffMax),
	}
	if value.ProviderWeb.StreamIdleTimeout <= 0 {
		base.Provider.Web.StreamIdleTimeout = config.Duration(settingsdomain.DefaultWebStreamIdleTimeout)
	}
	// Console 是后续版本新增的完整配置段；旧 JSON 整段缺失时沿用代码默认值。
	if value.ProviderConsole != (settingsdomain.ProviderConsoleConfig{}) {
		base.Provider.Console = config.ConsoleProviderConfig{
			BaseURL: value.ProviderConsole.BaseURL, ChatTimeout: config.Duration(value.ProviderConsole.ChatTimeout),
			StreamIdleTimeout: config.Duration(value.ProviderConsole.StreamIdleTimeout),
		}
		if value.ProviderConsole.StreamIdleTimeout <= 0 {
			base.Provider.Console.StreamIdleTimeout = config.Duration(settingsdomain.DefaultConsoleStreamIdleTimeout)
		}
	}
	randomDelay := time.Duration(-1)
	if value.Batch.RandomDelay != nil {
		randomDelay = *value.Batch.RandomDelay
	}
	base.Batch = config.BatchConfig{
		ImportConcurrency: value.Batch.ImportConcurrency, ConversionConcurrency: value.Batch.ConversionConcurrency,
		SyncConcurrency: value.Batch.SyncConcurrency, RefreshConcurrency: value.Batch.RefreshConcurrency,
		RandomDelay: config.Duration(randomDelay),
	}
	base.Media.MaxImageBytes = value.Media.MaxImageBytes
	base.Media.MaxTotalBytes = value.Media.MaxTotalBytes
	base.Media.CleanupThresholdPercent = value.Media.CleanupThresholdPercent
	base.Media.CleanupInterval = config.Duration(value.Media.CleanupInterval)
	base.Frontend.PublicAPIBaseURLOverride = strings.TrimSpace(value.Frontend.PublicAPIBaseURL)
	segmentedEnabled := base.Routing.SegmentedSelectorEnabled
	segmentedMinCandidates := base.Routing.SegmentedMinCandidates
	segmentedWindowSize := base.Routing.SegmentedWindowSize
	accountIsolatedConnections := base.Routing.AccountIsolatedConnections
	if value.Routing.AccountIsolatedConnections != nil {
		accountIsolatedConnections = *value.Routing.AccountIsolatedConnections
	}
	if value.Routing.SegmentedSelector != nil {
		segmentedEnabled = value.Routing.SegmentedSelector.ActiveEnabled
		segmentedMinCandidates = value.Routing.SegmentedSelector.MinCandidates
		segmentedWindowSize = value.Routing.SegmentedSelector.WindowSize
	}
	base.Routing = config.RoutingConfig{
		StickyTTL: config.Duration(value.Routing.StickyTTL), CooldownBase: config.Duration(value.Routing.CooldownBase),
		CooldownMax: config.Duration(value.Routing.CooldownMax), CapacityWait: config.Duration(capacityWait), MaxAttempts: value.Routing.MaxAttempts, VideoMaxAttempts: value.Routing.VideoMaxAttempts,
		MarkBuildChatDeniedAsReauth: value.Routing.MarkBuildChatDeniedAsReauth,
		PreferFreeBuild:             value.Routing.PreferFreeBuild,
		AccountIsolatedConnections:  accountIsolatedConnections,
		SegmentedSelectorEnabled:    segmentedEnabled,
		SegmentedMinCandidates:      segmentedMinCandidates,
		SegmentedWindowSize:         segmentedWindowSize,
		ReasoningReplayEnabled:      base.Routing.ReasoningReplayEnabled, ReasoningReplayTTL: base.Routing.ReasoningReplayTTL,
		ReasoningReplayMaxEntries: base.Routing.ReasoningReplayMaxEntries,
	}
	commitDelay := base.Audit.CommitDelay.Value()
	if value.Audit.CommitDelay > 0 {
		commitDelay = value.Audit.CommitDelay
	}
	retentionDays := base.Audit.RetentionDays
	if value.Audit.RetentionDays != nil {
		retentionDays = *value.Audit.RetentionDays
	}
	base.Audit = config.AuditConfig{
		BufferSize: value.Audit.BufferSize, BatchSize: value.Audit.BatchSize, FlushInterval: config.Duration(value.Audit.FlushInterval),
		CommitDelay: config.Duration(commitDelay), RetentionDays: retentionDays,
		LedgerMode: base.Audit.LedgerMode, LedgerFailureThreshold: base.Audit.LedgerFailureThreshold,
		LedgerUnhealthyGrace: base.Audit.LedgerUnhealthyGrace, LedgerQueueHighWatermarkPct: base.Audit.LedgerQueueHighWatermarkPct,
	}
	base.ClientKeyDefaults = config.ClientKeyDefaultsConfig{
		RPMLimit: value.ClientKeyDefaults.RPMLimit, MaxConcurrent: value.ClientKeyDefaults.MaxConcurrent,
	}
	// Accounts 为后续新增段；旧持久化缺字段时沿用代码默认（全部关闭）。
	if value.Accounts.AutoCleanReauthInterval > 0 {
		base.Accounts.AutoCleanReauthInterval = config.Duration(value.Accounts.AutoCleanReauthInterval)
	}
	if value.Accounts.AutoCleanReauthMinAge > 0 {
		base.Accounts.AutoCleanReauthMinAge = config.Duration(value.Accounts.AutoCleanReauthMinAge)
	}
	base.Accounts.AutoCleanReauthEnabled = value.Accounts.AutoCleanReauthEnabled
	base.Accounts.AutoCleanIncludeDisabled = value.Accounts.AutoCleanIncludeDisabled
	base.Accounts.MarkBuildForbiddenReauth = value.Accounts.MarkBuildForbiddenReauth
	if value.Accounts.BuildForbiddenReauthCodes != nil {
		base.Accounts.BuildForbiddenReauthCodes = append([]string(nil), value.Accounts.BuildForbiddenReauthCodes...)
	}
	base.Accounts.ExcludeBuildBotFlaggedFromScheduling = value.Accounts.ExcludeBuildBotFlaggedFromScheduling
	return base
}

// parseBuildClientVersion 解析 major.minor.patch 形式的客户端版本，允许 v 前缀与 -/+ 后缀。
// 语义与 updatecheck 包的语义化版本比较保持一致（该实现未导出，无法跨包复用）。
func parseBuildClientVersion(value string) ([3]uint64, bool) {
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	if index := strings.IndexAny(value, "-+"); index >= 0 {
		value = value[:index]
	}
	parts := strings.Split(value, ".")
	if len(parts) != 3 {
		return [3]uint64{}, false
	}
	var result [3]uint64
	for index, part := range parts {
		// 空段与带前导零的段都不是规范写法，一律视为无法解析。
		if part == "" || (len(part) > 1 && part[0] == '0') {
			return [3]uint64{}, false
		}
		number, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			return [3]uint64{}, false
		}
		result[index] = number
	}
	return result, true
}

func mustParseBuildClientVersion(value string) [3]uint64 {
	parsed, ok := parseBuildClientVersion(value)
	if !ok {
		panic("settings: 最低 Build 客户端版本不是语义化版本: " + value)
	}
	return parsed
}

func compareBuildClientVersion(left, right [3]uint64) int {
	for index := range left {
		if left[index] < right[index] {
			return -1
		}
		if left[index] > right[index] {
			return 1
		}
	}
	return 0
}

// backfillBuildClientVersion 判断持久化的 Build 客户端版本是否需要回填为推荐版本。
// 仅当持久化值可解析且低于上游最低要求时返回推荐版本；空值、非法值与更高版本一律返回 false。
func backfillBuildClientVersion(persisted string) (string, bool) {
	parsed, ok := parseBuildClientVersion(persisted)
	if !ok {
		return "", false
	}
	if compareBuildClientVersion(parsed, minSupportedBuildClientVersionParts) >= 0 {
		return "", false
	}
	return config.RecommendedBuildClientVersion, true
}

func toDomainConfig(value config.Config) settingsdomain.Config {
	randomDelay := value.Batch.RandomDelay.Value()
	accountIsolatedConnections := value.Routing.AccountIsolatedConnections
	return settingsdomain.Config{
		Server: settingsdomain.ServerConfig{MaxConcurrentRequests: value.Server.MaxConcurrentRequests},
		ProviderBuild: settingsdomain.ProviderBuildConfig{
			BaseURL: value.Provider.Build.BaseURL, FallbackBaseURL: config.NormalizeBuildFallbackBaseURL(value.Provider.Build.FallbackBaseURL),
			ClientVersion: value.Provider.Build.ClientVersion, ClientIdentifier: value.Provider.Build.ClientIdentifier,
			TokenAuth: value.Provider.Build.TokenAuth, UserAgent: value.Provider.Build.UserAgent,
			ResponseHeaderTimeout: value.Provider.Build.ResponseHeaderTimeout.Value(),
			StreamIdleTimeout:     value.Provider.Build.StreamIdleTimeout.Value(),
		},
		ProviderWeb: settingsdomain.ProviderWebConfig{
			BaseURL: value.Provider.Web.BaseURL, QuotaTimeout: value.Provider.Web.QuotaTimeout.Value(),
			StatsigMode: value.Provider.Web.StatsigMode, StatsigManualValue: value.Provider.Web.StatsigManualValue,
			StatsigSignerURL: value.Provider.Web.StatsigSignerURL,
			ClearanceMode:    value.Provider.Web.ClearanceMode, FlareSolverrURL: value.Provider.Web.FlareSolverrURL,
			ClearanceTimeout: value.Provider.Web.ClearanceTimeout.Value(), ClearanceRefresh: value.Provider.Web.ClearanceRefresh.Value(),
			ChatTimeout: value.Provider.Web.ChatTimeout.Value(), StreamIdleTimeout: value.Provider.Web.StreamIdleTimeout.Value(),
			ImageTimeout:     value.Provider.Web.ImageTimeout.Value(),
			VideoTimeout:     value.Provider.Web.VideoTimeout.Value(),
			MediaConcurrency: value.Provider.Web.MediaConcurrency, AllowNSFW: value.Provider.Web.AllowNSFW,
			FreeVideoDurationCap: settingsdomain.NormalizeWebFreeVideoDurationCap(value.Provider.Web.FreeVideoDurationCap),
			RecoveryBackoffBase:  value.Provider.Web.RecoveryBackoffBase.Value(), RecoveryBackoffMax: value.Provider.Web.RecoveryBackoffMax.Value(),
		},
		ProviderConsole: settingsdomain.ProviderConsoleConfig{
			BaseURL: value.Provider.Console.BaseURL, ChatTimeout: value.Provider.Console.ChatTimeout.Value(),
			StreamIdleTimeout: value.Provider.Console.StreamIdleTimeout.Value(),
		},
		Batch: settingsdomain.BatchConfig{
			ImportConcurrency: value.Batch.ImportConcurrency, ConversionConcurrency: value.Batch.ConversionConcurrency,
			SyncConcurrency: value.Batch.SyncConcurrency, RefreshConcurrency: value.Batch.RefreshConcurrency,
			RandomDelay: &randomDelay,
		},
		Media: settingsdomain.MediaConfig{
			MaxImageBytes: value.Media.MaxImageBytes, MaxTotalBytes: value.Media.MaxTotalBytes,
			CleanupThresholdPercent: value.Media.CleanupThresholdPercent, CleanupInterval: value.Media.CleanupInterval.Value(),
		},
		Frontend: settingsdomain.FrontendConfig{
			PublicAPIBaseURL: value.Frontend.PublicAPIBaseURLOverride,
		},
		Routing: settingsdomain.RoutingConfig{
			StickyTTL: value.Routing.StickyTTL.Value(), CooldownBase: value.Routing.CooldownBase.Value(),
			CooldownMax: value.Routing.CooldownMax.Value(), CapacityWait: value.Routing.CapacityWait.Value(), MaxAttempts: value.Routing.MaxAttempts, VideoMaxAttempts: value.Routing.VideoMaxAttempts,
			MarkBuildChatDeniedAsReauth: value.Routing.MarkBuildChatDeniedAsReauth,
			PreferFreeBuild:             value.Routing.PreferFreeBuild,
			AccountIsolatedConnections:  &accountIsolatedConnections,
			SegmentedSelector: &settingsdomain.SegmentedSelectorConfig{
				ActiveEnabled: value.Routing.SegmentedSelectorEnabled,
				MinCandidates: value.Routing.SegmentedMinCandidates, WindowSize: value.Routing.SegmentedWindowSize,
			},
		},
		Audit: settingsdomain.AuditConfig{
			BufferSize: value.Audit.BufferSize, BatchSize: value.Audit.BatchSize, FlushInterval: value.Audit.FlushInterval.Value(), CommitDelay: value.Audit.CommitDelay.Value(),
			RetentionDays: intPointer(value.Audit.RetentionDays),
		},
		ClientKeyDefaults: settingsdomain.ClientKeyDefaultsConfig{
			RPMLimit: value.ClientKeyDefaults.RPMLimit, MaxConcurrent: value.ClientKeyDefaults.MaxConcurrent,
		},
		Accounts: settingsdomain.AccountsConfig{
			MarkBuildForbiddenReauth:             value.Accounts.MarkBuildForbiddenReauth,
			BuildForbiddenReauthCodes:            append([]string(nil), value.Accounts.BuildForbiddenReauthCodes...),
			ExcludeBuildBotFlaggedFromScheduling: value.Accounts.ExcludeBuildBotFlaggedFromScheduling,
			AutoCleanReauthEnabled:               value.Accounts.AutoCleanReauthEnabled,
			AutoCleanReauthInterval:              value.Accounts.AutoCleanReauthInterval.Value(),
			AutoCleanReauthMinAge:                value.Accounts.AutoCleanReauthMinAge.Value(),
			AutoCleanIncludeDisabled:             value.Accounts.AutoCleanIncludeDisabled,
		},
	}
}

func normalizeForbiddenCodes(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		code := strings.ToLower(strings.TrimSpace(value))
		if code == "" {
			continue
		}
		if _, exists := seen[code]; exists {
			continue
		}
		seen[code] = struct{}{}
		result = append(result, code)
	}
	return result
}
