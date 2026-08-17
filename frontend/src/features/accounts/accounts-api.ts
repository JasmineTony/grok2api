import type {
  AccountCleanupStatus,
  AccountDTO,
  AccountEgressPolicyDTO,
  AccountEgressPolicyInput,
  AccountProvider,
  AccountState,
  AccountStateEventDTO,
  AccountSummaryDTO,
  AccountUpdateInput,
  BillingDTO,
  DevicePollDTO,
  DeviceSessionDTO,
} from "@/features/accounts/account-contracts";
import type { AccountTokenRefreshResultDTO } from "@/features/accounts/account-tasks-api";
import { updateAccountsEnabledAction } from "@/shared/api/account-actions";
import { type ApiClient, ApiError, type PaginatedDTO } from "@/shared/api/client";
import {
  createObjectDecoder,
  createPaginatedDecoder,
  createValidatedDecoder,
  decodeBooleanResult,
  decodeCountResult,
  hasShape,
  isArrayOf,
  isBoolean,
  isNumber,
  isOneOf,
  isOptional,
  isRecordOf,
  isString,
} from "@/shared/api/decoder";
import { i18n } from "@/shared/i18n";
import type { SortOrder } from "@/shared/lib/table-sort";

export type {
  AccountCleanupStatus,
  AccountDTO,
  AccountEgressPolicyDTO,
  AccountEgressPolicyInput,
  AccountEgressPolicyStrategy,
  AccountProvider,
  AccountState,
  AccountStateEventDTO,
  AccountSummaryDTO,
  AccountUpdateInput,
  BillingDTO,
  BillingHistoryDTO,
  BuildRouteMode,
  DevicePollDTO,
  DeviceSessionDTO,
  LinkedAccountDTO,
  QuotaDTO,
} from "@/features/accounts/account-contracts";

type AccountWireDTO = Omit<AccountDTO, "state"> & { state?: AccountState };
type DevicePollWireDTO = Omit<DevicePollDTO, "account"> & { account?: AccountWireDTO };

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
const accountEgressPolicyValidator = hasShape({
  accountId: isString,
  strategy: isOneOf("inherit", "node", "direct"),
  egressNodeId: isOptional(isString),
  allowDirectFallback: isBoolean,
  createdAt: isOptional(isString),
  updatedAt: isOptional(isString),
});
const accountStateEventValidator = hasShape({
  id: isString,
  fromState: isOneOf(
    "ready",
    "degraded",
    "cooldown",
    "quota_exhausted",
    "reauth_required",
    "disabled",
  ),
  toState: isOneOf(
    "ready",
    "degraded",
    "cooldown",
    "quota_exhausted",
    "reauth_required",
    "disabled",
  ),
  event: isString,
  reason: isOptional(isString),
  createdAt: isString,
});
const accountWireValidator = hasShape({
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
  state: isOptional(
    isOneOf("ready", "degraded", "cooldown", "quota_exhausted", "reauth_required", "disabled"),
  ),
  stateChangedAt: isOptional(isString),
  expiresAt: isOptional(isString),
  refreshable: isBoolean,
  cloudflareCookieConfigured: isBoolean,
  buildSuperEntitled: isBoolean,
  buildRouteMode: isOneOf("auto", "build", "xai"),
  buildBotFlagged: isBoolean,
  buildBotFlagSource: isOptional(isNumber),
  egressNodeId: isOptional(isString),
  egressAssignmentMode: isOptional(isOneOf("manual", "auto")),
  modelSyncFailed: isOptional(isBoolean),
  refreshDueAt: isOptional(isString),
  lastRefreshAt: isOptional(isString),
  refreshFailureCount: isNumber,
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
  linkedAccountId: isOptional(isString),
  linkedAccountName: isOptional(isString),
  linkedProvider: isOptional(isOneOf("grok_build", "grok_web")),
  linkedAccounts: isOptional(isArrayOf(linkedAccountValidator)),
  createdAt: isString,
  billing: isOptional(billingValidator),
  quota: quotaValidator,
  quotaWindows: isOptional(isArrayOf(quotaWindowValidator)),
});
const decodeBilling = createValidatedDecoder<BillingDTO>("billing", billingValidator);
const decodeAccountWire = createValidatedDecoder<AccountWireDTO>("account", accountWireValidator);
const decodeAccount = (value: unknown): AccountDTO => normalizeAccount(decodeAccountWire(value));
const decodeAccountStateEvents = createValidatedDecoder<AccountStateEventDTO[]>(
  "account state events",
  isArrayOf(accountStateEventValidator),
);
const decodeAccountEgressPolicy = createValidatedDecoder<AccountEgressPolicyDTO>(
  "account egress policy",
  accountEgressPolicyValidator,
);
const decodeAccountPageWire = createPaginatedDecoder<AccountWireDTO>(accountWireValidator);
const decodeAccountPage = (value: unknown): PaginatedDTO<AccountDTO> => {
  const page = decodeAccountPageWire(value);
  return { ...page, items: page.items.map(normalizeAccount) };
};
const decodeAccountSummary = createObjectDecoder<AccountSummaryDTO>("account summary", {
  total: isNumber,
  available: isNumber,
  recovering: isNumber,
  attention: isNumber,
  risk: isNumber,
  providers: isRecordOf(hasShape({ total: isNumber, available: isNumber })),
  recovery: hasShape({ cooldown: isNumber, waitingReset: isNumber, probing: isNumber }),
  issues: hasShape({ disabled: isNumber, reauthRequired: isNumber }),
});
const decodeDeviceSession = createObjectDecoder<DeviceSessionDTO>("device session", {
  sessionId: isString,
  userCode: isString,
  verificationUri: isString,
  verificationUriComplete: isOptional(isString),
  intervalSeconds: isNumber,
  expiresAt: isString,
});
const decodeDevicePollWire = createObjectDecoder<DevicePollWireDTO>("device poll", {
  status: isOneOf("pending", "succeeded", "syncFailed"),
  account: isOptional(accountWireValidator),
  synced: isOptional(isNumber),
  syncFailed: isOptional(isNumber),
});
const decodeDevicePoll = (value: unknown): DevicePollDTO => {
  const result = decodeDevicePollWire(value);
  const { account, ...response } = result;
  return account === undefined ? response : { ...response, account: normalizeAccount(account) };
};

