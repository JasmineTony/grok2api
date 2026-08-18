import {
  type AccountTaskProgressDTO,
  type AccountTaskProgressPhase,
  createAccountTaskProgressController,
} from "@/features/accounts/account-task-progress";
import { type ApiClient, ApiError } from "@/shared/api/client";

export type { AccountTaskProgressDTO } from "@/features/accounts/account-task-progress";
import {
  createObjectDecoder,
  hasShape,
  isNumber,
  isOneOf,
  isOptional,
  isRecordOf,
  isString,
} from "@/shared/api/decoder";
import { i18n } from "@/shared/i18n";

export type AccountBatchResultDTO = { succeeded: number; failed: number };
export type AccountTokenRefreshResultDTO = AccountBatchResultDTO & { skipped: number };

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

export type DetectBuildAccountsInput = { all: true; ids?: never } | { all?: false; ids: string[] };

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

export type AccountImportProviderSummaryDTO = {
  created: number;
  updated: number;
  skipped: number;
  synced: number;
  syncFailed: number;
};

export type AccountImportResultDTO = AccountImportProviderSummaryDTO & {
  provider?: string;
  byProvider?: Record<string, AccountImportProviderSummaryDTO>;
};

export type WebConsoleSyncResultDTO = AccountImportProviderSummaryDTO;

type AccountTaskStreamPayload = Partial<
  BuildConversionResultDTO &
    AccountTaskProgressDTO &
    AccountTokenRefreshResultDTO &
    AccountImportResultDTO
> & {
  code?: string;
  message?: string;
  id?: string;
  name?: string;
  email?: string;
  outcome?: BuildDetectItemDTO["outcome"];
  reason?: string;
  httpStatus?: number;
  provider?: string;
  byProvider?: Record<string, AccountImportProviderSummaryDTO>;
};

const isAccountImportProviderSummary = hasShape({
  created: isNumber,
  updated: isNumber,
  skipped: isNumber,
  synced: isNumber,
  syncFailed: isNumber,
});

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
    id: isOptional(isString),
    name: isOptional(isString),
    email: isOptional(isString),
    outcome: isOptional(isOneOf("ok", "invalid", "failed")),
    reason: isOptional(isString),
    httpStatus: isOptional(isNumber),
    provider: isOptional(isString),
    byProvider: isOptional(isRecordOf(isAccountImportProviderSummary)),
  },
);

const importSyncPhases = ["importing", "syncing"] as const;
const conversionSyncPhases = ["converting", "syncing"] as const;

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
  phases?: readonly AccountTaskProgressPhase[],
): Promise<T> {
  let result: T | undefined;
  const progress = createAccountTaskProgressController({
    ...(onProgress === undefined ? {} : { onProgress }),
    ...(phases === undefined ? {} : { phases }),
  });
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
          progress.report({
            completed: data.completed,
            total: data.total,
            ...(phase === undefined ? {} : { phase }),
          });
          return;
        }
        if (event === "complete") {
          progress.flush();
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
    progress.flush();
    progress.dispose();
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

export async function detectBuildAccounts(
  client: ApiClient,
  input: DetectBuildAccountsInput,
  handlers?: BuildDetectHandlers | ((value: AccountTaskProgressDTO) => void),
  signal?: AbortSignal,
): Promise<AccountBatchResultDTO> {
  const body = input.all
    ? { provider: "grok_build" as const, all: true }
    : { provider: "grok_build" as const, ids: input.ids };
  const resolved: BuildDetectHandlers =
    typeof handlers === "function" ? { onProgress: handlers } : (handlers ?? {});
  let result: AccountBatchResultDTO | undefined;
  const progress = createAccountTaskProgressController({
    ...(resolved.onProgress === undefined ? {} : { onProgress: resolved.onProgress }),
  });
  try {
    await client.eventStream(
      "/api/admin/v1/accounts/detect",
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
          progress.report({ completed: data.completed, total: data.total });
          return;
        }
        if (
          event === "item" &&
          typeof data.id === "string" &&
          typeof data.name === "string" &&
          (data.outcome === "ok" || data.outcome === "invalid" || data.outcome === "failed")
        ) {
          resolved.onItem?.({
            id: data.id,
            name: data.name,
            ...(data.email === undefined ? {} : { email: data.email }),
            outcome: data.outcome,
            ...(data.reason === undefined ? {} : { reason: data.reason }),
            ...(data.httpStatus === undefined ? {} : { httpStatus: data.httpStatus }),
          });
          return;
        }
        if (event === "complete") {
          progress.flush();
          if (hasNumericResult(data, ["succeeded", "failed"])) {
            result = data as AccountBatchResultDTO;
          }
          return;
        }
        if (event === "error") {
          const code = data.code ?? "accountDetectFailed";
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
    progress.flush();
    progress.dispose();
  }
  if (!result) {
    throw new ApiError(502, "invalidResponse", i18n.t("apiErrors.invalidResponse"));
  }
  return result;
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
    conversionSyncPhases,
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
    importSyncPhases,
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
    ["created", "updated", "skipped", "synced", "syncFailed"],
    onProgress,
    signal,
    importSyncPhases,
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
    ["created", "updated", "skipped", "synced", "syncFailed"],
    onProgress,
    signal,
    importSyncPhases,
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
    ["created", "updated", "skipped", "synced", "syncFailed"],
    onProgress,
    signal,
    importSyncPhases,
  );
}
