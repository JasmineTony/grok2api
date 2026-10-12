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
	result, err, _ := s.refreshes.Do(credentialRefreshKey(value.ID, options), func() (any, error) {
		credential, refreshErr := s.refreshCredentialValue(ctx, value, options)
		if refreshErr != nil {
			return nil, refreshErr
		}
		return credential, nil
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

// credentialRefreshKey 区分普通、调度与管理员重试的并发刷新键。
func credentialRefreshKey(accountID uint64, options ensureCredentialOptions) string {
	key := strconv.FormatUint(accountID, 10)
	if options.respectSchedule {
		key += ":scheduled"
	}
	if options.retryPermanentOnce {
		key += ":manual-retry"
	}
	return key
}

// refreshCredentialValue 在 singleflight 内重读凭据、加分布式锁并完成一次真实刷新。
func (s *Service) refreshCredentialValue(ctx context.Context, value accountdomain.Credential, options ensureCredentialOptions) (accountdomain.Credential, error) {
	latest, err := s.accounts.Get(ctx, value.ID)
	if err != nil {
		return accountdomain.Credential{}, err
	}
	currentTime := s.now()
	if credential, err, handled := s.resolvePermanentRefreshFailure(ctx, latest, currentTime, options.force, options.retryPermanentOnce); handled {
		return credential, err
	}
	if credential, satisfied := s.credentialRefreshSatisfiedBeforeLock(latest, value, currentTime, options); satisfied {
		return credential, nil
	}
	release, err := s.acquireRefreshLock(ctx, latest.ID)
	if err != nil {
		return accountdomain.Credential{}, err
	}
	if release != nil {
		defer release()
		latest, err = s.accounts.Get(ctx, value.ID)
		if err != nil {
			return accountdomain.Credential{}, err
		}
		currentTime = s.now()
		if credential, err, handled := s.resolvePermanentRefreshFailure(ctx, latest, currentTime, options.force, options.retryPermanentOnce); handled {
			return credential, err
		}
		if credential, satisfied := s.credentialRefreshSatisfiedAfterLock(latest, value, currentTime, options); satisfied {
			return credential, nil
		}
	}
	return s.executeCredentialRefresh(ctx, latest, currentTime, options, release != nil)
}

// credentialRefreshSatisfiedBeforeLock 判断加锁前的凭据是否已无需刷新。
func (s *Service) credentialRefreshSatisfiedBeforeLock(latest, current accountdomain.Credential, now time.Time, options ensureCredentialOptions) (accountdomain.Credential, bool) {
	if options.respectSchedule && latest.RefreshDueAt != nil && latest.RefreshDueAt.After(now) {
		return latest, true
	}
	if options.force && latest.EncryptedAccessToken != "" && latest.EncryptedAccessToken != current.EncryptedAccessToken {
		return latest, true
	}
	if !options.force && latest.EncryptedAccessToken != "" && !latest.ExpiresAt.IsZero() && now.Add(credentialRefreshAdvance).Before(latest.ExpiresAt) {
		return latest, true
	}
	if options.force && !options.bypassCooldown && s.credentialRefreshCoolingDown(latest, now) {
		return latest, true
	}
	return accountdomain.Credential{}, false
}

// credentialRefreshSatisfiedAfterLock 判断加锁后重读的凭据是否已被其他实例刷新。
func (s *Service) credentialRefreshSatisfiedAfterLock(latest, current accountdomain.Credential, now time.Time, options ensureCredentialOptions) (accountdomain.Credential, bool) {
	if options.respectSchedule && latest.RefreshDueAt != nil && latest.RefreshDueAt.After(now) {
		return latest, true
	}
	if options.force && !options.bypassCooldown && s.credentialRefreshCoolingDown(latest, now) {
		return latest, true
	}
	if latest.EncryptedAccessToken != "" && latest.EncryptedAccessToken != current.EncryptedAccessToken {
		return latest, true
	}
	if !options.force && latest.EncryptedAccessToken != "" && !latest.ExpiresAt.IsZero() && now.Add(credentialRefreshAdvance).Before(latest.ExpiresAt) {
		return latest, true
	}
	return accountdomain.Credential{}, false
}

// executeCredentialRefresh 调用 provider 适配器刷新凭据，并在失败时落库失败状态。
func (s *Service) executeCredentialRefresh(ctx context.Context, latest accountdomain.Credential, currentTime time.Time, options ensureCredentialOptions, distributedLock bool) (accountdomain.Credential, error) {
	adapter, ok := s.providers.CredentialRefresh(latest.Provider)
	if !ok {
		return accountdomain.Credential{}, fmt.Errorf("Provider %s 未注册", latest.Provider)
	}
	refreshed, err := adapter.RefreshCredential(ctx, latest)
	if err != nil {
		persistCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), credentialRefreshStateTTL)
		s.recordCredentialRefreshFailure(persistCtx, latest, err, !options.retryPermanentOnce, distributedLock)
		cancel()
		return accountdomain.Credential{}, err
	}
	return s.persistRefreshedCredential(ctx, latest, refreshed, currentTime, distributedLock)
}

