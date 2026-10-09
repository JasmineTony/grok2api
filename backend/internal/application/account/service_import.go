package account

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	egressapp "github.com/chenyme/grok2api/backend/internal/application/egress"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/pkg/batch"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// StartDeviceLogin 启动短期 Device OAuth，会话只保存在有界运行态存储中。
func (s *Service) StartDeviceLogin(ctx context.Context) (DeviceStartResult, error) {
	adapter, ok := s.providers.DeviceOAuth(accountdomain.ProviderBuild)
	if !ok {
		return DeviceStartResult{}, fmt.Errorf("CLI Provider 未注册")
	}
	authorization, err := adapter.StartDeviceAuthorization(ctx)
	if err != nil {
		return DeviceStartResult{}, err
	}
	sessionID, err := security.NewOpaqueToken(18)
	if err != nil {
		return DeviceStartResult{}, err
	}
	now := time.Now().UTC()
	session := accountdomain.DeviceSession{ID: sessionID, DeviceCode: authorization.DeviceCode, UserCode: authorization.UserCode, VerificationURI: authorization.VerificationURI, VerificationURIComplete: authorization.VerificationURIComplete, Interval: authorization.Interval, NextPollAt: now.Add(authorization.Interval), ExpiresAt: now.Add(authorization.ExpiresIn)}
	if err := s.deviceSessions.Create(ctx, session); err != nil {
		return DeviceStartResult{}, err
	}
	return DeviceStartResult{SessionID: sessionID, UserCode: session.UserCode, VerificationURI: session.VerificationURI, VerificationURIComplete: session.VerificationURIComplete, Interval: session.Interval, ExpiresAt: session.ExpiresAt}, nil
}

// PollDeviceLogin 执行一次上游轮询，成功后立即加密并写入账号仓储。
func (s *Service) PollDeviceLogin(ctx context.Context, sessionID string) (View, error) {
	now := time.Now().UTC()
	session, err := s.deviceSessions.Get(ctx, sessionID, now)
	if err != nil {
		return View{}, ErrDeviceDenied
	}
	if now.Before(session.NextPollAt) {
		return View{}, ErrDeviceSlowDown
	}
	adapter, ok := s.providers.DeviceOAuth(accountdomain.ProviderBuild)
	if !ok {
		return View{}, fmt.Errorf("CLI Provider 未注册")
	}
	seed, err := adapter.PollDeviceAuthorization(ctx, session.DeviceCode)
	session.NextPollAt = now.Add(session.Interval)
	_ = s.deviceSessions.Update(ctx, session)
	if errors.Is(err, provider.ErrAuthorizationPending) {
		return View{}, ErrDevicePending
	}
	if errors.Is(err, provider.ErrSlowDown) {
		session.Interval += 5 * time.Second
		session.NextPollAt = now.Add(session.Interval)
		_ = s.deviceSessions.Update(ctx, session)
		return View{}, ErrDeviceSlowDown
	}
	if errors.Is(err, provider.ErrAuthorizationDenied) {
		_ = s.deviceSessions.Delete(ctx, sessionID)
		return View{}, ErrDeviceDenied
	}
	if err != nil {
		return View{}, err
	}
	value, _, err := s.persistSeed(ctx, seed)
	if err != nil {
		return View{}, err
	}
	s.reconcileProviderLinksBestEffort(ctx, value.ID)
	_ = s.deviceSessions.Delete(ctx, sessionID)
	return s.Get(ctx, value.ID)
}

// ImportCredentials 导入用户上传的 OAuth 账号凭据。
func (s *Service) ImportCredentials(ctx context.Context, data []byte) (ImportResult, error) {
	return s.ImportCredentialsWithObserver(ctx, data, nil)
}

func (s *Service) ImportCredentialsWithObserver(ctx context.Context, data []byte, observer ImportedAccountObserver) (ImportResult, error) {
	return s.ImportCredentialsWithProgress(ctx, data, observer, nil)
}

// ImportCredentialsWithProgress 导入 Build 凭据并报告已写入流水线的账号数。
func (s *Service) ImportCredentialsWithProgress(ctx context.Context, data []byte, observer ImportedAccountObserver, progress BatchProgressObserver) (ImportResult, error) {
	return s.ImportCredentialDocumentsWithProgress(ctx, [][]byte{data}, observer, progress)
}

// ImportCredentialDocumentsWithProgress 合并解析多个 Build 凭据文件，并作为一个批次写入和同步。
func (s *Service) ImportCredentialDocumentsWithProgress(ctx context.Context, documents [][]byte, observer ImportedAccountObserver, progress BatchProgressObserver) (ImportResult, error) {
	adapter, ok := s.providers.CredentialCodec(accountdomain.ProviderBuild)
	if !ok {
		return ImportResult{}, fmt.Errorf("CLI Provider 未注册")
	}
	return s.importCredentialDocumentsWithProgress(ctx, adapter, documents, observer, progress)
}

