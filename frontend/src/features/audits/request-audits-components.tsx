import {
  Activity,
  ArrowDown,
  ArrowUp,
  BrainCircuit,
  CircleCheck,
  CircleDollarSign,
  CornerDownRight,
  Database,
  Info,
  type LucideIcon,
  Minimize2,
  WholeWord,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AuditDTO, AuditSummaryDTO } from "@/features/audits/request-audits-api";
import { cn } from "@/shared/lib/cn";
import { ticksToUSD } from "@/shared/lib/cost";
import { formatDuration, formatNumber } from "@/shared/lib/format";

export function RequestAuditSummary({
  summary,
  loading,
  locale,
}: {
  summary?: AuditSummaryDTO | undefined;
  loading: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  const tokenCacheHitRate = summary?.usage.tokenCacheHitRate ?? 0;
  const requestCacheAvailable = (summary?.usage.requestCacheEligibleRequests ?? 0) > 0;
  const requestCacheHitRate = summary?.usage.requestCacheHitRate ?? 0;
  const billedCostTicks = summary?.usage.billedCostInUsdTicks ?? 0;
  const hasCost = billedCostTicks > 0 || (summary?.pricing.pricedRequests ?? 0) > 0;
  return (
    <section className="space-y-2" aria-label={t("audits.usageSummary")}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <AuditMetric
          icon={Activity}
          loading={loading}
          label={t("audits.totalRequests")}
          value={formatNumber(summary?.usage.requests ?? 0, locale, 0)}
          detail={t("audits.requestBreakdown", {
            success: formatNumber(summary?.usage.successfulRequests ?? 0, locale, 0),
            failed: formatNumber(summary?.usage.failedRequests ?? 0, locale, 0),
          })}
        />
        <AuditMetric
          icon={WholeWord}
          loading={loading}
          label={t("audits.totalTokens")}
          value={formatNumber(summary?.usage.totalTokens ?? 0, locale, 0)}
          detail={
            requestCacheAvailable
              ? t("audits.cacheEfficiency", {
                  tokenRate: formatNumber(tokenCacheHitRate, locale, 1),
                  requestRate: formatNumber(requestCacheHitRate, locale, 1),
                })
              : t("audits.cacheEfficiencyUnavailable", {
                  tokenRate: formatNumber(tokenCacheHitRate, locale, 1),
                })
          }
        />
        <AuditMetric
          icon={CircleCheck}
          loading={loading}
          label={t("audits.successRate")}
          value={`${formatNumber(summary?.usage.successRate ?? 0, locale, 1)}%`}
          detail={t("audits.averageDuration", {
            duration: formatDuration(summary?.usage.averageDurationMs ?? 0),
          })}
        />
        <AuditMetric
          icon={CircleDollarSign}
          loading={loading}
          label={t("audits.billedCost")}
          value={hasCost ? formatUSDCost(billedCostTicks, 2) : "-"}
          fullValue={hasCost ? formatUSDCost(billedCostTicks, 10) : undefined}
          detail={t("audits.costComposition", {
            actual: formatUSDCost(summary?.usage.costInUsdTicks ?? 0, 2),
            estimated: formatUSDCost(summary?.usage.estimatedCostInUsdTicks ?? 0, 2),
          })}
          tooltip={t("audits.pricingDescription")}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <AuditTokenMetric
          icon={ArrowUp}
          loading={loading}
          label={t("audits.input")}
          value={formatNumber(summary?.usage.inputTokens ?? 0, locale, 0)}
        />
        <AuditTokenMetric
          icon={ArrowDown}
          loading={loading}
          label={t("audits.output")}
          value={formatNumber(summary?.usage.outputTokens ?? 0, locale, 0)}
        />
        <AuditTokenMetric
          icon={Database}
          loading={loading}
          label={t("audits.cached")}
          value={formatNumber(summary?.usage.cachedInputTokens ?? 0, locale, 0)}
        />
        <AuditTokenMetric
          icon={BrainCircuit}
          loading={loading}
          label={t("audits.reasoning")}
          value={formatNumber(summary?.usage.reasoningTokens ?? 0, locale, 0)}
        />
      </div>
    </section>
  );
}

export function RequestValue({ audit }: { audit: AuditDTO }) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <span className="block truncate text-xs font-medium">
        {providerLabel(audit.provider)} · {t(`audits.operations.${audit.operation}`)}
      </span>
      <span
        className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground"
        title={audit.requestId}
      >
        {audit.requestId}
      </span>
    </div>
  );
}

