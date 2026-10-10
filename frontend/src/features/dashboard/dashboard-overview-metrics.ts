import type { TFunction } from "i18next";
import { Activity, CircleDollarSign, Gauge, UsersRound, WholeWord, type LucideIcon } from "lucide-react";

import type { DashboardDTO, DashboardUsageDTO } from "@/features/dashboard/dashboard-api";
import { formatUSD, formatUSDValue } from "@/features/dashboard/dashboard-format";
import { formatDuration, formatNumber } from "@/shared/lib/format";
import { usdTicksToValue } from "@/shared/lib/usd";

export type OverviewMetric = {
  key: string;
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
};

type OverviewDerived = {
  cacheHitRate: number;
  averageRequestCost: number;
  hasFirstTokenSamples: boolean;
  performanceDetail: string;
};

/** 由 usage 派生的比例与性能文案：无样本时回退到 pending 文案。 */
function resolveOverviewDerived(usage: DashboardUsageDTO | undefined, locale: string, t: TFunction): OverviewDerived {
  const cacheHitRate =
    (usage?.inputTokens ?? 0) > 0 ? ((usage?.cachedInputTokens ?? 0) / (usage?.inputTokens ?? 1)) * 100 : 0;
  const averageRequestCost =
    (usage?.requests ?? 0) > 0 ? usdTicksToValue(usage?.billedCostUsdTicks ?? 0) / (usage?.requests ?? 1) : 0;
  const hasFirstTokenSamples = (usage?.firstTokenSamples ?? 0) > 0;
  const hasThroughputSamples = (usage?.throughputSamples ?? 0) > 0;
  const performanceDetail = hasThroughputSamples
    ? t("audits.averageOutputSpeed", {
        speed: formatNumber(usage?.outputTokensPerSecond ?? 0, locale, 1),
        count: formatNumber(usage?.throughputSamples ?? 0, locale),
      })
    : t(hasFirstTokenSamples ? "audits.throughputPending" : "audits.performancePending");
  return { cacheHitRate, averageRequestCost, hasFirstTokenSamples, performanceDetail };
}

/** 概览五项指标：账号、请求、tokens、计费与首 token；计算口径与文案保持原实现。 */
export function buildOverviewMetrics(
  dashboard: DashboardDTO | undefined,
  locale: string,
  t: TFunction,
): OverviewMetric[] {
  const resources = dashboard?.resources;
  const usage = dashboard?.usage;
  const derived = resolveOverviewDerived(usage, locale, t);
  return [
    {
      key: "accounts",
      icon: UsersRound,
      label: t("dashboard.accountCount"),
      value: formatNumber(resources?.totalAccounts ?? 0, locale),
      detail: t("dashboard.accountDistribution", {
        build: formatNumber(resources?.buildAccounts ?? 0, locale),
        web: formatNumber(resources?.webAccounts ?? 0, locale),
        console: formatNumber(resources?.consoleAccounts ?? 0, locale),
      }),
    },
    {
      key: "requests",
      icon: Activity,
      label: t("dashboard.requests"),
      value: formatNumber(usage?.requests ?? 0, locale),
      detail: t("dashboard.requestSuccessRate", { rate: formatNumber(usage?.successRate ?? 0, locale, 1) }),
    },
    {
      key: "tokens",
      icon: WholeWord,
      label: t("dashboard.tokens"),
      value: formatNumber(usage?.tokens ?? 0, locale),
      detail: t("dashboard.tokenEfficiency", { rate: formatNumber(derived.cacheHitRate, locale, 1) }),
    },
    {
      key: "billing",
      icon: CircleDollarSign,
      label: t("dashboard.billing"),
      value: formatUSD(usage?.billedCostUsdTicks ?? 0, locale),
      detail: t("dashboard.averageRequestCost", { cost: formatUSDValue(derived.averageRequestCost, locale) }),
    },
    {
      key: "firstToken",
      icon: Gauge,
      label: t("audits.averageFirstToken"),
      value: derived.hasFirstTokenSamples ? formatDuration(usage?.averageFirstTokenMs ?? 0) : "—",
      detail: derived.performanceDetail,
    },
  ];
}
