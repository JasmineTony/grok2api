import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AccountDTO } from "@/entities/accounts/types";
import { cn } from "@/shared/lib/cn";
import { formatDateTime, formatNumber } from "@/shared/lib/format";

type WebQuotaWindow = NonNullable<AccountDTO["quotaWindows"]>[number];

type WebQuotaBreakdown = NonNullable<WebQuotaWindow["breakdown"]>[number];

const visibleWebQuotaModes = ["auto", "fast", "expert", "heavy"] as const;

const imagineQuotaModes = [
  { mode: "image_pro", labelKey: "imagineModeImagePro" as const },
  { mode: "image_edit", labelKey: "imagineModeImageEdit" as const },
  { mode: "video", labelKey: "imagineModeVideo" as const },
  { mode: "video_720p", labelKey: "imagineModeVideo720p" as const },
] as const;

function imagineWindowsOf(windows: WebQuotaWindow[]): WebQuotaWindow[] {
  const known: Set<string> = new Set(imagineQuotaModes.map((item) => item.mode));
  return windows.filter((window) => known.has(window.mode));
}

function imagineModeLabel(mode: string, t: TFunction): string {
  const entry = imagineQuotaModes.find((item) => item.mode === mode);
  return entry ? t(`accounts.${entry.labelKey}`) : mode;
}

function formatWebQuotaMode(mode: string): string {
  return mode ? mode.charAt(0).toUpperCase() + mode.slice(1) : mode;
}

function quotaProductLabel(code: number, t: TFunction): string {
  const keys: Record<number, string> = {
    0: "thirdParty",
    1: "api",
    2: "build",
    3: "plugins",
    4: "chat",
    5: "imagine",
    6: "voice",
  };
  const key = keys[code];
  return key ? t(`quotaProducts.${key}`) : t("quotaProducts.unknown", { code });
}

function quotaProductColor(code: number): string {
  const colors: Record<number, string> = {
    0: "bg-quota-product-0",
    1: "bg-quota-product-1",
    2: "bg-quota-product-2",
    3: "bg-quota-product-3",
    4: "bg-quota-product-4",
    5: "bg-quota-product-5",
    6: "bg-quota-product-6",
  };
  return colors[code] ?? "bg-muted-foreground";
}

export function ConsoleQuota({
  windows,
  locale,
}: {
  windows: NonNullable<AccountDTO["quotaWindows"]>;
  locale: string;
}) {
  const { t } = useTranslation();
  if (windows.length === 0)
    return <span className="text-xs text-muted-foreground">{t("accounts.quotaNotSynced")}</span>;
  const windowsByMode = new Map(windows.map((window) => [window.mode, window]));
  const modes = [
    { mode: "console", label: "Chat" },
    { mode: "console_image", label: "Image" },
    { mode: "console_video", label: "Video" },
  ] as const;
  return (
    <div className="grid w-full min-w-0 grid-cols-[2fr_1fr_1fr] divide-x divide-border/70">
      {modes.map(({ mode, label }) => {
        const window = windowsByMode.get(mode);
        if (!window) {
          return (
            <div key={mode} className="min-w-0 px-2 first:pl-0 last:pr-0">
              <div className="flex items-center justify-between gap-1 text-[11px]">
                <span className="truncate text-muted-foreground">{label}</span>
                <span className="text-muted-foreground">-</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-muted" />
            </div>
          );
        }
        return (
          <WebQuotaMode
            key={mode}
            mode={label}
            window={window}
            locale={locale}
            compact
            recoveryProbe={mode === "console" && window.remaining === 0}
          />
        );
      })}
    </div>
  );
}

export function WebQuota({
  windows,
  locale,
  tier,
}: {
  windows: NonNullable<AccountDTO["quotaWindows"]>;
  locale: string;
  tier?: AccountDTO["webTier"];
}) {
  const { t } = useTranslation();
  if (windows.length === 0)
    return <span className="text-xs text-muted-foreground">{t("accounts.quotaNotSynced")}</span>;
  const windowsByMode = new Map(windows.map((window) => [window.mode, window]));
  const imagineWindows = imagineWindowsOf(windows);
  const mainBlock = webQuotaMainBlock(windowsByMode, tier, locale, t);

  if (imagineWindows.length === 0) return mainBlock;
  return (
    <div className="grid w-full min-w-0 grid-cols-2 divide-x divide-border/70">
      <div className="min-w-0 pr-2">{mainBlock}</div>
      <div className="min-w-0 pl-2">
        <ImagineQuotaRow windows={imagineWindows} locale={locale} />
      </div>
    </div>
  );
}

