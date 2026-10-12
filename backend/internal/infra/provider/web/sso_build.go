package web

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	egressdomain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

const (
	ssoBuildClientID = "b1a00492-073a-47ea-816f-4c329264a828"
	ssoBuildScope    = "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write"
	ssoDeviceURL     = "https://auth.x.ai/oauth2/device/code"
	ssoVerifyURL     = "https://auth.x.ai/oauth2/device/verify"
	ssoApproveURL    = "https://auth.x.ai/oauth2/device/approve"
	ssoTokenURL      = "https://auth.x.ai/oauth2/token"
	maxAuthBody      = 2 << 20
)

type ssoBuildHTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}

type ssoBuildFlow struct {
	client    ssoBuildHTTPClient
	userAgent string
	cookies   map[string]string
}

func (a *Adapter) ConvertToBuild(ctx context.Context, credential accountdomain.Credential) (provider.CredentialSeed, error) {
	if credential.Provider != accountdomain.ProviderWeb || credential.AuthType != accountdomain.AuthTypeSSO {
		return provider.CredentialSeed{}, fmt.Errorf("仅 Grok Web SSO 账号支持转换")
	}
	token, err := a.cipher.Decrypt(credential.EncryptedAccessToken)
	if err != nil {
		return provider.CredentialSeed{}, fmt.Errorf("解密 Grok Web SSO: %w", err)
	}
	token = normalizeSSOToken(token)
	if token == "" {
		return provider.CredentialSeed{}, provider.ErrUnauthorized
	}
	lease, err := a.egress.AcquireCredential(ctx, egressdomain.ScopeWeb, credential)
	if err != nil {
		return provider.CredentialSeed{}, err
	}
	defer lease.Release()
	requestCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	flow := &ssoBuildFlow{
		client: lease, userAgent: lease.UserAgent,
		cookies: map[string]string{"sso": token, "sso-rw": token},
	}
	seed, err := flow.convert(requestCtx, credential)
	if err != nil {
		a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, conversionStatus(err), err)
		return provider.CredentialSeed{}, err
	}
	a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, http.StatusOK, nil)
	return seed, nil
}

// ssoBuildSeed 把签发的 OAuth 令牌与账号信息组装为凭据种子。
func ssoBuildSeed(credential accountdomain.Credential, token ssoBuildToken) provider.CredentialSeed {
	claims := decodeBuildClaims(firstValue(token.IDToken, token.AccessToken))
	userID := claimString(claims, "sub")
	email := claimString(claims, "email")
	teamID := claimString(claims, "team_id")
	name := strings.TrimSpace(credential.Name)
	if name == "" {
		name = "Grok Web account"
	}
	return provider.CredentialSeed{
		Provider: accountdomain.ProviderBuild, AuthType: accountdomain.AuthTypeOAuth,
		Name: firstValue(email, name+" Build", userID, "Grok Build account"), Email: email, UserID: userID, TeamID: teamID,
		SourceKey: "sso-build:" + security.HashToken(token.AccessToken), OIDCClientID: ssoBuildClientID,
		AccessToken: token.AccessToken, RefreshToken: token.RefreshToken, ExpiresAt: token.ExpiresAt,
	}
}

func (f *ssoBuildFlow) convert(ctx context.Context, credential accountdomain.Credential) (provider.CredentialSeed, error) {
	device, err := f.startSSODeviceFlow(ctx)
	if err != nil {
		return provider.CredentialSeed{}, err
	}
	consentURL, err := f.verifySSODeviceCode(ctx, device.UserCode)
	if err != nil {
		return provider.CredentialSeed{}, err
	}
	if err := f.approveSSODeviceCode(ctx, consentURL, device.UserCode); err != nil {
		return provider.CredentialSeed{}, err
	}
	token, err := f.pollToken(ctx, device.DeviceCode, time.Duration(device.Interval)*time.Second, time.Duration(device.ExpiresIn)*time.Second)
	if err != nil {
		return provider.CredentialSeed{}, err
	}
	return ssoBuildSeed(credential, token), nil
}

type ssoBuildToken struct {
	AccessToken  string
	RefreshToken string
	IDToken      string
	ExpiresAt    time.Time
}

