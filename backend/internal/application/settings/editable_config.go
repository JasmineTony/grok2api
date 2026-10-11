package settings

import (
	"errors"
	"fmt"
	"strings"
	"time"

	settingsdomain "github.com/chenyme/grok2api/backend/internal/domain/settings"
	"github.com/chenyme/grok2api/backend/internal/infra/config"
)

// editableDurationInput 描述一个可编辑时长字段的配置路径、输入文本与写入目标。
type editableDurationInput struct {
	path  string
	value string
	set   func(config.Duration)
}

func mergeEditable(current config.Config, input EditableConfig) (config.Config, error) {
	if input.Audit.CommitDelayMS < 0 {
		return config.Config{}, errors.New("audit.commitDelayMS 不能为负数")
	}
	next := current
	next = applyEditableProviderFields(next, input)
	next = applyEditableBatchAndMediaFields(next, input)
	next = applyEditableRoutingFields(next, input)
	next = applyEditableAuditAndAccountFields(next, input)
	if err := applyEditableDurations(collectEditableDurations(input, &next)); err != nil {
		return config.Config{}, err
	}
	if err := validateEditableTimeoutRelationships(next); err != nil {
		return config.Config{}, err
	}
	if err := next.Validate(); err != nil {
		return config.Config{}, err
	}
	return next, nil
}

// applyEditableProviderFields 写入 Build、Web 与 Console 上游字段。
func applyEditableProviderFields(next config.Config, input EditableConfig) config.Config {
	next.Server.MaxConcurrentRequests = input.Server.MaxConcurrentRequests
	next.Provider.Build.BaseURL = strings.TrimSpace(input.ProviderBuild.BaseURL)
	next.Provider.Build.FallbackBaseURL = config.NormalizeBuildFallbackBaseURL(input.ProviderBuild.FallbackBaseURL)
	next.Provider.Build.ClientVersion = strings.TrimSpace(input.ProviderBuild.ClientVersion)
	next.Provider.Build.ClientIdentifier = strings.TrimSpace(input.ProviderBuild.ClientIdentifier)
	if tokenAuth := strings.TrimSpace(input.ProviderBuild.TokenAuth); tokenAuth != "" {
		next.Provider.Build.TokenAuth = tokenAuth
	}
	next.Provider.Build.UserAgent = strings.TrimSpace(input.ProviderBuild.UserAgent)
	next.Provider.Web.BaseURL = strings.TrimSpace(input.ProviderWeb.BaseURL)
	next.Provider.Web.StatsigMode = strings.TrimSpace(input.ProviderWeb.StatsigMode)
	next.Provider.Web.StatsigSignerURL = strings.TrimSpace(input.ProviderWeb.StatsigSignerURL)
	if input.ProviderWeb.ClearanceProvided {
		next.Provider.Web.ClearanceMode = strings.TrimSpace(input.ProviderWeb.ClearanceMode)
		next.Provider.Web.FlareSolverrURL = strings.TrimSpace(input.ProviderWeb.FlareSolverrURL)
	}
	if next.Provider.Web.StatsigMode == config.StatsigModeManual {
		if value := strings.TrimSpace(input.ProviderWeb.StatsigManualValue); value != "" {
			next.Provider.Web.StatsigManualValue = value
		}
	} else {
		next.Provider.Web.StatsigManualValue = ""
	}
	next.Provider.Web.MediaConcurrency = input.ProviderWeb.MediaConcurrency
	next.Provider.Web.AllowNSFW = input.ProviderWeb.AllowNSFW
	if input.ProviderWeb.FreeVideoDurationCapProvided {
		next.Provider.Web.FreeVideoDurationCap = settingsdomain.NormalizeWebFreeVideoDurationCap(input.ProviderWeb.FreeVideoDurationCap)
	}
	next.Provider.Console.BaseURL = strings.TrimSpace(input.ProviderConsole.BaseURL)
	return next
}

