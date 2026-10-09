package account

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

func (s *Service) MarkReauthRequired(ctx context.Context, id uint64, reason string) error {
	value, err := s.accounts.Get(ctx, id)
	if err != nil {
		return mapRepositoryError(err)
	}
	value.AuthStatus = accountdomain.AuthStatusReauthRequired
	value.LastError = reason
	if len(value.LastError) > 512 {
		value.LastError = value.LastError[:512]
	}
	if _, err := s.accounts.Update(ctx, value); err != nil {
		return mapRepositoryError(err)
	}
	if s.sticky != nil {
		_ = s.sticky.DeleteByAccount(ctx, id)
	}
	return nil
}

// markSSOCredentialRejected 在上游明确返回 401 后可靠持久化失效状态。
// 状态写入不继承客户端取消，避免已经确认失效的账号因请求断开继续留在号池。
func (s *Service) markSSOCredentialRejected(ctx context.Context, value accountdomain.Credential, reason string) error {
	if value.AuthType != accountdomain.AuthTypeSSO {
		return nil
	}
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), credentialStateWriteTimeout)
	defer cancel()
	if err := s.MarkReauthRequired(writeCtx, value.ID, reason); err != nil {
		s.logger.Error("account_reauth_required_write_failed", "account_id", value.ID, "provider", value.Provider, "error", err)
		return err
	}
	return nil
}

// EnsureCredential 在即将过期时刷新 token，同一账号并发请求只执行一次刷新。
func (s *Service) EnsureCredential(ctx context.Context, value accountdomain.Credential, force bool) (accountdomain.Credential, error) {
	return s.ensureCredential(ctx, value, ensureCredentialOptions{force: force})
}

type ensureCredentialOptions struct {
	force              bool
	bypassCooldown     bool
	respectSchedule    bool
	retryPermanentOnce bool
}

func (s *Service) ensureCredential(ctx context.Context, value accountdomain.Credential, options ensureCredentialOptions) (accountdomain.Credential, error) {
	if s.providers == nil || !s.providers.SupportsCredentialRefresh(value.Provider) {
		if options.force {
			return accountdomain.Credential{}, ErrUnsupported
		}
		return value, nil
	}
	now := s.now()
	if credential, err, handled := s.resolvePermanentRefreshFailure(ctx, value, now, options.force, options.retryPermanentOnce); handled {
		return credential, err
	}
	if !options.force && value.ExpiresAt.IsZero() && value.EncryptedAccessToken != "" {
		return value, nil
	}
	if !options.force && value.EncryptedAccessToken != "" && !value.ExpiresAt.IsZero() && now.Add(credentialRefreshAdvance).Before(value.ExpiresAt) {
		return value, nil
	}
	refreshKey := strconv.FormatUint(value.ID, 10)
	if options.respectSchedule {
		refreshKey += ":scheduled"
	}
	if options.retryPermanentOnce {
		refreshKey += ":manual-retry"
	}
	result, err, _ := s.refreshes.Do(refreshKey, func() (any, error) {
		latest, err := s.accounts.Get(ctx, value.ID)
		if err != nil {
			return nil, err
		}
		currentTime := s.now()
		if credential, err, handled := s.resolvePermanentRefreshFailure(ctx, latest, currentTime, options.force, options.retryPermanentOnce); handled {
			if err != nil {
				return nil, err
			}
			return credential, nil
		}
		if options.respectSchedule && latest.RefreshDueAt != nil && latest.RefreshDueAt.After(currentTime) {
			return latest, nil
		}
		if options.force && latest.EncryptedAccessToken != "" && latest.EncryptedAccessToken != value.EncryptedAccessToken {
			return latest, nil
		}
		if !options.force && latest.EncryptedAccessToken != "" && !latest.ExpiresAt.IsZero() && currentTime.Add(credentialRefreshAdvance).Before(latest.ExpiresAt) {
			return latest, nil
		}
		if options.force && !options.bypassCooldown && s.credentialRefreshCoolingDown(latest, currentTime) {
			return latest, nil
		}
		release, err := s.acquireRefreshLock(ctx, latest.ID)
		if err != nil {
			return nil, err
		}
		if release != nil {
			defer release()
			latest, err = s.accounts.Get(ctx, value.ID)
			if err != nil {
				return nil, err
			}
			currentTime = s.now()
			if credential, err, handled := s.resolvePermanentRefreshFailure(ctx, latest, currentTime, options.force, options.retryPermanentOnce); handled {
				if err != nil {
					return nil, err
				}
				return credential, nil
			}
			if options.respectSchedule && latest.RefreshDueAt != nil && latest.RefreshDueAt.After(currentTime) {
				return latest, nil
			}
			if options.force && !options.bypassCooldown && s.credentialRefreshCoolingDown(latest, currentTime) {
				return latest, nil
			}
			if latest.EncryptedAccessToken != "" && latest.EncryptedAccessToken != value.EncryptedAccessToken {
				return latest, nil
			}
			if !options.force && latest.EncryptedAccessToken != "" && !latest.ExpiresAt.IsZero() && currentTime.Add(credentialRefreshAdvance).Before(latest.ExpiresAt) {
				return latest, nil
			}
		}
		adapter, ok := s.providers.CredentialRefresh(latest.Provider)
		if !ok {
			return nil, fmt.Errorf("Provider %s 未注册", latest.Provider)
		}
		refreshed, err := adapter.RefreshCredential(ctx, latest)
		if err != nil {
			persistCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), credentialRefreshStateTTL)
			s.recordCredentialRefreshFailure(persistCtx, latest, err, !options.retryPermanentOnce, release != nil)
			cancel()
			return nil, err
		}
		riskCredential := latest
		riskCredential.EncryptedAccessToken = refreshed.EncryptedAccessToken
		botFlagSource := latest.BuildBotFlagSource
		if metadata := s.credentialMetadata(riskCredential); metadata.BuildBotFlagInspected {
			botFlagSource = metadata.BuildBotFlagSource
		}
		persistCtx, cancelPersist := context.WithTimeout(context.WithoutCancel(ctx), credentialStateWriteTimeout)
		updated, err := s.accounts.UpdateTokens(persistCtx, latest.ID, refreshed.EncryptedAccessToken, refreshed.EncryptedRefreshToken, refreshed.ExpiresAt, botFlagSource)
		cancelPersist()
		if err != nil {
			s.logger.Error("credential_refresh_token_write_failed",
				"account_id", latest.ID,
				"provider", latest.Provider,
				"refresh_token_rotated", refreshed.RefreshTokenRotated,
				"egress_node_id", latest.EgressNodeID,
				"build_api_fallback_marked", latest.BuildAPIFallback,
				"distributed_lock", release != nil,
				"error", err,
			)
			return nil, err
		}
		s.invalidateBuildBotFlagCache()
		s.markRefreshSuccess(latest.ID, currentTime)
		s.WakeCredentialRefresh()
		return updated, nil
	})
	if err != nil {
		return accountdomain.Credential{}, err
	}
	credential, ok := result.(accountdomain.Credential)
	if !ok {
		return accountdomain.Credential{}, fmt.Errorf("账号凭据刷新返回类型无效")
	}
	return credential, nil
}