// persistRefreshedCredential 持久化轮换后的 token 与 bot 风控来源，并唤醒刷新调度。
func (s *Service) persistRefreshedCredential(ctx context.Context, latest accountdomain.Credential, refreshed provider.RefreshedCredential, currentTime time.Time, distributedLock bool) (accountdomain.Credential, error) {
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
			"distributed_lock", distributedLock,
			"error", err,
		)
		return accountdomain.Credential{}, err
	}
	s.invalidateBuildBotFlagCache()
	s.markRefreshSuccess(latest.ID, currentTime)
	s.WakeCredentialRefresh()
	return updated, nil
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
	failure := s.classifyCredentialRefreshFailure(credential, refreshErr, preservePermanent)
	if err := s.accounts.UpdateCredentialRefreshFailure(ctx, credential.ID, repository.CredentialRefreshFailure{
		Count: failure.failureCount, UnclassifiedAuthFailureCount: failure.unclassifiedAuthFailureCount,
		RetryAt: failure.retryAt, Status: failure.errorStatus, Code: failure.errorCode,
		Message: failure.errorMessage, Response: failure.errorResponse, Permanent: failure.permanent,
	}); err != nil {
		s.logger.Warn("credential_refresh_state_write_failed", "account_id", credential.ID, "error", err)
	}
	s.logCredentialRefreshFailure(credential, failure, distributedLock)
	s.settleCredentialRefreshFailure(ctx, credential, failure)
}

// credentialRefreshFailure 汇总一次刷新失败落库与告警所需的分类结果。
type credentialRefreshFailure struct {
	failureCount                 int
	errorStatus                  int
	errorCode                    string
	errorMessage                 string
	errorResponse                string
	permanent                    bool
	unclassifiedAuthFailure      bool
	unclassifiedAuthFailureCount int
	configurationError           bool
	requiresReauth               bool
	accessTokenAlive             bool
	retryAt                      time.Time
}

// classifyCredentialRefreshFailure 把上游刷新错误归一化为可落库、可告警的分类结果。
func (s *Service) classifyCredentialRefreshFailure(credential accountdomain.Credential, refreshErr error, preservePermanent bool) credentialRefreshFailure {
	failure, retryAfter := classifyCredentialRefreshError(refreshErr, credential.RefreshFailureCount+1)
	applyCredentialRefreshPermanentRules(&failure, credential, preservePermanent)
	now := s.now()
	classifyUnclassifiedCredentialAuthFailure(&failure, credential)
	s.resolveCredentialRefreshRetry(credential, &failure, now, retryAfter)
	return failure
}

// classifyCredentialRefreshError 解析适配器返回的刷新错误与重试提示。
func classifyCredentialRefreshError(refreshErr error, failureCount int) (credentialRefreshFailure, time.Duration) {
	failure := credentialRefreshFailure{failureCount: failureCount, errorCode: "oauth_transport_error", errorMessage: "OAuth request failed"}
	retryAfter := time.Duration(0)
	var typed *provider.CredentialRefreshError
	if errors.As(refreshErr, &typed) {
		failure.errorCode = strings.TrimSpace(typed.Code)
		if failure.errorCode == "" {
			failure.errorCode = "oauth_refresh_error"
		}
		failure.errorStatus = typed.Status
		failure.permanent = typed.Permanent
		retryAfter = typed.RetryAfter
		if message := normalizeCredentialRefreshErrorMessage(typed.Message); message != "" {
			failure.errorMessage = message
		}
		failure.errorResponse = normalizeCredentialRefreshErrorResponse(typed.Response)
		return failure, retryAfter
	}
	if errors.Is(refreshErr, context.DeadlineExceeded) {
		failure.errorCode = "oauth_timeout"
		failure.errorMessage = "OAuth request timed out"
	}
	return failure, retryAfter
}

// applyCredentialRefreshPermanentRules 收敛 permanent 标记，避免历史误分类粘住可恢复错误。
func applyCredentialRefreshPermanentRules(failure *credentialRefreshFailure, credential accountdomain.Credential, preservePermanent bool) {
	// Defend against adapters or historical rows that classified every OAuth
	// 400/401 as terminal. Only explicit credential-specific terminal codes may
	// stop future refresh attempts.
	if failure.permanent && !provider.IsPermanentCredentialRefreshErrorCode(failure.errorCode) {
		failure.permanent = false
	}
	// 真正的 OAuth 永久失败（invalid_grant 等）只能由成功换 token 清除。
	// 非终态错误不得被旧的 status-only permanent 分类粘住。
	if preservePermanent && credential.RefreshPermanent && !isRecoverableRefreshErrorCode(credential.LastRefreshErrorCode) && !isRecoverableRefreshErrorCode(failure.errorCode) {
		failure.permanent = true
	}
}

