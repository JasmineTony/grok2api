import { ApiError, apiEventStream } from "@/shared/api/client";
import { createObjectDecoder, isNumber, isOneOf, isOptional, isString } from "@/shared/api/decoder";
import { i18n } from "@/shared/i18n";
import {
  createAccountTaskProgressController,
  type AccountTaskProgressDTO,
  type AccountTaskProgressPhase,
} from "@/features/accounts/account-task-progress";
import type {
  AccountBatchResultDTO,
  AccountImportResultDTO,
  AccountTokenRefreshResultDTO,
  BuildConversionInput,
  BuildConversionResultDTO,
  BuildDetectHandlers,
  BuildDetectItemDTO,
  WebAccountScriptsInput,
  WebConsoleSyncInput,
  WebConsoleSyncResultDTO,
} from "@/features/accounts/accounts-dto";

type AccountTaskStreamPayload = Partial<
  BuildConversionResultDTO &
    AccountTaskProgressDTO &
    AccountTokenRefreshResultDTO &
    AccountImportResultDTO &
    BuildDetectItemDTO
> & {
  code?: string;
  message?: string;
  outcome?: string;
  reason?: string;
  httpStatus?: number;
  id?: string;
  name?: string;
  email?: string;
};

const decodeAccountTaskStreamPayload = createObjectDecoder<AccountTaskStreamPayload>("account task event", {
  created: isOptional(isNumber),
  linked: isOptional(isNumber),
  skipped: isOptional(isNumber),
  failed: isOptional(isNumber),
  synced: isOptional(isNumber),
  syncFailed: isOptional(isNumber),
  completed: isOptional(isNumber),
  total: isOptional(isNumber),
  phase: isOptional(isOneOf("importing", "converting", "syncing")),
  updated: isOptional(isNumber),
  succeeded: isOptional(isNumber),
  code: isOptional(isString),
  message: isOptional(isString),
  id: isOptional(isString),
  name: isOptional(isString),
  email: isOptional(isString),
  outcome: isOptional(isOneOf("ok", "invalid", "failed")),
  reason: isOptional(isString),
  httpStatus: isOptional(isNumber),
});

function hasNumericResult(value: AccountTaskStreamPayload, fields: string[]): boolean {
  return fields.every((field) => {
    const item = value[field as keyof AccountTaskStreamPayload];
    return typeof item === "number" && Number.isInteger(item) && item >= 0;
  });
}

type AccountTaskOptions = {
  onProgress?: (value: AccountTaskProgressDTO) => void;
  signal?: AbortSignal;
  phases?: readonly AccountTaskProgressPhase[];
};

const importSyncPhases = ["importing", "syncing"] as const;
const conversionSyncPhases = ["converting", "syncing"] as const;

/** 任务流 error 事件统一转成带 i18n 文案的 ApiError。 */
function accountTaskError(data: AccountTaskStreamPayload, fallbackCode: string): ApiError {
  const code = data.code ?? fallbackCode;
  return new ApiError(
    502,
    code,
    i18n.exists(`apiErrors.${code}`)
      ? i18n.t(`apiErrors.${code}`)
      : (data.message ?? i18n.t("apiErrors.requestFailed")),
  );
}

async function runAccountTask<T>(
  path: string,
  body: BodyInit | object | undefined,
  resultFields: string[],
  options: AccountTaskOptions = {},
): Promise<T> {
  let result: T | undefined;
  const progress = createAccountTaskProgressController(options);
  try {
    await apiEventStream(
      path,
      {
        method: "POST",
        headers: { Accept: "text/event-stream" },
        body,
        signal: options.signal,
      },
      decodeAccountTaskStreamPayload,
      ({ event, data }) => {
        if (event === "progress" && typeof data.completed === "number" && typeof data.total === "number") {
          const phase =
            data.phase === "importing" || data.phase === "converting" || data.phase === "syncing"
              ? data.phase
              : undefined;
          progress.report({ completed: data.completed, total: data.total, phase });
          return;
        }
        if (event === "complete") {
          progress.flush();
          if (hasNumericResult(data, resultFields)) result = data as T;
          return;
        }
        if (event === "error") throw accountTaskError(data, "accountConversionFailed");
      },
    );
  } finally {
    progress.dispose();
  }
  if (!result) {
    throw new ApiError(502, "invalidResponse", i18n.t("apiErrors.invalidResponse"));
  }
  return result;
}

export function refreshAllAccountBilling(
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountBatchResultDTO> {
  return runAccountTask("/api/admin/v1/accounts/refresh-billing", undefined, ["succeeded", "failed"], {
    onProgress,
    signal,
  });
}

export type DetectBuildAccountsInput = { all: true; ids?: never } | { all?: false; ids: string[] };

/** item 事件只暴露完整字段的条目，缺失字段视为非法载荷并丢弃。 */
function detectItemFromEvent(data: AccountTaskStreamPayload): BuildDetectItemDTO | null {
  if (typeof data.id !== "string" || typeof data.name !== "string") return null;
  if (data.outcome !== "ok" && data.outcome !== "invalid" && data.outcome !== "failed") return null;
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    outcome: data.outcome,
    reason: data.reason,
    httpStatus: data.httpStatus,
  };
}

