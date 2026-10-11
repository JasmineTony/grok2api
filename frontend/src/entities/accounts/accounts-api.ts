import type { AccountDTO, AccountProvider, BillingDTO } from "@/entities/accounts/types";
import { apiRequest, type PaginatedDTO } from "@/shared/api/client";
import {
  createPaginatedDecoder,
  createValidatedDecoder,
  decodeCountResult,
  hasShape,
  isArrayOf,
  isBoolean,
  isNumber,
  isOneOf,
  isOptional,
  isString,
  type ValueValidator,
} from "@/shared/api/decoder";
import type { SortOrder } from "@/shared/lib/table-sort";

// 账号读取契约：跨 feature 共用的查询（listAccounts）与批量启停命令（updateAccountsEnabled）。
// 写操作/表单逻辑仍归 features/accounts；这里只保留多 feature 共用的最小 API 面。

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
export const accountValidator = hasShape({
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

type ListAccountsInput = {
  page: number;
  pageSize: number;
  search?: string;
  type?: string;
  status?: string;
  egress?: string;
  renewal?: string;
  risk?: string;
  agreement?: string;
  association?: string;
  // 为空时返回全部 provider 的账号，用于跨 provider 的通用名单（如请求审计筛选）。
  provider?: AccountProvider;
  sortBy?: string;
  sortOrder?: SortOrder;
};

export function listAccounts(input: ListAccountsInput): Promise<PaginatedDTO<AccountDTO>> {
  const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  if (input.search) query.set("search", input.search);
  if (input.type) query.set("type", input.type);
  if (input.status) query.set("status", input.status);
  if (input.egress) query.set("egress", input.egress);
  if (input.renewal) query.set("renewal", input.renewal);
  if (input.risk) query.set("risk", input.risk);
  if (input.agreement) query.set("agreement", input.agreement);
  if (input.association) query.set("association", input.association);
  if (input.sortBy && input.sortOrder) {
    query.set("sortBy", input.sortBy);
    query.set("sortOrder", input.sortOrder);
  }
  if (input.provider) query.set("provider", input.provider);
  return apiRequest(`/api/admin/v1/accounts?${query}`, {}, decodeAccountPage);
}

export function updateAccountsEnabled(
  ids: string[],
  enabled: boolean,
  provider: AccountProvider,
): Promise<{ updated: number }> {
  return apiRequest(
    "/api/admin/v1/accounts/batch",
    { method: "PATCH", body: { ids, enabled, provider } },
    decodeCountResult<{ updated: number }>("updated"),
  );
}
