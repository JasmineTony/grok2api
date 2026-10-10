import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Spinner } from "@/components/ui/spinner";
import type { DashboardDTO } from "@/features/dashboard/dashboard-api";
import { ActivityHeatmap, ActivityLegend } from "@/features/dashboard/dashboard-activity-heatmap";
import { buildActivityWeeks, formatActivityRange } from "@/features/dashboard/dashboard-activity-format";
import { DashboardPanel } from "@/features/dashboard/dashboard-panel";
import { formatNumber } from "@/shared/lib/format";

type DashboardActivityProps = {
  dashboard?: DashboardDTO;
  locale: string;
  loading: boolean;
};

/** 活动面板：总请求数、日期范围、180 天热力图与强度图例。 */
export function DashboardActivity({ dashboard, locale, loading }: DashboardActivityProps) {
  const { t } = useTranslation();
  const activity = useMemo(() => dashboard?.activity ?? [], [dashboard?.activity]);
  const weeks = useMemo(() => buildActivityWeeks(activity), [activity]);
  const maxRequests = Math.max(0, ...activity.map((point) => point.requests));
  const totalRequests = activity.reduce((total, point) => total + point.requests, 0);
  const generatedAt = dashboard?.generatedAt ? new Date(dashboard.generatedAt).getTime() : Number.POSITIVE_INFINITY;
  const rangeLabel = useMemo(() => formatActivityRange(activity, locale, generatedAt), [activity, generatedAt, locale]);

  return (
    <DashboardPanel
      id="dashboard-activity-title"
      title={t("dashboard.activityTitle")}
      actions={<span className="text-[11px] text-muted-foreground">{t("dashboard.lastDays", { count: 180 })}</span>}
      className="min-h-[210px]"
    >
      {loading ? (
        <div className="flex min-h-32 items-center justify-center">
          <Spinner className="size-5" />
        </div>
      ) : (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xl font-medium tabular-nums">{formatNumber(totalRequests, locale)}</p>
            <p className="text-[11px] text-muted-foreground">{rangeLabel}</p>
          </div>

          <ActivityHeatmap weeks={weeks} maxRequests={maxRequests} generatedAt={generatedAt} locale={locale} />

          <ActivityLegend />
        </div>
      )}
    </DashboardPanel>
  );
}
