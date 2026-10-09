import { ApiError, apiDownload, apiDownloadResponse } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";
import type { AccountExportBatch, AccountProvider } from "@/features/accounts/accounts-dto";

function requiredExportHeader(headers: Headers, name: string): string {
  const value = headers.get(name);
  if (value === null) {
    throw new ApiError(502, "invalidResponse", i18n.t("apiErrors.invalidResponse"));
  }
  return value;
}

export async function exportAccountBatch(
  provider: AccountProvider,
  limit: number,
  afterId: string,
  snapshotMaxId: string,
): Promise<AccountExportBatch> {
  const query = new URLSearchParams({ provider, limit: String(limit), afterId, snapshotMaxId });
  const result = await apiDownloadResponse(`/api/admin/v1/accounts/export?${query}`);
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
  if (hasMore && (count === 0 || BigInt(nextId) <= BigInt(afterId) || BigInt(nextId) > BigInt(nextSnapshotMaxId))) {
    throw new ApiError(502, "invalidResponse", i18n.t("apiErrors.invalidResponse"));
  }
  return {
    blob: result.blob,
    count,
    nextId,
    snapshotMaxId: nextSnapshotMaxId,
    hasMore,
  };
}

export function exportSelectedAccounts(provider: AccountProvider, ids: string[]): Promise<Blob> {
  return apiDownload("/api/admin/v1/accounts/export", { method: "POST", body: { provider, ids } });
}
