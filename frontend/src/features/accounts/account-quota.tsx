import type { ReactElement, ReactNode } from "react";
import type { TFunction } from "i18next";
import { Info, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BillingDTO, ModelQuotaBlockDTO, QuotaDTO } from "@/entities/accounts/types";
import { cn } from "@/shared/lib/cn";
import { formatDateTime, formatNumber, formatTokenMillions } from "@/shared/lib/format";

export function AccountQuota({
  quota,
  billing,
  locale,
}: {
  quota: QuotaDTO;
  billing?: BillingDTO;
  locale: string;
}): ReactElement {
  const { t } = useTranslation();
  const modelQuotaBlocks = quota.modelQuotaBlocks ?? [];
  if (quota.type === "unknown") {
    return (
      <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <span>{t("accountType.pending")}</span>
        <ModelQuotaBlockMarker blocks={modelQuotaBlocks} locale={locale} />
      </div>
    );
  }
  if (quota.type !== "free") {
    return <BuildQuota quota={quota} billing={billing} locale={locale} modelQuotaBlocks={modelQuotaBlocks} />;
  }
  return <FreeQuota quota={quota} locale={locale} modelQuotaBlocks={modelQuotaBlocks} />;
}

/** 免费额度用量文案：限量未知时按“估算”表述，无上限时只报已用量。 */
function freeQuotaUsageText(quota: QuotaDTO, t: TFunction, locale: string): string {
  const used = formatTokenMillions(quota.used, locale);
  const limit = formatTokenMillions(quota.limit, locale);
  if (quota.limit <= 0) return t("accounts.freeObservedUsage", { used });
  return quota.limitKnown
    ? t("accounts.freeConfirmedUsage", { used, limit })
    : t("accounts.freeEstimatedUsage", { used, limit });
}

function freeQuotaRecoveryDescription(quota: QuotaDTO, t: TFunction, locale: string): string {
  if (quota.nextProbeAt) return t("accounts.waitingResetUntil", { time: formatDateTime(quota.nextProbeAt, locale) });
  return quota.status === "probing" ? t("accounts.probingQuota") : t("accounts.quotaResetUnknown");
}