func (f *ssoBuildFlow) pollToken(ctx context.Context, deviceCode string, interval, expiresIn time.Duration) (ssoBuildToken, error) {
	if interval < time.Second {
		interval = time.Second
	}
	deadline := time.Now().Add(min(expiresIn, 75*time.Second))
	for time.Now().Before(deadline) {
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ssoBuildToken{}, ctx.Err()
		case <-timer.C:
		}
		status, _, body, err := f.do(ctx, http.MethodPost, ssoTokenURL, url.Values{
			"grant_type": {"urn:ietf:params:oauth:grant-type:device_code"}, "client_id": {ssoBuildClientID}, "device_code": {deviceCode},
		})
		if err != nil {
			return ssoBuildToken{}, err
		}
		token, pending, slowDown, err := decodeSSOTokenPollResponse(status, body)
		switch {
		case err != nil:
			return ssoBuildToken{}, err
		case pending:
			continue
		case slowDown:
			interval += 5 * time.Second
			continue
		}
		return token, nil
	}
	return ssoBuildToken{}, fmt.Errorf("xAI Device Flow 轮询超时")
}

// decodeSSOTokenPollResponse 解析一次 device code 轮询响应；
// slowDown 表示上游要求降低轮询频率，pending 表示授权仍在等待用户确认。
func decodeSSOTokenPollResponse(status int, body []byte) (ssoBuildToken, bool, bool, error) {
	var payload struct {
		AccessToken      string `json:"access_token"`
		RefreshToken     string `json:"refresh_token"`
		IDToken          string `json:"id_token"`
		ExpiresIn        int    `json:"expires_in"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ssoBuildToken{}, false, false, fmt.Errorf("解析 xAI OAuth Token: %w", err)
	}
	if status >= 200 && status < 300 && payload.AccessToken != "" {
		if payload.ExpiresIn <= 0 {
			payload.ExpiresIn = 3600
		}
		return ssoBuildToken{
			AccessToken:  payload.AccessToken,
			RefreshToken: payload.RefreshToken,
			IDToken:      payload.IDToken,
			ExpiresAt:    time.Now().UTC().Add(time.Duration(payload.ExpiresIn) * time.Second),
		}, false, false, nil
	}
	switch payload.Error {
	case "authorization_pending":
		return ssoBuildToken{}, true, false, nil
	case "slow_down":
		return ssoBuildToken{}, false, true, nil
	case "access_denied", "expired_token":
		return ssoBuildToken{}, false, false, provider.ErrAuthorizationDenied
	default:
		if status >= 400 {
			return ssoBuildToken{}, false, false, fmt.Errorf("xAI OAuth Token 失败 (%s): %w", firstValue(payload.ErrorDescription, payload.Error), conversionHTTPError{status: status})
		}
		return ssoBuildToken{}, false, false, fmt.Errorf("xAI OAuth Token 失败: %s", firstValue(payload.ErrorDescription, payload.Error, strconv.Itoa(status)))
	}
}

func normalizeSSOToken(value string) string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(strings.ToLower(value), "sso=") {
		value = strings.TrimSpace(value[len("sso="):])
	}
	if token, _, found := strings.Cut(value, ";"); found {
		value = strings.TrimSpace(token)
	}
	return strings.NewReplacer("\r", "", "\n", "", "\x00", "").Replace(value)
}

func decodeBuildClaims(token string) map[string]any {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return nil
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil
	}
	var claims map[string]any
	if json.Unmarshal(data, &claims) != nil {
		return nil
	}
	return claims
}

func claimString(claims map[string]any, key string) string {
	value, _ := claims[key].(string)
	return strings.TrimSpace(value)
}

func firstValue(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

type conversionHTTPError struct{ status int }

func (e conversionHTTPError) Error() string { return fmt.Sprintf("xAI OAuth HTTP %d", e.status) }

func conversionStatus(err error) int {
	var statusErr conversionHTTPError
	if errors.As(err, &statusErr) {
		return statusErr.status
	}
	if errors.Is(err, provider.ErrUnauthorized) {
		return http.StatusUnauthorized
	}
	return 0
}

var _ provider.BuildCredentialConverter = (*Adapter)(nil)
var _ ssoBuildHTTPClient = (*infraegress.Lease)(nil)
