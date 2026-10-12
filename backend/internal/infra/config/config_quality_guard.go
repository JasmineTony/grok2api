package config

import (
	"errors"
	"net/url"
	"strings"
	"time"
)

func validateQualityGuardConfig(value QualityGuardConfig) error {
	if err := validateQualityGuardRequestRetry(value.RequestRetry); err != nil {
		return err
	}
	if !value.Enabled {
		return nil
	}
	if err := validateQualityGuardIdentity(value); err != nil {
		return err
	}
	if err := validateQualityGuardLimits(value); err != nil {
		return err
	}
	return validateQualityGuardRotation(value)
}

// validateQualityGuardIdentity 校验受管节点、探测模型、运行模式与探测周期。
func validateQualityGuardIdentity(value QualityGuardConfig) error {
	if !validUniquePositiveIDs(value.NodeIDs) || !validUniquePositiveIDs(value.RotatableNodeIDs) {
		return errors.New("qualityGuard.nodeIDs 和 rotatableNodeIDs 必须是唯一的正整数")
	}
	if strings.TrimSpace(value.Model) == "" {
		return errors.New("qualityGuard.model 不能为空")
	}
	if value.Mode != "active" && value.Mode != "passive" && value.Mode != "hybrid" {
		return errors.New("qualityGuard.mode 必须是 active、passive 或 hybrid")
	}
	if value.ActiveInterval.Value() < time.Minute || value.ActiveInterval.Value() > 24*time.Hour {
		return errors.New("qualityGuard.activeInterval 必须在 1 分钟到 24 小时之间")
	}
	if value.PassivePollInterval.Value() < time.Second || value.PassivePollInterval.Value() > 5*time.Minute {
		return errors.New("qualityGuard.passivePollInterval 必须在 1 秒到 5 分钟之间")
	}
	return nil
}

// validateQualityGuardLimits 校验质量判定阈值、隔离策略与轮换超时。
func validateQualityGuardLimits(value QualityGuardConfig) error {
	if value.SoftTPS < 1 || value.HardTPS <= value.SoftTPS || value.HardTPS > 10000 {
		return errors.New("qualityGuard TPS 阈值无效")
	}
	if value.ConsecutiveSoft < 1 || value.ConsecutiveSoft > 20 || value.ConsecutiveErrors < 1 || value.ConsecutiveErrors > 20 {
		return errors.New("qualityGuard 连续异常次数必须在 1 到 20 之间")
	}
	if value.QuarantineDuration.Value() < 30*time.Second || value.QuarantineDuration.Value() > 24*time.Hour || value.NoAccountBackoff.Value() < 30*time.Second || value.NoAccountBackoff.Value() > 24*time.Hour {
		return errors.New("qualityGuard 隔离和无账号退避时间必须在 30 秒到 24 小时之间")
	}
	if value.MinimumHealthyNodes < 1 || (len(value.NodeIDs) > 0 && value.MinimumHealthyNodes > len(value.NodeIDs)) {
		return errors.New("qualityGuard.minimumHealthyNodes 与受管节点数量不匹配")
	}
	if value.MaxOutputTokens < 32 || value.MaxOutputTokens > 4096 {
		return errors.New("qualityGuard.maxOutputTokens 必须在 32 到 4096 之间")
	}
	if value.MinimumGenerationWindow.Value() < time.Millisecond || value.MinimumGenerationWindow.Value() > 2*time.Minute {
		return errors.New("qualityGuard.minimumGenerationWindow 必须在 1 毫秒到 2 分钟之间")
	}
	if value.RotationTimeout.Value() < 5*time.Second || value.RotationTimeout.Value() > 5*time.Minute {
		return errors.New("qualityGuard.rotationTimeout 必须在 5 秒到 5 分钟之间")
	}
	return nil
}

// validateQualityGuardRotation 校验节点轮换地址。
func validateQualityGuardRotation(value QualityGuardConfig) error {
	if len(value.RotatableNodeIDs) > 0 && strings.TrimSpace(value.RotationURL) == "" {
		return errors.New("qualityGuard.rotatableNodeIDs 非空时必须配置 rotationURL")
	}
	if raw := strings.TrimSpace(value.RotationURL); raw != "" {
		parsed, err := url.ParseRequestURI(raw)
		if err != nil || parsed.Host == "" || parsed.User != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return errors.New("qualityGuard.rotationURL 必须是无凭据的 HTTP(S) URL")
		}
	}
	return nil
}

func validateQualityGuardRequestRetry(value QualityGuardRequestRetryConfig) error {
	if !value.Enabled {
		return nil
	}
	if value.MaxAttempts != 0 && (value.MaxAttempts < 1 || value.MaxAttempts > 6) {
		return errors.New("qualityGuard.requestRetry.maxAttempts 必须在 1 到 6 之间")
	}
	if d := value.HoldTimeout.Value(); d != 0 && (d < 200*time.Millisecond || d > 30*time.Second) {
		return errors.New("qualityGuard.requestRetry.holdTimeout 必须在 200ms 到 30s 之间")
	}
	if value.MinOutputTokens != 0 && (value.MinOutputTokens < 8 || value.MinOutputTokens > 256) {
		return errors.New("qualityGuard.requestRetry.minOutputTokens 必须在 8 到 256 之间")
	}
	switch strings.TrimSpace(value.OnExhausted) {
	case "", "fail_open", "fail_closed":
	default:
		return errors.New("qualityGuard.requestRetry.onExhausted 必须是 fail_open 或 fail_closed")
	}
	if d := value.AccountCooldown.Value(); d != 0 && (d < time.Minute || d > 168*time.Hour) {
		return errors.New("qualityGuard.requestRetry.accountCooldown 必须在 1m 到 168h 之间")
	}
	if d := value.IdleAccountCooldown.Value(); d != 0 && (d < time.Minute || d > 168*time.Hour) {
		return errors.New("qualityGuard.requestRetry.idleAccountCooldown 必须在 1m 到 168h 之间")
	}
	if value.MinEncryptedBytes != 0 && (value.MinEncryptedBytes < 64 || value.MinEncryptedBytes > 4096) {
		return errors.New("qualityGuard.requestRetry.minEncryptedBytes 必须在 64 到 4096 之间")
	}
	if value.EncryptedBytesPerReasoningToken != 0 && (value.EncryptedBytesPerReasoningToken < 1 || value.EncryptedBytesPerReasoningToken > 16) {
		return errors.New("qualityGuard.requestRetry.encryptedBytesPerReasoningToken 必须在 1 到 16 之间")
	}
	return nil
}
