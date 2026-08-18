package account

import (
	"encoding/base64"
	"testing"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/infra/provider"
	cliprovider "github.com/chenyme/grok2api/backend/internal/infra/provider/cli"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
)

func TestCredentialFromSeedKeepsStorageDefaultsAtNormalizerBoundary(t *testing.T) {
	cipher, err := security.NewCipher(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	adapter := cliprovider.NewAdapter(cliprovider.Config{}, cipher)
	service := NewService(nil, nil, nil, nil, provider.NewRegistry(adapter), cipher, nil)

	value, err := service.credentialFromSeed(provider.CredentialSeed{
		Name:         "device-login",
		AccessToken:  "access-token",
		RefreshToken: "refresh-token",
	})
	if err != nil {
		t.Fatal(err)
	}
	if value.Provider != accountdomain.ProviderBuild || value.AuthType != accountdomain.AuthTypeOAuth {
		t.Fatalf("provider/auth type = %s/%s", value.Provider, value.AuthType)
	}
	if value.SourceKey != "device:"+security.HashToken("access-token") {
		t.Fatalf("source key = %q", value.SourceKey)
	}
	if got, err := cipher.Decrypt(value.EncryptedAccessToken); err != nil || got != "access-token" {
		t.Fatalf("access token decrypt = %q, error = %v", got, err)
	}
	if got, err := cipher.Decrypt(value.EncryptedRefreshToken); err != nil || got != "refresh-token" {
		t.Fatalf("refresh token decrypt = %q, error = %v", got, err)
	}
}