// applyEditableBatchAndMediaFields 写入批量任务、媒体与前端公开地址字段。
func applyEditableBatchAndMediaFields(next config.Config, input EditableConfig) config.Config {
	next.Batch = config.BatchConfig{
		ImportConcurrency: input.Batch.ImportConcurrency, ConversionConcurrency: input.Batch.ConversionConcurrency,
		SyncConcurrency: input.Batch.SyncConcurrency, RefreshConcurrency: input.Batch.RefreshConcurrency,
	}
	next.Media.MaxImageBytes = input.Media.MaxImageBytes
	next.Media.MaxTotalBytes = input.Media.MaxTotalBytes
	next.Media.CleanupThresholdPercent = input.Media.CleanupThresholdPercent
	next.Frontend.PublicAPIBaseURLOverride = strings.TrimSpace(input.Frontend.PublicAPIBaseURL)
	return next
}

// applyEditableRoutingFields 写入路由尝试次数、免费优先与分段选择器字段。
func applyEditableRoutingFields(next config.Config, input EditableConfig) config.Config {
	next.Routing.MaxAttempts = input.Routing.MaxAttempts
	next.Routing.VideoMaxAttempts = input.Routing.VideoMaxAttempts
	next.Routing.PreferFreeBuild = input.Routing.PreferFreeBuild
	if input.Routing.AccountIsolatedConnectionsProvided {
		next.Routing.AccountIsolatedConnections = input.Routing.AccountIsolatedConnections
	}
	if input.Routing.SegmentedSelectorProvided {
		next.Routing.SegmentedSelectorEnabled = input.Routing.SegmentedSelector.Enabled
		next.Routing.SegmentedMinCandidates = input.Routing.SegmentedSelector.MinCandidates
		next.Routing.SegmentedWindowSize = input.Routing.SegmentedSelector.WindowSize
	}
	if input.Routing.MarkBuildChatDeniedAsReauthProvided {
		next.Routing.MarkBuildChatDeniedAsReauth = input.Routing.MarkBuildChatDeniedAsReauth
	}
	return next
}

// applyEditableAuditAndAccountFields 写入审计队列、客户端密钥默认值与账号自动清理字段。
func applyEditableAuditAndAccountFields(next config.Config, input EditableConfig) config.Config {
	next.Audit.BufferSize = input.Audit.BufferSize
	next.Audit.BatchSize = input.Audit.BatchSize
	if input.Audit.CommitDelayMS > 0 {
		next.Audit.CommitDelay = config.Duration(time.Duration(input.Audit.CommitDelayMS) * time.Millisecond)
	}
	if input.Audit.RetentionDaysProvided {
		next.Audit.RetentionDays = input.Audit.RetentionDays
	}
	next.ClientKeyDefaults.RPMLimit = input.ClientKeyDefaults.RPMLimit
	next.ClientKeyDefaults.MaxConcurrent = input.ClientKeyDefaults.MaxConcurrent
	if input.AccountsProvided {
		if input.Accounts.MarkBuildForbiddenReauthProvided {
			next.Accounts.MarkBuildForbiddenReauth = input.Accounts.MarkBuildForbiddenReauth
		}
		if input.Accounts.BuildForbiddenReauthCodesProvided {
			next.Accounts.BuildForbiddenReauthCodes = normalizeForbiddenCodes(input.Accounts.BuildForbiddenReauthCodes)
		}
		if input.Accounts.ExcludeBuildBotFlaggedFromSchedulingProvided {
			next.Accounts.ExcludeBuildBotFlaggedFromScheduling = input.Accounts.ExcludeBuildBotFlaggedFromScheduling
		}
		next.Accounts.AutoCleanReauthEnabled = input.Accounts.AutoCleanReauthEnabled
		next.Accounts.AutoCleanIncludeDisabled = input.Accounts.AutoCleanIncludeDisabled
	}
	return next
}

