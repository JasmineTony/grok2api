import { AudioLines, Loader2, Upload, Video, X } from "lucide-react";
import { useRef, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { VoiceInfo } from "@/features/creative-console/creative-console-api";
import type { CreativeVideoController, VideoAttachmentKind } from "@/features/creative-console/use-creative-video";
import { cn } from "@/shared/lib/cn";

type ImageAttachmentCopy = {
  titleKey: string;
  addedKey: string;
  shortKey: string;
  clearKey: string;
  inputId: string;
};

const firstFrameCopy: ImageAttachmentCopy = {
  titleKey: "creativeConsole.firstFrameImage",
  addedKey: "creativeConsole.firstFrameImageAdded",
  shortKey: "creativeConsole.firstFrameImageShort",
  clearKey: "creativeConsole.clearFirstFrameImage",
  inputId: "video-image",
};

const referenceImageCopy: ImageAttachmentCopy = {
  titleKey: "creativeConsole.referenceImage",
  addedKey: "creativeConsole.referenceImageAdded",
  shortKey: "creativeConsole.referenceImageShort",
  clearKey: "creativeConsole.clearReferenceImage",
  inputId: "video-reference",
};

const defaultReferenceVoices: VoiceInfo[] = [
  { voiceId: "eve", name: "Eve" },
  { voiceId: "ara", name: "Ara" },
];

type ImageAttachmentProps = {
  kind: VideoAttachmentKind;
  controller: CreativeVideoController;
  icon: ReactNode;
};

/** 首帧图与参考图互斥：弹层结构一致，仅文案、图标与占用状态不同。 */
export function VideoImageAttachment({ kind, controller, icon }: ImageAttachmentProps): ReactNode {
  const { t } = useTranslation();
  const copy = kind === "image" ? firstFrameCopy : referenceImageCopy;
  const url = kind === "image" ? controller.imageURL : controller.referenceURL;
  const fileID = kind === "image" ? controller.imageFileID : controller.referenceFileID;
  const occupied = kind === "image" ? controller.hasFirstFrame : controller.hasReferenceImage;
  const locked = kind === "image" ? controller.isReferenceMode : controller.hasFirstFrame;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-8 gap-1.5 px-2 font-normal", occupied && "bg-secondary/70 text-foreground")}
          aria-label={t(copy.titleKey)}
          disabled={locked}
        >
          {icon}
          {occupied ? t(copy.addedKey) : t(copy.shortKey)}
        </Button>
      </PopoverTrigger>
      <VideoImageAttachmentContent
        kind={kind}
        controller={controller}
        copy={copy}
        url={url}
        fileID={fileID}
        fileInputRef={fileInputRef}
      />
    </Popover>
  );
}

function VideoImageAttachmentContent({
  kind,
  controller,
  copy,
  url,
  fileID,
  fileInputRef,
}: {
  kind: VideoAttachmentKind;
  controller: CreativeVideoController;
  copy: ImageAttachmentCopy;
  url: string;
  fileID: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
}): ReactNode {
  const { t } = useTranslation();
  const occupied = kind === "image" ? controller.hasFirstFrame : controller.hasReferenceImage;
  return (
    <PopoverContent align="start" className="w-80 p-3">
      <div className="mb-2 text-xs font-medium">{t(copy.titleKey)}</div>
      <AttachmentUrlField
        kind={kind}
        controller={controller}
        copy={copy}
        url={url}
        hasFile={Boolean(fileID)}
        occupied={occupied}
      />
      <AttachmentUploadButton
        inputRef={fileInputRef}
        accept="image/png,image/jpeg,image/webp,image/gif"
        labelKey="creativeConsole.uploadImage"
        pending={controller.uploadPending}
        error={controller.uploadError}
        onPickFile={(file) => controller.pickAttachmentFile(kind, file)}
      />
    </PopoverContent>
  );
}

