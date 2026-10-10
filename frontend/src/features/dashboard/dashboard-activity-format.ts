import type { DashboardDTO } from "@/features/dashboard/dashboard-api";

export type ActivityPoint = DashboardDTO["activity"][number];

export const ACTIVITY_INTENSITY_CLASSES = [
  "bg-emerald-500/10",
  "bg-emerald-500/25",
  "bg-emerald-500/45",
  "bg-emerald-500/70",
  "bg-emerald-500",
] as const;

/** 每 7 天一组，供网格按列渲染。 */
export function buildActivityWeeks(activity: ActivityPoint[]): ActivityPoint[][] {
  return Array.from({ length: Math.ceil(activity.length / 7) }, (_, index) => activity.slice(index * 7, index * 7 + 7));
}

/** 对数强度分级：0 表示无请求。 */
export function activityLevel(value: number, maximum: number): number {
  if (value <= 0 || maximum <= 0) return 0;
  const ratio = Math.log1p(value) / Math.log1p(maximum);
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export function formatActivityDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(value));
}

/** 活动范围文案：最后一个不晚于生成时间的桶作为结束。 */
export function formatActivityRange(activity: ActivityPoint[], locale: string, generatedAt: number): string {
  if (activity.length === 0) return "-";
  let lastVisible = activity[0];
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    if (new Date(activity[index].start).getTime() <= generatedAt) {
      lastVisible = activity[index];
      break;
    }
  }
  return `${formatActivityDate(activity[0].start, locale)} – ${formatActivityDate(lastVisible.start, locale)}`;
}
