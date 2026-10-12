package settings

import (
	"errors"
	"net/http"
	"strings"
	"time"

	settingsapp "github.com/chenyme/grok2api/backend/internal/application/settings"
	"github.com/chenyme/grok2api/backend/internal/shared/response"
	"github.com/gin-gonic/gin"
)

type Handler struct{ service *settingsapp.Service }

func NewHandler(service *settingsapp.Service) *Handler { return &Handler{service: service} }

func (h *Handler) Register(router *gin.RouterGroup) {
	router.GET("/settings", h.get)
	router.PUT("/settings", h.update)
}

type settingsConfigDTO struct {
	Server            serverConfigDTO            `json:"server"`
	ProviderBuild     providerBuildConfigDTO     `json:"providerBuild"`
	ProviderWeb       providerWebConfigDTO       `json:"providerWeb"`
	ProviderConsole   providerConsoleConfigDTO   `json:"providerConsole"`
	Batch             batchConfigDTO             `json:"batch"`
	Media             mediaConfigDTO             `json:"media"`
	Frontend          frontendConfigDTO          `json:"frontend"`
	Routing           routingConfigDTO           `json:"routing"`
	Audit             auditConfigDTO             `json:"audit"`
	ClientKeyDefaults clientKeyDefaultsConfigDTO `json:"clientKeyDefaults"`
	Accounts          *accountsConfigDTO         `json:"accounts,omitempty"`
}

type serverConfigDTO struct {
	MaxConcurrentRequests int `json:"maxConcurrentRequests"`
}

type providerConsoleConfigDTO struct {
	BaseURL           string `json:"baseURL"`
	ChatTimeout       string `json:"chatTimeout"`
	StreamIdleTimeout string `json:"streamIdleTimeout"`
}

type mediaConfigDTO struct {
	MaxImageBytes           int64  `json:"maxImageBytes"`
	MaxTotalBytes           int64  `json:"maxTotalBytes"`
	CleanupThresholdPercent int    `json:"cleanupThresholdPercent"`
	CleanupInterval         string `json:"cleanupInterval"`
}

type frontendConfigDTO struct {
	PublicAPIBaseURL string `json:"publicApiBaseURL"`
}

type providerBuildConfigDTO struct {
	BaseURL               string `json:"baseURL"`
	FallbackBaseURL       string `json:"fallbackBaseURL"`
	ClientVersion         string `json:"clientVersion"`
	ClientIdentifier      string `json:"clientIdentifier"`
	TokenAuth             string `json:"tokenAuth"`
	TokenAuthConfigured   bool   `json:"tokenAuthConfigured"`
	UserAgent             string `json:"userAgent"`
	ResponseHeaderTimeout string `json:"responseHeaderTimeout"`
	StreamIdleTimeout     string `json:"streamIdleTimeout"`
}

type providerWebConfigDTO struct {
	BaseURL                 string  `json:"baseURL"`
	StatsigMode             string  `json:"statsigMode"`
	StatsigManualValue      string  `json:"statsigManualValue,omitempty"`
	StatsigManualConfigured bool    `json:"statsigManualConfigured"`
	StatsigSignerURL        string  `json:"statsigSignerURL"`
	ClearanceMode           *string `json:"clearanceMode,omitempty"`
	FlareSolverrURL         *string `json:"flareSolverrURL,omitempty"`
	ClearanceTimeout        *string `json:"clearanceTimeout,omitempty"`
	ClearanceRefresh        *string `json:"clearanceRefresh,omitempty"`
	QuotaTimeout            string  `json:"quotaTimeout"`
	ChatTimeout             string  `json:"chatTimeout"`
	StreamIdleTimeout       string  `json:"streamIdleTimeout"`
	ImageTimeout            string  `json:"imageTimeout"`
	VideoTimeout            string  `json:"videoTimeout"`
	MediaConcurrency        int     `json:"mediaConcurrency"`
	AllowNSFW               bool    `json:"allowNSFW"`
	FreeVideoDurationCap    *int    `json:"freeVideoDurationCap,omitempty"`
	RecoveryBackoffBase     string  `json:"recoveryBackoffBase"`
	RecoveryBackoffMax      string  `json:"recoveryBackoffMax"`
}

