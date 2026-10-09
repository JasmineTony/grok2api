package provider

import (
	"errors"
	"fmt"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	ports "github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// Registry stores enabled Provider Adapters and does not create placeholders for unsupported sources.
type Registry struct {
	adapters    map[account.Provider]ports.Adapter
	definitions map[account.Provider]ports.Definition
	aliases     map[string]ports.ModelAlias
	issues      []error
}

// Registry 是 ports.Registry 契约的唯一生产实现；此处用编译期断言固定该关系。
var _ ports.Registry = (*Registry)(nil)

func NewRegistry(adapters ...ports.Adapter) *Registry {
	registry := &Registry{
		adapters:    make(map[account.Provider]ports.Adapter, len(adapters)),
		definitions: make(map[account.Provider]ports.Definition, len(adapters)),
		aliases:     make(map[string]ports.ModelAlias),
	}
	for _, adapter := range adapters {
		if adapter == nil {
			registry.issues = append(registry.issues, errors.New("Provider Adapter 不能为空"))
			continue
		}
		providerValue := adapter.Provider()
		if !providerValue.IsValid() {
			registry.issues = append(registry.issues, fmt.Errorf("Provider Adapter 身份 %q 无效", providerValue))
			continue
		}
		if _, exists := registry.adapters[providerValue]; exists {
			registry.issues = append(registry.issues, fmt.Errorf("Provider %s 重复注册", providerValue))
			continue
		}
		registry.adapters[providerValue] = adapter
		if source, ok := adapter.(ports.DefinitionAdapter); ok {
			registry.definitions[providerValue] = source.Definition().Clone()
		}
		if source, ok := adapter.(ports.ModelAliasAdapter); ok {
			for _, value := range source.ModelAliases() {
				if value.Alias == "" || value.PublicModel == "" {
					continue
				}
				if value.Provider != providerValue {
					registry.issues = append(registry.issues, fmt.Errorf("Provider %s 的模型别名 %q 指向了 %s", providerValue, value.Alias, value.Provider))
					continue
				}
				if !modeldomain.IsCanonicalPublicID(value.Provider, value.PublicModel) {
					registry.issues = append(registry.issues, fmt.Errorf("Provider %s 的模型别名 %q 目标 %q 不是规范内部路由 ID", providerValue, value.Alias, value.PublicModel))
					continue
				}
				if existing, exists := registry.aliases[value.Alias]; exists {
					if existing != value {
						registry.issues = append(registry.issues, fmt.Errorf("模型别名 %q 重复注册", value.Alias))
					}
					continue
				}
				registry.aliases[value.Alias] = value
			}
		}
	}
	return registry
}

// Get returns a registered Provider Adapter.
func (r *Registry) Get(value account.Provider) (ports.Adapter, bool) {
	adapter, ok := r.adapters[value]
	return adapter, ok
}

// ResolveModelAlias returns the canonical internal route for a hidden compatibility model name.
func (r *Registry) ResolveModelAlias(value string) (ports.ModelAlias, bool) {
	result, ok := r.aliases[value]
	return result, ok
}

// Definition returns the stable capability declaration from a production Adapter.
func (r *Registry) Definition(value account.Provider) (ports.Definition, bool) {
	definition, ok := r.definitions[value]
	return definition.Clone(), ok
}

// Providers returns registered Providers in fixed channel order with capability definitions.
func (r *Registry) Providers() []account.Provider {
	values := make([]account.Provider, 0, len(r.definitions))
	for _, value := range account.Providers() {
		if _, ok := r.definitions[value]; ok {
			values = append(values, value)
		}
	}
	return values
}

// Validate checks that production registry definitions match their implemented capability interfaces.
func (r *Registry) Validate() error {
	if r == nil {
		return errors.New("Provider Registry 不能为空")
	}
	if len(r.issues) > 0 {
		return errors.Join(r.issues...)
	}
	for _, value := range account.Providers() {
		adapter, registered := r.adapters[value]
		definition, described := r.definitions[value]
		if !registered || !described {
			return fmt.Errorf("Provider %s 未完整注册 Adapter 与 Definition", value)
		}
		if definition.Provider != value {
			return fmt.Errorf("Provider %s 的 Definition 身份不一致", value)
		}
		if err := definition.Validate(); err != nil {
			return err
		}
		if definition.Conversation.Responses || definition.Conversation.ChatCompletions || definition.Conversation.Messages {
			if _, ok := adapter.(ports.ResponseAdapter); !ok {
				return fmt.Errorf("Provider %s 声明对话能力但未实现适配器", value)
			}
		}
		if _, ok := adapter.(ports.ModelCatalogAdapter); !ok {
			return fmt.Errorf("Provider %s 未实现模型目录适配器", value)
		}
		switch definition.Quota {
		case ports.QuotaBilling:
			if _, ok := adapter.(ports.BillingAdapter); !ok {
				return fmt.Errorf("Provider %s 声明 Billing 额度但未实现适配器", value)
			}
		case ports.QuotaRemoteWindow, ports.QuotaLocalWindow:
			if _, ok := adapter.(ports.QuotaAdapter); !ok {
				return fmt.Errorf("Provider %s 声明窗口额度但未实现适配器", value)
			}
		}
		if definition.Credential.Import {
			if _, ok := adapter.(ports.CredentialCodecAdapter); !ok {
				return fmt.Errorf("Provider %s 声明凭据导入但未实现适配器", value)
			}
		}
		if definition.Credential.Refresh {
			if _, ok := adapter.(ports.CredentialRefreshAdapter); !ok {
				return fmt.Errorf("Provider %s 声明凭据刷新但未实现适配器", value)
			}
		}
		if definition.Credential.DeviceOAuth {
			if _, ok := adapter.(ports.DeviceOAuthAdapter); !ok {
				return fmt.Errorf("Provider %s 声明 Device OAuth 但未实现适配器", value)
			}
		}
		if definition.Media.ImageGeneration {
			if _, ok := adapter.(ports.ImageGenerationAdapter); !ok {
				return fmt.Errorf("Provider %s 声明图像生成能力但未实现适配器", value)
			}
		}
		if definition.Media.ImageEdit {
			if _, ok := adapter.(ports.ImageEditAdapter); !ok {
				return fmt.Errorf("Provider %s 声明图像编辑能力但未实现适配器", value)
			}
		}
		if definition.Media.VideoGeneration {
			if _, ok := adapter.(ports.VideoAdapter); !ok {
				return fmt.Errorf("Provider %s 声明视频能力但未实现适配器", value)
			}
		}
		if definition.Media.TTS {
			if _, ok := adapter.(ports.TTSAdapter); !ok {
				return fmt.Errorf("Provider %s 声明语音合成能力但未实现适配器", value)
			}
		}
		if definition.Media.STT {
			if _, ok := adapter.(ports.STTAdapter); !ok {
				return fmt.Errorf("Provider %s 声明语音识别能力但未实现适配器", value)
			}
		}
		if definition.Media.Realtime {
			if _, ok := adapter.(ports.VoiceWebSocketAdapter); !ok {
				return fmt.Errorf("Provider %s 声明实时语音能力但未实现 WebSocket 适配器", value)
			}
		}
	}
	return nil
}

func (r *Registry) SupportsStoredResponses(value account.Provider) bool {
	definition, ok := r.Definition(value)
	return ok && definition.Conversation.StoredResponses
}

func (r *Registry) SupportsConversation(value account.Provider, operation string) bool {
	definition, ok := r.Definition(value)
	return ok && definition.Conversation.Supports(operation)
}

func (r *Registry) SupportsResponseCompaction(value account.Provider) bool {
	definition, ok := r.Definition(value)
	return ok && definition.Conversation.Compact
}

func (r *Registry) SupportsCredentialRefresh(value account.Provider) bool {
	definition, ok := r.Definition(value)
	return ok && definition.Credential.Refresh
}

func (r *Registry) QuotaKind(value account.Provider) (ports.QuotaKind, bool) {
	definition, ok := r.Definition(value)
	if !ok {
		return "", false
	}
	return definition.Quota, true
}

func (r *Registry) UsageKind(value account.Provider) (ports.UsageKind, bool) {
	definition, ok := r.Definition(value)
	if !ok {
		return "", false
	}
	return definition.Inference.Usage, true
}

func (r *Registry) RetryForbiddenAsEgress(value account.Provider) bool {
	definition, ok := r.Definition(value)
	return ok && definition.Inference.RetryForbiddenAsEgress
}

func (r *Registry) Responses(value account.Provider) (ports.ResponseAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.ResponseAdapter)
	return result, ok
}

