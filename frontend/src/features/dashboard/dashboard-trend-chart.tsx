import type { ComponentProps } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { DashboardPeriod } from "@/features/dashboard/dashboard-api";
import { formatBucketTick } from "@/features/dashboard/dashboard-trend-buckets";
import { DashboardTrendLegend } from "@/features/dashboard/dashboard-trend-legend";
import type { TrendAxes, TrendSeries } from "@/features/dashboard/dashboard-trend-series";
import { formatCompactNumber, formatCompactUSD, formatUSDValue } from "@/features/dashboard/dashboard-format";
import type { TrendChartPoint } from "@/features/dashboard/use-dashboard-trend";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";

export type DashboardTrendChartProps = {
  chartData: TrendChartPoint[];
  xTicks: string[];
  chartConfig: ChartConfig;
  period: DashboardPeriod;
  /** 序列 key 后缀：period 变化时重建面积/折线以重播动画，加载中为 loading。 */
  seriesKey: string;
  locale: string;
  hiddenSeries: ReadonlySet<TrendSeries>;
  axisSides: TrendAxes;
  loading: boolean;
  onToggleSeries: (series: TrendSeries) => void;
};

const CHART_MARGIN = { left: 0, right: 4, top: 10, bottom: 0 };
const TOKENS_FILL_ID = "dashboard-tokens-fill";

type AxisProps = {
  x: Omit<ComponentProps<typeof XAxis>, "ref">;
  tokens: Omit<ComponentProps<typeof YAxis>, "ref">;
  billing: Omit<ComponentProps<typeof YAxis>, "ref">;
  requests: Omit<ComponentProps<typeof YAxis>, "ref">;
};

/**
 * 坐标轴属性：recharts 只识别 ComposedChart 的直接子元素，
 * 因此这里只构造属性对象，元素本身仍直接写在图表里。
 */
function buildAxisProps(period: DashboardPeriod, locale: string, xTicks: string[], axisSides: TrendAxes): AxisProps {
  return {
    x: {
      dataKey: "start",
      ticks: xTicks,
      interval: 0,
      tickLine: false,
      axisLine: false,
      tickMargin: 10,
      minTickGap: 12,
      tickFormatter: (value) => formatBucketTick(String(value), period, locale),
    },
    tokens: {
      yAxisId: "tokens",
      hide: !axisSides.tokens,
      orientation: axisSides.tokens ?? "left",
      tickLine: false,
      axisLine: false,
      tickMargin: 8,
      width: axisSides.tokens ? 48 : 0,
      allowDecimals: false,
      tickFormatter: (value) => formatCompactNumber(Number(value), locale),
    },
    billing: {
      yAxisId: "billing",
      hide: !axisSides.billing,
      orientation: axisSides.billing ?? "right",
      tickLine: false,
      axisLine: false,
      tickMargin: 8,
      width: axisSides.billing ? 48 : 0,
      allowDecimals: true,
      tickFormatter: (value) => formatCompactUSD(Number(value), locale),
    },
    requests: {
      yAxisId: "requests",
      hide: !axisSides.requests,
      orientation: axisSides.requests ?? "right",
      tickLine: false,
      axisLine: false,
      tickMargin: 8,
      width: axisSides.requests ? 48 : 0,
      allowDecimals: false,
      tickFormatter: (value) => formatCompactNumber(Number(value), locale),
    },
  };
}

type MarkProps = {
  billing: Omit<ComponentProps<typeof Bar>, "ref">;
  tokens: Omit<ComponentProps<typeof Area>, "ref">;
  requests: Omit<ComponentProps<typeof Line>, "ref">;
};

