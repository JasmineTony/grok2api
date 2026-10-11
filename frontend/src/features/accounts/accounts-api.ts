import { decodeAccount, decodeBilling } from "@/entities/accounts/accounts-api";
import type { AccountDTO, AccountProvider, BillingDTO } from "@/entities/accounts/types";
import { apiRequest } from "@/shared/api/client";
import { createObjectDecoder, decodeBooleanResult, isNumber, isOptional, isRecordOf } from "@/shared/api/decoder";
import {
  decodeAccountSummary,
  decodeDevicePoll,
  decodeDeviceSession,
  type AccountDeletionPreviewDTO,
  type AccountDeleteResultDTO,
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
