import type { DashboardPeriod } from "@/features/dashboard/dashboard-api";

/** 时间桶 tooltip 文案：24h 显示时分区间，其余按日期；90d 显示闭区间。 */
export function formatBucketRange(
  startValue: string | undefined,
  endValue: string | undefined,
  period: DashboardPeriod,
  locale: string,
): string {
  if (!startValue || !endValue) return "-";
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (period === "24h") {
    const formatter = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return `${formatter.format(start)}–${formatter.format(end)}`;
  }
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  if (period !== "90d") return formatter.format(start);
  const inclusiveEnd = new Date(end.getTime() - 1);
  return `${formatter.format(start)}–${formatter.format(inclusiveEnd)}`;
}

/** X 轴刻度抽样：24h 每 3 个桶、30d 每 5 个桶，末位始终显示。 */
export function shouldShowTick(index: number, count: number, period: DashboardPeriod): boolean {
  const step = period === "24h" ? 3 : period === "30d" ? 5 : 1;
  return index % step === 0 || index === count - 1;
}

/** 刻度文案：24h 显示时分，其余显示月/日。 */
export function formatBucketTick(value: string, period: DashboardPeriod, locale: string): string {
  const options: Intl.DateTimeFormatOptions =
    period === "24h" ? { hour: "2-digit", minute: "2-digit" } : { month: "numeric", day: "numeric" };
  return new Intl.DateTimeFormat(locale, options).format(new Date(value));
}
