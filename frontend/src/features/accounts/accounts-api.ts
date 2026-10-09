import { apiRequest, type PaginatedDTO } from "@/shared/api/client";
import { createObjectDecoder, decodeBooleanResult, isNumber, isOptional, isRecordOf } from "@/shared/api/decoder";
import type { SortOrder } from "@/shared/lib/table-sort";
import {
  decodeAccount,
  decodeAccountPage,
  decodeAccountSummary,
  decodeBilling,
  decodeDevicePoll,
  decodeDeviceSession,
  type BillingDTO,
  type AccountDTO,
  type AccountDeletionPreviewDTO,
  type AccountDeleteResultDTO,
  type AccountProvider,
  type AccountSummaryDTO,
  type AccountUpdateInput,
  type DevicePollDTO,
  type DeviceSessionDTO,
  type LinkedDeleteTarget,
} from "@/features/accounts/accounts-dto";

export type { AccountTaskProgressDTO } from "@/features/accounts/account-task-progress";

// 账号模块的 DTO/解码器、SSE 任务流、批量与导出接口按职责拆分到独立模块，
// 这里保持既有对外导出面（调用方仍从 accounts-api 引入），避免零行为变更以外的改动。
export * from "@/features/accounts/accounts-dto";
export * from "@/features/accounts/account-task-stream";
export * from "@/features/accounts/account-batch-api";
export * from "@/features/accounts/account-export-api";

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

export function getAccountSummary(): Promise<AccountSummaryDTO> {
  return apiRequest("/api/admin/v1/accounts/summary", {}, decodeAccountSummary);
}

export function updateAccount(id: string, input: AccountUpdateInput): Promise<AccountDTO> {
  return apiRequest(`/api/admin/v1/accounts/${id}`, { method: "PATCH", body: input }, decodeAccount);
}

export function deleteAccount(
  id: string,
  input?: { provider?: AccountProvider; linkedDeleteTargets?: LinkedDeleteTarget[] },
): Promise<AccountDeleteResultDTO | { deleted: boolean }> {
  if (input?.linkedDeleteTargets?.length) {
    return apiRequest(
      `/api/admin/v1/accounts/${id}`,
      { method: "DELETE", body: { provider: input.provider, linkedDeleteTargets: input.linkedDeleteTargets } },
      createObjectDecoder("account delete", {
        deleted: isNumber,
        rootsDeleted: isOptional(isNumber),
        linkedDeleted: isOptional(isNumber),
        deletedByProvider: isOptional(isRecordOf(isNumber)),
      }),
    );
  }
  return apiRequest(
    `/api/admin/v1/accounts/${id}`,
    { method: "DELETE" },
    decodeBooleanResult<{ deleted: boolean }>("deleted"),
  );
}

export function previewAccountDeletion(
  ids: string[],
  provider: AccountProvider,
  linkedDeleteTargets: LinkedDeleteTarget[] = [],
): Promise<AccountDeletionPreviewDTO> {
  return apiRequest(
    "/api/admin/v1/accounts/deletion-preview",
    { method: "POST", body: { ids, provider, linkedDeleteTargets } },
    createObjectDecoder("account deletion preview", {
      rootCount: isNumber,
      linkedByProvider: isRecordOf(isNumber),
      total: isNumber,
    }),
  );
}

export function refreshAccountBilling(id: string): Promise<BillingDTO> {
  return apiRequest(`/api/admin/v1/accounts/${id}/refresh-billing`, { method: "POST" }, decodeBilling);
}

export function refreshAccountToken(id: string): Promise<AccountDTO> {
  return apiRequest(`/api/admin/v1/accounts/${id}/refresh-token`, { method: "POST" }, decodeAccount);
}

export function clearAccountCooldown(id: string): Promise<AccountDTO> {
  return apiRequest(`/api/admin/v1/accounts/${id}/clear-cooldown`, { method: "POST" }, decodeAccount);
}

export function refreshAccountQuota(id: string): Promise<AccountDTO> {
  return apiRequest(`/api/admin/v1/accounts/${id}/refresh-quota`, { method: "POST" }, decodeAccount);
}

export function acceptWebAccountTerms(id: string): Promise<{ completed: boolean }> {
  return apiRequest(
    `/api/admin/v1/accounts/web/${id}/accept-terms`,
    { method: "POST" },
    decodeBooleanResult<{ completed: boolean }>("completed"),
  );
}

export function setWebAccountBirthDate(id: string): Promise<{ completed: boolean }> {
  return apiRequest(
    `/api/admin/v1/accounts/web/${id}/birth-date`,
    { method: "POST" },
    decodeBooleanResult<{ completed: boolean }>("completed"),
  );
}

export function enableWebAccountNSFW(id: string): Promise<{ completed: boolean }> {
  return apiRequest(
    `/api/admin/v1/accounts/web/${id}/nsfw`,
    { method: "POST" },
    decodeBooleanResult<{ completed: boolean }>("completed"),
  );
}

export function startDeviceAuthorization(): Promise<DeviceSessionDTO> {
  return apiRequest("/api/admin/v1/accounts/device/start", { method: "POST" }, decodeDeviceSession);
}

export function pollDeviceAuthorization(sessionId: string, signal: AbortSignal): Promise<DevicePollDTO> {
  return apiRequest(`/api/admin/v1/accounts/device/${sessionId}/poll`, { method: "POST", signal }, decodeDevicePoll);
}