type batchConfigDTO struct {
	ImportConcurrency     int    `json:"importConcurrency"`
	ConversionConcurrency int    `json:"conversionConcurrency"`
	SyncConcurrency       int    `json:"syncConcurrency"`
	RefreshConcurrency    int    `json:"refreshConcurrency"`
	RandomDelay           string `json:"randomDelay"`
}

type routingConfigDTO struct {
	StickyTTL                   string                      `json:"stickyTTL"`
	CooldownBase                string                      `json:"cooldownBase"`
	CooldownMax                 string                      `json:"cooldownMax"`
	CapacityWait                string                      `json:"capacityWait"`
	MaxAttempts                 int                         `json:"maxAttempts"`
	VideoMaxAttempts            int                         `json:"videoMaxAttempts"`
	PreferFreeBuild             bool                        `json:"preferFreeBuild"`
	MarkBuildChatDeniedAsReauth *bool                       `json:"markBuildChatDeniedAsReauth,omitempty"`
	AccountIsolatedConnections  *bool                       `json:"accountIsolatedConnections,omitempty"`
	SegmentedSelector           *segmentedSelectorConfigDTO `json:"segmentedSelector,omitempty"`
}

type segmentedSelectorConfigDTO struct {
	Enabled       bool `json:"enabled"`
	MinCandidates int  `json:"minCandidates"`
	WindowSize    int  `json:"windowSize"`
}

type auditConfigDTO struct {
	BufferSize    int    `json:"bufferSize"`
	BatchSize     int    `json:"batchSize"`
	FlushInterval string `json:"flushInterval"`
	CommitDelayMS int    `json:"commitDelayMS"`
	RetentionDays *int   `json:"retentionDays,omitempty"`
}

type clientKeyDefaultsConfigDTO struct {
	RPMLimit      int `json:"rpmLimit"`
	MaxConcurrent int `json:"maxConcurrent"`
}

type accountsConfigDTO struct {
	MarkBuildForbiddenReauth             *bool     `json:"markBuildForbiddenReauth,omitempty"`
	BuildForbiddenReauthCodes            *[]string `json:"buildForbiddenReauthCodes,omitempty"`
	ExcludeBuildBotFlaggedFromScheduling *bool     `json:"excludeBuildBotFlaggedFromScheduling,omitempty"`
	AutoCleanReauthEnabled               bool      `json:"autoCleanReauthEnabled"`
	AutoCleanReauthInterval              string    `json:"autoCleanReauthInterval"`
	AutoCleanReauthMinAge                string    `json:"autoCleanReauthMinAge"`
	AutoCleanIncludeDisabled             bool      `json:"autoCleanIncludeDisabled"`
}

type settingsResponse struct {
	Config                   settingsConfigDTO              `json:"config"`
	RecommendedProviderBuild providerBuildRecommendationDTO `json:"recommendedProviderBuild"`
	UpdatedAt                time.Time                      `json:"updatedAt"`
	Revision                 uint64                         `json:"revision,string"`
	RestartRequired          []string                       `json:"restartRequired"`
}

type providerBuildRecommendationDTO struct {
	ClientVersion string `json:"clientVersion"`
	UserAgent     string `json:"userAgent"`
}

type updateRequest struct {
	Revision uint64            `json:"revision,string"`
	Config   settingsConfigDTO `json:"config" binding:"required"`
}

func (h *Handler) get(c *gin.Context) {
	response.Success(c, http.StatusOK, newSettingsResponse(h.service.Get()))
}

