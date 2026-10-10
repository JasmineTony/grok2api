import type { TFunction } from "i18next";

import type { ChartConfig } from "@/components/ui/chart";

export type TrendSeries = "billing" | "tokens" | "requests";
export type AxisSide = "left" | "right";
export type TrendAxes = Partial<Record<TrendSeries, AxisSide>>;

export const TREND_SERIES: TrendSeries[] = ["billing", "tokens", "requests"];

/**
 * 隐藏序列后重新分配左右轴：
 * 三条可见时 tokens 左轴、billing 右轴；两条时优先保留 tokens 左轴；一条时用左轴。
 */
export function resolveTrendAxes(hiddenSeries: ReadonlySet<TrendSeries>): TrendAxes {
  const visible = TREND_SERIES.filter((series) => !hiddenSeries.has(series));
  if (visible.length === 3) return { tokens: "left", billing: "right" };
  if (visible.length === 2) {
    if (visible.includes("tokens")) {
      return { tokens: "left", [visible.includes("billing") ? "billing" : "requests"]: "right" };
    }
    return { requests: "left", billing: "right" };
  }
  return visible.length === 1 ? { [visible[0]]: "left" } : {};
}

/** 三条序列的图例标签与主题色，保持原图表配置。 */
export function buildTrendChartConfig(t: TFunction): ChartConfig {
  return {
    tokens: {
      label: t("dashboard.trendTokens"),
      theme: { light: "oklch(0.68 0.15 245)", dark: "oklch(0.74 0.13 245)" },
    },
    billing: {
      label: t("dashboard.billing"),
      theme: { light: "oklch(0.7 0.11 160)", dark: "oklch(0.73 0.1 160)" },
    },
    requests: {
      label: t("dashboard.trendRequests"),
      theme: { light: "oklch(0.76 0.06 245)", dark: "oklch(0.56 0.07 245)" },
    },
  };
}