function normalizeAccount(value: AccountWireDTO): AccountDTO {
  if (value.state !== undefined) return value as AccountDTO;
  let state: AccountState = "ready";
  if (!value.enabled) state = "disabled";
  else if (value.authStatus === "reauthRequired") state = "reauth_required";
  else if (
    value.quota.status === "waitingReset" ||
    value.quotaWindows?.some((window) => window.mode === "console" && window.remaining <= 0)
  )
    state = "quota_exhausted";
  else if (
    value.cooldownUntil !== undefined &&
    Number.isFinite(Date.parse(value.cooldownUntil)) &&
    Date.parse(value.cooldownUntil) > Date.now()
  )
    state = "cooldown";
  return { ...value, state };
}

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
  provider?: AccountProvider;
  sortBy?: string;
  sortOrder?: SortOrder;
};

export function listAccounts(
  client: ApiClient,
  input: ListAccountsInput,
): Promise<PaginatedDTO<AccountDTO>> {
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
  return client.request(`/api/admin/v1/accounts?${query}`, {}, decodeAccountPage);
}

export function getAccountSummary(client: ApiClient): Promise<AccountSummaryDTO> {
  return client.request("/api/admin/v1/accounts/summary", {}, decodeAccountSummary);
}

export function updateAccount(
  client: ApiClient,
  id: string,
  input: AccountUpdateInput,
): Promise<AccountDTO> {
  return client.request(
    `/api/admin/v1/accounts/${id}`,
    { method: "PATCH", body: input },
    decodeAccount,
  );
}

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
  skipped?: number;
  deletedByProvider?: Partial<Record<AccountProvider, number>>;
};

const decodeAccountDeleteResult = createObjectDecoder<AccountDeleteResultDTO>("account delete", {
  deleted: isNumber,
  rootsDeleted: isOptional(isNumber),
  linkedDeleted: isOptional(isNumber),
  skipped: isOptional(isNumber),
  deletedByProvider: isOptional(isRecordOf(isNumber)),
});

export function deleteAccount(
  client: ApiClient,
  id: string,
  input?: { provider?: AccountProvider; linkedDeleteTargets?: LinkedDeleteTarget[] },
): Promise<AccountDeleteResultDTO | { deleted: boolean }> {
  if (input?.linkedDeleteTargets?.length) {
    return client.request(
      `/api/admin/v1/accounts/${id}`,
      { method: "DELETE", body: input },
      decodeAccountDeleteResult,
    );
  }
  return client.request(
    `/api/admin/v1/accounts/${id}`,
    { method: "DELETE" },
    decodeBooleanResult<{ deleted: boolean }>("deleted"),
  );
}