func (h *Handler) update(c *gin.Context) {
	var request updateRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "请求参数无效: "+err.Error())
		return
	}
	result, err := h.service.Update(c.Request.Context(), request.Revision, request.Config.toApplication())
	if err != nil {
		if errors.Is(err, settingsapp.ErrInvalidInput) {
			response.Error(c, http.StatusBadRequest, "settingsUpdateFailed", err.Error())
			return
		}
		if errors.Is(err, settingsapp.ErrConflict) {
			response.Error(c, http.StatusConflict, "settingsConflict", "设置已被其他会话更新，请刷新后重试")
			return
		}
		response.Error(c, http.StatusInternalServerError, "settingsUpdateFailed", "保存运行设置失败")
		return
	}
	response.Success(c, http.StatusOK, newSettingsResponse(result))
}

func (value settingsConfigDTO) toApplication() settingsapp.EditableConfig {
	result := settingsapp.EditableConfig{
		Server:        settingsapp.ServerConfig{MaxConcurrentRequests: value.Server.MaxConcurrentRequests},
		ProviderBuild: value.toProviderBuildConfig(),
		ProviderWeb:   value.toProviderWebConfig(),
		ProviderConsole: settingsapp.ProviderConsoleConfig{
			BaseURL: value.ProviderConsole.BaseURL, ChatTimeout: value.ProviderConsole.ChatTimeout,
			StreamIdleTimeout: value.ProviderConsole.StreamIdleTimeout,
		},
		Batch: settingsapp.BatchConfig{
			ImportConcurrency: value.Batch.ImportConcurrency, ConversionConcurrency: value.Batch.ConversionConcurrency,
			SyncConcurrency: value.Batch.SyncConcurrency, RefreshConcurrency: value.Batch.RefreshConcurrency,
			RandomDelay: value.Batch.RandomDelay,
		},
		Media: settingsapp.MediaConfig{
			MaxImageBytes: value.Media.MaxImageBytes, MaxTotalBytes: value.Media.MaxTotalBytes,
			CleanupThresholdPercent: value.Media.CleanupThresholdPercent, CleanupInterval: value.Media.CleanupInterval,
		},
		Frontend: settingsapp.FrontendConfig{
			PublicAPIBaseURL: value.Frontend.PublicAPIBaseURL,
		},
		Routing: value.toRoutingConfig(),
		Audit: settingsapp.AuditConfig{
			BufferSize: value.Audit.BufferSize, BatchSize: value.Audit.BatchSize, FlushInterval: value.Audit.FlushInterval, CommitDelayMS: value.Audit.CommitDelayMS,
			RetentionDays: intValue(value.Audit.RetentionDays), RetentionDaysProvided: value.Audit.RetentionDays != nil,
		},
		ClientKeyDefaults: settingsapp.ClientKeyDefaultsConfig{
			RPMLimit: value.ClientKeyDefaults.RPMLimit, MaxConcurrent: value.ClientKeyDefaults.MaxConcurrent,
		},
	}
	if value.Routing.SegmentedSelector != nil {
		result.Routing.SegmentedSelector = settingsapp.SegmentedSelectorConfig{
			Enabled: value.Routing.SegmentedSelector.Enabled, MinCandidates: value.Routing.SegmentedSelector.MinCandidates,
			WindowSize: value.Routing.SegmentedSelector.WindowSize,
		}
		result.Routing.SegmentedSelectorProvided = true
	}
	if value.Accounts != nil {
		result.Accounts = value.toAccountsConfig()
		result.AccountsProvided = true
	}
	return result
}

// toProviderBuildConfig 转换 Build 通道配置。
func (value settingsConfigDTO) toProviderBuildConfig() settingsapp.ProviderBuildConfig {
	return settingsapp.ProviderBuildConfig{
		BaseURL: value.ProviderBuild.BaseURL, FallbackBaseURL: value.ProviderBuild.FallbackBaseURL,
		ClientVersion: value.ProviderBuild.ClientVersion, ClientIdentifier: value.ProviderBuild.ClientIdentifier,
		TokenAuth: value.ProviderBuild.TokenAuth, UserAgent: value.ProviderBuild.UserAgent,
		ResponseHeaderTimeout: value.ProviderBuild.ResponseHeaderTimeout,
		StreamIdleTimeout:     value.ProviderBuild.StreamIdleTimeout,
	}
}

