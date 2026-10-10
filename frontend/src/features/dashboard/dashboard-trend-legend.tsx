import { useTranslation } from "react-i18next";

import type { ChartConfig } from "@/components/ui/chart";
import { TREND_SERIES, type TrendSeries } from "@/features/dashboard/dashboard-trend-series";
import { cn } from "@/shared/lib/cn";

type DashboardTrendLegendProps = {
  config: ChartConfig;
  hiddenSeries: ReadonlySet<TrendSeries>;
  onToggle: (series: TrendSeries) => void;
};

/** 可点击图例：按序列显示样式标记与启用状态，点击切换显隐。 */
export function DashboardTrendLegend({ config, hiddenSeries, onToggle }: DashboardTrendLegendProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-3 text-xs text-muted-foreground">
      {TREND_SERIES.map((series) => {
        const hidden = hiddenSeries.has(series);
        const label = config[series]?.label ?? series;
        return (
          <button
            key={series}
            type="button"
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 transition-[background-color,color,opacity] hover:bg-accent hover:opacity-100",
              hidden && "opacity-35",
            )}
            onClick={() => onToggle(series)}
            aria-pressed={!hidden}
            aria-label={`${t(hidden ? "common.enable" : "common.disable")} ${String(label)}`}
            data-testid={`dashboard-trend-legend-${series}`}
          >
            <SeriesLegendMark series={series} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SeriesLegendMark({ series }: { series: TrendSeries }) {
  if (series === "billing") {
    return <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: "var(--color-billing)" }} />;
  }
  return (
    <span
      className={cn("w-3 shrink-0 border-t", series === "requests" && "border-dashed")}
      style={{ borderColor: `var(--color-${series})` }}
    />
  );
}
