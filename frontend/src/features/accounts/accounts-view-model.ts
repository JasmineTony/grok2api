import type { AccountProvider } from "@/features/accounts/accounts-dto";

/** react-i18next 的 t 的最小结构契约，便于纯函数复用文案而不引入 hook。 */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

export type AccountMetricDetailItem = { label: string; value: string; tone?: string; count?: number };

export function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}

export function downloadAccountExport(blob: Blob, provider: AccountProvider, suffix: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `grok2api-${provider.replaceAll("_", "-")}-accounts-${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 关联删除目标：只能是当前账号池以外的其它 provider。 */
export function linkedTargetOptions(current: AccountProvider): AccountProvider[] {
  return (["grok_web", "grok_build", "grok_console"] as AccountProvider[]).filter((item) => item !== current);
}

export function linkedTargetLabel(value: AccountProvider): string {
  if (value === "grok_build") return "Grok Build";
  if (value === "grok_console") return "Grok Console";
  return "Grok Web";
}

export type AbnormalBreakdownItem = { label: string; count: number; tone: string };

/** 异常账号明细：标签与配色集中在此，保证总览面板与提示文案同源。 */
export function buildAbnormalBreakdown(
  t: Translate,
  counts: {
    cooldown: number;
    waitingReset: number;
    probing: number;
    risk: number;
    disabled: number;
    reauthRequired: number;
  },
): AbnormalBreakdownItem[] {
  return [
    {
      label: t("accounts.statusCooldown"),
      count: counts.cooldown,
      tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      label: t("accounts.waitingReset"),
      count: counts.waitingReset,
      tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    { label: t("accounts.probing"), count: counts.probing, tone: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
    {
      label: t("accounts.riskFilter"),
      count: counts.risk,
      tone: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
    },
    { label: t("accounts.statusDisabled"), count: counts.disabled, tone: "bg-muted text-muted-foreground" },
    {
      label: t("accounts.statusReauthRequired"),
      count: counts.reauthRequired,
      tone: "bg-red-500/10 text-red-700 dark:text-red-300",
    },
  ];
}

/** 概览卡片的明细：不可用时退化为 “-”，无异常时显示“正常”。 */
export function buildAbnormalDetailItems(
  breakdown: AbnormalBreakdownItem[],
  t: Translate,
  format: (value: number) => string,
  unavailable: boolean,
): AccountMetricDetailItem[] {
  if (unavailable) return [{ label: "-", value: "", tone: "bg-muted text-muted-foreground" }];
  const items: AccountMetricDetailItem[] = breakdown
    .filter((item) => item.count > 0)
    .map((item) => ({ label: item.label, value: format(item.count), tone: item.tone }));
  if (items.length === 0) {
    items.push({
      label: t("accounts.statusActive"),
      value: "",
      tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      count: 0,
    });
  }
  return items;
}
