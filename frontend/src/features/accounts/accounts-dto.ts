import { accountValidator } from "@/entities/accounts/accounts-api";
import type { AccountDTO, AccountProvider, BuildRouteMode } from "@/entities/accounts/types";
import type { AccountTaskProgressDTO } from "@/features/accounts/account-task-progress";
import {
  createObjectDecoder,
  hasShape,
  isNumber,
  isOneOf,
  isOptional,
  isRecordOf,
  isString,
} from "@/shared/api/decoder";

// 账号 feature 专属契约：更新入参、汇总/设备授权结果、批量与导入导出结果。
// 跨 feature 共用的账号/额度/计费 DTO 与解码器（AccountDTO/BillingDTO/QuotaDTO/...、decodeAccount/
// decodeBilling/decodeAccountPage）已下沉到 @/entities/accounts（SSOT），此处不再重复定义。

export type AccountCleanupStatus = "cooldown" | "disabled" | "reauthRequired";

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