// collectEditableDurations 收集本次写入需要解析的时长字段，顺序即错误上报顺序。
func collectEditableDurations(input EditableConfig, next *config.Config) []editableDurationInput {
	durations := []editableDurationInput{
		{"routing.stickyTTL", input.Routing.StickyTTL, func(value config.Duration) { next.Routing.StickyTTL = value }},
		{"routing.cooldownBase", input.Routing.CooldownBase, func(value config.Duration) { next.Routing.CooldownBase = value }},
		{"routing.cooldownMax", input.Routing.CooldownMax, func(value config.Duration) { next.Routing.CooldownMax = value }},
		{"routing.capacityWait", input.Routing.CapacityWait, func(value config.Duration) { next.Routing.CapacityWait = value }},
		{"audit.flushInterval", input.Audit.FlushInterval, func(value config.Duration) { next.Audit.FlushInterval = value }},
		{"providerWeb.quotaTimeout", input.ProviderWeb.QuotaTimeout, func(value config.Duration) { next.Provider.Web.QuotaTimeout = value }},
		{"providerWeb.chatTimeout", input.ProviderWeb.ChatTimeout, func(value config.Duration) { next.Provider.Web.ChatTimeout = value }},
		{"providerWeb.imageTimeout", input.ProviderWeb.ImageTimeout, func(value config.Duration) { next.Provider.Web.ImageTimeout = value }},
		{"providerWeb.videoTimeout", input.ProviderWeb.VideoTimeout, func(value config.Duration) { next.Provider.Web.VideoTimeout = value }},
		{"providerWeb.recoveryBackoffBase", input.ProviderWeb.RecoveryBackoffBase, func(value config.Duration) { next.Provider.Web.RecoveryBackoffBase = value }},
		{"providerWeb.recoveryBackoffMax", input.ProviderWeb.RecoveryBackoffMax, func(value config.Duration) { next.Provider.Web.RecoveryBackoffMax = value }},
		{"providerConsole.chatTimeout", input.ProviderConsole.ChatTimeout, func(value config.Duration) { next.Provider.Console.ChatTimeout = value }},
		{"media.cleanupInterval", input.Media.CleanupInterval, func(value config.Duration) { next.Media.CleanupInterval = value }},
		{"batch.randomDelay", input.Batch.RandomDelay, func(value config.Duration) { next.Batch.RandomDelay = value }},
	}
	return appendEditableConditionalDurations(durations, input, next)
}

// appendEditableConditionalDurations 追加仅在输入提供时才生效的时长字段。
func appendEditableConditionalDurations(durations []editableDurationInput, input EditableConfig, next *config.Config) []editableDurationInput {
	if strings.TrimSpace(input.ProviderBuild.ResponseHeaderTimeout) != "" {
		durations = append(durations, editableDurationInput{"providerBuild.responseHeaderTimeout", input.ProviderBuild.ResponseHeaderTimeout, func(value config.Duration) { next.Provider.Build.ResponseHeaderTimeout = value }})
	}
	if strings.TrimSpace(input.ProviderBuild.StreamIdleTimeout) != "" {
		durations = append(durations, editableDurationInput{"providerBuild.streamIdleTimeout", input.ProviderBuild.StreamIdleTimeout, func(value config.Duration) { next.Provider.Build.StreamIdleTimeout = value }})
	}
	if strings.TrimSpace(input.ProviderWeb.StreamIdleTimeout) != "" {
		durations = append(durations, editableDurationInput{"providerWeb.streamIdleTimeout", input.ProviderWeb.StreamIdleTimeout, func(value config.Duration) { next.Provider.Web.StreamIdleTimeout = value }})
	}
	if strings.TrimSpace(input.ProviderConsole.StreamIdleTimeout) != "" {
		durations = append(durations, editableDurationInput{"providerConsole.streamIdleTimeout", input.ProviderConsole.StreamIdleTimeout, func(value config.Duration) { next.Provider.Console.StreamIdleTimeout = value }})
	}
	if input.ProviderWeb.ClearanceProvided {
		durations = append(durations,
			editableDurationInput{"providerWeb.clearanceTimeout", input.ProviderWeb.ClearanceTimeout, func(value config.Duration) { next.Provider.Web.ClearanceTimeout = value }},
			editableDurationInput{"providerWeb.clearanceRefresh", input.ProviderWeb.ClearanceRefresh, func(value config.Duration) { next.Provider.Web.ClearanceRefresh = value }},
		)
	}
	if input.AccountsProvided {
		durations = append(durations,
			editableDurationInput{"accounts.autoCleanReauthInterval", input.Accounts.AutoCleanReauthInterval, func(value config.Duration) { next.Accounts.AutoCleanReauthInterval = value }},
			editableDurationInput{"accounts.autoCleanReauthMinAge", input.Accounts.AutoCleanReauthMinAge, func(value config.Duration) { next.Accounts.AutoCleanReauthMinAge = value }},
		)
	}
	return durations
}