func (r *Registry) Models(value account.Provider) (ports.ModelCatalogAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.ModelCatalogAdapter)
	return result, ok
}

func (r *Registry) Billing(value account.Provider) (ports.BillingAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.BillingAdapter)
	return result, ok
}

func (r *Registry) CredentialRefresh(value account.Provider) (ports.CredentialRefreshAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.CredentialRefreshAdapter)
	return result, ok
}

func (r *Registry) DeviceOAuth(value account.Provider) (ports.DeviceOAuthAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.DeviceOAuthAdapter)
	return result, ok
}

func (r *Registry) CredentialCodec(value account.Provider) (ports.CredentialCodecAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.CredentialCodecAdapter)
	return result, ok
}

// CredentialMetadata returns derived credential metadata safe for admin display.
func (r *Registry) CredentialMetadata(credential account.Credential) ports.CredentialMetadata {
	if r == nil {
		return ports.CredentialMetadata{}
	}
	adapter, ok := r.adapters[credential.Provider]
	if !ok {
		return ports.CredentialMetadata{}
	}
	inspector, ok := adapter.(ports.CredentialMetadataAdapter)
	if !ok {
		return ports.CredentialMetadata{}
	}
	return inspector.CredentialMetadata(credential)
}

func (r *Registry) AccountIdentity(value account.Provider) (ports.AccountIdentityAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.AccountIdentityAdapter)
	return result, ok
}

