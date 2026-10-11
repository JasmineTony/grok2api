package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"

	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	settingsdomain "github.com/chenyme/grok2api/backend/internal/domain/settings"
	"github.com/chenyme/grok2api/backend/internal/pkg/signerurl"
)

// Validate 校验启动所需的安全配置和运行边界。
func (c Config) Validate() error {
	if strings.TrimSpace(c.Server.Listen) == "" {
		return errors.New("server.listen 不能为空")
	}
	if c.Server.MaxBodyBytes <= 0 || c.Server.MaxBodyBytes > maxServerBodyBytes {
		return fmt.Errorf("server.maxBodyBytes 必须在 1 到 %d 字节之间", maxServerBodyBytes)
	}
	if c.Server.ReadTimeout.Value() <= 0 || c.Server.ReadTimeout.Value() > maxReadTimeout {
		return errors.New("server.readTimeout 必须大于零且不超过 1 小时")
	}
	if c.Server.RequestTimeout.Value() <= 0 || c.Server.RequestTimeout.Value() > maxRequestTimeout {
		return errors.New("server.requestTimeout 必须大于零且不超过 24 小时")
	}
	if c.Server.MaxConcurrentRequests < 1 || c.Server.MaxConcurrentRequests > 100000 {
		return errors.New("server.maxConcurrentRequests 必须在 1 到 100000 之间")
	}
	for _, value := range c.Server.TrustedProxies {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return errors.New("server.trustedProxies 不能包含空值")
		}
		if trimmed != value {
			return fmt.Errorf("server.trustedProxies %q 不能包含首尾空白", value)
		}
		if net.ParseIP(trimmed) != nil {
			continue
		}
		_, network, err := net.ParseCIDR(trimmed)
		if err != nil {
			return fmt.Errorf("server.trustedProxies %q 必须是 IP 或 CIDR", value)
		}
		if ones, _ := network.Mask.Size(); ones == 0 {
			return fmt.Errorf("server.trustedProxies %q 不能信任整个互联网", value)
		}
	}
	for _, item := range []struct {
		name  string
		value string
	}{
		{name: "frontend.publicApiBaseURL", value: c.Frontend.PublicAPIBaseURL},
		{name: "frontend.publicApiBaseURL 运行设置", value: c.Frontend.PublicAPIBaseURLOverride},
	} {
		if publicBase := strings.TrimSpace(item.value); publicBase != "" {
			publicAPIURL, err := url.ParseRequestURI(publicBase)
			if err != nil || (publicAPIURL.Scheme != "http" && publicAPIURL.Scheme != "https") || publicAPIURL.Host == "" || publicAPIURL.User != nil || publicAPIURL.RawQuery != "" || publicAPIURL.Fragment != "" {
				return fmt.Errorf("%s 必须是不含凭据、查询参数和片段的 HTTP(S) URL", item.name)
			}
		}
	}
	switch c.Database.Driver {
	case "sqlite":
		if strings.TrimSpace(c.Database.SQLite.Path) == "" {
			return errors.New("database.sqlite.path 不能为空")
		}
	case "postgres":
		if strings.TrimSpace(c.Database.Postgres.DSN) == "" {
			return errors.New("database.postgres.dsn 不能为空")
		}
		if c.Database.Postgres.MaxOpenConns < 1 || c.Database.Postgres.MaxOpenConns > 1000 || c.Database.Postgres.MaxIdleConns < 0 || c.Database.Postgres.MaxIdleConns > c.Database.Postgres.MaxOpenConns {
			return errors.New("database.postgres 连接池配置无效")
		}
	default:
		return errors.New("database.driver 必须是 sqlite 或 postgres")
	}
	switch c.RuntimeStore.Driver {
	case "memory":
	case "redis":
		if strings.TrimSpace(c.RuntimeStore.Redis.Address) == "" {
			return errors.New("runtimeStore.redis.address 不能为空")
		}
		if c.RuntimeStore.Redis.Database < 0 || c.RuntimeStore.Redis.Database > 1024 {
			return errors.New("runtimeStore.redis.database 必须在 0 到 1024 之间")
		}
		if prefix := strings.TrimSpace(c.RuntimeStore.Redis.KeyPrefix); prefix == "" || len(prefix) > 128 {
			return errors.New("runtimeStore.redis.keyPrefix 必须在 1 到 128 个字符之间")
		}
	default:
		return errors.New("runtimeStore.driver 必须是 memory 或 redis")
	}
	if c.Deployment.Replicas < 1 || c.Deployment.Replicas > maxDeploymentReplicas {
		return fmt.Errorf("deployment.replicas 必须在 1 到 %d 之间", maxDeploymentReplicas)
	}
	if c.Deployment.Replicas > 1 {
		if c.Database.Driver != "postgres" {
			return errors.New("多实例部署必须使用 PostgreSQL")
		}
		if c.RuntimeStore.Driver != "redis" {
			return errors.New("多实例部署必须使用 Redis 运行态存储")
		}
		if strings.TrimSpace(c.Deployment.InstanceID) == "" {
			return errors.New("多实例部署必须配置 deployment.instanceID")
		}
		if strings.TrimSpace(c.Deployment.ClusterID) == "" {
			return errors.New("多实例部署必须配置 deployment.clusterID")
		}
		if !c.Deployment.SharedMedia {
			return errors.New("多实例部署必须确认 deployment.sharedMedia=true 并挂载共享媒体目录")
		}
	}
	if c.Media.Driver != "local" {
		return errors.New("media.driver 当前仅支持 local")
	}
	if strings.TrimSpace(c.Media.Local.Path) == "" {
		return errors.New("media.local.path 不能为空")
	}
	if c.Media.MaxImageBytes < 1<<20 || c.Media.MaxImageBytes > 32<<20 {
		return errors.New("media.maxImageBytes 必须在 1 MiB 到 32 MiB 之间")
	}
	if c.Media.MaxTotalBytes < c.Media.MaxImageBytes || c.Media.MaxTotalBytes > 1<<40 {
		return errors.New("media.maxTotalBytes 必须不小于单图上限且不超过 1 TiB")
	}
	if c.Media.CleanupThresholdPercent < 50 || c.Media.CleanupThresholdPercent > 95 {
		return errors.New("media.cleanupThresholdPercent 必须在 50 到 95 之间")
	}
	if c.Media.CleanupInterval.Value() < time.Minute || c.Media.CleanupInterval.Value() > 24*time.Hour {
		return errors.New("media.cleanupInterval 必须在 1 分钟到 24 小时之间")
	}
	if len(c.Secrets.JWTSecret) < 32 {
		return errors.New("secrets.jwtSecret 至少需要 32 个字符")
	}
	if isExampleSecret(c.Secrets.JWTSecret) {
		return errors.New("secrets.jwtSecret 不能使用示例占位值")
	}
	if !validCredentialEncryptionKey(c.Secrets.CredentialEncryptionKey) {
		return errors.New("secrets.credentialEncryptionKey 必须是 Base64 编码的 32 字节密钥")
	}
	if isExampleSecret(c.BootstrapAdmin.Password) {
		return errors.New("bootstrapAdmin.password 不能使用示例占位值")
	}
	if c.Auth.AccessTokenTTL.Value() <= 0 || c.Auth.RefreshTokenTTL.Value() <= 0 {
		return errors.New("JWT 有效期必须大于零")
	}
	if err := validateAPIBaseURL("provider.build.baseURL", c.Provider.Build.BaseURL, false); err != nil {
		return err
	}
	fallbackBase := strings.TrimSpace(c.Provider.Build.FallbackBaseURL)
	if fallbackBase == "" {
		fallbackBase = DefaultBuildFallbackBaseURL
	}
	if err := validateAPIBaseURL("provider.build.fallbackBaseURL", fallbackBase, true); err != nil {
		return err
	}
	if strings.TrimSpace(c.Provider.Build.ClientVersion) == "" || strings.TrimSpace(c.Provider.Build.ClientIdentifier) == "" || strings.TrimSpace(c.Provider.Build.TokenAuth) == "" || strings.TrimSpace(c.Provider.Build.UserAgent) == "" {
		return errors.New("provider.build 客户端标识不能为空")
	}
	if timeout := c.Provider.Build.ResponseHeaderTimeout.Value(); timeout < settingsdomain.MinBuildResponseHeaderTimeout || timeout > settingsdomain.MaxBuildResponseHeaderTimeout {
		return errors.New("Grok Build 响应头超时必须在 30 秒到 30 分钟之间")
	}
	if idle := c.Provider.Build.StreamIdleTimeout.Value(); idle < settingsdomain.MinBuildStreamIdleTimeout || idle > settingsdomain.MaxBuildStreamIdleTimeout {
		return errors.New("Grok Build 流式空闲超时必须在 30 秒到 10 分钟之间")
	}
	webURL, err := url.ParseRequestURI(strings.TrimSpace(c.Provider.Web.BaseURL))
	if err != nil || webURL.Scheme != "https" || webURL.Host == "" || webURL.User != nil {
		return errors.New("provider.web.baseURL 必须是无凭据的 HTTPS URL")
	}
	switch c.Provider.Web.StatsigMode {
	case StatsigModeManual:
		if !validStatsigID(c.Provider.Web.StatsigManualValue) {
			return errors.New("provider.web 手动 x-statsig-id 格式无效")
		}
	case StatsigModeURL:
		if err := signerurl.Validate(c.Provider.Web.StatsigSignerURL); err != nil {
			return fmt.Errorf("provider.web Statsig 签名 URL 无效: %w", err)
		}
	default:
		return errors.New("provider.web Statsig 模式必须是 manual 或 url")
	}
	switch c.Provider.Web.ClearanceMode {
	case ClearanceModeManual:
	case ClearanceModeFlareSolverr, ClearanceModeOnDemand:
		if err := validateFlareSolverrURL(c.Provider.Web.FlareSolverrURL); err != nil {
			return fmt.Errorf("provider.web FlareSolverr URL 无效: %w", err)
		}
	default:
		return errors.New("provider.web Clearance 模式必须是 manual、flaresolverr 或 on_demand")
	}
	if c.Provider.Web.ClearanceTimeout.Value() < 10*time.Second || c.Provider.Web.ClearanceTimeout.Value() > 5*time.Minute {
		return errors.New("provider.web Clearance 超时必须在 10 秒到 5 分钟之间")
	}
	if c.Provider.Web.ClearanceRefresh.Value() < time.Minute || c.Provider.Web.ClearanceRefresh.Value() > 24*time.Hour {
		return errors.New("provider.web Clearance 刷新间隔必须在 1 分钟到 24 小时之间")
	}
	if c.Provider.Web.QuotaTimeout.Value() < time.Second || c.Provider.Web.QuotaTimeout.Value() > 2*time.Minute ||
		c.Provider.Web.ChatTimeout.Value() < 5*time.Second || c.Provider.Web.ChatTimeout.Value() > 30*time.Minute ||
		c.Provider.Web.ImageTimeout.Value() < 5*time.Second || c.Provider.Web.ImageTimeout.Value() > 30*time.Minute ||
		c.Provider.Web.VideoTimeout.Value() < time.Minute || c.Provider.Web.VideoTimeout.Value() > 2*time.Hour {
		return errors.New("provider.web 上游超时配置无效")
	}
	if idle := c.Provider.Web.StreamIdleTimeout.Value(); idle < settingsdomain.MinProviderStreamIdleTimeout || idle > settingsdomain.MaxProviderStreamIdleTimeout {
		return errors.New("Grok Web 流式空闲超时必须在 30 秒到 10 分钟之间")
	}
	if c.Provider.Web.MediaConcurrency < 1 || c.Provider.Web.MediaConcurrency > 64 {
		return errors.New("provider.web 媒体并发必须在 1 到 64 之间")
	}
	if c.Provider.Web.FreeVideoDurationCap != 0 && (c.Provider.Web.FreeVideoDurationCap < settingsdomain.MinWebFreeVideoDurationCap || c.Provider.Web.FreeVideoDurationCap > settingsdomain.MaxWebFreeVideoDurationCap) {
		return errors.New("provider.web free 视频时长上限必须在 1 到 15 秒之间")
	}
	consoleURL, err := url.ParseRequestURI(strings.TrimSpace(c.Provider.Console.BaseURL))
	if err != nil || consoleURL.Scheme != "https" || consoleURL.Host == "" || consoleURL.User != nil {
		return errors.New("provider.console.baseURL 必须是无凭据的 HTTPS URL")
	}
	if c.Provider.Console.ChatTimeout.Value() < 5*time.Second || c.Provider.Console.ChatTimeout.Value() > 30*time.Minute {
		return errors.New("provider.console.chatTimeout 必须在 5 秒到 30 分钟之间")
	}
	if idle := c.Provider.Console.StreamIdleTimeout.Value(); idle < settingsdomain.MinProviderStreamIdleTimeout || idle > settingsdomain.MaxProviderStreamIdleTimeout {
		return errors.New("Grok Console 流式空闲超时必须在 30 秒到 10 分钟之间")
	}
	if c.Batch.ImportConcurrency < 1 || c.Batch.ImportConcurrency > 50 ||
		c.Batch.ConversionConcurrency < 1 || c.Batch.ConversionConcurrency > 50 ||
		c.Batch.SyncConcurrency < 1 || c.Batch.SyncConcurrency > 50 ||
		c.Batch.RefreshConcurrency < 1 || c.Batch.RefreshConcurrency > 50 {
		return errors.New("批量任务并发必须在 1 到 50 之间")
	}
	if c.Batch.RandomDelay.Value() < 0 || c.Batch.RandomDelay.Value() > 5*time.Second {
		return errors.New("批量任务随机延迟必须在 0 到 5 秒之间")
	}
	if c.Provider.Web.RecoveryBackoffBase.Value() < 5*time.Second || c.Provider.Web.RecoveryBackoffMax.Value() < c.Provider.Web.RecoveryBackoffBase.Value() || c.Provider.Web.RecoveryBackoffMax.Value() > 6*time.Hour {
		return errors.New("provider.web 恢复退避配置无效")
	}
	if c.Routing.StickyTTL.Value() <= 0 || c.Routing.StickyTTL.Value() > maxRoutingTTL || c.Routing.CooldownBase.Value() <= 0 || c.Routing.CooldownMax.Value() < c.Routing.CooldownBase.Value() || c.Routing.CooldownMax.Value() > maxRoutingCooldown || c.Routing.CapacityWait.Value() <= 0 || c.Routing.CapacityWait.Value() > maxRoutingCapacityWait || (c.Routing.MaxAttempts < unlimitedRoutingAttempts || c.Routing.MaxAttempts == 0 || c.Routing.MaxAttempts > maxRoutingAttempts) || (c.Routing.VideoMaxAttempts < unlimitedRoutingAttempts || c.Routing.VideoMaxAttempts > maxRoutingAttempts) {
		return errors.New("routing 配置无效")
	}
	if c.Routing.SegmentedMinCandidates < 100 || c.Routing.SegmentedMinCandidates > 1000000 ||
		c.Routing.SegmentedWindowSize < 8 || c.Routing.SegmentedWindowSize > 256 ||
		c.Routing.SegmentedWindowSize > c.Routing.SegmentedMinCandidates {
		return errors.New("routing segmented selector 配置无效")
	}
	if c.Routing.ReasoningReplayTTL.Value() <= 0 || c.Routing.ReasoningReplayTTL.Value() > 24*time.Hour {
		return errors.New("routing.reasoningReplayTTL 必须在 1 纳秒到 24 小时之间")
	}
	if c.Routing.ReasoningReplayMaxEntries < 100 || c.Routing.ReasoningReplayMaxEntries > 1000000 {
		return errors.New("routing.reasoningReplayMaxEntries 必须在 100 到 1000000 之间")
	}
	if !validAutoAssignShare(c.Routing.AutoAssignMaxNodeShare) || !validAutoAssignShare(c.Routing.AutoAssignMaxMigrationShare) {
		return errors.New("routing.autoAssignMaxNodeShare 与 autoAssignMaxMigrationShare 必须为 0 或 0.05 到 1 之间")
	}
	if c.Audit.BufferSize < 1 || c.Audit.BufferSize > maxAuditBufferSize || c.Audit.BatchSize < 1 || c.Audit.BatchSize > maxAuditBatchSize || c.Audit.BatchSize > c.Audit.BufferSize || c.Audit.FlushInterval.Value() < minAuditFlushInterval || c.Audit.FlushInterval.Value() > maxAuditFlushInterval {
		return errors.New("audit 队列和批量写入配置无效")
	}
	if c.Audit.CommitDelay.Value() < minAuditCommitDelay || c.Audit.CommitDelay.Value() > maxAuditCommitDelay {
		return errors.New("audit.commitDelay 必须在 1ms 到 50ms 之间")
	}
	if c.Audit.RetentionDays < 0 || c.Audit.RetentionDays > 365 {
		return errors.New("audit.retentionDays 必须在 0 到 365 之间")
	}
	if c.Audit.LedgerMode != "observe" && c.Audit.LedgerMode != "enforce" {
		return errors.New("audit.ledgerMode 必须是 observe 或 enforce")
	}
	if c.Audit.LedgerFailureThreshold < 1 || c.Audit.LedgerFailureThreshold > 100 {
		return errors.New("audit.ledgerFailureThreshold 必须在 1 到 100 之间")
	}
	if c.Audit.LedgerUnhealthyGrace.Value() < time.Second || c.Audit.LedgerUnhealthyGrace.Value() > 10*time.Minute {
		return errors.New("audit.ledgerUnhealthyGrace 必须在 1 秒到 10 分钟之间")
	}
	if c.Audit.LedgerQueueHighWatermarkPct < 50 || c.Audit.LedgerQueueHighWatermarkPct > 100 {
		return errors.New("audit.ledgerQueueHighWatermarkPercent 必须在 50 到 100 之间")
	}
	if err := validateQualityGuardConfig(c.QualityGuard); err != nil {
		return err
	}
	if c.ClientKeyDefaults.RPMLimit < 1 || c.ClientKeyDefaults.RPMLimit > clientkeydomain.MaxRPMLimit || c.ClientKeyDefaults.MaxConcurrent < 1 || c.ClientKeyDefaults.MaxConcurrent > clientkeydomain.MaxConcurrent {
		return errors.New("clientKeyDefaults 超出允许范围")
	}
	if c.Accounts.AutoCleanReauthInterval.Value() < time.Minute || c.Accounts.AutoCleanReauthInterval.Value() > time.Hour {
		return errors.New("accounts.autoCleanReauthInterval 必须在 1 分钟到 1 小时之间")
	}
	if c.Accounts.AutoCleanReauthMinAge.Value() < time.Minute || c.Accounts.AutoCleanReauthMinAge.Value() > 30*24*time.Hour {
		return errors.New("accounts.autoCleanReauthMinAge 必须在 1 分钟到 30 天之间")
	}
	if len(c.Accounts.BuildForbiddenReauthCodes) > 32 {
		return errors.New("accounts.buildForbiddenReauthCodes 最多支持 32 个错误码")
	}
	for _, code := range c.Accounts.BuildForbiddenReauthCodes {
		if !buildForbiddenCodePattern.MatchString(strings.TrimSpace(code)) {
			return errors.New("accounts.buildForbiddenReauthCodes 包含无效错误码")
		}
	}
	if len(c.Accounts.BuildForbiddenReauthCodes) == 0 {
		return errors.New("accounts.buildForbiddenReauthCodes 至少需要一个错误码")
	}
	return nil
}