// applyEditableDurations 按收集顺序解析时长文本并写入对应字段。
func applyEditableDurations(durations []editableDurationInput) error {
	for _, item := range durations {
		value, err := time.ParseDuration(strings.TrimSpace(item.value))
		if err != nil {
			return fmt.Errorf("%s 必须是有效时长", item.path)
		}
		item.set(config.Duration(value))
	}
	return nil
}

// validateEditableTimeoutRelationships 约束新写入的空闲超时不得超过对应的绝对超时。
// Enforce the relationship only for new writes. Persisted settings from an
// older version remain loadable during rolling upgrades, while an admin can
// no longer save an idle deadline shadowed by a shorter absolute timeout.
func validateEditableTimeoutRelationships(next config.Config) error {
	if next.Provider.Web.StreamIdleTimeout.Value() > next.Provider.Web.ChatTimeout.Value() {
		return errors.New("providerWeb.streamIdleTimeout 不能超过 providerWeb.chatTimeout")
	}
	if next.Provider.Console.StreamIdleTimeout.Value() > next.Provider.Console.ChatTimeout.Value() {
		return errors.New("providerConsole.streamIdleTimeout 不能超过 providerConsole.chatTimeout")
	}
	return nil
}

func toEditable(cfg config.Config) EditableConfig {
	return EditableConfig{
		Server:            ServerConfig{MaxConcurrentRequests: cfg.Server.MaxConcurrentRequests},
		ProviderBuild:     toEditableProviderBuild(cfg),
		ProviderWeb:       toEditableProviderWeb(cfg),
		ProviderConsole:   toEditableProviderConsole(cfg),
		Batch:             toEditableBatch(cfg),
		Media:             toEditableMedia(cfg),
		Frontend:          FrontendConfig{PublicAPIBaseURL: cfg.Frontend.PublicAPIBaseURLOverride},
		Routing:           toEditableRouting(cfg),
		Audit:             toEditableAudit(cfg),
		ClientKeyDefaults: ClientKeyDefaultsConfig{RPMLimit: cfg.ClientKeyDefaults.RPMLimit, MaxConcurrent: cfg.ClientKeyDefaults.MaxConcurrent},
		Accounts:          toEditableAccounts(cfg),
		AccountsProvided:  true,
	}
}

func toEditableProviderBuild(cfg config.Config) ProviderBuildConfig {
	return ProviderBuildConfig{
		BaseURL: cfg.Provider.Build.BaseURL, FallbackBaseURL: config.NormalizeBuildFallbackBaseURL(cfg.Provider.Build.FallbackBaseURL),
		ClientVersion: cfg.Provider.Build.ClientVersion, ClientIdentifier: cfg.Provider.Build.ClientIdentifier,
		TokenAuth: cfg.Provider.Build.TokenAuth, UserAgent: cfg.Provider.Build.UserAgent,
		ResponseHeaderTimeout: cfg.Provider.Build.ResponseHeaderTimeout.String(),
		StreamIdleTimeout:     cfg.Provider.Build.StreamIdleTimeout.String(),
	}
}

func toEditableProviderWeb(cfg config.Config) ProviderWebConfig {
	return ProviderWebConfig{
		BaseURL: cfg.Provider.Web.BaseURL, QuotaTimeout: cfg.Provider.Web.QuotaTimeout.String(),
		StatsigMode: cfg.Provider.Web.StatsigMode, StatsigManualConfigured: strings.TrimSpace(cfg.Provider.Web.StatsigManualValue) != "",
		StatsigSignerURL: cfg.Provider.Web.StatsigSignerURL,
		ClearanceMode:    cfg.Provider.Web.ClearanceMode, FlareSolverrURL: cfg.Provider.Web.FlareSolverrURL,
		ClearanceTimeout: cfg.Provider.Web.ClearanceTimeout.String(), ClearanceRefresh: cfg.Provider.Web.ClearanceRefresh.String(),
		ChatTimeout: cfg.Provider.Web.ChatTimeout.String(), StreamIdleTimeout: cfg.Provider.Web.StreamIdleTimeout.String(),
		ImageTimeout:     cfg.Provider.Web.ImageTimeout.String(),
		VideoTimeout:     cfg.Provider.Web.VideoTimeout.String(),
		MediaConcurrency: cfg.Provider.Web.MediaConcurrency, AllowNSFW: cfg.Provider.Web.AllowNSFW,
		FreeVideoDurationCap:         settingsdomain.NormalizeWebFreeVideoDurationCap(cfg.Provider.Web.FreeVideoDurationCap),
		FreeVideoDurationCapProvided: true,
		RecoveryBackoffBase:          cfg.Provider.Web.RecoveryBackoffBase.String(), RecoveryBackoffMax: cfg.Provider.Web.RecoveryBackoffMax.String(),
	}
}