// ImportWebCredentials 导入版本化或旧号池格式的 Grok Web SSO 凭据。
func (s *Service) ImportWebCredentials(ctx context.Context, data []byte) (ImportResult, error) {
	return s.ImportWebCredentialsWithObserver(ctx, data, nil)
}

func (s *Service) ImportWebCredentialsWithObserver(ctx context.Context, data []byte, observer ImportedAccountObserver) (ImportResult, error) {
	return s.ImportWebCredentialsWithProgress(ctx, data, observer, nil)
}

// ImportWebCredentialsWithProgress 导入 Web 凭据并报告已写入流水线的账号数。
func (s *Service) ImportWebCredentialsWithProgress(ctx context.Context, data []byte, observer ImportedAccountObserver, progress BatchProgressObserver) (ImportResult, error) {
	return s.ImportWebCredentialDocumentsWithProgress(ctx, [][]byte{data}, observer, progress)
}

// ImportWebCredentialDocumentsWithProgress 合并解析多个 Web JSON 或 SSO 文本文件，并作为一个批次写入和同步。
func (s *Service) ImportWebCredentialDocumentsWithProgress(ctx context.Context, documents [][]byte, observer ImportedAccountObserver, progress BatchProgressObserver) (ImportResult, error) {
	adapter, ok := s.providers.CredentialCodec(accountdomain.ProviderWeb)
	if !ok {
		return ImportResult{}, fmt.Errorf("Grok Web Provider 未注册")
	}
	return s.importCredentialDocumentsWithProgress(ctx, adapter, documents, observer, progress)
}

func (s *Service) ImportConsoleCredentials(ctx context.Context, data []byte) (ImportResult, error) {
	return s.ImportConsoleCredentialsWithObserver(ctx, data, nil)
}

func (s *Service) ImportConsoleCredentialsWithObserver(ctx context.Context, data []byte, observer ImportedAccountObserver) (ImportResult, error) {
	return s.ImportConsoleCredentialsWithProgress(ctx, data, observer, nil)
}

func (s *Service) ImportConsoleCredentialsWithProgress(ctx context.Context, data []byte, observer ImportedAccountObserver, progress BatchProgressObserver) (ImportResult, error) {
	return s.ImportConsoleCredentialDocumentsWithProgress(ctx, [][]byte{data}, observer, progress)
}

func (s *Service) ImportConsoleCredentialDocumentsWithProgress(ctx context.Context, documents [][]byte, observer ImportedAccountObserver, progress BatchProgressObserver) (ImportResult, error) {
	adapter, ok := s.providers.CredentialCodec(accountdomain.ProviderConsole)
	if !ok {
		return ImportResult{}, fmt.Errorf("Grok Console Provider 未注册")
	}
	return s.importCredentialDocumentsWithProgress(ctx, adapter, documents, observer, progress)
}

func (s *Service) importCredentialDocumentsWithProgress(ctx context.Context, adapter provider.CredentialCodecAdapter, documents [][]byte, observer ImportedAccountObserver, progress BatchProgressObserver) (ImportResult, error) {
	if len(documents) == 0 {
		return ImportResult{}, fmt.Errorf("%w: 没有可导入的账号文件", ErrInvalidImport)
	}
	seeds := make([]provider.CredentialSeed, 0)
	seen := make(map[string]struct{})
	parsedAccounts := 0
	skipped := 0
	for index, document := range documents {
		values, err := adapter.ParseImportedCredentials(document)
		if err != nil {
			if errors.Is(err, provider.ErrCredentialLimit) {
				return ImportResult{}, fmt.Errorf("%w: 单次最多导入 %d 个账号", ErrImportLimit, maxCredentialImportAccounts)
			}
			return ImportResult{}, fmt.Errorf("%w: 第 %d 个文件: %v", ErrInvalidImport, index+1, err)
		}
		parsedAccounts += len(values)
		if parsedAccounts > maxCredentialImportAccounts {
			return ImportResult{}, fmt.Errorf("%w: 单次最多导入 %d 个账号", ErrImportLimit, maxCredentialImportAccounts)
		}
		for _, value := range values {
			if value.SourceKey != "" {
				key := string(value.Provider) + "\x00" + value.SourceKey
				if _, exists := seen[key]; exists {
					skipped++
					continue
				}
				seen[key] = struct{}{}
			}
			seeds = append(seeds, value)
		}
	}
	var result ImportResult
	var err error
	if preparer, ok := adapter.(provider.CredentialImportPreparer); ok && hasRefreshTokenOnlySeed(seeds) {
		result, err = s.persistPreparedImportedSeeds(ctx, seeds, preparer, observer, progress)
	} else {
		result, err = s.persistImportedSeeds(ctx, seeds, observer, progress)
	}
	result.Skipped += skipped
	return result, err
}