/** 主额度区块的形态：周限优先，其次 basic 档的 Fast，最后是四个 Web 模式。 */
function webQuotaMainBlock(
  windowsByMode: Map<string, WebQuotaWindow>,
  tier: AccountDTO["webTier"],
  locale: string,
  t: TFunction,
): ReactNode {
  const weekly = windowsByMode.get("weekly");
  if (weekly) return <WeeklyWebQuota window={weekly} locale={locale} t={t} />;
  const fast = windowsByMode.get("fast");
  if (tier === "basic" && fast) return <WebQuotaMode mode="Fast" window={fast} locale={locale} />;
  return <WebQuotaModeGrid windowsByMode={windowsByMode} locale={locale} />;
}

function WebQuotaModeGrid({
  windowsByMode,
  locale,
}: {
  windowsByMode: Map<string, WebQuotaWindow>;
  locale: string;
}): ReactNode {
  return (
    <div className="grid w-full min-w-0 grid-cols-4 divide-x divide-border/70">
      {visibleWebQuotaModes.map((mode) => {
        const window = windowsByMode.get(mode);
        if (!window) {
          return (
            <div key={mode} className="min-w-0 px-2 first:pl-0 last:pr-0">
              <div className="flex items-center justify-between gap-1 text-[11px]">
                <span className="truncate capitalize text-muted-foreground">{mode}</span>
                <span className="text-muted-foreground">-</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-muted" />
            </div>
          );
        }
        return <WebQuotaMode key={mode} mode={formatWebQuotaMode(mode)} window={window} locale={locale} compact />;
      })}
    </div>
  );
}

function ImagineQuotaRow({ windows, locale }: { windows: WebQuotaWindow[]; locale: string }): ReactNode {
  const windowsByMode = new Map(windows.map((window) => [window.mode, window]));
  const columns = imagineQuotaModes.filter((item) => windowsByMode.has(item.mode));
  if (columns.length === 0) return null;
  return (
    <div
      className="grid w-full min-w-0 divide-x divide-border/70"
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
    >
      {columns.map(({ mode }) => (
        <ImagineQuotaColumn key={mode} window={windowsByMode.get(mode)!} locale={locale} />
      ))}
    </div>
  );
}