export function EgressValue({ audit }: { audit: AuditDTO }) {
  const { t } = useTranslation();
  if (!audit.egressMode) {
    return <span className="text-muted-foreground">-</span>;
  }
  const proxied = audit.egressMode === "proxy";
  const node =
    audit.egressNodeName || (proxied ? t("audits.egressUnknown") : t("audits.egressDirect"));
  const details = [audit.egressScope, audit.egressNodeId ? `#${audit.egressNodeId}` : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="block min-w-0 max-w-full cursor-help text-left"
          aria-label={`${proxied ? t("audits.egressProxy") : t("audits.egressDirect")}: ${node}`}
        >
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs",
              proxied ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                proxied ? "bg-emerald-500" : "bg-muted-foreground/50",
              )}
            />
            {proxied ? t("audits.egressProxy") : t("audits.egressDirect")}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72" side="top" align="start">
        <div>{node}</div>
        {details ? <div className="mt-1 text-primary-foreground/65">{details}</div> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function BillingValue({ audit }: { audit: AuditDTO }) {
  const { t } = useTranslation();
  const upstreamReported = audit.costInUsdTicks > 0;
  const priced = upstreamReported || Boolean(audit.pricingModel);
  const ticks = upstreamReported ? audit.costInUsdTicks : audit.estimatedCostInUsdTicks;
  const amount = priced ? formatUSDCost(ticks, 2) : "-";
  const fullAmount = priced ? formatUSDCost(ticks, 10) : "";
  return (
    <div className="max-w-full text-left">
      {priced ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block cursor-help whitespace-nowrap text-xs tabular-nums" tabIndex={0}>
              {amount}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="text-primary-foreground/65">{t("audits.exactBilling")}</span>{" "}
            <span className="font-mono">{fullAmount}</span>
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="block text-xs text-muted-foreground">-</span>
      )}
      {audit.numServerSideToolsUsed > 0 ? (
        <span className="mt-0.5 block whitespace-nowrap text-[10px] text-muted-foreground">
          {t("audits.serverTools", { count: audit.numServerSideToolsUsed })}
        </span>
      ) : null}
    </div>
  );
}

function AuditMetric({
  icon: Icon,
  label,
  value,
  detail,
  tooltip,
  fullValue,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: string;
  tooltip?: string;
  fullValue?: string | undefined;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <article className="min-h-28 rounded-lg bg-card p-4" aria-busy={loading}>
      <header className="flex min-h-5 items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{label}</span>
          {tooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="cursor-help" aria-label={tooltip}>
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-72 leading-5">{tooltip}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
      </header>
      <div className="mt-3 flex min-h-8 items-center text-2xl font-medium tracking-tight tabular-nums">
        {loading ? (
          <Spinner />
        ) : fullValue ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help" tabIndex={0}>
                {value}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span className="text-primary-foreground/65">{t("audits.exactBilling")}</span>{" "}
              <span className="font-mono">{fullValue}</span>
            </TooltipContent>
          </Tooltip>
        ) : (
          value
        )}
      </div>
      {detail ? (
        <p
          className={cn(
            "mt-1.5 min-h-4 truncate text-[11px] text-muted-foreground",
            loading && "invisible",
          )}
          title={detail}
        >
          {detail}
        </p>
      ) : null}
    </article>
  );
}

function AuditTokenMetric({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <div className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-lg bg-muted/45 px-4 py-2">
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        {label}
      </span>
      <span
        className="flex min-h-5 min-w-8 items-center justify-end truncate text-sm font-medium tabular-nums"
        title={loading ? undefined : value}
      >
        {loading ? <Spinner className="size-3.5" /> : value}
      </span>
    </div>
  );
}