func toEditableProviderConsole(cfg config.Config) ProviderConsoleConfig {
	return ProviderConsoleConfig{
		BaseURL: cfg.Provider.Console.BaseURL, ChatTimeout: cfg.Provider.Console.ChatTimeout.String(),
		StreamIdleTimeout: cfg.Provider.Console.StreamIdleTimeout.String(),
	}
}

func toEditableBatch(cfg config.Config) BatchConfig {
	return BatchConfig{
		ImportConcurrency: cfg.Batch.ImportConcurrency, ConversionConcurrency: cfg.Batch.ConversionConcurrency,
		SyncConcurrency: cfg.Batch.SyncConcurrency, RefreshConcurrency: cfg.Batch.RefreshConcurrency,
		RandomDelay: cfg.Batch.RandomDelay.String(),
	}
}

func toEditableMedia(cfg config.Config) MediaConfig {
	return MediaConfig{
		MaxImageBytes: cfg.Media.MaxImageBytes, MaxTotalBytes: cfg.Media.MaxTotalBytes,
		CleanupThresholdPercent: cfg.Media.CleanupThresholdPercent, CleanupInterval: cfg.Media.CleanupInterval.String(),
	}
}

func toEditableRouting(cfg config.Config) RoutingConfig {
	return RoutingConfig{
		StickyTTL: cfg.Routing.StickyTTL.String(), CooldownBase: cfg.Routing.CooldownBase.String(),
		CooldownMax: cfg.Routing.CooldownMax.String(), CapacityWait: cfg.Routing.CapacityWait.String(), MaxAttempts: cfg.Routing.MaxAttempts, VideoMaxAttempts: cfg.Routing.VideoMaxAttempts,
		MarkBuildChatDeniedAsReauth:         cfg.Routing.MarkBuildChatDeniedAsReauth,
		MarkBuildChatDeniedAsReauthProvided: true,
		PreferFreeBuild:                     cfg.Routing.PreferFreeBuild,
		AccountIsolatedConnections:          cfg.Routing.AccountIsolatedConnections,
		AccountIsolatedConnectionsProvided:  true,
		SegmentedSelector: SegmentedSelectorConfig{
			Enabled: cfg.Routing.SegmentedSelectorEnabled, MinCandidates: cfg.Routing.SegmentedMinCandidates,
			WindowSize: cfg.Routing.SegmentedWindowSize,
		},
		SegmentedSelectorProvided: true,
	}
}

func toEditableAudit(cfg config.Config) AuditConfig {
	return AuditConfig{
		BufferSize: cfg.Audit.BufferSize, BatchSize: cfg.Audit.BatchSize, FlushInterval: cfg.Audit.FlushInterval.String(), CommitDelayMS: int(cfg.Audit.CommitDelay.Value() / time.Millisecond),
		RetentionDays: cfg.Audit.RetentionDays, RetentionDaysProvided: true,
	}
}

func toEditableAccounts(cfg config.Config) AccountsConfig {
	return AccountsConfig{
		MarkBuildForbiddenReauth:                     cfg.Accounts.MarkBuildForbiddenReauth,
		BuildForbiddenReauthCodes:                    append([]string(nil), cfg.Accounts.BuildForbiddenReauthCodes...),
		ExcludeBuildBotFlaggedFromScheduling:         cfg.Accounts.ExcludeBuildBotFlaggedFromScheduling,
		MarkBuildForbiddenReauthProvided:             true,
		BuildForbiddenReauthCodesProvided:            true,
		ExcludeBuildBotFlaggedFromSchedulingProvided: true,
		AutoCleanReauthEnabled:                       cfg.Accounts.AutoCleanReauthEnabled,
		AutoCleanReauthInterval:                      cfg.Accounts.AutoCleanReauthInterval.String(),
		AutoCleanReauthMinAge:                        cfg.Accounts.AutoCleanReauthMinAge.String(),
		AutoCleanIncludeDisabled:                     cfg.Accounts.AutoCleanIncludeDisabled,
	}
}
