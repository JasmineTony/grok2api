package provider

import (
	"github.com/chenyme/grok2api/backend/internal/domain/account"
)

// Registry 是 application 查询 Provider 能力与适配器的最小契约：
// 按 Provider 身份取得已注册的能力适配器、静态能力定义与路由元数据。
//
// 方法集合来自 application 生产代码的实际调用面，不包含仅供装配与自检使用的
// 维护方法（Get / Validate / TierOrder / TierOrderForQuotaMode）——这些仍只属于
// infra/provider.Registry 实现本身。实现由 internal/infra/provider 提供，契约包
// 不反向依赖实现。
type Registry interface {
	// Definition 返回已注册 Provider 的静态能力定义。
	Definition(value account.Provider) (Definition, bool)
	// Providers 返回已注册 Provider 的固定渠道顺序列表。
	Providers() []account.Provider
	// QuotaKind 返回号池额度的权威来源。
	QuotaKind(value account.Provider) (QuotaKind, bool)
	// UsageKind 返回文本推理 usage 的权威性。
	UsageKind(value account.Provider) (UsageKind, bool)
	// QuotaMode 把上游模型映射为可路由的额度模式。
	QuotaMode(value account.Provider, upstreamModel string) string
	// QuotaRefreshGroup 把上游模型映射为内部额度刷新分组。
	QuotaRefreshGroup(value account.Provider, upstreamModel string) string
	// PricingModel 把 Provider 私有模型标识映射为公开计费模型。
	PricingModel(value account.Provider, upstreamModel string) string
	// SupportsStoredResponses 报告 Provider 是否支持持久化 Responses。
	SupportsStoredResponses(value account.Provider) bool
	// SupportsConversation 报告 Provider 是否声明指定统一对话操作。
	SupportsConversation(value account.Provider, operation string) bool
	// SupportsResponseCompaction 报告 Provider 是否支持 Responses 压缩。
	SupportsResponseCompaction(value account.Provider) bool
	// SupportsCredentialRefresh 报告 Provider 是否支持凭据刷新。
	SupportsCredentialRefresh(value account.Provider) bool
	// RetryForbiddenAsEgress 报告 403 是否应按出口节点问题重试。
	RetryForbiddenAsEgress(value account.Provider) bool
	// ResolveModelAlias 把隐藏的兼容模型名解析为规范内部路由。
	ResolveModelAlias(value string) (ModelAlias, bool)
	// CredentialMetadata 返回可安全用于管理端展示的凭据派生元数据。
	CredentialMetadata(credential account.Credential) CredentialMetadata

	// Responses 返回对话转发能力适配器。
	Responses(value account.Provider) (ResponseAdapter, bool)
	// Models 返回模型目录能力适配器。
	Models(value account.Provider) (ModelCatalogAdapter, bool)
	// Billing 返回 Billing 额度能力适配器。
	Billing(value account.Provider) (BillingAdapter, bool)
	// CredentialRefresh 返回凭据刷新能力适配器。
	CredentialRefresh(value account.Provider) (CredentialRefreshAdapter, bool)
	// DeviceOAuth 返回 Device OAuth 能力适配器。
	DeviceOAuth(value account.Provider) (DeviceOAuthAdapter, bool)
	// CredentialCodec 返回凭据编解码能力适配器。
	CredentialCodec(value account.Provider) (CredentialCodecAdapter, bool)
	// AccountIdentity 返回账号身份同步能力适配器。
	AccountIdentity(value account.Provider) (AccountIdentityAdapter, bool)
	// BuildConverter 返回 Build 凭据转换能力适配器。
	BuildConverter(value account.Provider) (BuildCredentialConverter, bool)
	// Quota 返回窗口额度能力适配器。
	Quota(value account.Provider) (QuotaAdapter, bool)
	// QuotaGroup 返回分组额度能力适配器。
	QuotaGroup(value account.Provider) (QuotaGroupAdapter, bool)
	// WebAccountSettings 返回 Grok Web 账号设置能力适配器。
	WebAccountSettings() (WebAccountSettingsAdapter, bool)
	// ImageGeneration 返回图像生成能力适配器。
	ImageGeneration(value account.Provider) (ImageGenerationAdapter, bool)
	// ImageEdit 返回图像编辑能力适配器。
	ImageEdit(value account.Provider) (ImageEditAdapter, bool)
	// Videos 返回视频生成能力适配器。
	Videos(value account.Provider) (VideoAdapter, bool)
	// TTS 返回语音合成能力适配器。
	TTS(value account.Provider) (TTSAdapter, bool)
	// STT 返回语音识别能力适配器。
	STT(value account.Provider) (STTAdapter, bool)
	// VoiceWebSocket 返回实时语音 WebSocket 能力适配器。
	VoiceWebSocket(value account.Provider) (VoiceWebSocketAdapter, bool)
}
