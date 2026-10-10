import { useTranslation } from "react-i18next";

import { Spinner } from "@/components/ui/spinner";
import type { DashboardDTO } from "@/features/dashboard/dashboard-api";
import { DashboardPanel } from "@/features/dashboard/dashboard-panel";
import { DashboardTrendChart } from "@/features/dashboard/dashboard-trend-chart";
import { resolveTrendAxes } from "@/features/dashboard/dashboard-trend-series";
import { useDashboardTrend } from "@/features/dashboard/use-dashboard-trend";
import { EmptyState } from "@/shared/components/data-state";

type DashboardTrendProps = {
  dashboard?: DashboardDTO;
  locale: string;
  loading: boolean;
};

/** 使用量趋势面板：无数据时展示空态，加载中保留图表并叠加遮罩与 spinner。 */
export function DashboardTrend({ dashboard, locale, loading }: DashboardTrendProps) {
  const { t } = useTranslation();
  const trend = useDashboardTrend(dashboard, locale);

  return (
    <DashboardPanel id="dashboard-trend-title" title={t("dashboard.trend")} className="h-full min-h-[360px]">
      {!loading && !trend.hasData ? (
        <div className="flex h-[280px] items-center justify-center">
          <EmptyState message={t("dashboard.noTrendData")} />
        </div>
      ) : (
        <div className="relative" aria-busy={loading}>
          <DashboardTrendChart
            chartData={trend.chartData}
            xTicks={trend.xTicks}
            chartConfig={trend.chartConfig}
            period={dashboard?.period ?? "24h"}
            seriesKey={dashboard?.period ?? "loading"}
            locale={locale}
            hiddenSeries={trend.hiddenSeries}
            axisSides={resolveTrendAxes(trend.hiddenSeries)}
            loading={loading}
            onToggleSeries={trend.toggleSeries}
          />
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : null}
        </div>
      )}
    </DashboardPanel>
  );
}
