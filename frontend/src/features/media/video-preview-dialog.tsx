import { AlertCircle, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { videoAssetURL } from "@/features/media/media-format";
import type { MediaJobDTO } from "@/features/media/types";
import { cn } from "@/shared/lib/cn";

/** 视频预览弹窗；关闭时内容卸载，视频元素随之销毁（无对象 URL 泄漏）。 */
export function VideoPreviewDialog({ job, onClose }: { job: MediaJobDTO | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={Boolean(job)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-4xl overflow-hidden" data-testid="video-preview-dialog">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle className="line-clamp-2 min-w-0 break-words leading-6" title={job?.prompt || undefined}>
            {job?.prompt || t("media.videos.previewTitle")}
          </DialogTitle>
          <DialogDescription className="min-w-0 truncate font-mono" title={job?.id}>
            {job?.id}
          </DialogDescription>
        </DialogHeader>
        {job?.assetId ? <VideoPreview key={job.assetId} assetId={job.assetId} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function VideoPreview({ assetId }: { assetId: string }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  function retry(): void {
    setState("loading");
    videoRef.current?.load();
  }

  return (
    <div className="relative flex min-h-56 w-full items-center justify-center overflow-hidden rounded-lg bg-black sm:min-h-80">
      <video
        ref={videoRef}
        className={cn("h-auto max-h-[70vh] w-auto max-w-full object-contain", state === "error" && "invisible")}
        src={videoAssetURL(assetId)}
        controls
        playsInline
        preload="auto"
        data-testid="video-preview-player"
        onLoadStart={() => setState("loading")}
        onLoadedMetadata={(event) => showFirstVideoFrame(event.currentTarget)}
        onLoadedData={() => setState("ready")}
        onCanPlay={() => setState("ready")}
        onEnded={(event) => showFirstVideoFrame(event.currentTarget)}
        onError={() => setState("error")}
      />
      {state === "loading" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black">
          <Spinner className="size-5 text-white" />
          <span className="sr-only">{t("common.loading")}</span>
        </div>
      ) : null}
      {state === "error" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center text-white">
          <AlertCircle className="size-6 text-red-400" />
          <p className="text-sm">{t("media.videos.previewUnavailable")}</p>
          <Button type="button" variant="secondary" size="sm" onClick={retry} data-testid="video-preview-retry">
            <RefreshCw />
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** 部分浏览器只显示海报帧，这里在元数据或播放结束时跳到极短时间点以渲染首帧。 */
function showFirstVideoFrame(video: HTMLVideoElement): void {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  video.currentTime = Math.min(0.01, video.duration / 2);
}
