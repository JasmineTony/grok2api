export type AccountProvider = "grok_build" | "grok_web" | "grok_console";
export type BuildRouteMode = "auto" | "build" | "xai";
export type AccountCleanupStatus = "cooldown" | "disabled" | "reauthRequired";
export type AccountState =
  "ready" | "degraded" | "cooldown" | "quota_exhausted" | "reauth_required" | "disabled";

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
    | "unknown"
    | "upstreamBilling"
    | "upstreamExhaustion"
    | "responseModel"
    | "billingProfile"
    | "buildSuperEntitlement";
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
  state: AccountState;
  stateChangedAt?: string;
  expiresAt?: string;
  refreshable: boolean;
  cloudflareCookieConfigured: boolean;
  buildSuperEntitled: boolean;
  buildRouteMode: BuildRouteMode;
  buildBotFlagged: boolean;
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

export type AccountStateEventDTO = {
  id: string;
  fromState: AccountState;
  toState: AccountState;
  event: string;
  reason?: string;
  createdAt: string;
};

export type AccountEgressPolicyStrategy = "inherit" | "node" | "direct";
export type AccountEgressPolicyDTO = {
  accountId: string;
  strategy: AccountEgressPolicyStrategy;
  egressNodeId?: string;
  allowDirectFallback: boolean;
  createdAt?: string;
  updatedAt?: string;
};
export type AccountEgressPolicyInput = {
  strategy: AccountEgressPolicyStrategy;
  egressNodeId?: string;
  allowDirectFallback: boolean;
};

export type LinkedAccountDTO = {
  id: string;
  provider: AccountProvider;
  name: string;
  email?: string;
  userId?: string;
};

export type AccountUpdateInput = {
  name: string;
  enabled: boolean;
  priority: number;
  maxConcurrent: number;
  minimumRemaining: number;
  cloudflareCookies?: string;
  clearCloudflareCookies?: boolean;
  buildSuperEntitled?: boolean;
  buildRouteMode?: BuildRouteMode;
};

export type AccountSummaryDTO = {
  total: number;
  available: number;
  recovering: number;
  attention: number;
  risk: number;
  providers: Record<AccountProvider, { total: number; available: number }>;
  recovery: { cooldown: number; waitingReset: number; probing: number };
  issues: { disabled: number; reauthRequired: number };
};

export type DeviceSessionDTO = {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  intervalSeconds: number;
  expiresAt: string;
};

export type DevicePollDTO = {
  status: "pending" | "succeeded" | "syncFailed";
  account?: AccountDTO;
  synced?: number;
  syncFailed?: number;
};