export function previewAccountDeletion(
  client: ApiClient,
  ids: string[],
  provider: AccountProvider,
  linkedDeleteTargets: LinkedDeleteTarget[] = [],
): Promise<AccountDeletionPreviewDTO> {
  return client.request(
    "/api/admin/v1/accounts/deletion-preview",
    { method: "POST", body: { ids, provider, linkedDeleteTargets } },
    createObjectDecoder("account deletion preview", {
      rootCount: isNumber,
      linkedByProvider: isRecordOf(isNumber),
      total: isNumber,
    }),
  );
}

export function refreshAccountBilling(client: ApiClient, id: string): Promise<BillingDTO> {
  return client.request(
    `/api/admin/v1/accounts/${id}/refresh-billing`,
    { method: "POST" },
    decodeBilling,
  );
}

export function refreshAccountToken(client: ApiClient, id: string): Promise<AccountDTO> {
  return client.request(
    `/api/admin/v1/accounts/${id}/refresh-token`,
    { method: "POST" },
    decodeAccount,
  );
}

export function acceptWebAccountTerms(
  client: ApiClient,
  id: string,
): Promise<{ completed: boolean }> {
  return client.request(
    `/api/admin/v1/accounts/web/${id}/accept-terms`,
    { method: "POST" },
    decodeBooleanResult<{ completed: boolean }>("completed"),
  );
}

export function setWebAccountBirthDate(
  client: ApiClient,
  id: string,
): Promise<{ completed: boolean }> {
  return client.request(
    `/api/admin/v1/accounts/web/${id}/birth-date`,
    { method: "POST" },
    decodeBooleanResult<{ completed: boolean }>("completed"),
  );
}

export function enableWebAccountNSFW(
  client: ApiClient,
  id: string,
): Promise<{ completed: boolean }> {
  return client.request(
    `/api/admin/v1/accounts/web/${id}/nsfw`,
    { method: "POST" },
    decodeBooleanResult<{ completed: boolean }>("completed"),
  );
}

export * from "@/features/accounts/account-tasks-api";

export function refreshAccountQuota(client: ApiClient, id: string): Promise<AccountDTO> {
  return client.request(
    `/api/admin/v1/accounts/${id}/refresh-quota`,
    { method: "POST" },
    decodeAccount,
  );
}

export type AccountExportBatch = {
  blob: Blob;
  count: number;
  nextId: string;
  snapshotMaxId: string;
  hasMore: boolean;
};

function requiredExportHeader(headers: Headers, name: string): string {
  const value = headers.get(name);
  if (value === null) {
    throw new ApiError(502, "invalidResponse", i18n.t("apiErrors.invalidResponse"));
  }
  return value;
}

// Cursor export keeps a large account pool off the server's heap: each call returns one
// page plus the cursor for the next, instead of serialising every credential at once.
export async function exportAccountBatch(
  client: ApiClient,
  provider: AccountProvider,
  limit: number,
  afterId: string,
  snapshotMaxId: string,
): Promise<AccountExportBatch> {
  const query = new URLSearchParams({ provider, limit: String(limit), afterId, snapshotMaxId });
  const result = await client.downloadResponse(`/api/admin/v1/accounts/export?${query}`);
  const count = Number(requiredExportHeader(result.headers, "X-Exported-Accounts"));
  const nextId = requiredExportHeader(result.headers, "X-Export-Next-ID");
  const nextSnapshotMaxId = requiredExportHeader(result.headers, "X-Export-Snapshot-Max-ID");
  const hasMoreText = requiredExportHeader(result.headers, "X-Export-Has-More");
  const validCursor = /^\d+$/.test(nextId) && /^\d+$/.test(nextSnapshotMaxId);
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    !validCursor ||
    (hasMoreText !== "true" && hasMoreText !== "false")
  ) {
    throw new ApiError(502, "invalidResponse", i18n.t("apiErrors.invalidResponse"));
  }
  const hasMore = hasMoreText === "true";
  // A page that claims more work but does not advance the cursor would loop forever.
  if (
    hasMore &&
    (count === 0 || BigInt(nextId) <= BigInt(afterId) || BigInt(nextId) > BigInt(nextSnapshotMaxId))
  ) {
    throw new ApiError(502, "invalidResponse", i18n.t("apiErrors.invalidResponse"));
  }
  return { blob: result.blob, count, nextId, snapshotMaxId: nextSnapshotMaxId, hasMore };
}

export function updateAccountsEnabled(
  client: ApiClient,
  ids: string[],
  enabled: boolean,
  provider: AccountProvider,
): Promise<{ updated: number }> {
  return updateAccountsEnabledAction(client, ids, enabled, provider);
}

