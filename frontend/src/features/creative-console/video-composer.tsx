import { ArrowUp, Clock3, Images, ImagePlus, ImageUpscale, Loader2, TvMinimal } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  composerClassName,
  videoAspectRatios,
  videoDurations,
  videoExtendDurations,
  type VideoAction,
} from "@/features/creative-console/creative-panel-contract";
import { CompactModelSelect, CompactSelect } from "@/features/creative-console/creative-widgets";
import {
  ReferenceVoiceSelect,
  VideoImageAttachment,
  VideoSourceAttachment,
} from "@/features/creative-console/video-attachment";
import type { CreativeVideoController } from "@/features/creative-console/use-creative-video";
import { cn } from "@/shared/lib/cn";

const videoActionKeys: Array<{ value: VideoAction; labelKey: string }> = [
  { value: "generate", labelKey: "creativeConsole.videoActions.generate" },
  { value: "edit", labelKey: "creativeConsole.videoActions.edit" },
  { value: "extend", labelKey: "creativeConsole.videoActions.extend" },
];

export function VideoComposer({
  controller,
  onModelChange,
}: {
  controller: CreativeVideoController;
  onModelChange: (model: string) => void;
}): ReactNode {
  return (
    <form className="w-full shrink-0 px-3 pb-2 sm:px-6 sm:pb-3" onSubmit={controller.submit}>
      <div className={composerClassName}>
        <VideoActionSwitch controller={controller} />
        <Textarea
          id="video-prompt"
          value={controller.prompt}
          onChange={(event) => controller.setPrompt(event.target.value)}
          placeholder={controller.placeholder}
          className="min-h-24 resize-none border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-0"
        />
        <div className="flex items-center justify-between gap-3 px-3 pb-3">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            <CompactModelSelect
              value={controller.activeModel}
              models={controller.activeModels}
              onChange={onModelChange}
            />
            {controller.action === "generate" ? (
              <>
                <VideoImageAttachment kind="image" controller={controller} icon={<ImagePlus />} />
                <VideoImageAttachment kind="reference" controller={controller} icon={<Images />} />
                <ReferenceVoiceSelect controller={controller} />
              </>
            ) : (
              <VideoSourceAttachment controller={controller} />
            )}
            <VideoShapeControls controller={controller} />
          </div>
          <Button type="submit" size="icon" aria-label={controller.submitLabel} disabled={!controller.canSubmit}>
            {controller.isSubmitting ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </div>
      {controller.createError ? (
        <div className="mt-1 px-2 text-[11px] text-destructive">{controller.createError}</div>
      ) : null}
    </form>
  );
}

function VideoActionSwitch({ controller }: { controller: CreativeVideoController }): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 pt-3">
      {videoActionKeys.map((item) => (
        <Button
          key={item.value}
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 rounded-full px-3 text-xs font-normal",
            controller.action === item.value && "bg-secondary/70 text-foreground",
          )}
          onClick={() => controller.changeAction(item.value)}
        >
          {t(item.labelKey)}
        </Button>
      ))}
    </div>
  );
}

function VideoShapeControls({ controller }: { controller: CreativeVideoController }): ReactNode {
  const { t } = useTranslation();
  if (controller.action === "edit") return null;
  if (controller.action === "extend") {
    return (
      <CompactSelect
        value={controller.extendDuration}
        options={videoExtendDurations}
        onChange={controller.setExtendDuration}
        ariaLabel={t("creativeConsole.extendDuration")}
        suffix="s"
        icon={<Clock3 />}
      />
    );
  }
  return (
    <>
      <CompactSelect
        value={controller.duration}
        options={videoDurations}
        onChange={controller.setDuration}
        ariaLabel={t("creativeConsole.duration")}
        suffix="s"
        icon={<Clock3 />}
      />
      <CompactSelect
        value={controller.aspectRatio}
        options={videoAspectRatios}
        onChange={controller.setAspectRatio}
        ariaLabel={t("creativeConsole.aspectRatio")}
        icon={<TvMinimal />}
      />
      <CompactSelect
        value={controller.selectedResolution}
        options={controller.generateResolutions}
        onChange={controller.setResolution}
        ariaLabel={t("creativeConsole.resolution")}
        icon={<ImageUpscale />}
      />
    </>
  );
}
