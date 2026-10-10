import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { VideoStatus } from "@/features/creative-console/creative-console-api";
import { InlineError, MetaItem, RetryableError } from "@/features/creative-console/creative-widgets";

type VideoResultProps = {
  requestId: string;
  status?: VideoStatus;
  loading: boolean;
  error: string;
  onRetry: () => void;
};

export function VideoResult({ requestId, status, loading, error, onRetry }: VideoResultProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="w-full space-y-4" aria-live="polite" data-testid="video-result">
      <div className="grid gap-3 sm:grid-cols-2">
        <MetaItem label={t("creativeConsole.requestId")} value={requestId} mono testId="video-result-request-id" />
        <MetaItem
          label={t("creativeConsole.status")}
          value={status ? t(`creativeConsole.videoStatus.${status.status}`) : t("common.loading")}
          testId="video-result-status"
        />
      </div>
      <VideoProgressBar progress={status?.progress ?? 0} />
      {loading && status?.status !== "done" && status?.status !== "failed" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="video-result-polling">
          <Spinner />
          {t("creativeConsole.pollingVideo")}
        </div>
      ) : null}
      {error ? (
        <RetryableError
          message={error}
          onRetry={onRetry}
          testId="video-result-error"
          retryTestId="video-result-retry"
        />
      ) : null}
      {status?.status === "failed" ? (
        <InlineError
          message={status.error?.message || t("creativeConsole.errors.videoFailed")}
          testId="video-result-failed"
        />
      ) : null}
      {status?.status === "done" && status.video ? <VideoPreview video={status.video} /> : null}
    </div>
  );
}

function VideoProgressBar({ progress }: { progress: number }): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="space-y-2" data-testid="video-result-progress">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{t("creativeConsole.progress")}</span>
        <span className="tabular-nums">{progress}%</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function VideoPreview({ video }: { video: { url: string; duration?: number } }): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" data-testid="video-result-preview">
      <video
        src={video.url}
        controls
        preload="metadata"
        className="max-h-[60vh] w-full rounded-2xl bg-black shadow-sm"
        data-testid="video-result-player"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {video.duration ? t("creativeConsole.videoDuration", { count: video.duration }) : ""}
        </span>
        <Button variant="secondary" size="sm" asChild>
          <a href={video.url} target="_blank" rel="noreferrer" data-testid="video-result-open">
            <ExternalLink />
            {t("creativeConsole.openVideo")}
          </a>
        </Button>
      </div>
    </div>
  );
}
