import type { LucideIcon } from "lucide-react";
import { AlertCircle, CheckCircle2, Clock, ListVideo, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MediaJobDTO, VideoStatsDTO } from "@/features/media/types";
import { progressTone, statusTone } from "@/features/media/video-gallery-utils";
import { cn } from "@/shared/lib/cn";
import { formatDateTime, formatNumber } from "@/shared/lib/format";

export function VideoSummary({
  stats,
  loading,
  unavailable,
  locale,
}: {
  stats?: VideoStatsDTO | undefined;
  loading: boolean;
  unavailable: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  if (loading)
    return (
      <div className="flex h-8 items-center">
        <Spinner className="size-3.5" />
      </div>
    );
  const value = (count: number | undefined) =>
    unavailable ? "-" : formatNumber(count ?? 0, locale, 0);
  return (
    <div className="flex h-8 w-full items-center gap-4 overflow-x-auto whitespace-nowrap text-xs sm:w-auto">
      <VideoSummaryItem
        icon={ListVideo}
        label={t("media.videos.totalJobs")}
        value={value(stats?.totalJobs)}
        tone="text-muted-foreground"
      />
      <span className="h-3 w-px shrink-0 bg-border" aria-hidden="true" />
      <VideoSummaryItem
        icon={Clock}
        label={t("media.videos.queued")}
        value={value(stats?.queued)}
        tone="text-amber-600 dark:text-amber-400"
      />
      <VideoSummaryItem
        icon={Loader2}
        label={t("media.videos.inProgress")}
        value={value(stats?.inProgress)}
        tone="text-sky-600 dark:text-sky-400"
      />
      <VideoSummaryItem
        icon={CheckCircle2}
        label={t("media.videos.completed")}
        value={value(stats?.completed)}
        tone="text-emerald-600 dark:text-emerald-400"
      />
      <VideoSummaryItem
        icon={AlertCircle}
        label={t("media.videos.failed")}
        value={value(stats?.failed)}
        tone="text-red-600 dark:text-red-400"
      />
    </div>
  );
}

export function VideoSummaryItem({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <Icon className={cn("size-3.5", tone)} />
      <span className="text-muted-foreground">{label}</span>
      <strong className="font-medium tabular-nums">{value}</strong>
    </span>
  );
}

export function VideoStatus({
  status,
  errorMessage,
}: {
  status: MediaJobDTO["status"];
  errorMessage?: string | undefined;
}) {
  const { t } = useTranslation();
  const tone = statusTone(status);
  const statusLabel = (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs", tone.text)}>
      <span className={cn("size-1.5 rounded-full", tone.dot)} />
      {t(`media.videoStatus.${status}`)}
    </span>
  );
  if (!errorMessage) return statusLabel;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help" tabIndex={0}>
          {statusLabel}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-80 whitespace-normal break-words text-left leading-relaxed"
      >
        {errorMessage}
      </TooltipContent>
    </Tooltip>
  );
}

export function VideoProgress({
  status,
  value,
  errorMessage,
  locale,
}: {
  status: MediaJobDTO["status"];
  value: number;
  errorMessage?: string | undefined;
  locale: string;
}) {
  const normalized = Math.max(0, Math.min(100, value));
  return (
    <div className="w-28 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <VideoStatus status={status} errorMessage={errorMessage} />
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {formatNumber(normalized, locale, 0)}%
        </span>
      </div>
      <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full", progressTone(status))}
          style={{ width: `${normalized}%` }}
        />
      </span>
    </div>
  );
}

export function VideoTimes({ job, locale }: { job: MediaJobDTO; locale: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 whitespace-nowrap text-[11px]">
      <div className="flex items-center gap-1.5">
        <span className="w-7 text-muted-foreground">{t("media.videos.createdShort")}</span>
        <span>{formatDateTime(job.createdAt, locale)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-7 text-muted-foreground">{t("media.videos.completedShort")}</span>
        <span className={job.completedAt ? undefined : "text-muted-foreground"}>
          {formatDateTime(job.completedAt, locale)}
        </span>
      </div>
    </div>
  );
}
