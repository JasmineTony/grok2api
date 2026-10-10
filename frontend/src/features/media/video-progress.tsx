import { useTranslation } from "react-i18next";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MediaJobDTO } from "@/features/media/types";
import { cn } from "@/shared/lib/cn";
import { formatDateTime, formatNumber } from "@/shared/lib/format";

/** 视频任务状态点与文案；存在错误信息时用 tooltip 展示原文。 */
export function VideoStatus({ status, errorMessage }: { status: MediaJobDTO["status"]; errorMessage?: string }) {
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
      <TooltipContent side="top" className="max-w-80 whitespace-normal break-words text-left leading-relaxed">
        {errorMessage}
      </TooltipContent>
    </Tooltip>
  );
}

/** 进度条 + 百分比，进度值被规范到 0..100。 */
export function VideoProgress({
  status,
  value,
  errorMessage,
  locale,
}: {
  status: MediaJobDTO["status"];
  value: number;
  errorMessage?: string;
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
        <span className={cn("block h-full rounded-full", progressTone(status))} style={{ width: `${normalized}%` }} />
      </span>
    </div>
  );
}

/** 创建/完成时间两行展示。 */
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

function progressTone(status: MediaJobDTO["status"]): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-red-500";
    case "in_progress":
      return "bg-sky-500";
    case "queued":
      return "bg-amber-500";
  }
}

function statusTone(status: MediaJobDTO["status"]): { dot: string; text: string } {
  switch (status) {
    case "completed":
      return { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" };
    case "failed":
      return { dot: "bg-red-500", text: "text-red-700 dark:text-red-300" };
    case "in_progress":
      return { dot: "bg-sky-500", text: "text-sky-700 dark:text-sky-300" };
    case "queued":
      return { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" };
  }
}
