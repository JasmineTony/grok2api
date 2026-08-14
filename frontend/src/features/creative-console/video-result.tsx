import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { VideoStatus } from "@/features/creative-console/creative-console-api";
import {
  InlineError,
  MetaItem,
  RetryableError,
} from "@/features/creative-console/creative-console-components";
export function VideoResult({
  requestId,
  status,
  loading,
  error,
  onRetry,
}: {
  requestId: string;
  status?: VideoStatus;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const progress = status?.progress ?? 0;
  return (
    <div className="w-full space-y-4" aria-live="polite">
      <div className="grid gap-3 sm:grid-cols-2">
        <MetaItem label={t("creativeConsole.requestId")} value={requestId} mono />
        <MetaItem
          label={t("creativeConsole.status")}
          value={status ? t(`creativeConsole.videoStatus.${status.status}`) : t("common.loading")}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{t("creativeConsole.progress")}</span>
          <span className="tabular-nums">{progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      {loading && status?.status !== "done" && status?.status !== "failed" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          {t("creativeConsole.pollingVideo")}
        </div>
      ) : null}
      {error ? <RetryableError message={error} onRetry={onRetry} /> : null}
      {status?.status === "failed" ? (
        <InlineError message={status.error?.message || t("creativeConsole.errors.videoFailed")} />
      ) : null}
      {status?.status === "done" && status.video ? (
        <div className="space-y-3">
          <video
            src={status.video.url}
            controls
            preload="metadata"
            className="max-h-[60vh] w-full rounded-2xl bg-black shadow-sm"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {status.video.duration
                ? t("creativeConsole.videoDuration", { count: status.video.duration })
                : ""}
            </span>
            <Button variant="secondary" size="sm" asChild>
              <a href={status.video.url} target="_blank" rel="noreferrer">
                <ExternalLink />
                {t("creativeConsole.openVideo")}
              </a>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