func (r *Registry) BuildConverter(value account.Provider) (ports.BuildCredentialConverter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.BuildCredentialConverter)
	return result, ok
}

func (r *Registry) Quota(value account.Provider) (ports.QuotaAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.QuotaAdapter)
	return result, ok
}

func (r *Registry) QuotaGroup(value account.Provider) (ports.QuotaGroupAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.QuotaGroupAdapter)
	return result, ok
}

// WebAccountSettings returns the Grok Web-specific account profile settings capability.
func (r *Registry) WebAccountSettings() (ports.WebAccountSettingsAdapter, bool) {
	adapter, ok := r.Get(account.ProviderWeb)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.WebAccountSettingsAdapter)
	return result, ok
}

func (r *Registry) QuotaMode(value account.Provider, upstreamModel string) string {
	adapter, ok := r.Get(value)
	if !ok {
		return ""
	}
	metadata, ok := adapter.(ports.RoutingMetadataAdapter)
	if !ok {
		return ""
	}
	return metadata.QuotaMode(upstreamModel)
}

func (r *Registry) QuotaRefreshGroup(value account.Provider, upstreamModel string) string {
	adapter, ok := r.Get(value)
	if !ok {
		return ""
	}
	metadata, ok := adapter.(ports.QuotaRefreshMetadataAdapter)
	if !ok {
		return ""
	}
	return metadata.QuotaRefreshGroup(upstreamModel)
}

func (r *Registry) TierOrder(value account.Provider, upstreamModel string) []account.WebTier {
	adapter, ok := r.Get(value)
	if !ok {
		return nil
	}
	metadata, ok := adapter.(ports.RoutingMetadataAdapter)
	if !ok {
		return nil
	}
	return metadata.TierOrder(upstreamModel)
}

func (r *Registry) TierOrderForQuotaMode(value account.Provider, upstreamModel, quotaMode string) []account.WebTier {
	adapter, ok := r.Get(value)
	if !ok {
		return nil
	}
	if metadata, ok := adapter.(ports.QuotaTierOrderAdapter); ok {
		return metadata.TierOrderForQuotaMode(upstreamModel, quotaMode)
	}
	metadata, ok := adapter.(ports.RoutingMetadataAdapter)
	if !ok {
		return nil
	}
	return metadata.TierOrder(upstreamModel)
}

func (r *Registry) PricingModel(value account.Provider, upstreamModel string) string {
	adapter, ok := r.Get(value)
	if !ok {
		return upstreamModel
	}
	metadata, ok := adapter.(ports.PricingMetadataAdapter)
	if !ok {
		return upstreamModel
	}
	if model := metadata.PricingModel(upstreamModel); model != "" {
		return model
	}
	return upstreamModel
}

// ImageGeneration returns the image-generation capability registered by the Provider.
func (r *Registry) ImageGeneration(value account.Provider) (ports.ImageGenerationAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.ImageGenerationAdapter)
	return result, ok
}

// ImageEdit returns the image-editing capability registered by the Provider.
func (r *Registry) ImageEdit(value account.Provider) (ports.ImageEditAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.ImageEditAdapter)
	return result, ok
}

func (r *Registry) Videos(value account.Provider) (ports.VideoAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.VideoAdapter)
	return result, ok
}

func (r *Registry) TTS(value account.Provider) (ports.TTSAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.TTSAdapter)
	return result, ok
}

func (r *Registry) STT(value account.Provider) (ports.STTAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.STTAdapter)
	return result, ok
}

func (r *Registry) VoiceWebSocket(value account.Provider) (ports.VoiceWebSocketAdapter, bool) {
	adapter, ok := r.Get(value)
	if !ok {
		return nil, false
	}
	result, ok := adapter.(ports.VoiceWebSocketAdapter)
	return result, ok
}
