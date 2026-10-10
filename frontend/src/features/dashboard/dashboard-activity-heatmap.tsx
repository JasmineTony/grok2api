import { useTranslation } from "react-i18next";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ACTIVITY_INTENSITY_CLASSES,
  activityLevel,
  formatActivityDate,
  type ActivityPoint,
} from "@/features/dashboard/dashboard-activity-format";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";

type ActivityHeatmapProps = {
  weeks: ActivityPoint[][];
  maxRequests: number;
  generatedAt: number;
  locale: string;
};

/** 180 天活动热力图：每列一周，未来日期以浅色占位。 */
export function ActivityHeatmap({ weeks, maxRequests, generatedAt, locale }: ActivityHeatmapProps) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 w-full pb-1">
      <div
        className="flex w-full gap-1"
        aria-label={t("dashboard.activityTitle")}
        data-testid="dashboard-activity-heatmap"
      >
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="grid min-w-0 flex-1 grid-rows-7 gap-1">
            {week.map((point) => (
              <ActivityDay
                key={point.start}
                point={point}
                maxRequests={maxRequests}
                generatedAt={generatedAt}
                locale={locale}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityDay({
  point,
  maxRequests,
  generatedAt,
  locale,
}: {
  point: ActivityPoint;
  maxRequests: number;
  generatedAt: number;
  locale: string;
}) {
  const { t } = useTranslation();
  const future = new Date(point.start).getTime() > generatedAt;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "aspect-square w-full rounded-[3px]",
            future ? "bg-muted/40" : ACTIVITY_INTENSITY_CLASSES[activityLevel(point.requests, maxRequests)],
          )}
          aria-hidden="true"
        />
      </TooltipTrigger>
      <TooltipContent>
        {t("dashboard.activityDay", {
          date: formatActivityDate(point.start, locale),
          requests: formatNumber(point.requests, locale),
        })}
      </TooltipContent>
    </Tooltip>
  );
}

/** 强度图例：少 → 多。 */
export function ActivityLegend() {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
      <span>{t("dashboard.activityLess")}</span>
      {ACTIVITY_INTENSITY_CLASSES.map((className) => (
        <span key={className} className={cn("size-2.5 rounded-[2px]", className)} />
      ))}
      <span>{t("dashboard.activityMore")}</span>
    </div>
  );
}
