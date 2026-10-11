package clientkey

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"strings"
	"time"

	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

func (s *Service) List(ctx context.Context, page, pageSize int, search string, filter ListFilter) ([]clientkeydomain.Key, int64, error) {
	page, pageSize = normalizePage(page, pageSize)
	if !validListFilter(filter.Status, "", "active", "disabled", "expired") || !validListFilter(filter.ModelScope, "", "all", "restricted") || !repository.IsValidSort(filter.Sort, "name", "prefix", "status", "rpmLimit", "maxConcurrent", "billingLimit", "expiresAt", "lastUsedAt") {
		return nil, 0, ErrInvalidFilter
	}
	if prefix, ok := security.SplitClientKey(strings.TrimSpace(search)); ok {
		search = prefix
	}
	return s.keys.List(ctx, repository.ClientKeyListQuery{Page: repository.PageQuery{Offset: (page - 1) * pageSize, Limit: pageSize, Search: search, Sort: filter.Sort}, Filter: repository.ClientKeyListFilter{Status: filter.Status, ModelScope: filter.ModelScope, Now: time.Now().UTC()}})
}

// Get returns one client key policy for trusted application services. It does
// not reveal the plaintext secret and must not be exposed by public handlers.
func (s *Service) Get(ctx context.Context, id uint64) (clientkeydomain.Key, error) {
	if id == 0 {
		return clientkeydomain.Key{}, ErrNotFound
	}
	value, err := s.keys.Get(ctx, id)
	return value, mapRepositoryError(err)
}

// Create 创建客户端 Key；哈希用于鉴权，加密副本仅供管理员按需再次复制。
func (s *Service) Create(ctx context.Context, input CreateInput) (Created, error) {
	if err := validateCreateInput(input); err != nil {
		return Created{}, err
	}
	providerScope, tierScope, err := normalizeCreateScopes(input.ProviderScope, input.TierScope)
	if err != nil {
		return Created{}, err
	}
	prefix, raw, encryptedSecret, err := s.issueClientKeySecret()
	if err != nil {
		return Created{}, err
	}
	input, err = s.applyCreateLimitDefaults(input)
	if err != nil {
		return Created{}, err
	}
	value, err := s.keys.Create(ctx, clientkeydomain.Key{
		Name: strings.TrimSpace(input.Name), Prefix: prefix, SecretHash: security.HashToken(raw), EncryptedSecret: encryptedSecret,
		Enabled: input.Enabled, ExpiresAt: input.ExpiresAt, RPMLimit: input.RPMLimit, MaxConcurrent: input.MaxConcurrent,
		BillingLimitUSDTicks: input.BillingLimitUSDTicks, AllowModelAliases: input.AllowModelAliases, AllowedModels: input.AllowedModels,
		ProviderScope: providerScope, TierScope: tierScope,
	})
	return Created{Key: value, Secret: raw}, mapRepositoryError(err)
}

// validateCreateInput 校验新建 Key 的名称与限额区间，检查顺序与错误文案保持稳定。
func validateCreateInput(input CreateInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return invalidInput("Key 名称不能为空")
	}
	if input.RPMLimit < 0 || input.RPMLimit > clientkeydomain.MaxRPMLimit {
		return invalidInput("rpmLimit 必须在 0 到 100000 之间")
	}
	if input.MaxConcurrent < 0 || input.MaxConcurrent > clientkeydomain.MaxConcurrent {
		return invalidInput("maxConcurrent 必须在 0 到 1024 之间")
	}
	if input.BillingLimitUSDTicks < 0 || input.BillingLimitUSDTicks > clientkeydomain.MaxBillingLimitTicks {
		return invalidInput("billingLimitUsdTicks 超出允许范围")
	}
	return nil
}

// normalizeCreateScopes 规范化新建 Key 的 Provider 与 Tier 范围。
func normalizeCreateScopes(providerScope clientkeydomain.ProviderScope, tierScope clientkeydomain.TierScope) (clientkeydomain.ProviderScope, clientkeydomain.TierScope, error) {
	normalizedProviderScope, providerScopeValid := clientkeydomain.NormalizeProviderScope(providerScope)
	normalizedTierScope, tierScopeValid := clientkeydomain.NormalizeTierScope(tierScope)
	if !providerScopeValid || !tierScopeValid {
		return 0, 0, invalidInput("providerScope 或 tierScope 无效")
	}
	return normalizedProviderScope, normalizedTierScope, nil
}

// issueClientKeySecret 生成密钥前缀与明文，并返回用于持久化的加密副本。
func (s *Service) issueClientKeySecret() (string, string, string, error) {
	prefix, err := security.NewHexToken(6)
	if err != nil {
		return "", "", "", err
	}
	secretPart, err := security.NewOpaqueToken(24)
	if err != nil {
		return "", "", "", err
	}
	raw := security.FormatClientKey(prefix, secretPart)
	if s.cipher == nil {
		return "", "", "", errors.New("客户端 Key 加密器未配置")
	}
	encryptedSecret, err := s.cipher.Encrypt(raw)
	if err != nil {
		return "", "", "", fmt.Errorf("加密客户端 Key: %w", err)
	}
	return prefix, raw, encryptedSecret, nil
}

// applyCreateLimitDefaults 按默认值补齐未指定限额，并保留“显式无限”语义。
func (s *Service) applyCreateLimitDefaults(input CreateInput) (CreateInput, error) {
	if input.RPMUnlimited {
		input.RPMLimit = 0
	} else if input.RPMLimit == 0 {
		input.RPMLimit = int(s.defaultRPM.Load())
	}
	if input.ConcurrencyUnlimited {
		input.MaxConcurrent = 0
	} else if input.MaxConcurrent == 0 {
		input.MaxConcurrent = int(s.defaultMax.Load())
	}
	if input.RPMLimit < 0 || input.MaxConcurrent < 0 {
		return CreateInput{}, invalidInput("RPM 和最大并发不能小于零")
	}
	return input, nil
}