func hasRefreshTokenOnlySeed(seeds []provider.CredentialSeed) bool {
	for _, seed := range seeds {
		if strings.TrimSpace(seed.AccessToken) == "" && strings.TrimSpace(seed.RefreshToken) != "" {
			return true
		}
	}
	return false
}

func (s *Service) persistPreparedImportedSeeds(ctx context.Context, seeds []provider.CredentialSeed, preparer provider.CredentialImportPreparer, observer ImportedAccountObserver, progress BatchProgressObserver) (ImportResult, error) {
	result := ImportResult{AccountIDs: make([]uint64, 0, len(seeds))}
	if progress != nil {
		if err := progress(0, len(seeds)); err != nil {
			return result, err
		}
	}
	prepareCtx, cancelPrepare := context.WithCancel(ctx)
	defer cancelPrepare()
	var (
		mu        sync.Mutex
		firstErr  error
		completed int
		persisted bool
		seen      = make(map[string]struct{}, len(seeds))
	)
	_, batchErr := batch.ForEachObserved(prepareCtx, seeds, batch.Options{Workers: credentialImportPrepareWorkers}, func(itemCtx context.Context, seed provider.CredentialSeed) (provider.CredentialSeed, error) {
		if strings.TrimSpace(seed.AccessToken) == "" && strings.TrimSpace(seed.RefreshToken) != "" {
			return preparer.PrepareImportedCredential(itemCtx, seed)
		}
		return seed, nil
	}, func(index int, item batch.Result[provider.CredentialSeed]) {
		mu.Lock()
		defer mu.Unlock()
		completed++
		if !item.Completed || item.Err != nil {
			result.Failed++
			if item.Err != nil {
				s.logger.Warn("account_rt_import_failed", "index", index+1, "error", item.Err)
			}
			reportCredentialImportProgress(progress, completed, len(seeds), &firstErr, cancelPrepare)
			return
		}
		seed := item.Value
		if seed.SourceKey != "" {
			key := string(seed.Provider) + "\x00" + seed.SourceKey
			if _, exists := seen[key]; exists {
				result.Skipped++
				reportCredentialImportProgress(progress, completed, len(seeds), &firstErr, cancelPrepare)
				return
			}
			seen[key] = struct{}{}
		}

		// OAuth providers may invalidate the submitted refresh token as soon as
		// they return its replacement. Persist that replacement before any
		// request-scoped observer or progress callback can abort the import.
		persistCtx, cancelPersist := context.WithTimeout(context.WithoutCancel(ctx), credentialStateWriteTimeout)
		stored, err := s.persistImportedSeed(persistCtx, seed)
		cancelPersist()
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			cancelPrepare()
			return
		}
		persisted = true
		result.AccountIDs = append(result.AccountIDs, stored.ID)
		if stored.Created {
			result.Created++
		} else {
			result.Updated++
		}
		if firstErr == nil && observer != nil {
			if err := observer(stored.ID); err != nil {
				firstErr = err
				cancelPrepare()
			}
		}
		reportCredentialImportProgress(progress, completed, len(seeds), &firstErr, cancelPrepare)
	})
	if persisted {
		s.WakeCredentialRefresh()
	}
	return result, errors.Join(firstErr, batchErr)
}

func reportCredentialImportProgress(progress BatchProgressObserver, completed, total int, firstErr *error, cancel context.CancelFunc) {
	if progress == nil || *firstErr != nil {
		return
	}
	if err := progress(completed, total); err != nil {
		*firstErr = err
		cancel()
	}
}

func (s *Service) persistImportedSeed(ctx context.Context, seed provider.CredentialSeed) (repository.AccountUpsertResult, error) {
	value, err := s.credentialFromSeed(seed)
	if err != nil {
		return repository.AccountUpsertResult{}, err
	}
	stored, err := s.accounts.UpsertManyByIdentity(ctx, []accountdomain.Credential{value})
	if err != nil {
		return repository.AccountUpsertResult{}, err
	}
	if len(stored) != 1 {
		return repository.AccountUpsertResult{}, fmt.Errorf("导入账号持久化结果数量无效: %d", len(stored))
	}
	s.reconcileProviderLinksBestEffort(ctx, stored[0].ID)
	return stored[0], nil
}

func (s *Service) persistImportedSeeds(ctx context.Context, seeds []provider.CredentialSeed, observer ImportedAccountObserver, progress BatchProgressObserver) (ImportResult, error) {
	return s.persistImportedSeedsFromProgress(ctx, seeds, observer, progress, 0, len(seeds), true)
}