export function ModelRouteValue({
  model,
  upstreamModel,
  account,
  clientKey,
}: {
  model: string;
  upstreamModel: string;
  account: string;
  clientKey: string;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="block w-full min-w-0 cursor-help text-left"
          aria-label={t("audits.routeDetails")}
        >
          <span className="block truncate text-xs font-medium" title={model}>
            {model}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
            <CornerDownRight className="size-3 shrink-0" />
            <span className="truncate" title={upstreamModel}>
              {upstreamModel}
            </span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="w-64 space-y-1.5 py-2" side="top" align="start">
        <div className="grid grid-cols-[auto_1fr] gap-x-3">
          <span className="text-primary-foreground/65">{t("audits.owningAccount")}</span>
          <span className="truncate text-right" title={account}>
            {account}
          </span>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3">
          <span className="text-primary-foreground/65">{t("audits.owningKey")}</span>
          <span className="truncate text-right" title={clientKey}>
            {clientKey}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function UsageDetails({ audit, locale }: { audit: AuditDTO; locale: string }) {
  const { t } = useTranslation();
  if (audit.operation === "compaction" && audit.totalTokens === 0) {
    return (
      <div className="flex h-[52px] w-full items-center gap-2 rounded-md bg-muted/45 px-2.5 text-[11px]">
        <Minimize2 className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate font-medium">{t("audits.operations.compaction")}</p>
          <p className="truncate text-muted-foreground">{t("audits.compactionUsageUnavailable")}</p>
        </div>
      </div>
    );
  }
  if (audit.operation === "video") {
    return (
      <MediaUsage
        input={t("audits.imageCount", { count: audit.mediaInputImages })}
        output={t("audits.secondsCount", { count: audit.mediaOutputSeconds })}
      />
    );
  }
  if (
    audit.operation === "image" ||
    audit.operation === "image_edit" ||
    audit.mediaInputImages > 0 ||
    audit.mediaOutputImages > 0
  ) {
    return (
      <MediaUsage
        input={t("audits.imageCount", { count: audit.mediaInputImages })}
        output={t("audits.imageCount", { count: audit.mediaOutputImages })}
      />
    );
  }
  const items = [
    { label: t("audits.input"), value: audit.inputTokens },
    { label: t("audits.output"), value: audit.outputTokens },
    { label: t("audits.cached"), value: audit.cachedInputTokens },
    { label: t("audits.reasoning"), value: audit.reasoningTokens },
  ];
  return (
    <div className="w-full">
      <div className="grid grid-cols-2 gap-1">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex h-6 min-w-0 items-center justify-between gap-2 rounded-md bg-muted/45 px-2 text-[11px]"
          >
            <span className="text-muted-foreground">{item.label}</span>
            <span className="font-medium tabular-nums">{formatNumber(item.value, locale)}</span>
          </div>
        ))}
      </div>
      {audit.numSourcesUsed > 0 ? (
        <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
          <span>{t("audits.sources", { count: audit.numSourcesUsed })}</span>
        </div>
      ) : null}
    </div>
  );
}

function MediaUsage({ input, output }: { input: string; output: string }) {
  const { t } = useTranslation();
  return (
    <div className="grid w-full gap-1">
      <div className="flex h-6 items-center justify-between gap-3 rounded-md bg-muted/45 px-2 text-[11px]">
        <span className="text-muted-foreground">{t("audits.mediaInput")}</span>
        <span className="font-medium tabular-nums">{input}</span>
      </div>
      <div className="flex h-6 items-center justify-between gap-3 rounded-md bg-muted/45 px-2 text-[11px]">
        <span className="text-muted-foreground">{t("audits.output")}</span>
        <span className="font-medium tabular-nums">{output}</span>
      </div>
    </div>
  );
}

function StatusCode({ statusCode, hasError = false }: { statusCode: number; hasError?: boolean }) {
  const tone = statusTone(statusCode, hasError);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs tabular-nums", tone.text)}>
      <span className={cn("size-1.5 rounded-full", tone.dot)} />
      {statusCode || "-"}
    </span>
  );
}

export function AuditStatus({ audit, onOpen }: { audit: AuditDTO; onOpen: () => void }) {
  const { t } = useTranslation();
  const mode =
    audit.operation === "compaction"
      ? t("audits.operations.compaction")
      : audit.streaming
        ? t("audits.stream")
        : t("audits.nonStream");
  const content = (
    <>
      <StatusCode statusCode={audit.statusCode} hasError={Boolean(audit.errorCode)} />
      <span className="block whitespace-nowrap text-[10px] text-muted-foreground">{mode}</span>
    </>
  );
  if (!audit.errorCode && audit.attemptCount === 0)
    return <div className="space-y-0.5 text-center">{content}</div>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="group space-y-0.5 rounded-md text-center outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&>span:last-child]:underline-offset-2 hover:[&>span:last-child]:text-foreground hover:[&>span:last-child]:underline"
          aria-label={t("audits.openDiagnostics")}
          onClick={onOpen}
        >
          {content}
        </button>
      </TooltipTrigger>
      <TooltipContent
        className="max-w-80 whitespace-normal break-words text-left leading-5"
        side="top"
      >
        {audit.errorCode || t("audits.openDiagnostics")}
      </TooltipContent>
    </Tooltip>
  );
}

function statusTone(statusCode: number, hasError = false): { dot: string; text: string } {
  if (hasError) return { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" };
  if (statusCode >= 500) return { dot: "bg-red-500", text: "text-red-700 dark:text-red-300" };
  if (statusCode >= 400) return { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" };
  if (statusCode >= 200 && statusCode < 300)
    return { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" };
  return { dot: "bg-muted-foreground/50", text: "text-muted-foreground" };
}

function providerLabel(provider: AuditDTO["provider"]): string {
  switch (provider) {
    case "grok_build":
      return "Grok Build";
    case "grok_web":
      return "Grok Web";
    case "grok_console":
      return "Grok Console";
  }
}

function formatUSDCost(ticks: number, fractionDigits: number): string {
  return `${ticksToUSD(ticks).toFixed(fractionDigits)}`;
}