function ImagineQuotaColumn({ window, locale }: { window: WebQuotaWindow; locale: string }): ReactNode {
  const { t } = useTranslation();
  const exhausted = window.remaining <= 0;
  const hasTotal = window.total > 0;
  const used = hasTotal ? Math.max(0, window.total - window.remaining) : 0;
  const percent = hasTotal ? Math.max(0, Math.min(100, (used / window.total) * 100)) : 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="block w-full min-w-0 px-2 text-left first:pl-0 last:pr-0">
          <ImagineQuotaColumnHeader window={window} locale={locale} />
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            {exhausted ? (
              <div className="h-full w-full bg-amber-500" />
            ) : hasTotal ? (
              <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
            ) : null}
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div>
          {exhausted
            ? t("accounts.imagineQuotaExhausted")
            : t("accounts.imagineQuotaRemaining", { remaining: formatNumber(window.remaining, locale, 0) })}
        </div>
        <div className="text-muted-foreground">
          {window.resetAt
            ? t("accounts.quotaResetAt", { time: formatDateTime(window.resetAt, locale) })
            : t("accounts.quotaResetUnknown")}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** Imagine 单列表头：模式名在耗尽时转为警示色，右侧按“耗尽 / 有总量 / 无总量”展示。 */
function ImagineQuotaColumnHeader({ window, locale }: { window: WebQuotaWindow; locale: string }): ReactNode {
  const { t } = useTranslation();
  const exhausted = window.remaining <= 0;
  const hasTotal = window.total > 0;
  return (
    <div className="flex items-center justify-between gap-1 text-[11px]">
      <span className={cn("truncate", exhausted ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
        {imagineModeLabel(window.mode, t)}
      </span>
      {exhausted ? (
        <span className="shrink-0 truncate text-amber-600 dark:text-amber-400">
          {t("accounts.imagineQuotaExhausted")}
        </span>
      ) : hasTotal ? (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatNumber(window.remaining, locale, 0)}/{formatNumber(window.total, locale, 0)}
        </span>
      ) : (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatNumber(window.remaining, locale, 0)}/-
        </span>
      )}
    </div>
  );
}

function WeeklyWebQuota({ window, locale, t }: { window: WebQuotaWindow; locale: string; t: TFunction }): ReactNode {
  const usedPercent = Math.max(0, Math.min(100, window.usagePercent));
  const breakdown = (window.breakdown ?? []).filter((item) => item.usagePercent > 0);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="block w-full min-w-0 text-left">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <WeeklyQuotaBreakdownChips breakdown={breakdown} locale={locale} />
            <span className="shrink-0 tabular-nums">{formatNumber(usedPercent, locale, 1)}%</span>
          </div>
          <WeeklyQuotaBreakdownBar breakdown={breakdown} usedPercent={usedPercent} />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div>{t("accounts.webWeeklyQuotaUsage", { remaining: formatNumber(100 - usedPercent, locale, 1) })}</div>
        <div className="text-muted-foreground">
          {window.resetAt
            ? t("accounts.quotaResetAt", { time: formatDateTime(window.resetAt, locale) })
            : t("accounts.quotaResetUnknown")}
        </div>
        {breakdown.length > 0 ? (
          <div className="mt-2 grid gap-1 border-t pt-2">
            {breakdown.map((item) => (
              <div key={item.productCode} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-full", quotaProductColor(item.productCode))} />
                  {quotaProductLabel(item.productCode, t)}
                </span>
                <span className="tabular-nums">{formatNumber(item.usagePercent, locale, 1)}%</span>
              </div>
            ))}
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** 周限表头左侧：最多三个产品构成，超出折叠为 “+N”，无构成时回退为周限标签。 */
function WeeklyQuotaBreakdownChips({
  breakdown,
  locale,
}: {
  breakdown: WebQuotaBreakdown[];
  locale: string;
}): ReactNode {
  const { t } = useTranslation();
  if (breakdown.length === 0)
    return <span className="truncate text-muted-foreground">{t("accounts.weeklyQuota")}</span>;

  return (
    <div className="flex min-w-0 items-center gap-2.5 overflow-hidden text-muted-foreground">
      {breakdown.slice(0, 3).map((item) => (
        <span key={item.productCode} className="flex shrink-0 items-center gap-1">
          <span className={cn("size-1.5 rounded-full", quotaProductColor(item.productCode))} />
          <span>{quotaProductLabel(item.productCode, t)}</span>
          <span className="tabular-nums text-foreground">{formatNumber(item.usagePercent, locale, 1)}%</span>
        </span>
      ))}
      {breakdown.length > 3 ? <span className="shrink-0">+{breakdown.length - 3}</span> : null}
    </div>
  );
}

function WeeklyQuotaBreakdownBar({
  breakdown,
  usedPercent,
}: {
  breakdown: WebQuotaBreakdown[];
  usedPercent: number;
}): ReactNode {
  return (
    <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
      {breakdown.length > 0 ? (
        breakdown.map((item) => (
          <div
            key={item.productCode}
            className={cn("h-full shrink-0", quotaProductColor(item.productCode))}
            style={{ width: `${Math.max(0, Math.min(100, item.usagePercent))}%` }}
          />
        ))
      ) : (
        <div className="h-full bg-primary" style={{ width: `${usedPercent}%` }} />
      )}
    </div>
  );
}

function WebQuotaMode({
  mode,
  window,
  locale,
  compact = false,
  recoveryProbe = false,
}: {
  mode: string;
  window: WebQuotaWindow;
  locale: string;
  compact?: boolean;
  recoveryProbe?: boolean;
}) {
  const { t } = useTranslation();
  const used = Math.max(0, window.total - window.remaining);
  const percent = window.total > 0 ? Math.max(0, Math.min(100, (used / window.total) * 100)) : 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={cn("block w-full min-w-0 text-left", compact && "px-2 first:pl-0 last:pr-0")}>
          <div className="flex items-center justify-between gap-1 text-[11px]">
            <span className="truncate text-muted-foreground">{mode}</span>
            <span className="shrink-0 tabular-nums">
              {formatNumber(used, locale, 0)}/{formatNumber(window.total, locale, 0)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div>{t("accounts.webModeQuotaRemaining", { mode, remaining: formatNumber(window.remaining, locale, 0) })}</div>
        <div className="text-muted-foreground">
          {window.resetAt
            ? recoveryProbe
              ? t("console.recoveryProbeAt", { time: formatDateTime(window.resetAt, locale) })
              : t("accounts.quotaResetAt", { time: formatDateTime(window.resetAt, locale) })
            : t("accounts.quotaResetUnknown")}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