func (s *Service) persistImportedSeedsFromProgress(ctx context.Context, seeds []provider.CredentialSeed, observer ImportedAccountObserver, progress BatchProgressObserver, completed, total int, reportInitial bool) (ImportResult, error) {
	result := ImportResult{AccountIDs: make([]uint64, 0, len(seeds))}
	if progress != nil && reportInitial {
		if err := progress(completed, total); err != nil {
			return ImportResult{}, err
		}
	}
	for start := 0; start < len(seeds); start += credentialImportChunkSize {
		end := min(start+credentialImportChunkSize, len(seeds))
		values := make([]accountdomain.Credential, 0, end-start)
		for _, seed := range seeds[start:end] {
			value, err := s.credentialFromSeed(seed)
			if err != nil {
				return ImportResult{}, err
			}
			values = append(values, value)
		}
		stored, err := s.accounts.UpsertManyByIdentity(ctx, values)
		if err != nil {
			return ImportResult{}, err
		}
		for _, value := range stored {
			result.AccountIDs = append(result.AccountIDs, value.ID)
			s.reconcileProviderLinksBestEffort(ctx, value.ID)
			if observer != nil {
				if err := observer(value.ID); err != nil {
					return ImportResult{}, err
				}
			}
			completed++
			if progress != nil {
				if err := progress(completed, total); err != nil {
					return ImportResult{}, err
				}
			}
			if value.Created {
				result.Created++
			} else {
				result.Updated++
			}
		}
	}
	s.WakeCredentialRefresh()
	return result, nil
}

func (s *Service) persistSeed(ctx context.Context, seed provider.CredentialSeed) (accountdomain.Credential, bool, error) {
	value, err := s.credentialFromSeed(seed)
	if err != nil {
		return accountdomain.Credential{}, false, err
	}
	stored, created, err := s.accounts.UpsertByIdentity(ctx, value)
	if err == nil {
		s.invalidateBuildBotFlagCache()
		s.WakeCredentialRefresh()
	}
	return stored, created, err
}

func (s *Service) credentialFromSeed(seed provider.CredentialSeed) (accountdomain.Credential, error) {
	accessEncrypted, err := s.cipher.Encrypt(seed.AccessToken)
	if err != nil {
		return accountdomain.Credential{}, err
	}
	refreshEncrypted, err := s.cipher.Encrypt(seed.RefreshToken)
	if err != nil {
		return accountdomain.Credential{}, err
	}
	cloudflareEncrypted := ""
	if strings.TrimSpace(seed.CloudflareCookies) != "" {
		cookies := egressapp.SanitizeCloudflareCookies(seed.CloudflareCookies)
		if cookies == "" {
			return accountdomain.Credential{}, invalidInput("Cloudflare Cookie 中没有有效字段")
		}
		cloudflareEncrypted, err = s.cipher.Encrypt(cookies)
		if err != nil {
			return accountdomain.Credential{}, err
		}
	}
	sourceKey := seed.SourceKey
	if sourceKey == "" {
		sourceKey = "device:" + security.HashToken(seed.AccessToken)
	}
	providerValue := seed.Provider
	if providerValue == "" {
		providerValue = accountdomain.ProviderBuild
	}
	authType := seed.AuthType
	if authType == "" {
		if s.providers == nil {
			return accountdomain.Credential{}, fmt.Errorf("Provider 注册表未初始化")
		}
		definition, ok := s.providers.Definition(providerValue)
		if !ok {
			return accountdomain.Credential{}, fmt.Errorf("Provider %s 未注册", providerValue)
		}
		authType = definition.Credential.AuthType
	}
	value := accountdomain.Credential{Provider: providerValue, AuthType: authType, WebTier: seed.WebTier, Name: seed.Name, Email: seed.Email, UserID: seed.UserID, TeamID: seed.TeamID, SourceKey: sourceKey, OIDCClientID: seed.OIDCClientID, EncryptedAccessToken: accessEncrypted, EncryptedRefreshToken: refreshEncrypted, EncryptedCloudflareCookie: cloudflareEncrypted, ExpiresAt: seed.ExpiresAt, Enabled: true, AuthStatus: accountdomain.AuthStatusActive, Priority: accountdomain.DefaultPriority, MaxConcurrent: accountdomain.DefaultMaxConcurrent, MinimumRemaining: accountdomain.DefaultMinimumRemaining, WebNSFWEnabledAt: seed.WebNSFWEnabledAt, WebTermsAcceptedAt: seed.WebTermsAcceptedAt, WebTermsAcceptedVersion: seed.WebTermsAcceptedVersion, WebBirthDateSetAt: seed.WebBirthDateSetAt}
	value.BuildBotFlagSource = s.credentialMetadata(value).BuildBotFlagSource
	if providerValue == accountdomain.ProviderWeb && strings.TrimSpace(seed.AccessToken) != "" {
		value.EgressIdentity = "sso_" + security.HashToken(seed.AccessToken)[:32]
	}
	return value, nil
}
