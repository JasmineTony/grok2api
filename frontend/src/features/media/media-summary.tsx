import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Clock, Database, Image as ImageIcon, ListVideo, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/features/media/media-format";
import type { VideoStatsDTO } from "@/features/media/types";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";

type SummaryItemProps = {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  tone: string;
};

/** 摘要条目：图标 + 标签 + 数值。 */
export function SummaryItem({ icon: Icon, label, value, tone }: SummaryItemProps) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <Icon className={cn("size-3.5", tone)} />
      <span className="text-muted-foreground">{label}</span>
      <strong className="font-medium tabular-nums">{value}</strong>
    </span>
  );
}

type GallerySummaryProps = {
  loading: boolean;
  unavailable: boolean;
  totalImages: number;
  totalBytes: number;
  locale: string;
};

/** 图库统计摘要；加载中显示 spinner，接口不可用时显示 "-"。 */
export function GallerySummary({ loading, unavailable, totalImages, totalBytes, locale }: GallerySummaryProps) {
  const { t } = useTranslation();
  const value = (text: string): ReactNode => (loading ? <Spinner className="size-3" /> : unavailable ? "-" : text);
  return (
    <div className="flex h-8 items-center gap-4 whitespace-nowrap text-xs" aria-busy={loading}>
      <SummaryItem
        icon={ImageIcon}
        tone="text-emerald-600 dark:text-emerald-400"
        label={t("media.images.totalImages")}
        value={value(formatNumber(totalImages, locale, 0))}
      />
      <span className="h-3 w-px bg-border" aria-hidden="true" />
      <SummaryItem
        icon={Database}
        tone="text-sky-600 dark:text-sky-400"
        label={t("media.images.totalBytes")}
        value={value(formatBytes(totalBytes, locale))}
      />
    </div>
  );
}

type VideoSummaryProps = {
  stats?: VideoStatsDTO;
  loading: boolean;
  unavailable: boolean;
  locale: string;
};

/** 视频任务统计摘要；加载中只显示 spinner，统计不可用时显示 "-"。 */
export function VideoSummary({ stats, loading, unavailable, locale }: VideoSummaryProps) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="flex h-8 items-center">
        <Spinner className="size-3.5" />
      </div>
    );
  }
  const value = (count: number | undefined): string => (unavailable ? "-" : formatNumber(count ?? 0, locale, 0));
  return (
    <div className="flex h-8 w-full items-center gap-4 overflow-x-auto whitespace-nowrap text-xs sm:w-auto">
      <SummaryItem
        icon={ListVideo}
        label={t("media.videos.totalJobs")}
        value={value(stats?.totalJobs)}
        tone="text-muted-foreground"
      />
      <span className="h-3 w-px shrink-0 bg-border" aria-hidden="true" />
      <SummaryItem
        icon={Clock}
        label={t("media.videos.queued")}
        value={value(stats?.queued)}
        tone="text-amber-600 dark:text-amber-400"
      />
      <SummaryItem
        icon={Loader2}
        label={t("media.videos.inProgress")}
        value={value(stats?.inProgress)}
        tone="text-sky-600 dark:text-sky-400"
      />
      <SummaryItem
        icon={CheckCircle2}
        label={t("media.videos.completed")}
        value={value(stats?.completed)}
        tone="text-emerald-600 dark:text-emerald-400"
      />
      <SummaryItem
        icon={AlertCircle}
        label={t("media.videos.failed")}
        value={value(stats?.failed)}
        tone="text-red-600 dark:text-red-400"
      />
    </div>
  );
}