// toProviderWebConfig 转换 Web 通道配置，并保留清关参数是否被显式提交的信息。
func (value settingsConfigDTO) toProviderWebConfig() settingsapp.ProviderWebConfig {
	clearanceProvided := value.ProviderWeb.ClearanceMode != nil || value.ProviderWeb.FlareSolverrURL != nil ||
		value.ProviderWeb.ClearanceTimeout != nil || value.ProviderWeb.ClearanceRefresh != nil
	return settingsapp.ProviderWebConfig{
		BaseURL: value.ProviderWeb.BaseURL, QuotaTimeout: value.ProviderWeb.QuotaTimeout,
		StatsigMode: value.ProviderWeb.StatsigMode, StatsigManualValue: value.ProviderWeb.StatsigManualValue,
		StatsigManualConfigured: value.ProviderWeb.StatsigManualConfigured, StatsigSignerURL: value.ProviderWeb.StatsigSignerURL,
		ClearanceMode: optionalString(value.ProviderWeb.ClearanceMode), FlareSolverrURL: optionalString(value.ProviderWeb.FlareSolverrURL),
		ClearanceTimeout: optionalString(value.ProviderWeb.ClearanceTimeout), ClearanceRefresh: optionalString(value.ProviderWeb.ClearanceRefresh),
		ClearanceProvided: clearanceProvided,
		ChatTimeout:       value.ProviderWeb.ChatTimeout, StreamIdleTimeout: value.ProviderWeb.StreamIdleTimeout,
		ImageTimeout:     value.ProviderWeb.ImageTimeout,
		VideoTimeout:     value.ProviderWeb.VideoTimeout,
		MediaConcurrency: value.ProviderWeb.MediaConcurrency, AllowNSFW: value.ProviderWeb.AllowNSFW,
		FreeVideoDurationCap:         intValue(value.ProviderWeb.FreeVideoDurationCap),
		FreeVideoDurationCapProvided: value.ProviderWeb.FreeVideoDurationCap != nil,
		RecoveryBackoffBase:          value.ProviderWeb.RecoveryBackoffBase, RecoveryBackoffMax: value.ProviderWeb.RecoveryBackoffMax,
	}
}

// toRoutingConfig 转换路由、冷却与分段选择器开关。
func (value settingsConfigDTO) toRoutingConfig() settingsapp.RoutingConfig {
	return settingsapp.RoutingConfig{
		StickyTTL: value.Routing.StickyTTL, CooldownBase: value.Routing.CooldownBase,
		CooldownMax: value.Routing.CooldownMax, CapacityWait: value.Routing.CapacityWait, MaxAttempts: value.Routing.MaxAttempts, VideoMaxAttempts: value.Routing.VideoMaxAttempts,
		PreferFreeBuild:                     value.Routing.PreferFreeBuild,
		MarkBuildChatDeniedAsReauth:         boolValue(value.Routing.MarkBuildChatDeniedAsReauth),
		MarkBuildChatDeniedAsReauthProvided: value.Routing.MarkBuildChatDeniedAsReauth != nil,
		AccountIsolatedConnections:          boolValue(value.Routing.AccountIsolatedConnections),
		AccountIsolatedConnectionsProvided:  value.Routing.AccountIsolatedConnections != nil,
	}
}