export function refreshAccountsQuota(
  client: ApiClient,
  ids: string[],
  provider: AccountProvider,
): Promise<{ succeeded: number; failed: number }> {
  return client.request(
    "/api/admin/v1/accounts/batch/refresh-quotas",
    { method: "POST", body: { ids, provider } },
    createObjectDecoder("account batch", { succeeded: isNumber, failed: isNumber }),
  );
}

export function resetAccountsQuota(
  client: ApiClient,
  ids: string[],
  provider: AccountProvider,
): Promise<{ reset: number }> {
  return client.request(
    "/api/admin/v1/accounts/batch/reset-quota",
    { method: "POST", body: { ids, provider } },
    decodeCountResult<{ reset: number }>("reset"),
  );
}

export function resetAllAccountQuota(client: ApiClient): Promise<{ reset: number }> {
  return client.request(
    "/api/admin/v1/accounts/reset-quota",
    { method: "POST" },
    decodeCountResult<{ reset: number }>("reset"),
  );
}
export function refreshAccountsTokens(
  client: ApiClient,
  ids: string[],
  provider: AccountProvider,
): Promise<AccountTokenRefreshResultDTO> {
  return client.request(
    "/api/admin/v1/accounts/batch/refresh-tokens",
    { method: "POST", body: { ids, provider } },
    createObjectDecoder("account token refresh batch", {
      succeeded: isNumber,
      failed: isNumber,
      skipped: isNumber,
    }),
  );
}

export type CleanupResultDTO = AccountDeleteResultDTO & { rootCount?: number };
export type CleanupPreviewDTO = AccountDeletionPreviewDTO & {
  rootsByStatus: Partial<Record<AccountCleanupStatus, number>>;
};

export function cleanupAccounts(
  client: ApiClient,
  provider: AccountProvider,
  statuses: AccountCleanupStatus[],
  linkedDeleteTargets: LinkedDeleteTarget[] = [],
): Promise<CleanupResultDTO> {
  return client.request(
    "/api/admin/v1/accounts/cleanup",
    { method: "POST", body: { provider, statuses, linkedDeleteTargets } },
    decodeAccountDeleteResult,
  );
}

export function previewCleanup(
  client: ApiClient,
  provider: AccountProvider,
  statuses: AccountCleanupStatus[],
  linkedDeleteTargets: LinkedDeleteTarget[] = [],
): Promise<CleanupPreviewDTO> {
  return client.request(
    "/api/admin/v1/accounts/cleanup-preview",
    { method: "POST", body: { provider, statuses, linkedDeleteTargets } },
    createObjectDecoder("account cleanup preview", {
      rootsByStatus: isRecordOf(isNumber),
      rootCount: isNumber,
      linkedByProvider: isRecordOf(isNumber),
      total: isNumber,
    }),
  );
}

export function deleteAccounts(
  client: ApiClient,
  ids: string[],
  provider: AccountProvider,
  linkedDeleteTargets: LinkedDeleteTarget[] = [],
): Promise<AccountDeleteResultDTO> {
  return client.request(
    "/api/admin/v1/accounts",
    { method: "DELETE", body: { ids, provider, linkedDeleteTargets } },
    decodeAccountDeleteResult,
  );
}

export function startDeviceAuthorization(client: ApiClient): Promise<DeviceSessionDTO> {
  return client.request(
    "/api/admin/v1/accounts/device/start",
    { method: "POST" },
    decodeDeviceSession,
  );
}

export function pollDeviceAuthorization(
  client: ApiClient,
  sessionId: string,
  signal: AbortSignal,
): Promise<DevicePollDTO> {
  return client.request(
    `/api/admin/v1/accounts/device/${sessionId}/poll`,
    { method: "POST", signal },
    decodeDevicePoll,
  );
}

export function listAccountStateEvents(
  client: ApiClient,
  id: string,
  limit = 20,
): Promise<AccountStateEventDTO[]> {
  return client.request(
    `/api/admin/v1/accounts/${id}/state-events?limit=${Math.min(Math.max(limit, 1), 100)}`,
    {},
    decodeAccountStateEvents,
  );
}

export function getAccountEgressPolicy(
  client: ApiClient,
  id: string,
): Promise<AccountEgressPolicyDTO> {
  return client.request(
    `/api/admin/v1/accounts/${id}/egress-policy`,
    {},
    decodeAccountEgressPolicy,
  );
}

export function updateAccountEgressPolicy(
  client: ApiClient,
  id: string,
  input: AccountEgressPolicyInput,
): Promise<AccountEgressPolicyDTO> {
  return client.request(
    `/api/admin/v1/accounts/${id}/egress-policy`,
    { method: "PUT", body: input },
    decodeAccountEgressPolicy,
  );
}
