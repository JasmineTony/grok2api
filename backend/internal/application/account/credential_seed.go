package account

import (
	"fmt"
	"strings"

	egressapp "github.com/chenyme/grok2api/backend/internal/application/egress"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/infra/provider"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
)

// credentialFromSeed converts a provider-owned import/login seed into the
// encrypted account value persisted by the application layer. Provider
// adapters remain responsible for parsing and provider-specific SourceKey
// conventions; this boundary owns storage defaults and secret handling.
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
	value := accountdomain.Credential{
		Provider: providerValue, AuthType: authType, WebTier: seed.WebTier,
		Name: seed.Name, Email: seed.Email, UserID: seed.UserID, TeamID: seed.TeamID,
		SourceKey: sourceKey, OIDCClientID: seed.OIDCClientID,
		EncryptedAccessToken: accessEncrypted, EncryptedRefreshToken: refreshEncrypted,
		EncryptedCloudflareCookie: cloudflareEncrypted, ExpiresAt: seed.ExpiresAt,
		Enabled: true, AuthStatus: accountdomain.AuthStatusActive,
		Priority: accountdomain.DefaultPriority, MaxConcurrent: accountdomain.DefaultMaxConcurrent,
		MinimumRemaining: accountdomain.DefaultMinimumRemaining,
		WebNSFWEnabledAt: seed.WebNSFWEnabledAt, WebTermsAcceptedAt: seed.WebTermsAcceptedAt,
		WebTermsAcceptedVersion: seed.WebTermsAcceptedVersion, WebBirthDateSetAt: seed.WebBirthDateSetAt,
	}
	value.BuildBotFlagSource = s.credentialMetadata(value).BuildBotFlagSource
	if providerValue == accountdomain.ProviderWeb && strings.TrimSpace(seed.AccessToken) != "" {
		value.EgressIdentity = "sso_" + security.HashToken(seed.AccessToken)[:32]
	}
	return value, nil
}