// toAccountsConfig 转换账号自动清理与 Build 封禁重认证配置。
func (value settingsConfigDTO) toAccountsConfig() settingsapp.AccountsConfig {
	return settingsapp.AccountsConfig{
		MarkBuildForbiddenReauth:                     boolValue(value.Accounts.MarkBuildForbiddenReauth),
		BuildForbiddenReauthCodes:                    stringSliceValue(value.Accounts.BuildForbiddenReauthCodes),
		ExcludeBuildBotFlaggedFromScheduling:         boolValue(value.Accounts.ExcludeBuildBotFlaggedFromScheduling),
		MarkBuildForbiddenReauthProvided:             value.Accounts.MarkBuildForbiddenReauth != nil,
		BuildForbiddenReauthCodesProvided:            value.Accounts.BuildForbiddenReauthCodes != nil,
		ExcludeBuildBotFlaggedFromSchedulingProvided: value.Accounts.ExcludeBuildBotFlaggedFromScheduling != nil,
		AutoCleanReauthEnabled:                       value.Accounts.AutoCleanReauthEnabled,
		AutoCleanReauthInterval:                      value.Accounts.AutoCleanReauthInterval,
		AutoCleanReauthMinAge:                        value.Accounts.AutoCleanReauthMinAge,
		AutoCleanIncludeDisabled:                     value.Accounts.AutoCleanIncludeDisabled,
	}
}

func newSettingsResponse(value settingsapp.Snapshot) settingsResponse {
	config := value.Config
	return settingsResponse{
		Config: settingsConfigDTO{
			Server:        serverConfigDTO{MaxConcurrentRequests: config.Server.MaxConcurrentRequests},
			ProviderBuild: newProviderBuildConfigDTO(config.ProviderBuild),
			ProviderWeb:   newProviderWebConfigDTO(config.ProviderWeb),
			ProviderConsole: providerConsoleConfigDTO{
				BaseURL: config.ProviderConsole.BaseURL, ChatTimeout: config.ProviderConsole.ChatTimeout,
				StreamIdleTimeout: config.ProviderConsole.StreamIdleTimeout,
			},
			Batch: batchConfigDTO{
				ImportConcurrency: config.Batch.ImportConcurrency, ConversionConcurrency: config.Batch.ConversionConcurrency,
				SyncConcurrency: config.Batch.SyncConcurrency, RefreshConcurrency: config.Batch.RefreshConcurrency,
				RandomDelay: config.Batch.RandomDelay,
			},
			Media: mediaConfigDTO{
				MaxImageBytes: config.Media.MaxImageBytes, MaxTotalBytes: config.Media.MaxTotalBytes,
				CleanupThresholdPercent: config.Media.CleanupThresholdPercent, CleanupInterval: config.Media.CleanupInterval,
			},
			Frontend: frontendConfigDTO{
				PublicAPIBaseURL: config.Frontend.PublicAPIBaseURL,
			},
			Routing: newRoutingConfigDTO(config.Routing),
			Audit: auditConfigDTO{
				BufferSize: config.Audit.BufferSize, BatchSize: config.Audit.BatchSize, FlushInterval: config.Audit.FlushInterval, CommitDelayMS: config.Audit.CommitDelayMS,
				RetentionDays: intPointer(config.Audit.RetentionDays),
			},
			ClientKeyDefaults: clientKeyDefaultsConfigDTO{
				RPMLimit: config.ClientKeyDefaults.RPMLimit, MaxConcurrent: config.ClientKeyDefaults.MaxConcurrent,
			},
			Accounts: newAccountsConfigDTO(config.Accounts),
		},
		RecommendedProviderBuild: providerBuildRecommendationDTO{
			ClientVersion: value.RecommendedProviderBuild.ClientVersion,
			UserAgent:     value.RecommendedProviderBuild.UserAgent,
		},
		UpdatedAt: value.UpdatedAt, Revision: value.Revision, RestartRequired: value.RestartRequired,
	}
}

// newProviderBuildConfigDTO 转换 Build 通道响应字段，并标记 TokenAuth 是否已配置。
func newProviderBuildConfigDTO(config settingsapp.ProviderBuildConfig) providerBuildConfigDTO {
	return providerBuildConfigDTO{
		BaseURL: config.BaseURL, FallbackBaseURL: config.FallbackBaseURL,
		ClientVersion: config.ClientVersion, ClientIdentifier: config.ClientIdentifier,
		TokenAuth:           config.TokenAuth,
		TokenAuthConfigured: strings.TrimSpace(config.TokenAuth) != "", UserAgent: config.UserAgent,
		ResponseHeaderTimeout: config.ResponseHeaderTimeout,
		StreamIdleTimeout:     config.StreamIdleTimeout,
	}
}