// acquireRefreshLock 在 Redis 模式下等待其他实例完成刷新，锁租约过期后可自动接管。
func (s *Service) acquireRefreshLock(ctx context.Context, accountID uint64) (func(), error) {
	if s.refreshLock == nil {
		return nil, nil
	}
	key := "credential-refresh:" + strconv.FormatUint(accountID, 10)
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		release, acquired, err := s.refreshLock.Acquire(ctx, key, 2*time.Minute)
		if err != nil {
			return nil, err
		}
		if acquired {
			return release, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (s *Service) RefreshToken(ctx context.Context, id uint64) (View, error) {
	value, err := s.accounts.Get(ctx, id)
	if err != nil {
		return View{}, mapRepositoryError(err)
	}
	if _, err := s.ensureCredential(ctx, value, ensureCredentialOptions{force: true, bypassCooldown: true, retryPermanentOnce: true}); err != nil {
		return View{}, err
	}
	return s.Get(ctx, id)
}

func (s *Service) refreshCoolingDown(accountID uint64, now time.Time) bool {
	s.refreshMu.Lock()
	defer s.refreshMu.Unlock()
	last := s.lastRefreshAt[accountID]
	return !last.IsZero() && now.Sub(last) < forcedRefreshMinInterval
}

func (s *Service) credentialRefreshCoolingDown(credential accountdomain.Credential, now time.Time) bool {
	if credential.LastRefreshAt != nil {
		age := now.Sub(*credential.LastRefreshAt)
		if age >= 0 && age < forcedRefreshMinInterval {
			return true
		}
	}
	return s.refreshCoolingDown(credential.ID, now)
}

func (s *Service) markRefreshSuccess(accountID uint64, now time.Time) {
	s.refreshMu.Lock()
	s.lastRefreshAt[accountID] = now
	s.refreshMu.Unlock()
}

func (s *Service) clearRefreshState(accountID uint64) {
	s.refreshMu.Lock()
	delete(s.lastRefreshAt, accountID)
	s.refreshMu.Unlock()
}

func (s *Service) recordCredentialRefreshFailure(ctx context.Context, credential accountdomain.Credential, refreshErr error, preservePermanent, distributedLock bool) {
	if errors.Is(refreshErr, context.Canceled) || errors.Is(refreshErr, context.DeadlineExceeded) && errors.Is(ctx.Err(), context.Canceled) {
		return
	}
	failureCount := credential.RefreshFailureCount + 1
	errorCode := "oauth_transport_error"
	errorMessage := "OAuth request failed"
	errorStatus := 0
	errorResponse := ""
	permanent := false
	retryAfter := time.Duration(0)
	var typed *provider.CredentialRefreshError
	if errors.As(refreshErr, &typed) {
		errorCode = strings.TrimSpace(typed.Code)
		if errorCode == "" {
			errorCode = "oauth_refresh_error"
		}
		errorStatus = typed.Status
		permanent = typed.Permanent
		retryAfter = typed.RetryAfter
		if message := normalizeCredentialRefreshErrorMessage(typed.Message); message != "" {
			errorMessage = message
		}
		errorResponse = normalizeCredentialRefreshErrorResponse(typed.Response)
	} else if errors.Is(refreshErr, context.DeadlineExceeded) {
		errorCode = "oauth_timeout"
		errorMessage = "OAuth request timed out"
	}
	// Defend against adapters or historical rows that classified every OAuth
	// 400/401 as terminal. Only explicit credential-specific terminal codes may
	// stop future refresh attempts.
	if permanent && !provider.IsPermanentCredentialRefreshErrorCode(errorCode) {
		permanent = false
	}
	// 真正的 OAuth 永久失败（invalid_grant 等）只能由成功换 token 清除。
	// 非终态错误不得被旧的 status-only permanent 分类粘住。
	if preservePermanent && credential.RefreshPermanent && !isRecoverableRefreshErrorCode(credential.LastRefreshErrorCode) && !isRecoverableRefreshErrorCode(errorCode) {
		permanent = true
	}
	now := s.now()
	unclassifiedAuthFailure := provider.IsUnclassifiedCredentialAuthRejection(errorStatus, errorCode)
	configurationError := provider.IsCredentialRefreshConfigurationErrorCode(errorCode)
	unclassifiedAuthFailureCount := 0
	if unclassifiedAuthFailure {
		unclassifiedAuthFailureCount = 1
		if credential.LastRefreshErrorStatus == errorStatus && strings.EqualFold(strings.TrimSpace(credential.LastRefreshErrorCode), strings.TrimSpace(errorCode)) {
			unclassifiedAuthFailureCount = credential.RefreshUnclassifiedAuthCount + 1
		}
	}
	retryAt := now.Add(credentialRefreshBackoff(credential.ID, failureCount, retryAfter))
	if configurationError && retryAt.Before(now.Add(credentialConfigurationRetry)) {
		retryAt = now.Add(credentialConfigurationRetry)
	}
	accessTokenAlive := credential.EncryptedAccessToken != "" && !credential.ExpiresAt.IsZero() && credential.ExpiresAt.After(now)
	requiresReauth := unclassifiedAuthFailure && !accessTokenAlive && unclassifiedAuthFailureCount >= credentialUnclassifiedAuthLimit
	if permanent && accessTokenAlive {
		// refresh token 已永久失效时，提前重试没有意义；到 access token 到期时再完成失效收敛。
		retryAt = credential.ExpiresAt
	} else if permanent {
		retryAt = now
	}
	if err := s.accounts.UpdateCredentialRefreshFailure(ctx, credential.ID, repository.CredentialRefreshFailure{
		Count: failureCount, UnclassifiedAuthFailureCount: unclassifiedAuthFailureCount,
		RetryAt: retryAt, Status: errorStatus, Code: errorCode,
		Message: errorMessage, Response: errorResponse, Permanent: permanent,
	}); err != nil {
		s.logger.Warn("credential_refresh_state_write_failed", "account_id", credential.ID, "error", err)
	}
	s.logger.Warn("credential_refresh_failed",
		"account_id", credential.ID,
		"provider", credential.Provider,
		"http_status", errorStatus,
		"error_code", errorCode,
		"error_message", errorMessage,
		"permanent", permanent,
		"failure_count", failureCount,
		"unclassified_auth_failure", unclassifiedAuthFailure,
		"unclassified_auth_failure_count", unclassifiedAuthFailureCount,
		"configuration_error", configurationError,
		"requires_reauth", requiresReauth,
		"retry_at", retryAt,
		"access_token_alive", accessTokenAlive,
		"refresh_token_rotated", false,
		"egress_node_id", credential.EgressNodeID,
		"build_api_fallback_marked", credential.BuildAPIFallback,
		"distributed_lock", distributedLock,
	)
	if permanent && accessTokenAlive {
		s.logger.Warn("credential_refresh_permanent_but_token_alive", "account_id", credential.ID, "error_code", errorCode, "expires_at", credential.ExpiresAt, "retry_at", retryAt)
		s.WakeCredentialRefresh()
		return
	}
	if permanent {
		if err := s.MarkReauthRequired(ctx, credential.ID, "OAuth refresh failed: "+errorCode); err != nil {
			s.logger.Warn("credential_refresh_reauth_mark_failed", "account_id", credential.ID, "error", err)
		}
		return
	}
	if requiresReauth {
		if err := s.MarkReauthRequired(ctx, credential.ID, "OAuth refresh repeatedly rejected without a classifiable error"); err != nil {
			s.logger.Warn("credential_refresh_unclassified_reauth_mark_failed", "account_id", credential.ID, "error", err)
			return
		}
		s.logger.Warn("credential_refresh_unclassified_reauth_required",
			"account_id", credential.ID,
			"http_status", errorStatus,
			"error_code", errorCode,
			"failure_count", unclassifiedAuthFailureCount,
		)
		return
	}
	s.logger.Warn("credential_refresh_deferred", "account_id", credential.ID, "failure_count", failureCount, "retry_at", retryAt, "error_code", errorCode)
	s.WakeCredentialRefresh()
}

func normalizeCredentialRefreshErrorMessage(value string) string {
	value = strings.Map(func(char rune) rune {
		switch char {
		case '\r', '\n', '\t':
			return ' '
		}
		if char < 0x20 || char == 0x7f {
			return -1
		}
		return char
	}, strings.TrimSpace(value))
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if len(runes) > 512 {
		value = string(runes[:511]) + "…"
	}
	return value
}

func normalizeCredentialRefreshErrorResponse(value string) string {
	value = strings.Map(func(char rune) rune {
		if char < 0x20 || char == 0x7f {
			return ' '
		}
		return char
	}, strings.TrimSpace(value))
	runes := []rune(value)
	if len(runes) > 4096 {
		value = string(runes[:4095]) + "…"
	}
	return value
}

// resolvePermanentRefreshFailure 阻止自动链路再次请求已确认失效的 refresh token，
// 并在 access token 到期后收敛账号状态。管理员显式刷新可通过
// retryPermanentOnce 绕过一次；credential_decrypt_failed 等可恢复本地错误不受阻断。
func (s *Service) resolvePermanentRefreshFailure(ctx context.Context, credential accountdomain.Credential, now time.Time, force, retryPermanentOnce bool) (accountdomain.Credential, error, bool) {
	if !credential.RefreshPermanent {
		return accountdomain.Credential{}, nil, false
	}
	if isRecoverableRefreshErrorCode(credential.LastRefreshErrorCode) {
		// 允许 force 或到期调度再次尝试解密/刷新；成功后会 clear permanent 标记。
		return accountdomain.Credential{}, nil, false
	}
	if retryPermanentOnce {
		return accountdomain.Credential{}, nil, false
	}
	accessTokenAlive := credential.EncryptedAccessToken != "" && !credential.ExpiresAt.IsZero() && credential.ExpiresAt.After(now)
	if accessTokenAlive && !force {
		return credential, nil, true
	}
	if !accessTokenAlive {
		if err := s.MarkReauthRequired(ctx, credential.ID, permanentRefreshExpiredReason); err != nil {
			return accountdomain.Credential{}, err, true
		}
	}
	if credential.LastRefreshErrorCode == "" {
		return accountdomain.Credential{}, ErrCredentialRefreshPermanent, true
	}
	return accountdomain.Credential{}, fmt.Errorf("%w: %s", ErrCredentialRefreshPermanent, credential.LastRefreshErrorCode), true
}

// isRecoverableRefreshErrorCode 标识“永久标记可被后续成功刷新清除”的本地/临时错误。
func isRecoverableRefreshErrorCode(code string) bool {
	return !provider.IsPermanentCredentialRefreshErrorCode(code)
}

func credentialRefreshBackoff(accountID uint64, failureCount int, retryAfter time.Duration) time.Duration {
	delays := [...]time.Duration{30 * time.Second, 2 * time.Minute, 5 * time.Minute, 10 * time.Minute, 15 * time.Minute}
	index := max(0, min(failureCount-1, len(delays)-1))
	delay := delays[index]
	if retryAfter > delay {
		delay = min(retryAfter, 30*time.Minute)
	}
	return delay + time.Duration((accountID*37)%16)*time.Second
}