func validAutoAssignShare(value float64) bool {
	return value == 0 || (value >= 0.05 && value <= 1)
}

func validUniquePositiveIDs(values []uint64) bool {
	seen := make(map[uint64]struct{}, len(values))
	for _, value := range values {
		if value == 0 {
			return false
		}
		if _, exists := seen[value]; exists {
			return false
		}
		seen[value] = struct{}{}
	}
	return true
}

// validateAPIBaseURL 仅允许无凭据、query、fragment 的 HTTP(S) API 根地址。
// requireHTTPS 为 true 时强制 HTTPS（用于生产默认 XAI 备用地址）。
func validateAPIBaseURL(name, raw string, requireHTTPS bool) error {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("%s 必须是不含凭据、查询参数和片段的 HTTP(S) URL", name)
	}
	switch parsed.Scheme {
	case "https":
		return nil
	case "http":
		if requireHTTPS {
			return fmt.Errorf("%s 必须是 HTTPS URL", name)
		}
		return nil
	default:
		return fmt.Errorf("%s 必须是不含凭据、查询参数和片段的 HTTP(S) URL", name)
	}
}

func validateFlareSolverrURL(value string) error {
	if err := signerurl.Validate(value); err != nil {
		return errors.New(strings.ReplaceAll(err.Error(), "签名 URL", "URL"))
	}
	return nil
}

func validStatsigID(value string) bool {
	value = strings.TrimSpace(value)
	decoded, err := base64.RawStdEncoding.DecodeString(value)
	if err != nil {
		decoded, err = base64.StdEncoding.DecodeString(value)
	}
	return err == nil && len(decoded) == 70
}

func validCredentialEncryptionKey(value string) bool {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(value))
	return err == nil && len(decoded) == 32
}

func isExampleSecret(value string) bool {
	switch strings.TrimSpace(value) {
	case "replace-with-at-least-32-characters", "replace-with-base64-key", "replace-with-a-strong-password":
		return true
	default:
		return false
	}
}