// RevealSecret 解密指定客户端 Key，并校验密文、前缀和鉴权哈希仍然一致。
func (s *Service) RevealSecret(ctx context.Context, id uint64) (string, error) {
	value, err := s.keys.Get(ctx, id)
	if err != nil {
		return "", mapRepositoryError(err)
	}
	if value.InternalKind != "" {
		return "", ErrSystemManaged
	}
	if s.cipher == nil || value.EncryptedSecret == "" {
		return "", ErrSecretUnavailable
	}
	raw, err := s.cipher.Decrypt(value.EncryptedSecret)
	if err != nil {
		return "", fmt.Errorf("解密客户端 Key: %w", err)
	}
	prefix, ok := security.SplitClientKey(raw)
	if !ok || prefix != value.Prefix || subtle.ConstantTimeCompare([]byte(security.HashToken(raw)), []byte(value.SecretHash)) != 1 {
		return "", errors.New("客户端 Key 加密副本校验失败")
	}
	return raw, nil
}

func (s *Service) Update(ctx context.Context, id uint64, input UpdateInput) (clientkeydomain.Key, error) {
	value, err := s.keys.Get(ctx, id)
	if err != nil {
		return clientkeydomain.Key{}, mapRepositoryError(err)
	}
	if value.InternalKind != "" {
		return clientkeydomain.Key{}, ErrSystemManaged
	}
	value, err = applyClientKeyIdentityUpdate(value, input)
	if err != nil {
		return clientkeydomain.Key{}, err
	}
	value, err = applyClientKeyLimitUpdate(value, input)
	if err != nil {
		return clientkeydomain.Key{}, err
	}
	value, err = applyClientKeyScopeUpdate(value, input)
	if err != nil {
		return clientkeydomain.Key{}, err
	}
	updated, err := s.keys.Update(ctx, value)
	if err == nil {
		s.authCache.deleteID(id)
	}
	return updated, mapRepositoryError(err)
}

// applyClientKeyIdentityUpdate 覆盖名称、启用状态与过期时间。
func applyClientKeyIdentityUpdate(value clientkeydomain.Key, input UpdateInput) (clientkeydomain.Key, error) {
	if input.Name != nil {
		value.Name = strings.TrimSpace(*input.Name)
		if value.Name == "" {
			return clientkeydomain.Key{}, invalidInput("Key 名称不能为空")
		}
	}
	if input.Enabled != nil {
		value.Enabled = *input.Enabled
	}
	if input.ClearExpiresAt {
		value.ExpiresAt = nil
	} else if input.ExpiresAt != nil {
		value.ExpiresAt = input.ExpiresAt
	}
	return value, nil
}

// applyClientKeyLimitUpdate 覆盖 RPM、并发与计费限额，越界时返回参数错误。
func applyClientKeyLimitUpdate(value clientkeydomain.Key, input UpdateInput) (clientkeydomain.Key, error) {
	if input.RPMLimit != nil {
		if *input.RPMLimit < 0 || *input.RPMLimit > clientkeydomain.MaxRPMLimit {
			return clientkeydomain.Key{}, invalidInput("rpmLimit 必须在 0 到 100000 之间")
		}
		value.RPMLimit = *input.RPMLimit
	}
	if input.MaxConcurrent != nil {
		if *input.MaxConcurrent < 0 || *input.MaxConcurrent > clientkeydomain.MaxConcurrent {
			return clientkeydomain.Key{}, invalidInput("maxConcurrent 必须在 0 到 1024 之间")
		}
		value.MaxConcurrent = *input.MaxConcurrent
	}
	if input.BillingLimitUSDTicks != nil {
		if *input.BillingLimitUSDTicks < 0 || *input.BillingLimitUSDTicks > clientkeydomain.MaxBillingLimitTicks {
			return clientkeydomain.Key{}, invalidInput("billingLimitUsdTicks 超出允许范围")
		}
		value.BillingLimitUSDTicks = *input.BillingLimitUSDTicks
	}
	return value, nil
}

// applyClientKeyScopeUpdate 覆盖模型别名、模型白名单与 Provider/Tier 范围。
func applyClientKeyScopeUpdate(value clientkeydomain.Key, input UpdateInput) (clientkeydomain.Key, error) {
	if input.AllowModelAliases != nil {
		value.AllowModelAliases = *input.AllowModelAliases
	}
	if input.AllowedModels != nil {
		value.AllowedModels = *input.AllowedModels
	}
	if input.ProviderScope != nil {
		providerScope, valid := clientkeydomain.NormalizeProviderScope(*input.ProviderScope)
		if !valid {
			return clientkeydomain.Key{}, invalidInput("providerScope 无效")
		}
		value.ProviderScope = providerScope
	}
	if input.TierScope != nil {
		tierScope, valid := clientkeydomain.NormalizeTierScope(*input.TierScope)
		if !valid {
			return clientkeydomain.Key{}, invalidInput("tierScope 无效")
		}
		value.TierScope = tierScope
	}
	return value, nil
}

func (s *Service) Delete(ctx context.Context, id uint64) error {
	value, err := s.keys.Get(ctx, id)
	if err != nil {
		return mapRepositoryError(err)
	}
	if value.InternalKind != "" {
		return ErrSystemManaged
	}
	if err := s.keys.Delete(ctx, id); err != nil {
		return mapRepositoryError(err)
	}
	s.touches.deleteID(id)
	s.authCache.deleteID(id)
	return nil
}
