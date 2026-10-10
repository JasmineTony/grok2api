import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { CreativePanelProps } from "@/features/creative-console/creative-panel-contract";
import { LoadingResult, WelcomeState } from "@/features/creative-console/creative-widgets";
import { VideoComposer } from "@/features/creative-console/video-composer";
import { VideoResult } from "@/features/creative-console/video-result";
import { useCreativeVideo } from "@/features/creative-console/use-creative-video";

export function VideoPanel({ apiKey, model, modelOptions, onModelChange }: CreativePanelProps): ReactNode {
  const { t } = useTranslation();
  const controller = useCreativeVideo({ apiKey, model, modelOptions, onModelChange });
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        <div className="flex min-h-full w-full flex-col justify-center px-3 sm:px-6">
          {!controller.job && !controller.isSubmitting ? <WelcomeState title={controller.welcome} /> : null}
          {controller.isSubmitting ? <LoadingResult text={t("creativeConsole.submittingVideo")} /> : null}
          {controller.job ? (
            <VideoResult
              requestId={controller.job.requestId}
              status={controller.status}
              loading={controller.statusLoading}
              error={controller.statusError}
              onRetry={controller.retryStatus}
            />
          ) : null}
        </div>
      </div>
      <VideoComposer controller={controller} onModelChange={onModelChange} />
    </div>
  );
}
