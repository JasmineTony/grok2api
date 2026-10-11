package cli

import (
	"context"
	"fmt"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// CredentialMetadata extracts only non-sensitive risk flags from a Build access token.
// bot_flag_source or its short alias bfs must be JSON number 1 or 2; other values, malformed
// tokens, and decryption failures are not marked. bot_flag_source is preferred when both are set.
func (a *Adapter) CredentialMetadata(credential account.Credential) provider.CredentialMetadata {
	if credential.Provider != account.ProviderBuild || a.cipher == nil || credential.EncryptedAccessToken == "" {
		return provider.CredentialMetadata{}
	}
	accessToken, err := a.cipher.Decrypt(credential.EncryptedAccessToken)
	if err != nil {
		return provider.CredentialMetadata{}
	}
	claims := decodeJWTClaims(accessToken)
	if claims == nil {
		return provider.CredentialMetadata{}
	}
	source := buildBotFlagSourceFromClaims(claims)
	return provider.CredentialMetadata{
		BuildBotFlagInspected: true,
		BuildBotFlagged:       source != 0,
		BuildBotFlagSource:    source,
	}
}

// buildBotFlagSourceFromClaims returns the bot-risk source from JWT claims.
// Accepts bot_flag_source or bfs; only JSON numbers 1 and 2 count (string "1"/"2" do not).
// Prefer bot_flag_source when it is 1 or 2; otherwise fall back to bfs.
func buildBotFlagSourceFromClaims(claims map[string]any) int {
	if claims == nil {
		return 0
	}
	if source := botFlagSourceClaim(claims, "bot_flag_source"); source != 0 {
		return source
	}
	return botFlagSourceClaim(claims, "bfs")
}

func botFlagSourceClaim(claims map[string]any, key string) int {
	value, ok := claims[key].(float64)
	if !ok {
		return 0
	}
	switch value {
	case 1, 2:
		return int(value)
	default:
		return 0
	}
}

// buildBotFlaggedFromClaims reports whether JWT claims mark a Build account as bot-risked.
func buildBotFlaggedFromClaims(claims map[string]any) bool {
	return buildBotFlagSourceFromClaims(claims) != 0
}

func (a *Adapter) RefreshCredential(ctx context.Context, credential account.Credential) (provider.RefreshedCredential, error) {
	ctx, cancel := context.WithTimeout(ctx, buildControlTimeout)
	defer cancel()
	refreshToken, err := a.cipher.Decrypt(credential.EncryptedRefreshToken)
	if err != nil {
		// Decryption failures are usually temporary or mismatched local encryption keys and are recoverable;
		// do not mark them permanent, or manual/batch refresh will never retry after the key is fixed.
		// True permanent OAuth failures such as invalid_grant are returned by oauth.refresh with Permanent=true.
		return provider.RefreshedCredential{}, &provider.CredentialRefreshError{Code: "credential_decrypt_failed", Message: "Stored refresh credential could not be decrypted", Permanent: false, Cause: err}
	}
	if strings.TrimSpace(refreshToken) == "" {
		return provider.RefreshedCredential{}, &provider.CredentialRefreshError{Code: "missing_refresh_token", Message: "Refresh token is missing", Permanent: true}
	}
	refreshCtx := infraegress.WithCredential(ctx, credential)
	tokens, err := a.oauth.refreshWithClientID(refreshCtx, refreshToken, credential.OIDCClientID)
	if err != nil {
		return provider.RefreshedCredential{}, err
	}
	accessEncrypted, err := a.cipher.Encrypt(tokens.AccessToken)
	if err != nil {
		return provider.RefreshedCredential{}, err
	}
	refreshEncrypted, err := a.cipher.Encrypt(tokens.RefreshToken)
	if err != nil {
		return provider.RefreshedCredential{}, err
	}
	return provider.RefreshedCredential{EncryptedAccessToken: accessEncrypted, EncryptedRefreshToken: refreshEncrypted, ExpiresAt: tokens.ExpiresAt, RefreshTokenRotated: tokens.RefreshTokenRotated}, nil
}

func (a *Adapter) StartDeviceAuthorization(ctx context.Context) (provider.DeviceAuthorization, error) {
	ctx, cancel := context.WithTimeout(ctx, buildControlTimeout)
	defer cancel()
	return a.oauth.startDevice(ctx)
}

func (a *Adapter) PollDeviceAuthorization(ctx context.Context, deviceCode string) (provider.CredentialSeed, error) {
	ctx, cancel := context.WithTimeout(ctx, buildControlTimeout)
	defer cancel()
	tokens, err := a.oauth.pollDevice(ctx, deviceCode)
	if err != nil {
		return provider.CredentialSeed{}, err
	}
	claims := decodeJWTClaims(firstNonEmpty(tokens.IDToken, tokens.AccessToken))
	userID := stringClaim(claims, "sub")
	email := stringClaim(claims, "email")
	return provider.CredentialSeed{Name: firstNonEmpty(email, userID, "Grok Build account"), Email: email, UserID: userID, TeamID: stringClaim(claims, "team_id"), OIDCClientID: defaultOAuthClientID, AccessToken: tokens.AccessToken, RefreshToken: tokens.RefreshToken, ExpiresAt: tokens.ExpiresAt}, nil
}

func (a *Adapter) ParseImportedCredentials(data []byte) ([]provider.CredentialSeed, error) {
	return parseImportedCredentials(data)
}

// PrepareImportedCredential validates a refresh-token-only import and keeps
// the rotated tokens returned by xAI before the account is persisted.
func (a *Adapter) PrepareImportedCredential(ctx context.Context, seed provider.CredentialSeed) (provider.CredentialSeed, error) {
	if strings.TrimSpace(seed.AccessToken) != "" || strings.TrimSpace(seed.RefreshToken) == "" {
		return seed, nil
	}
	refreshCtx, cancel := context.WithTimeout(ctx, buildControlTimeout)
	defer cancel()
	tokens, err := a.oauth.refreshWithClientID(refreshCtx, strings.TrimSpace(seed.RefreshToken), seed.OIDCClientID)
	if err != nil {
		return provider.CredentialSeed{}, fmt.Errorf("验证 Grok Build refresh token: %w", err)
	}
	claims := decodeJWTClaims(firstNonEmpty(tokens.IDToken, tokens.AccessToken))
	seed.AccessToken = tokens.AccessToken
	seed.RefreshToken = tokens.RefreshToken
	seed.ExpiresAt = tokens.ExpiresAt
	seed.OIDCClientID = firstNonEmpty(seed.OIDCClientID, defaultOAuthClientID)
	seed.UserID = firstNonEmpty(seed.UserID, stringClaim(claims, "sub"))
	seed.Email = firstNonEmpty(seed.Email, stringClaim(claims, "email"))
	seed.TeamID = firstNonEmpty(seed.TeamID, stringClaim(claims, "team_id"))
	if seed.Name == "" || seed.Name == "Grok Build account" {
		seed.Name = firstNonEmpty(seed.Email, seed.UserID, "Grok Build account")
	}
	identity := firstNonEmpty(seed.UserID, strings.ToLower(seed.Email), seed.TeamID, seed.RefreshToken, seed.AccessToken)
	seed.SourceKey = "import:" + security.HashToken(strings.Join([]string{credentialImportProvider, seed.OIDCClientID, identity}, "|"))
	return seed, nil
}

func (a *Adapter) MarshalCredentials(values []provider.CredentialSeed) ([]byte, error) {
	return marshalCredentials(values)
}
