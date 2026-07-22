import type { TFunction } from "i18next";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import type { AccountFormValues } from "@/features/accounts/account-form";
import type {
  AccountDTO,
  AccountProvider,
  AccountSummaryDTO,
  BuildConversionStrategy,
} from "@/features/accounts/accounts-api";

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

export function downloadAccountExport(blob: Blob, provider: AccountProvider): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `grok2api-${provider.replaceAll("_", "-")}-accounts-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
