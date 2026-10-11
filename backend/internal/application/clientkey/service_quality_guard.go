package clientkey

import (
	"context"
	"errors"
	"fmt"

	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// EnsureQualityGuardIdentity creates or reconciles the non-exportable system
// identity used to attribute quality probes. It is stable across restarts and
// cannot authenticate through the public API even if its secret is exposed.
func (s *Service) EnsureQualityGuardIdentity(ctx context.Context, enabled bool) (clientkeydomain.Key, error) {
	value, err := s.keys.GetByPrefix(ctx, qualityGuardInternalPrefix)
	if errors.Is(err, repository.ErrNotFound) {
		if !enabled {
			return clientkeydomain.Key{}, nil
		}
		value, err = s.createQualityGuardIdentity(ctx)
		if errors.Is(err, repository.ErrConflict) {
			value, err = s.keys.GetByPrefix(ctx, qualityGuardInternalPrefix)
		}
	}
	if err != nil {
		return clientkeydomain.Key{}, fmt.Errorf("读取系统质量探测身份: %w", err)
	}
	if value.InternalKind != clientkeydomain.InternalKindQualityGuard {
		return clientkeydomain.Key{}, fmt.Errorf("%w: 保留前缀已被占用", ErrConflict)
	}
	value.Name = qualityGuardInternalName
	value.Enabled = enabled
	value.ExpiresAt = nil
	value.RPMLimit = 0
	value.MaxConcurrent = 0
	value.BillingLimitUSDTicks = 0
	value.AllowModelAliases = false
	value.AllowedModels = nil
	value.ProviderScope = clientkeydomain.ProviderScopeBuild
	value.TierScope = clientkeydomain.TierScopeAll
	updated, err := s.keys.Update(ctx, value)
	if err != nil {
		return clientkeydomain.Key{}, fmt.Errorf("更新系统质量探测身份: %w", err)
	}
	s.authCache.deleteID(updated.ID)
	return updated, nil
}

func (s *Service) createQualityGuardIdentity(ctx context.Context) (clientkeydomain.Key, error) {
	if s.cipher == nil {
		return clientkeydomain.Key{}, errors.New("客户端 Key 加密器未配置")
	}
	secretPart, err := security.NewOpaqueToken(32)
	if err != nil {
		return clientkeydomain.Key{}, err
	}
	raw := security.FormatClientKey(qualityGuardInternalPrefix, secretPart)
	encrypted, err := s.cipher.Encrypt(raw)
	if err != nil {
		return clientkeydomain.Key{}, fmt.Errorf("加密系统质量探测身份: %w", err)
	}
	return s.keys.Create(ctx, clientkeydomain.Key{
		Name: qualityGuardInternalName, Prefix: qualityGuardInternalPrefix,
		SecretHash: security.HashToken(raw), EncryptedSecret: encrypted,
		InternalKind: clientkeydomain.InternalKindQualityGuard, Enabled: true,
		ProviderScope: clientkeydomain.ProviderScopeBuild, TierScope: clientkeydomain.TierScopeAll,
	})
}
