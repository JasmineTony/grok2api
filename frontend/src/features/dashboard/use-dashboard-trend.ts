import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ChartConfig } from "@/components/ui/chart";
import type { DashboardDTO } from "@/features/dashboard/dashboard-api";
import { formatBucketRange, shouldShowTick } from "@/features/dashboard/dashboard-trend-buckets";
import { buildTrendChartConfig, type TrendSeries } from "@/features/dashboard/dashboard-trend-series";
import { usdTicksToValue } from "@/shared/lib/usd";

export type TrendChartPoint = {
  requests: number;
  tokens: number;
  billing: number;
  start: string;
  tooltipLabel: string;
};

export type DashboardTrendModel = {
  chartData: TrendChartPoint[];
  xTicks: string[];
  chartConfig: ChartConfig;
  hasData: boolean;
  hiddenSeries: ReadonlySet<TrendSeries>;
  toggleSeries: (series: TrendSeries) => void;
};

/** 趋势图数据、刻度与图例配置，以及序列显隐状态；图表渲染在独立组件。 */
export function useDashboardTrend(dashboard: DashboardDTO | undefined, locale: string): DashboardTrendModel {
  const { t } = useTranslation();
  const [hiddenSeries, setHiddenSeries] = useState<Set<TrendSeries>>(() => new Set());
  const period = dashboard?.period ?? "24h";
  const chartData = useMemo<TrendChartPoint[]>(
    () =>
      dashboard?.series.map((bucket) => ({
        requests: bucket.requests,
        tokens: bucket.tokens,
        billing: usdTicksToValue(bucket.billedCostUsdTicks),
        start: bucket.start,
        tooltipLabel: formatBucketRange(bucket.start, bucket.end, dashboard.period, locale),
      })) ?? [],
    [dashboard, locale],
  );
  const xTicks = useMemo(
    () =>
      chartData.filter((_point, index) => shouldShowTick(index, chartData.length, period)).map((point) => point.start),
    [chartData, period],
  );
  const chartConfig = useMemo(() => buildTrendChartConfig(t), [t]);
  const hasData =
    dashboard?.series.some((bucket) => bucket.requests > 0 || bucket.tokens > 0 || bucket.billedCostUsdTicks > 0) ??
    false;

  function toggleSeries(series: TrendSeries): void {
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(series)) next.delete(series);
      else next.add(series);
      return next;
    });
  }

  return { chartData, xTicks, chartConfig, hasData, hiddenSeries, toggleSeries };
}