/** 三类序列样式：柱（billing）、渐变面积（tokens）、虚线（requests）。 */
function buildMarkProps(hiddenSeries: ReadonlySet<TrendSeries>): MarkProps {
  return {
    billing: {
      yAxisId: "billing",
      dataKey: "billing",
      fill: "var(--color-billing)",
      fillOpacity: 0.42,
      hide: hiddenSeries.has("billing"),
      maxBarSize: 32,
      radius: [3, 3, 0, 0],
      animationDuration: 700,
      animationEasing: "ease-out",
    },
    tokens: {
      yAxisId: "tokens",
      dataKey: "tokens",
      type: "monotone",
      stroke: "var(--color-tokens)",
      strokeWidth: 1.5,
      fill: `url(#${TOKENS_FILL_ID})`,
      hide: hiddenSeries.has("tokens"),
      dot: false,
      activeDot: { r: 3, fill: "var(--color-tokens)", stroke: "var(--color-background)", strokeWidth: 2 },
      animationDuration: 700,
      animationEasing: "ease-out",
    },
    requests: {
      yAxisId: "requests",
      dataKey: "requests",
      type: "monotone",
      stroke: "var(--color-requests)",
      strokeWidth: 1.25,
      strokeDasharray: "5 4",
      hide: hiddenSeries.has("requests"),
      dot: false,
      activeDot: { r: 3, fill: "var(--color-requests)", stroke: "var(--color-background)", strokeWidth: 2 },
      animationDuration: 700,
      animationEasing: "ease-out",
    },
  };
}

type TooltipProps = Omit<ComponentProps<typeof ChartTooltipContent>, "ref">;

/** tooltip 内容属性：标签使用桶区间文案，数值按 billing/其它分别格式化。 */
function buildTooltipProps(chartConfig: ChartConfig, locale: string): { content: TooltipProps } {
  return {
    content: {
      className: "w-64 max-w-[calc(100vw-2rem)]",
      indicator: "dot",
      labelFormatter: (_label, payload) => payload?.[0]?.payload?.tooltipLabel ?? "",
      formatter: (value, name, item) => (
        <div className="flex w-full items-center justify-between gap-4">
          <span className="flex min-w-0 items-center gap-2 text-xs font-normal text-muted-foreground">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: item.color || `var(--color-${String(name)})` }}
            />
            <span className="truncate">{chartConfig[String(name)]?.label ?? name}</span>
          </span>
          <span className="shrink-0 font-mono text-xs font-normal tabular-nums text-muted-foreground">
            {name === "billing" ? formatUSDValue(Number(value), locale) : formatNumber(Number(value), locale)}
          </span>
        </div>
      ),
    },
  };
}

/** 使用量趋势组合图：tokens 面积、billing 柱、requests 虚线，配双 Y 轴与可点击图例。 */
export function DashboardTrendChart(props: DashboardTrendChartProps) {
  const axis = buildAxisProps(props.period, props.locale, props.xTicks, props.axisSides);
  const marks = buildMarkProps(props.hiddenSeries);
  const tooltip = buildTooltipProps(props.chartConfig, props.locale);
  return (
    <ChartContainer
      config={props.chartConfig}
      className={cn("h-[280px] w-full aspect-auto", props.loading && "opacity-40")}
    >
      <ComposedChart accessibilityLayer data={props.chartData} margin={CHART_MARGIN}>
        <defs>
          <linearGradient id={TOKENS_FILL_ID} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-tokens)" stopOpacity={0.2} />
            <stop offset="95%" stopColor="var(--color-tokens)" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis {...axis.x} />
        <YAxis {...axis.tokens} />
        <YAxis {...axis.billing} />
        <YAxis {...axis.requests} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent {...tooltip.content} />} />
        <Bar {...marks.billing} />
        <Area key={`tokens-${props.seriesKey}`} {...marks.tokens} />
        <Line key={`requests-${props.seriesKey}`} {...marks.requests} />
        <ChartLegend
          content={
            <DashboardTrendLegend
              config={props.chartConfig}
              hiddenSeries={props.hiddenSeries}
              onToggle={props.onToggleSeries}
            />
          }
        />
      </ComposedChart>
    </ChartContainer>
  );
}