// classifyUnclassifiedCredentialAuthFailure 累计无法归类的鉴权拒绝次数，用于判定是否要求重新授权。
func classifyUnclassifiedCredentialAuthFailure(failure *credentialRefreshFailure, credential accountdomain.Credential) {
	failure.unclassifiedAuthFailure = provider.IsUnclassifiedCredentialAuthRejection(failure.errorStatus, failure.errorCode)
	failure.configurationError = provider.IsCredentialRefreshConfigurationErrorCode(failure.errorCode)
	if !failure.unclassifiedAuthFailure {
		return
	}
	failure.unclassifiedAuthFailureCount = 1
	if credential.LastRefreshErrorStatus == failure.errorStatus && strings.EqualFold(strings.TrimSpace(credential.LastRefreshErrorCode), strings.TrimSpace(failure.errorCode)) {
		failure.unclassifiedAuthFailureCount = credential.RefreshUnclassifiedAuthCount + 1
	}
}

// resolveCredentialRefreshRetry 计算下次重试时间与是否需要重新授权。
func (s *Service) resolveCredentialRefreshRetry(credential accountdomain.Credential, failure *credentialRefreshFailure, now time.Time, retryAfter time.Duration) {
	failure.retryAt = now.Add(credentialRefreshBackoff(credential.ID, failure.failureCount, retryAfter))
	if failure.configurationError && failure.retryAt.Before(now.Add(credentialConfigurationRetry)) {
		failure.retryAt = now.Add(credentialConfigurationRetry)
	}
	failure.accessTokenAlive = credential.EncryptedAccessToken != "" && !credential.ExpiresAt.IsZero() && credential.ExpiresAt.After(now)
	failure.requiresReauth = failure.unclassifiedAuthFailure && !failure.accessTokenAlive && failure.unclassifiedAuthFailureCount >= credentialUnclassifiedAuthLimit
	if failure.permanent && failure.accessTokenAlive {
		// refresh token 已永久失效时，提前重试没有意义；到 access token 到期时再完成失效收敛。
		failure.retryAt = credential.ExpiresAt
		return
	}
	if failure.permanent {
		failure.retryAt = now
	}
}

// logCredentialRefreshFailure 记录刷新失败分类结果；日志不含任何 token 值。
func (s *Service) logCredentialRefreshFailure(credential accountdomain.Credential, failure credentialRefreshFailure, distributedLock bool) {
	s.logger.Warn("credential_refresh_failed",
		"account_id", credential.ID,
		"provider", credential.Provider,
		"http_status", failure.errorStatus,
		"error_code", failure.errorCode,
		"error_message", failure.errorMessage,
		"permanent", failure.permanent,
		"failure_count", failure.failureCount,
		"unclassified_auth_failure", failure.unclassifiedAuthFailure,
		"unclassified_auth_failure_count", failure.unclassifiedAuthFailureCount,
		"configuration_error", failure.configurationError,
		"requires_reauth", failure.requiresReauth,
		"retry_at", failure.retryAt,
		"access_token_alive", failure.accessTokenAlive,
		"refresh_token_rotated", false,
		"egress_node_id", credential.EgressNodeID,
		"build_api_fallback_marked", credential.BuildAPIFallback,
		"distributed_lock", distributedLock,
	)
}

// settleCredentialRefreshFailure 按分类结果收敛账号状态：保留可用 token、要求重新授权或延后重试。
func (s *Service) settleCredentialRefreshFailure(ctx context.Context, credential accountdomain.Credential, failure credentialRefreshFailure) {
	if failure.permanent && failure.accessTokenAlive {
		s.logger.Warn("credential_refresh_permanent_but_token_alive", "account_id", credential.ID, "error_code", failure.errorCode, "expires_at", credential.ExpiresAt, "retry_at", failure.retryAt)
		s.WakeCredentialRefresh()
		return
	}
	if failure.permanent {
		if err := s.MarkReauthRequired(ctx, credential.ID, "OAuth refresh failed: "+failure.errorCode); err != nil {
			s.logger.Warn("credential_refresh_reauth_mark_failed", "account_id", credential.ID, "error", err)
		}
		return
	}
	if failure.requiresReauth {
		s.markUnclassifiedReauthRequired(ctx, credential, failure)
		return
	}
	s.logger.Warn("credential_refresh_deferred", "account_id", credential.ID, "failure_count", failure.failureCount, "retry_at", failure.retryAt, "error_code", failure.errorCode)
	s.WakeCredentialRefresh()
}

// markUnclassifiedReauthRequired 在连续无法归类的鉴权拒绝后要求重新授权。
func (s *Service) markUnclassifiedReauthRequired(ctx context.Context, credential accountdomain.Credential, failure credentialRefreshFailure) {
	if err := s.MarkReauthRequired(ctx, credential.ID, "OAuth refresh repeatedly rejected without a classifiable error"); err != nil {
		s.logger.Warn("credential_refresh_unclassified_reauth_mark_failed", "account_id", credential.ID, "error", err)
		return
	}
	s.logger.Warn("credential_refresh_unclassified_reauth_required",
		"account_id", credential.ID,
		"http_status", failure.errorStatus,
		"error_code", failure.errorCode,
		"failure_count", failure.unclassifiedAuthFailureCount,
	)
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
