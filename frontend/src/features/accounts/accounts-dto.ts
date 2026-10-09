import {
  createObjectDecoder,
  createPaginatedDecoder,
  createValidatedDecoder,
  hasShape,
  isArrayOf,
  isBoolean,
  isNumber,
  isOneOf,
  isOptional,
  isRecordOf,
  isString,
  type ValueValidator,
} from "@/shared/api/decoder";
import type { AccountTaskProgressDTO } from "@/features/accounts/account-task-progress";

export type AccountProvider = "grok_build" | "grok_web" | "grok_console";
export type BuildRouteMode = "auto" | "build" | "xai";
export type AccountCleanupStatus = "cooldown" | "disabled" | "reauthRequired";

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

export type AccountUpdateInput = {
  name: string;
  enabled?: boolean;
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

export type LinkedDeleteTarget = AccountProvider;

export type AccountDeletionPreviewDTO = {
  rootCount: number;
  linkedByProvider: Partial<Record<AccountProvider, number>>;
  total: number;
};

export type AccountDeleteResultDTO = {
  deleted: number;
  rootsDeleted?: number;
  linkedDeleted?: number;
  // Batch paths skip whole groups that still have active media jobs.
  skipped?: number;
  deletedByProvider?: Partial<Record<AccountProvider, number>>;
};

export type AccountBatchResultDTO = { succeeded: number; failed: number };
export type AccountTokenRefreshResultDTO = AccountBatchResultDTO & { skipped: number };

/** 管理端 Grok Build 检测的单账号增量结果（SSE event: item）。 */
export type BuildDetectItemDTO = {
  id: string;
  name: string;
  email?: string;
  outcome: "ok" | "invalid" | "failed";
  reason?: string;
  httpStatus?: number;
};

export type BuildDetectHandlers = {
  onProgress?: (value: AccountTaskProgressDTO) => void;
  onItem?: (item: BuildDetectItemDTO) => void;
};

export type BuildConversionResultDTO = {
  created: number;
  linked: number;
  skipped: number;
  failed: number;
  synced: number;
  syncFailed: number;
};

export type AccountSyncStrategy = "missing" | "all";
export type BuildConversionStrategy = AccountSyncStrategy;
export type WebConsoleSyncStrategy = AccountSyncStrategy;

export type BuildConversionInput =
  | { all: true; ids?: never; strategy?: BuildConversionStrategy }
  | { all?: false; ids: string[]; strategy?: BuildConversionStrategy };

export type WebConsoleSyncInput =
  | { all: true; ids?: never; strategy: WebConsoleSyncStrategy }
  | { all?: false; ids: string[]; strategy: WebConsoleSyncStrategy };

export type WebAccountScriptActions = {
  acceptTerms: boolean;
  setBirthDate: boolean;
  enableNSFW: boolean;
};

export type WebAccountScriptsInput =
  | { all: true; ids?: never; actions: WebAccountScriptActions }
  | { all?: false; ids: string[]; actions: WebAccountScriptActions };

export type AccountImportResultDTO = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  synced: number;
  syncFailed: number;
};

export type WebConsoleSyncResultDTO = AccountImportResultDTO & { skipped: number };

export type AccountExportBatch = {
  blob: Blob;
  count: number;
  nextId: string;
  snapshotMaxId: string;
  hasMore: boolean;
};

export type CleanupResultDTO = {
  deleted: number;
  rootsDeleted?: number;
  linkedDeleted?: number;
  skipped?: number;
  deletedByProvider?: Partial<Record<AccountProvider, number>>;
};

export type CleanupPreviewDTO = {
  rootsByStatus: Partial<Record<AccountCleanupStatus, number>>;
  rootCount: number;
  linkedByProvider: Partial<Record<AccountProvider, number>>;
  total: number;
};