function FreeQuota({
  quota,
  locale,
  modelQuotaBlocks,
}: {
  quota: QuotaDTO;
  locale: string;
  modelQuotaBlocks: ModelQuotaBlockDTO[];
}) {
  const { t } = useTranslation();
  const percent = Math.min(100, Math.max(0, quota.usagePercent));
  return (
    <div className="w-full min-w-0 space-y-1.5">
      <FreeQuotaHeader
        usage={freeQuotaUsageText(quota, t, locale)}
        recoveryDescription={freeQuotaRecoveryDescription(quota, t, locale)}
        usagePercent={quota.usagePercent}
        isEstimated={!quota.limitKnown}
        locale={locale}
        modelQuotaBlocks={modelQuotaBlocks}
      />
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** 免费额度表头：用量文案、模型级封锁标记、估算说明与百分比。 */
function FreeQuotaHeader({
  usage,
  recoveryDescription,
  usagePercent,
  isEstimated,
  locale,
  modelQuotaBlocks,
}: {
  usage: string;
  recoveryDescription: string;
  usagePercent: number;
  isEstimated: boolean;
  locale: string;
  modelQuotaBlocks: ModelQuotaBlockDTO[];
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-3 text-[11px] font-normal">
      <div className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
        <span>{usage}</span>
        <ModelQuotaBlockMarker blocks={modelQuotaBlocks} locale={locale} />
        {isEstimated ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={t("accounts.freeEstimatedDescription")}
              >
                <Info className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-80 space-y-1">
              <div>{t("accounts.freeEstimatedDescription")}</div>
              <div className="text-muted-foreground">{recoveryDescription}</div>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <span className="shrink-0 text-muted-foreground">
        {isEstimated ? "≈" : ""}
        {formatNumber(usagePercent, locale, 1)}%
      </span>
    </div>
  );
}

/** 付费额度的周期口径：周限来自百分比额度或统一计费周期，月限来自正数限额。 */
function buildQuotaMetrics(quota: QuotaDTO, billing?: BillingDTO) {
  const percentageQuota = quota.unit === "percent";
  const weeklySource = percentageQuota ? quota.usagePercent : (billing?.creditUsagePercent ?? 0);
  return {
    hasWeekly: percentageQuota || billing?.usagePeriodType === "USAGE_PERIOD_TYPE_WEEKLY",
    hasMonthly: !percentageQuota && quota.limit > 0,
    weeklyPercent: Math.max(0, Math.min(100, weeklySource)),
    monthlyPercent: Math.max(0, Math.min(100, quota.usagePercent)),
    weeklyPeriodEnd: quota.periodEnd ?? billing?.usagePeriodEnd,
  };
}

function BuildQuota({
  quota,
  billing,
  locale,
  modelQuotaBlocks,
}: {
  quota: QuotaDTO;
  billing?: BillingDTO;
  locale: string;
  modelQuotaBlocks: ModelQuotaBlockDTO[];
}) {
  const metrics = buildQuotaMetrics(quota, billing);
  if (!metrics.hasWeekly && !metrics.hasMonthly) {
    return <PaidQuotaUsageLine modelQuotaBlocks={modelQuotaBlocks} locale={locale} />;
  }

  return (
    <div className="w-full min-w-0 space-y-1.5">
      <div
        className={cn(
          "grid w-full min-w-0 divide-x divide-border/70",
          metrics.hasWeekly && metrics.hasMonthly ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        {metrics.hasWeekly ? (
          <WeeklyQuotaColumn
            percent={metrics.weeklyPercent}
            periodEnd={metrics.weeklyPeriodEnd}
            locale={locale}
            modelQuotaBlocks={modelQuotaBlocks}
          />
        ) : null}
        {metrics.hasMonthly ? (
          <MonthlyQuotaColumn
            quota={quota}
            billing={billing}
            percent={metrics.monthlyPercent}
            locale={locale}
            modelQuotaBlocks={modelQuotaBlocks}
          />
        ) : null}
      </div>
    </div>
  );
}

/** 付费额度既无周限也无月限时，只展示用量标签与模型级封锁标记。 */
function PaidQuotaUsageLine({ modelQuotaBlocks, locale }: { modelQuotaBlocks: ModelQuotaBlockDTO[]; locale: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="text-xs text-muted-foreground">{t("accounts.paidQuotaUsage")}</span>
      <ModelQuotaBlockMarker blocks={modelQuotaBlocks} locale={locale} />
    </div>
  );
}

function WeeklyQuotaColumn({
  percent,
  periodEnd,
  locale,
  modelQuotaBlocks,
}: {
  percent: number;
  periodEnd?: string;
  locale: string;
  modelQuotaBlocks: ModelQuotaBlockDTO[];
}) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="min-w-0 px-2 text-left font-normal first:pl-0 last:pr-0">
          <div className="flex items-center justify-between gap-1 text-[11px]">
            <span className="truncate text-muted-foreground">{t("accounts.weeklyQuota")}</span>
            <span className="shrink-0 tabular-nums">{formatNumber(percent, locale, 1)}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div>{t("accounts.weeklyLimit", { percent: formatNumber(100 - percent, locale, 1) })}</div>
        <div className="text-muted-foreground">
          {periodEnd
            ? t("accounts.quotaResetAt", { time: formatDateTime(periodEnd, locale) })
            : t("accounts.quotaResetUnknown")}
        </div>
        <ModelQuotaBlockTooltip blocks={modelQuotaBlocks} locale={locale} />
      </TooltipContent>
    </Tooltip>
  );
}

function MonthlyQuotaColumn({
  quota,
  billing,
  percent,
  locale,
  modelQuotaBlocks,
}: {
  quota: QuotaDTO;
  billing?: BillingDTO;
  percent: number;
  locale: string;
  modelQuotaBlocks: ModelQuotaBlockDTO[];
}) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="min-w-0 px-2 text-left font-normal first:pl-0 last:pr-0">
          <div className="flex items-center justify-between gap-1 text-[11px]">
            <span className="truncate text-muted-foreground">{t("accounts.monthlyQuota")}</span>
            <span className="shrink-0 tabular-nums">
              {formatNumber(quota.used, locale, 2)}/{formatNumber(quota.limit, locale, 2)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div>{t("accounts.paidQuotaDetails", { remaining: formatNumber(quota.remaining, locale, 2) })}</div>
        <div className="text-muted-foreground">
          {billing?.billingPeriodEnd
            ? t("accounts.quotaResetAt", { time: formatDateTime(billing.billingPeriodEnd, locale) })
            : t("accounts.quotaResetUnknown")}
        </div>
        <ModelQuotaBlockTooltip blocks={modelQuotaBlocks} locale={locale} />
      </TooltipContent>
    </Tooltip>
  );
}

// ModelQuotaBlockMarker 是额度单元格里的行内警示：账号整体可用，但个别上游模型仍被封。
function ModelQuotaBlockMarker({ blocks, locale }: { blocks: ModelQuotaBlockDTO[]; locale: string }): ReactNode {
  const { t } = useTranslation();
  if (blocks.length === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="account-quota-model-block-marker"
          className="inline-flex shrink-0 text-amber-600 transition-colors hover:text-amber-500 dark:text-amber-400"
          aria-label={t("accounts.modelQuotaBlockedTitle", { count: blocks.length })}
        >
          <TriangleAlert className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-80">
        <ModelQuotaBlockTooltip blocks={blocks} locale={locale} />
      </TooltipContent>
    </Tooltip>
  );
}

export function ModelQuotaBlockTooltip({
  blocks,
  locale,
}: {
  blocks: ModelQuotaBlockDTO[];
  locale: string;
}): ReactNode {
  const { t } = useTranslation();
  if (blocks.length === 0) return null;
  return (
    <>
      <div data-testid="account-quota-model-block-title">
        {t("accounts.modelQuotaBlockedTitle", { count: blocks.length })}
      </div>
      <div className="mt-1 grid gap-1" data-testid="account-quota-model-block-list">
        {blocks.map((block) => (
          <div
            key={`${block.model}@${block.cooldownUntil ?? ""}`}
            data-testid={`account-quota-model-block-item-${block.model}`}
            className="flex items-center justify-between gap-4"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{block.model}</span>
              <span className="shrink-0 text-muted-foreground">{modelQuotaReasonLabel(block.reason, t)}</span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              {block.cooldownUntil
                ? t("accounts.modelQuotaBlockedUntil", { time: formatDateTime(block.cooldownUntil, locale) })
                : t("accounts.quotaResetUnknown")}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function modelQuotaReasonLabel(reason: string, t: TFunction): string {
  const keys: Record<string, string> = {
    model_quota_depleted: "modelQuotaReasonDepleted",
    model_access_denied: "modelQuotaReasonAccessDenied",
  };
  const key = keys[reason];
  return key ? t(`accounts.${key}`) : reason;
}
