import { type ApiClient, ApiError } from "@/shared/api/client";
import { createObjectDecoder, isNumber, isOneOf, isOptional, isString } from "@/shared/api/decoder";
import { i18n } from "@/shared/i18n";

export type AccountBatchResultDTO = { succeeded: number; failed: number };
export type AccountTokenRefreshResultDTO = AccountBatchResultDTO & { skipped: number };

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

export type AccountTaskProgressDTO = {
  completed: number;
  total: number;
  phase?: "importing" | "converting" | "syncing";
};

export type AccountImportResultDTO = {
  created: number;
  updated: number;
  synced: number;
  syncFailed: number;
};

export type WebConsoleSyncResultDTO = AccountImportResultDTO & { skipped: number };

type AccountTaskStreamPayload = Partial<
  BuildConversionResultDTO &
    AccountTaskProgressDTO &
    AccountTokenRefreshResultDTO &
    AccountImportResultDTO
> & {
  code?: string;
  message?: string;
};

const decodeAccountTaskStreamPayload = createObjectDecoder<AccountTaskStreamPayload>(
  "account task event",
  {
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
  },
);

function hasNumericResult(value: AccountTaskStreamPayload, fields: string[]): boolean {
  return fields.every((field) => {
    const item = value[field as keyof AccountTaskStreamPayload];
    return typeof item === "number" && Number.isInteger(item) && item >= 0;
  });
}

async function runAccountTask<T>(
  client: ApiClient,
  path: string,
  body: BodyInit | object | undefined,
  resultFields: string[],
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<T> {
  let result: T | undefined;
  let pendingProgress: AccountTaskProgressDTO | undefined;
  let progressTimer: number | undefined;
  let lastProgressAt = 0;
  const flushProgress = () => {
    if (!pendingProgress || !onProgress) return;
    const value = pendingProgress;
    pendingProgress = undefined;
    lastProgressAt = performance.now();
    onProgress(value);
  };
  const reportProgress = (value: AccountTaskProgressDTO) => {
    if (
      pendingProgress &&
      pendingProgress.phase !== value.phase &&
      pendingProgress.completed === pendingProgress.total
    ) {
      if (progressTimer !== undefined) window.clearTimeout(progressTimer);
      progressTimer = undefined;
      flushProgress();
    }
    pendingProgress = value;
    const delay = Math.max(0, 100 - (performance.now() - lastProgressAt));
    if (delay === 0) {
      if (progressTimer !== undefined) window.clearTimeout(progressTimer);
      progressTimer = undefined;
      flushProgress();
    } else if (progressTimer === undefined) {
      progressTimer = window.setTimeout(() => {
        progressTimer = undefined;
        flushProgress();
      }, delay);
    }
  };
  try {
    await client.eventStream(
      path,
      {
        method: "POST",
        headers: { Accept: "text/event-stream" },
        body,
        signal,
      },
      decodeAccountTaskStreamPayload,
      ({ event, data }) => {
        if (
          event === "progress" &&
          typeof data.completed === "number" &&
          typeof data.total === "number"
        ) {
          const phase =
            data.phase === "importing" || data.phase === "converting" || data.phase === "syncing"
              ? data.phase
              : undefined;
          reportProgress({
            completed: data.completed,
            total: data.total,
            ...(phase === undefined ? {} : { phase }),
          });
          return;
        }
        if (event === "complete") {
          flushProgress();
          if (hasNumericResult(data, resultFields)) result = data as T;
          return;
        }
        if (event === "error") {
          const code = data.code ?? "accountConversionFailed";
          throw new ApiError(
            502,
            code,
            i18n.exists(`apiErrors.${code}`)
              ? i18n.t(`apiErrors.${code}`)
              : (data.message ?? i18n.t("apiErrors.requestFailed")),
          );
        }
      },
    );
  } finally {
    if (progressTimer !== undefined) window.clearTimeout(progressTimer);
    flushProgress();
  }
  if (!result) {
    throw new ApiError(502, "invalidResponse", i18n.t("apiErrors.invalidResponse"));
  }
  return result;
}

export function refreshAllAccountBilling(
  client: ApiClient,
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountBatchResultDTO> {
  return runAccountTask(
    client,
    "/api/admin/v1/accounts/refresh-billing",
    undefined,
    ["succeeded", "failed"],
    onProgress,
    signal,
  );
}

export function refreshAllAccountTokens(
  client: ApiClient,
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountTokenRefreshResultDTO> {
  return runAccountTask(
    client,
    "/api/admin/v1/accounts/refresh-tokens",
    undefined,
    ["succeeded", "failed", "skipped"],
    onProgress,
    signal,
  );
}

export function refreshAllWebAccountQuotas(
  client: ApiClient,
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountBatchResultDTO> {
  return runAccountTask(
    client,
    "/api/admin/v1/accounts/web/refresh-quotas",
    undefined,
    ["succeeded", "failed"],
    onProgress,
    signal,
  );
}

export function refreshAllConsoleAccountQuotas(
  client: ApiClient,
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountBatchResultDTO> {
  return runAccountTask(
    client,
    "/api/admin/v1/accounts/console/refresh-quotas",
    undefined,
    ["succeeded", "failed"],
    onProgress,
    signal,
  );
}

export function convertWebAccountsToBuild(
  client: ApiClient,
  input: BuildConversionInput,
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<BuildConversionResultDTO> {
  return runAccountTask(
    client,
    "/api/admin/v1/accounts/web/convert-to-build",
    input,
    ["created", "linked", "skipped", "failed", "synced", "syncFailed"],
    onProgress,
    signal,
  );
}

export function syncWebAccountsToConsole(
  client: ApiClient,
  input: WebConsoleSyncInput,
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<WebConsoleSyncResultDTO> {
  return runAccountTask(
    client,
    "/api/admin/v1/accounts/web/sync-to-console",
    input,
    ["created", "updated", "skipped", "synced", "syncFailed"],
    onProgress,
    signal,
  );
}

export function runWebAccountScripts(
  client: ApiClient,
  input: WebAccountScriptsInput,
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountBatchResultDTO> {
  return runAccountTask(
    client,
    "/api/admin/v1/accounts/web/run-scripts",
    input,
    ["succeeded", "failed"],
    onProgress,
    signal,
  );
}

export function importAccounts(
  client: ApiClient,
  files: readonly File[],
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountImportResultDTO> {
  const body = new FormData();
  files.forEach((file) => body.append("files", file, file.name));
  return runAccountTask(
    client,
    "/api/admin/v1/accounts/import",
    body,
    ["created", "updated", "synced", "syncFailed"],
    onProgress,
    signal,
  );
}

export function importWebAccounts(
  client: ApiClient,
  files: readonly File[],
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountImportResultDTO> {
  const body = new FormData();
  files.forEach((file) => body.append("files", file, file.name));
  return runAccountTask(
    client,
    "/api/admin/v1/accounts/web/import",
    body,
    ["created", "updated", "synced", "syncFailed"],
    onProgress,
    signal,
  );
}

export function importConsoleAccounts(
  client: ApiClient,
  files: readonly File[],
  onProgress?: (value: AccountTaskProgressDTO) => void,
  signal?: AbortSignal,
): Promise<AccountImportResultDTO> {
  const body = new FormData();
  files.forEach((file) => body.append("files", file, file.name));
  return runAccountTask(
    client,
    "/api/admin/v1/accounts/console/import",
    body,
    ["created", "updated", "synced", "syncFailed"],
    onProgress,
    signal,
  );
}
