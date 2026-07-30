import type { TFunction } from "i18next";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import type { AccountFormValues } from "@/features/accounts/account-form";
import {
  exportAccountBatch,
  type AccountDTO,
  type AccountProvider,
  type AccountSummaryDTO,
  type BuildConversionStrategy,
} from "@/features/accounts/accounts-api";
import type { ApiClient } from "@/shared/api/client";

const MAX_IMPORT_FILE_BYTES = 30 * 1024 * 1024;

export function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}

export function showAccountError(error: unknown, t: TFunction): void {
  toast.error(error instanceof Error ? error.message : t("errors.generic"));
}

export function createQuickImportFile(tokens: string, provider: AccountProvider): File | null {
  const value = tokens.trim();
  if (!value) return null;
  const filename =
    provider === "grok_console" ? "grok-console-sso-tokens.txt" : "grok-web-sso-tokens.txt";
  return new File([value], filename, { type: "text/plain" });
}

export async function readQuickImportFile(file: File): Promise<string> {
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new RangeError("accountImportFileTooLarge");
  return file.text();
}

type AccountConversionInput =
  | { all: true; strategy: BuildConversionStrategy }
  | { ids: string[]; strategy: BuildConversionStrategy };

export function createConversionInput(
  targets: string[] | "all",
  strategy: BuildConversionStrategy,
): AccountConversionInput {
  return targets === "all" ? { all: true, strategy } : { ids: targets, strategy };
}

export function resetAccountForm(
  form: UseFormReturn<AccountFormValues>,
  account: AccountDTO,
): void {
  form.reset({
    name: account.name,
    enabled: account.enabled,
    priority: account.priority,
    maxConcurrent: account.maxConcurrent,
    minimumRemaining: account.minimumRemaining,
    cloudflareCookies: "",
    clearCloudflareCookies: false,
    buildSuperEntitled: account.buildSuperEntitled,
    buildRouteMode: account.buildRouteMode,
  });
}

export function deriveAccountOverview(
  summary: AccountSummaryDTO | undefined,
  provider: AccountProvider,
  resultTotal: number,
) {
  const recovering = summary?.recovering ?? 0;
  const disabled = summary?.issues.disabled ?? 0;
  const invalid = summary?.issues.reauthRequired ?? 0;
  const risk = summary?.risk ?? 0;
  const emptyProvider = { total: 0, available: 0 };
  const build = summary?.providers.grok_build ?? emptyProvider;
  const web = summary?.providers.grok_web ?? emptyProvider;
  const console = summary?.providers.grok_console ?? emptyProvider;
  const providerTotal =
    provider === "grok_build" ? build.total : provider === "grok_web" ? web.total : console.total;
  return {
    build,
    web,
    console,
    recovering,
    disabled,
    invalid,
    risk,
    abnormal: recovering + disabled + invalid,
    hasProviderAccounts: providerTotal > 0 || resultTotal > 0,
  };
}

const exportBatchSize = 2000;
// Guards against a server that keeps reporting more pages: 10k accounts per page would
// already exceed any real pool long before this many round trips.
const maxExportBatches = 500;

type ExportDocument = { provider?: string; accounts?: unknown[] };

function parseExportDocument(text: string): ExportDocument {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("account export payload is not an object");
  }
  return parsed as ExportDocument;
}

/**
 * Exports an entire provider pool by walking the cursor endpoint and merging each page's
 * `accounts` array into a single document. The unpaginated endpoint refuses pools above
 * 10000 accounts, so paging is the only way to export a large pool at all.
 */
export async function exportAllAccountsAsBlob(
  client: ApiClient,
  provider: AccountProvider,
): Promise<Blob> {
  const accounts: unknown[] = [];
  let documentProvider: string | undefined;
  let afterId = "0";
  let snapshotMaxId = "0";

  for (let batch = 0; batch < maxExportBatches; batch += 1) {
    const page = await exportAccountBatch(
      client,
      provider,
      exportBatchSize,
      afterId,
      snapshotMaxId,
    );
    const document = parseExportDocument(await page.blob.text());
    documentProvider ??= document.provider;
    if (Array.isArray(document.accounts)) accounts.push(...document.accounts);
    if (!page.hasMore) {
      const merged = documentProvider === undefined ? { accounts } : { provider: documentProvider, accounts };
      return new Blob([JSON.stringify(merged, null, 2) + "\n"], {
        type: "application/json; charset=utf-8",
      });
    }
    afterId = page.nextId;
    snapshotMaxId = page.snapshotMaxId;
  }
  throw new Error("account export did not finish within the allowed number of batches");
}

export function downloadAccountExport(blob: Blob, provider: AccountProvider): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `grok2api-${provider.replaceAll("_", "-")}-accounts-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
