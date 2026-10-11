// 账号读取契约：跨 feature 共用的账号/额度/计费 DTO。只依赖 shared，供 audits/quality-guard 等消费方复用。
export type AccountProvider = "grok_build" | "grok_web" | "grok_console";
export type BuildRouteMode = "auto" | "build" | "xai";

export type BillingDTO = {
  planCode?: string;
  planName?: string;
  monthlyLimit: number;
  used: number;
  remaining: number;
  onDemandCap: number;
  onDemandUsed: number;
  prepaidBalance: number;
  creditUsagePercent: number;
  isUnifiedBillingUser: boolean;
  onDemandEnabled?: boolean;
  topUpMethod?: string;
  usagePeriodType?: string;
  usagePeriodStart?: string;
  usagePeriodEnd?: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  history?: BillingHistoryDTO[];
  syncedAt: string;
};

export type BillingHistoryDTO = {
  year: number;
  month: number;
  periodType?: string;
  periodStart?: string;
  periodEnd?: string;
  includedUsed: number;
  onDemandUsed: number;
  totalUsed: number;
};

export type QuotaDTO = {
  type: "free" | "paid" | "unknown";
  source:
    "unknown" | "upstreamBilling" | "upstreamExhaustion" | "responseModel" | "billingProfile" | "buildSuperEntitlement";
  confidence: "estimated" | "observed" | "confirmed" | "";
  status: "active" | "waitingReset" | "probing";
  unit?: "tokens" | "credits" | "percent";
  used: number;
  limit: number;
  remaining: number;
  usagePercent: number;
  limitKnown: boolean;
  windowHours?: number;
  observed: boolean;
  confirmed: boolean;
  periodStart?: string;
  periodEnd?: string;
  exhaustedAt?: string;
  nextProbeAt?: string;
  lastConfirmedAt?: string;
  modelQuotaBlocks?: ModelQuotaBlockDTO[];
};

export type ModelQuotaBlockDTO = {
  model: string;
  reason: string;
  cooldownUntil?: string;
};

export type AccountDTO = {
  id: string;
  provider: AccountProvider;
  authType: "oauth" | "sso";
  webTier?: "auto" | "basic" | "super" | "heavy";
  webTierSyncedAt?: string;
  nsfwEnabledAt?: string;
  termsAcceptedAt?: string;
  name: string;
  email?: string;
  userId?: string;
  teamId?: string;
  enabled: boolean;
  authStatus: "active" | "reauthRequired";
  expiresAt?: string;
  refreshable: boolean;
  cloudflareCookieConfigured: boolean;
  buildSuperEntitled: boolean;
  buildRouteMode: BuildRouteMode;
  buildBotFlagged: boolean;
  /** Numeric bot_flag_source/bfs claim when risk-flagged: 1 or 2. */
  buildBotFlagSource?: number;
  egressNodeId?: string;
  egressAssignmentMode?: "manual" | "auto";
  modelSyncFailed?: boolean;
  refreshDueAt?: string;
  lastRefreshAt?: string;
  refreshFailureCount: number;
  lastRefreshErrorStatus?: number;
  lastRefreshErrorCode?: string;
  lastRefreshErrorMessage?: string;
  lastRefreshErrorResponse?: string;
  priority: number;
  maxConcurrent: number;
  minimumRemaining: number;
  failureCount: number;
  cooldownUntil?: string;
  lastError?: string;
  enabledDoesNotClearCooldown?: boolean;
  lastUsedAt?: string;
  linkedAccountId?: string;
  linkedAccountName?: string;
  linkedProvider?: "grok_build" | "grok_web";
  linkedAccounts?: LinkedAccountDTO[];
  createdAt: string;
  billing?: BillingDTO;
  quota: QuotaDTO;
  quotaWindows?: Array<{
    mode: string;
    remaining: number;
    total: number;
    usagePercent: number;
    breakdown?: Array<{ productCode: number; usagePercent: number }>;
    windowSeconds: number;
    resetAt?: string;
    syncedAt?: string;
    source: "default" | "estimated" | "upstream";
  }>;
};

export type LinkedAccountDTO = {
  id: string;
  provider: "grok_build" | "grok_web" | "grok_console";
  name: string;
  email?: string;
  userId?: string;
};
