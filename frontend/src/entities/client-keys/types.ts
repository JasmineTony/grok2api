// 客户端密钥读取契约：跨 feature 共用的密钥 DTO 与作用域枚举。只依赖 shared。
export type ProviderScopeValue = "all" | "grok_build" | "grok_web" | "grok_console";
export type TierScopeValue = "all" | "free" | "super";

export type ClientKeyDTO = {
  id: string;
  name: string;
  prefix: string;
  enabled: boolean;
  expiresAt?: string;
  rpmLimit: number;
  maxConcurrent: number;
  billingLimitUsdTicks: number;
  billedUsageUsdTicks: number;
  allowModelAliases: boolean;
  allowedModelIds: string[];
  providerScope?: ProviderScopeValue[];
  tierScope?: TierScopeValue[];
  lastUsedAt?: string;
};