// newProviderWebConfigDTO 转换 Web 通道响应字段，未提交的清关参数返回空指针。
func newProviderWebConfigDTO(config settingsapp.ProviderWebConfig) providerWebConfigDTO {
	return providerWebConfigDTO{
		BaseURL: config.BaseURL, QuotaTimeout: config.QuotaTimeout,
		StatsigMode: config.StatsigMode, StatsigManualConfigured: config.StatsigManualConfigured,
		StatsigSignerURL: config.StatsigSignerURL,
		ClearanceMode:    stringPointer(config.ClearanceMode), FlareSolverrURL: stringPointer(config.FlareSolverrURL),
		ClearanceTimeout: stringPointer(config.ClearanceTimeout), ClearanceRefresh: stringPointer(config.ClearanceRefresh),
		ChatTimeout: config.ChatTimeout, StreamIdleTimeout: config.StreamIdleTimeout,
		ImageTimeout:     config.ImageTimeout,
		VideoTimeout:     config.VideoTimeout,
		MediaConcurrency: config.MediaConcurrency, AllowNSFW: config.AllowNSFW,
		FreeVideoDurationCap: intPointer(config.FreeVideoDurationCap),
		RecoveryBackoffBase:  config.RecoveryBackoffBase, RecoveryBackoffMax: config.RecoveryBackoffMax,
	}
}

// newRoutingConfigDTO 转换路由、冷却与分段选择器响应字段。
func newRoutingConfigDTO(config settingsapp.RoutingConfig) routingConfigDTO {
	return routingConfigDTO{
		StickyTTL: config.StickyTTL, CooldownBase: config.CooldownBase,
		CooldownMax: config.CooldownMax, CapacityWait: config.CapacityWait, MaxAttempts: config.MaxAttempts, VideoMaxAttempts: config.VideoMaxAttempts,
		MarkBuildChatDeniedAsReauth: boolPointer(config.MarkBuildChatDeniedAsReauth),
		PreferFreeBuild:             config.PreferFreeBuild,
		AccountIsolatedConnections:  boolPointer(config.AccountIsolatedConnections),
		SegmentedSelector: &segmentedSelectorConfigDTO{
			Enabled: config.SegmentedSelector.Enabled, MinCandidates: config.SegmentedSelector.MinCandidates,
			WindowSize: config.SegmentedSelector.WindowSize,
		},
	}
}

// newAccountsConfigDTO 转换账号自动清理与 Build 封禁重认证响应字段。
func newAccountsConfigDTO(config settingsapp.AccountsConfig) *accountsConfigDTO {
	return &accountsConfigDTO{
		MarkBuildForbiddenReauth:             boolPointer(config.MarkBuildForbiddenReauth),
		BuildForbiddenReauthCodes:            stringSlicePointer(config.BuildForbiddenReauthCodes),
		ExcludeBuildBotFlaggedFromScheduling: boolPointer(config.ExcludeBuildBotFlaggedFromScheduling),
		AutoCleanReauthEnabled:               config.AutoCleanReauthEnabled,
		AutoCleanReauthInterval:              config.AutoCleanReauthInterval,
		AutoCleanReauthMinAge:                config.AutoCleanReauthMinAge,
		AutoCleanIncludeDisabled:             config.AutoCleanIncludeDisabled,
	}
}

func optionalString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func stringPointer(value string) *string { return &value }

func boolPointer(value bool) *bool { return &value }

func boolValue(value *bool) bool {
	if value == nil {
		return false
	}
	return *value
}

func intPointer(value int) *int { return &value }

func intValue(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func stringSliceValue(value *[]string) []string {
	if value == nil {
		return nil
	}
	return append([]string(nil), (*value)...)
}

func stringSlicePointer(value []string) *[]string {
	cloned := append([]string(nil), value...)
	return &cloned
}