const billingHistoryValidator = hasShape({
  year: isNumber,
  month: isNumber,
  periodType: isOptional(isString),
  periodStart: isOptional(isString),
  periodEnd: isOptional(isString),
  includedUsed: isNumber,
  onDemandUsed: isNumber,
  totalUsed: isNumber,
});
const billingValidator = hasShape({
  planCode: isOptional(isString),
  planName: isOptional(isString),
  monthlyLimit: isNumber,
  used: isNumber,
  remaining: isNumber,
  onDemandCap: isNumber,
  onDemandUsed: isNumber,
  prepaidBalance: isNumber,
  creditUsagePercent: isNumber,
  isUnifiedBillingUser: isBoolean,
  onDemandEnabled: isOptional(isBoolean),
  topUpMethod: isOptional(isString),
  usagePeriodType: isOptional(isString),
  usagePeriodStart: isOptional(isString),
  usagePeriodEnd: isOptional(isString),
  billingPeriodStart: isOptional(isString),
  billingPeriodEnd: isOptional(isString),
  history: isOptional(isArrayOf(billingHistoryValidator)),
  syncedAt: isString,
});
const modelQuotaBlockValidator: ValueValidator = hasShape({
  model: isString,
  reason: isString,
  cooldownUntil: isOptional(isString),
});
const quotaValidator = hasShape({
  type: isOneOf("free", "paid", "unknown"),
  source: isOneOf(
    "unknown",
    "upstreamBilling",
    "upstreamExhaustion",
    "responseModel",
    "billingProfile",
    "buildSuperEntitlement",
  ),
  confidence: isOneOf("estimated", "observed", "confirmed", ""),
  status: isOneOf("active", "waitingReset", "probing"),
  unit: isOptional(isOneOf("tokens", "credits", "percent")),
  used: isNumber,
  limit: isNumber,
  remaining: isNumber,
  usagePercent: isNumber,
  limitKnown: isBoolean,
  windowHours: isOptional(isNumber),
  observed: isBoolean,
  confirmed: isBoolean,
  periodStart: isOptional(isString),
  periodEnd: isOptional(isString),
  exhaustedAt: isOptional(isString),
  nextProbeAt: isOptional(isString),
  lastConfirmedAt: isOptional(isString),
  modelQuotaBlocks: isOptional(isArrayOf(modelQuotaBlockValidator)),
});
const quotaBreakdownValidator = hasShape({ productCode: isNumber, usagePercent: isNumber });
const quotaWindowValidator = hasShape({
  mode: isString,
  remaining: isNumber,
  total: isNumber,
  usagePercent: isNumber,
  breakdown: isOptional(isArrayOf(quotaBreakdownValidator)),
  windowSeconds: isNumber,
  resetAt: isOptional(isString),
  syncedAt: isOptional(isString),
  source: isOneOf("default", "estimated", "upstream"),
});
const linkedAccountValidator = hasShape({
  id: isString,
  provider: isOneOf("grok_build", "grok_web", "grok_console"),
  name: isString,
  email: isOptional(isString),
  userId: isOptional(isString),
});
const accountValidator = hasShape({
  id: isString,
  provider: isOneOf("grok_build", "grok_web", "grok_console"),
  authType: isOneOf("oauth", "sso"),
  webTier: isOptional(isOneOf("auto", "basic", "super", "heavy")),
  webTierSyncedAt: isOptional(isString),
  nsfwEnabledAt: isOptional(isString),
  termsAcceptedAt: isOptional(isString),
  name: isString,
  email: isOptional(isString),
  userId: isOptional(isString),
  teamId: isOptional(isString),
  enabled: isBoolean,
  authStatus: isOneOf("active", "reauthRequired"),
  expiresAt: isOptional(isString),
  refreshable: isBoolean,
  cloudflareCookieConfigured: isBoolean,
  buildSuperEntitled: isBoolean,
  buildRouteMode: isOneOf("auto", "build", "xai"),
  buildBotFlagged: isBoolean,
  buildBotFlagSource: isOptional(isNumber),
  modelSyncFailed: isOptional(isBoolean),
  refreshDueAt: isOptional(isString),
  lastRefreshAt: isOptional(isString),
  refreshFailureCount: isNumber,
  egressNodeId: isOptional(isString),
  egressAssignmentMode: isOptional(isOneOf("manual", "auto")),
  lastRefreshErrorStatus: isOptional(isNumber),
  lastRefreshErrorCode: isOptional(isString),
  lastRefreshErrorMessage: isOptional(isString),
  lastRefreshErrorResponse: isOptional(isString),
  priority: isNumber,
  maxConcurrent: isNumber,
  minimumRemaining: isNumber,
  failureCount: isNumber,
  cooldownUntil: isOptional(isString),
  lastError: isOptional(isString),
  lastUsedAt: isOptional(isString),
  enabledDoesNotClearCooldown: isOptional(isBoolean),
  linkedAccountId: isOptional(isString),
  linkedAccountName: isOptional(isString),
  linkedProvider: isOptional(isOneOf("grok_build", "grok_web")),
  linkedAccounts: isOptional(isArrayOf(linkedAccountValidator)),
  createdAt: isString,
  billing: isOptional(billingValidator),
  quota: quotaValidator,
  quotaWindows: isOptional(isArrayOf(quotaWindowValidator)),
});

export const decodeBilling = createValidatedDecoder<BillingDTO>("billing", billingValidator);
export const decodeAccount = createValidatedDecoder<AccountDTO>("account", accountValidator);
export const decodeAccountPage = createPaginatedDecoder<AccountDTO>(accountValidator);
export const decodeAccountSummary = createObjectDecoder<AccountSummaryDTO>("account summary", {
  total: isNumber,
  available: isNumber,
  recovering: isNumber,
  attention: isNumber,
  risk: isNumber,
  providers: isRecordOf(hasShape({ total: isNumber, available: isNumber })),
  recovery: hasShape({ cooldown: isNumber, waitingReset: isNumber, probing: isNumber }),
  issues: hasShape({ disabled: isNumber, reauthRequired: isNumber }),
});
export const decodeDeviceSession = createObjectDecoder<DeviceSessionDTO>("device session", {
  sessionId: isString,
  userCode: isString,
  verificationUri: isString,
  verificationUriComplete: isOptional(isString),
  intervalSeconds: isNumber,
  expiresAt: isString,
});
export const decodeDevicePoll = createObjectDecoder<DevicePollDTO>("device poll", {
  status: isOneOf("pending", "succeeded", "syncFailed"),
  account: isOptional(accountValidator),
  synced: isOptional(isNumber),
  syncFailed: isOptional(isNumber),
});