function AttachmentUploadButton({
  inputRef,
  accept,
  labelKey,
  pending,
  error,
  onPickFile,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  accept: string;
  labelKey: string;
  pending: boolean;
  error: string;
  onPickFile: (file: File) => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPickFile(file);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-2 w-full"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
      >
        {pending ? <Loader2 className="animate-spin" /> : <Upload />}
        {t(labelKey)}
      </Button>
      {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}
    </>
  );
}

export function VideoSourceAttachment({ controller }: { controller: CreativeVideoController }): ReactNode {
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const { t } = useTranslation();
  const hasSource = Boolean(controller.sourceVideoURL || controller.sourceVideoFileID);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-8 gap-1.5 px-2 font-normal", hasSource && "bg-secondary/70 text-foreground")}
          aria-label={t("creativeConsole.sourceVideo")}
        >
          <Video />
          {hasSource ? t("creativeConsole.sourceVideoAdded") : t("creativeConsole.sourceVideoShort")}
        </Button>
      </PopoverTrigger>
      <VideoSourceAttachmentContent
        controller={controller}
        hasSource={hasSource}
        videoFileInputRef={videoFileInputRef}
      />
    </Popover>
  );
}

export function ReferenceVoiceSelect({ controller }: { controller: CreativeVideoController }): ReactNode {
  const { t } = useTranslation();
  const options = controller.voices.length > 0 ? controller.voices : defaultReferenceVoices;
  return (
    <Select
      value={controller.referenceVoiceId || "__none__"}
      onValueChange={controller.selectReferenceVoice}
      disabled={controller.hasFirstFrame}
    >
      <SelectTrigger
        className={cn(
          "h-8 w-auto gap-1.5 border-0 bg-transparent px-2 shadow-none",
          controller.hasReferenceAudio && "bg-secondary/70",
        )}
        aria-label={t("creativeConsole.referenceVoice")}
      >
        <AudioLines className="size-3.5" />
        <SelectValue placeholder={t("creativeConsole.referenceVoiceShort")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">{t("creativeConsole.referenceVoiceNone")}</SelectItem>
        {options.map((voice) => (
          <SelectItem key={voice.voiceId} value={voice.voiceId}>
            {voice.name || voice.voiceId}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AttachmentUrlField({
  kind,
  controller,
  copy,
  url,
  hasFile,
  occupied,
}: {
  kind: VideoAttachmentKind;
  controller: CreativeVideoController;
  copy: ImageAttachmentCopy;
  url: string;
  hasFile: boolean;
  occupied: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <Input
        id={copy.inputId}
        type="url"
        value={url}
        onChange={(event) => controller.setAttachmentURL(kind, event.target.value)}
        placeholder={hasFile ? t(copy.addedKey) : "https://..."}
        aria-label={t(copy.titleKey)}
      />
      {occupied ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label={t(copy.clearKey)}
          onClick={() => controller.clearAttachment(kind)}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}

function VideoSourceAttachmentContent({
  controller,
  hasSource,
  videoFileInputRef,
}: {
  controller: CreativeVideoController;
  hasSource: boolean;
  videoFileInputRef: RefObject<HTMLInputElement | null>;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <PopoverContent align="start" className="w-80 p-3">
      <div className="mb-2 text-xs font-medium">{t("creativeConsole.sourceVideo")}</div>
      <div className="flex items-center gap-2">
        <Input
          id="video-source"
          type="url"
          value={controller.sourceVideoURL}
          onChange={(event) => controller.setSourceVideoURL(event.target.value)}
          placeholder={controller.sourceVideoFileID ? t("creativeConsole.sourceVideoAdded") : "https://..."}
          aria-label={t("creativeConsole.sourceVideo")}
        />
        {hasSource ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={t("creativeConsole.clearSourceVideo")}
            onClick={controller.clearSourceVideo}
          >
            <X />
          </Button>
        ) : null}
      </div>
      <AttachmentUploadButton
        inputRef={videoFileInputRef}
        accept="video/mp4,video/webm,video/quicktime"
        labelKey="creativeConsole.uploadVideo"
        pending={controller.videoUploadPending}
        error={controller.videoUploadError}
        onPickFile={controller.pickSourceVideo}
      />
    </PopoverContent>
  );
}