async function runDetectBuildAccountsTask(
  body: object,
  handlers: BuildDetectHandlers,
  signal?: AbortSignal,
): Promise<AccountBatchResultDTO> {
  let result: AccountBatchResultDTO | undefined;
  const progress = createAccountTaskProgressController({ onProgress: handlers.onProgress });
  try {
    await apiEventStream(
      "/api/admin/v1/accounts/detect",
      {
        method: "POST",
        headers: { Accept: "text/event-stream" },
        body,
        signal,
      },
      decodeAccountTaskStreamPayload,
      ({ event, data }) => {
        if (event === "progress" && typeof data.completed === "number" && typeof data.total === "number") {
          progress.report({ completed: data.completed, total: data.total });
          return;
        }
        if (event === "item") {
          const item = detectItemFromEvent(data);
          if (item) handlers.onItem?.(item);
          return;
        }
        if (event === "complete") {
          progress.flush();
          if (hasNumericResult(data, ["succeeded", "failed"])) result = data as AccountBatchResultDTO;
          return;
        }
        if (event === "error") throw accountTaskError(data, "accountDetectFailed");
      },
    );
  } finally {
    progress.dispose();
  }
  if (!result) {
    throw new ApiError(502, "invalidResponse", i18n.t("apiErrors.invalidResponse"));
  }
  return result;
}

export function detectBuildAccounts(
  input: DetectBuildAccountsInput,
  handlers?: BuildDetectHandlers | ((value: AccountTaskProgressDTO) => void),
  signal?: AbortSignal,
): Promise<AccountBatchResultDTO> {
  const body = input.all
    ? { provider: "grok_build" as const, all: true }
    : { provider: "grok_build" as const, ids: input.ids };
  const resolved: BuildDetectHandlers = typeof handlers === "function" ? { onProgress: handlers } : (handlers ?? {});
  return runDetectBuildAccountsTask(body, resolved, signal);
}

export function refreshAllAccountTokens(
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountTokenRefreshResultDTO> {
  return runAccountTask("/api/admin/v1/accounts/refresh-tokens", undefined, ["succeeded", "failed", "skipped"], {
    onProgress,
    signal,
  });
}

export function refreshAllWebAccountQuotas(
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountBatchResultDTO> {
  return runAccountTask("/api/admin/v1/accounts/web/refresh-quotas", undefined, ["succeeded", "failed"], {
    onProgress,
    signal,
  });
}

export function refreshAllConsoleAccountQuotas(
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountBatchResultDTO> {
  return runAccountTask("/api/admin/v1/accounts/console/refresh-quotas", undefined, ["succeeded", "failed"], {
    onProgress,
    signal,
  });
}

export function convertWebAccountsToBuild(
  input: BuildConversionInput,
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<BuildConversionResultDTO> {
  return runAccountTask(
    "/api/admin/v1/accounts/web/convert-to-build",
    input,
    ["created", "linked", "skipped", "failed", "synced", "syncFailed"],
    { onProgress, signal, phases: conversionSyncPhases },
  );
}

export function syncWebAccountsToConsole(
  input: WebConsoleSyncInput,
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<WebConsoleSyncResultDTO> {
  return runAccountTask(
    "/api/admin/v1/accounts/web/sync-to-console",
    input,
    ["created", "updated", "skipped", "failed", "synced", "syncFailed"],
    { onProgress, signal, phases: importSyncPhases },
  );
}

export function runWebAccountScripts(
  input: WebAccountScriptsInput,
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountBatchResultDTO> {
  return runAccountTask("/api/admin/v1/accounts/web/run-scripts", input, ["succeeded", "failed"], {
    onProgress,
    signal,
  });
}

export function importAccounts(
  files: readonly File[],
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountImportResultDTO> {
  const body = new FormData();
  files.forEach((file) => body.append("files", file, file.name));
  return runAccountTask(
    "/api/admin/v1/accounts/import",
    body,
    ["created", "updated", "skipped", "failed", "synced", "syncFailed"],
    { onProgress, signal, phases: importSyncPhases },
  );
}

export function importWebAccounts(
  files: readonly File[],
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountImportResultDTO> {
  const body = new FormData();
  files.forEach((file) => body.append("files", file, file.name));
  return runAccountTask(
    "/api/admin/v1/accounts/web/import",
    body,
    ["created", "updated", "skipped", "failed", "synced", "syncFailed"],
    { onProgress, signal, phases: importSyncPhases },
  );
}

export function importConsoleAccounts(
  files: readonly File[],
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountImportResultDTO> {
  const body = new FormData();
  files.forEach((file) => body.append("files", file, file.name));
  return runAccountTask(
    "/api/admin/v1/accounts/console/import",
    body,
    ["created", "updated", "skipped", "failed", "synced", "syncFailed"],
    { onProgress, signal, phases: importSyncPhases },
  );
}
