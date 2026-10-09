import { apiRequest } from "@/shared/api/client";
import { createObjectDecoder, decodeCountResult, isNumber, isOptional, isRecordOf } from "@/shared/api/decoder";
import type {
  AccountCleanupStatus,
  AccountDeleteResultDTO,
  AccountProvider,
  AccountTokenRefreshResultDTO,
  CleanupPreviewDTO,
  CleanupResultDTO,
  LinkedDeleteTarget,
} from "@/features/accounts/accounts-dto";

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

export function updateAccountsMaxConcurrent(
  ids: string[],
  maxConcurrent: number,
  provider: AccountProvider,
): Promise<{ updated: number }> {
  return apiRequest(
    "/api/admin/v1/accounts/batch",
    { method: "PATCH", body: { ids, maxConcurrent, provider } },
    decodeCountResult<{ updated: number }>("updated"),
  );
}

export function refreshAccountsQuota(
  ids: string[],
  provider: AccountProvider,
): Promise<{ succeeded: number; failed: number }> {
  return apiRequest(
    "/api/admin/v1/accounts/batch/refresh-quotas",
    { method: "POST", body: { ids, provider } },
    createObjectDecoder("account batch", { succeeded: isNumber, failed: isNumber }),
  );
}

export function resetAccountsQuota(ids: string[], provider: AccountProvider): Promise<{ reset: number }> {
  return apiRequest(
    "/api/admin/v1/accounts/batch/reset-quota",
    { method: "POST", body: { ids, provider } },
    decodeCountResult<{ reset: number }>("reset"),
  );
}

export function resetAllAccountQuota(): Promise<{ reset: number }> {
  return apiRequest(
    "/api/admin/v1/accounts/reset-quota",
    { method: "POST" },
    decodeCountResult<{ reset: number }>("reset"),
  );
}

export function refreshAccountsTokens(ids: string[], provider: AccountProvider): Promise<AccountTokenRefreshResultDTO> {
  return apiRequest(
    "/api/admin/v1/accounts/batch/refresh-tokens",
    { method: "POST", body: { ids, provider } },
    createObjectDecoder("account token refresh batch", { succeeded: isNumber, failed: isNumber, skipped: isNumber }),
  );
}

export function cleanupAccounts(
  provider: AccountProvider,
  statuses: AccountCleanupStatus[],
  linkedDeleteTargets: LinkedDeleteTarget[] = [],
): Promise<CleanupResultDTO> {
  return apiRequest(
    "/api/admin/v1/accounts/cleanup",
    {
      method: "POST",
      body: {
        provider,
        statuses,
        ...(linkedDeleteTargets.length ? { linkedDeleteTargets } : {}),
      },
    },
    createObjectDecoder("account cleanup", {
      deleted: isNumber,
      rootsDeleted: isOptional(isNumber),
      linkedDeleted: isOptional(isNumber),
      skipped: isOptional(isNumber),
      deletedByProvider: isOptional(isRecordOf(isNumber)),
    }),
  );
}

export function previewCleanup(
  provider: AccountProvider,
  statuses: AccountCleanupStatus[],
  linkedDeleteTargets: LinkedDeleteTarget[] = [],
): Promise<CleanupPreviewDTO> {
  return apiRequest(
    "/api/admin/v1/accounts/cleanup-preview",
    { method: "POST", body: { provider, statuses, ...(linkedDeleteTargets.length ? { linkedDeleteTargets } : {}) } },
    createObjectDecoder("account cleanup preview", {
      rootsByStatus: isRecordOf(isNumber),
      rootCount: isNumber,
      linkedByProvider: isRecordOf(isNumber),
      total: isNumber,
    }),
  );
}

export function deleteAccounts(
  ids: string[],
  provider: AccountProvider,
  linkedDeleteTargets: LinkedDeleteTarget[] = [],
): Promise<AccountDeleteResultDTO> {
  // Batch delete must forward linkedDeleteTargets; omitting them falls back to root-only deletion.
  return apiRequest(
    "/api/admin/v1/accounts",
    {
      method: "DELETE",
      body: {
        ids,
        provider,
        ...(linkedDeleteTargets.length ? { linkedDeleteTargets } : {}),
      },
    },
    createObjectDecoder("account batch delete", {
      deleted: isNumber,
      rootsDeleted: isOptional(isNumber),
      linkedDeleted: isOptional(isNumber),
      skipped: isOptional(isNumber),
      deletedByProvider: isOptional(isRecordOf(isNumber)),
    }),
  );
}
