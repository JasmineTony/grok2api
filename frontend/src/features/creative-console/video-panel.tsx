import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  AudioLines,
  Clock3,
  ImagePlus,
  Images,
  ImageUpscale,
  Loader2,
  TvMinimal,
  Upload,
  Video,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createVideo,
  editVideo,
  extendVideo,
  getVideo,
  listVoices,
  type VoiceInfo,
} from "@/features/creative-console/creative-console-api";
import {
  CompactModelSelect,
  CompactSelect,
  LoadingResult,
  WelcomeState,
} from "@/features/creative-console/creative-console-components";
import type { CreativePanelProps } from "@/features/creative-console/creative-console-types";
import { VideoResult } from "@/features/creative-console/video-result";
import { importMediaInputFromURL, uploadMediaInput } from "@/shared/api/media-input";
import { useApiClient } from "@/shared/api/use-api-client";
import { cn } from "@/shared/lib/cn";

const mediaAspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;
const videoResolutions = ["480p", "720p", "1080p"] as const;
const videoDurations = ["6", "10", "15"] as const;
const videoExtendDurations = ["2", "4", "6", "8", "10"] as const;
type VideoAction = "generate" | "edit" | "extend";
const composerClassName =
  "overflow-hidden rounded-2xl bg-secondary/45 ring-1 ring-transparent transition-colors focus-within:bg-secondary/60 focus-within:ring-ring";
export function VideoPanel({ apiKey, model, modelOptions, onModelChange }: CreativePanelProps) {
  const { t } = useTranslation();
  const apiClient = useApiClient();
  const [action, setAction] = useState<VideoAction>("generate");
  const [prompt, setPrompt] = useState("");
  const [imageURL, setImageURL] = useState("");
  const [imageFileID, setImageFileID] = useState("");
  const [referenceURL, setReferenceURL] = useState("");
  const [referenceFileID, setReferenceFileID] = useState("");
  const [referenceVoiceId, setReferenceVoiceId] = useState("");
  const [sourceVideoURL, setSourceVideoURL] = useState("");
  const [sourceVideoFileID, setSourceVideoFileID] = useState("");
  const [duration, setDuration] = useState("6");
  const [extendDuration, setExtendDuration] = useState("6");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720p");
  const [job, setJob] = useState<{ requestId: string; apiKey: string } | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const referenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageSelectionVersionRef = useRef(0);
  const referenceSelectionVersionRef = useRef(0);
  const videoSelectionVersionRef = useRef(0);

  const generateModels = useMemo(() => {
    const seen = new Set<string>();
    return modelOptions.filter((item) => {
      if (item.capability !== "video" || seen.has(item.publicId)) return false;
      seen.add(item.publicId);
      return true;
    });
  }, [modelOptions]);
  const editModels = useMemo(() => {
    const eligiblePublicIDs = new Set(
      modelOptions
        .filter(
          (item) =>
            item.capability === "video" &&
            item.provider === "grok_console" &&
            item.upstreamModel === "grok-imagine-video",
        )
        .map((item) => item.publicId),
    );
    return generateModels.filter((item) => eligiblePublicIDs.has(item.publicId));
  }, [generateModels, modelOptions]);
  const activeModels = action === "generate" ? generateModels : editModels;
  const activeModel = activeModels.some((item) => item.publicId === model)
    ? model
    : (activeModels[0]?.publicId ?? "");

  useEffect(() => {
    if (activeModel && activeModel !== model) onModelChange(activeModel);
  }, [activeModel, model, onModelChange]);

  const voicesQuery = useQuery({
    queryKey: ["creative-console", "video-voices", apiKey],
    queryFn: ({ signal }) => listVoices(apiClient, { apiKey, model: "grok-voice-latest", signal }),
    enabled: Boolean(apiKey && action === "generate"),
    staleTime: 60_000,
  });
  const voices = useMemo(() => voicesQuery.data ?? [], [voicesQuery.data]);
  const voiceOptions: VoiceInfo[] =
    voices.length > 0
      ? voices
      : [
          { voiceId: "eve", name: "Eve" },
          { voiceId: "ara", name: "Ara" },
        ];
  const hasFirstFrame = Boolean(imageURL.trim() || imageFileID);
  const hasReferenceImage = Boolean(referenceURL.trim() || referenceFileID);
  const hasReferenceAudio = Boolean(referenceVoiceId.trim());
  const isReferenceMode = hasReferenceImage || hasReferenceAudio;
  const hasSourceVideo = Boolean(sourceVideoURL.trim() || sourceVideoFileID);
  const generateResolutions = isReferenceMode
    ? videoResolutions.filter((item) => item !== "1080p")
    : videoResolutions;
  const selectedVideoResolution = isReferenceMode && resolution === "1080p" ? "720p" : resolution;

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!apiKey || !activeModel) throw new Error(t("creativeConsole.errors.noModels"));
      if (action === "generate") {
        let nextImageURL = imageURL.trim() || undefined;
        let nextImageFileID = imageFileID || undefined;
        let nextReferenceURL = referenceURL.trim() || undefined;
        let nextReferenceFileID = referenceFileID || undefined;
        let nextReferenceVoice = referenceVoiceId.trim() || undefined;
        if (nextImageFileID || nextImageURL) {
          nextReferenceURL = undefined;
          nextReferenceFileID = undefined;
          nextReferenceVoice = undefined;
        }
        if (!nextImageFileID && nextImageURL && /^https?:\/\//i.test(nextImageURL)) {
          const staged = await importMediaInputFromURL(apiClient, nextImageURL);
          if (staged.kind !== "image") throw new Error(t("creativeConsole.errors.invalidImage"));
          nextImageURL = undefined;
          nextImageFileID = staged.fileId;
        }
        if (!nextReferenceFileID && nextReferenceURL && /^https?:\/\//i.test(nextReferenceURL)) {
          const staged = await importMediaInputFromURL(apiClient, nextReferenceURL);
          if (staged.kind !== "image") throw new Error(t("creativeConsole.errors.invalidImage"));
          nextReferenceURL = undefined;
          nextReferenceFileID = staged.fileId;
        }
        return createVideo(apiClient, {
          apiKey,
          model: activeModel,
          prompt: prompt.trim(),
          ...(nextImageURL ? { imageURL: nextImageURL } : {}),
          ...(nextImageFileID ? { imageFileID: nextImageFileID } : {}),
          ...(nextReferenceFileID
            ? { referenceImages: [{ fileId: nextReferenceFileID }] }
            : nextReferenceURL
              ? { referenceImages: [{ url: nextReferenceURL }] }
              : {}),
          ...(nextReferenceVoice ? { referenceVoiceIds: [nextReferenceVoice] } : {}),
          duration: Number(duration),
          aspectRatio,
          resolution: selectedVideoResolution,
        });
      }
      const videoURL = sourceVideoURL.trim() || undefined;
      const videoFileID = sourceVideoFileID || undefined;
      if (!videoURL && !videoFileID) throw new Error(t("creativeConsole.errors.noSourceVideo"));
      if (action === "edit") {
        return editVideo(apiClient, {
          apiKey,
          model: activeModel,
          prompt: prompt.trim(),
          ...(videoURL ? { videoURL } : {}),
          ...(videoFileID ? { videoFileID } : {}),
        });
      }
      return extendVideo(apiClient, {
        apiKey,
        model: activeModel,
        prompt: prompt.trim(),
        ...(videoURL ? { videoURL } : {}),
        ...(videoFileID ? { videoFileID } : {}),
        duration: Number(extendDuration),
      });
    },
    onSuccess: (requestId) => setJob({ requestId, apiKey }),
  });

  const uploadMutation = useMutation({
    mutationFn: async ({
      file,
      target,
      selectionVersion,
    }: {
      file: File;
      target: "first" | "reference";
      selectionVersion: number;
    }) => {
      if (file.type && !file.type.startsWith("image/")) {
        throw new Error(t("creativeConsole.errors.invalidImage"));
      }
      const input = await uploadMediaInput(apiClient, file);
      if (input.kind !== "image") throw new Error(t("creativeConsole.errors.invalidImage"));
      return { ...input, target, selectionVersion };
    },
    onSuccess: (input) => {
      if (input.target === "first") {
        if (input.selectionVersion !== imageSelectionVersionRef.current) return;
        setImageFileID(input.fileId);
        setImageURL("");
        setReferenceURL("");
        setReferenceFileID("");
        setReferenceVoiceId("");
        return;
      }
      if (input.selectionVersion !== referenceSelectionVersionRef.current) return;
      setReferenceFileID(input.fileId);
      setReferenceURL("");
      setImageURL("");
      setImageFileID("");
    },
  });

  const videoUploadMutation = useMutation({
    mutationFn: async ({ file }: { file: File; selectionVersion: number }) => {
      if (file.type && !file.type.startsWith("video/")) {
        throw new Error(t("creativeConsole.errors.invalidVideo"));
      }
      const input = await uploadMediaInput(apiClient, file);
      if (input.kind !== "video") throw new Error(t("creativeConsole.errors.invalidVideo"));
      return input;
    },
    onSuccess: (input, request) => {
      if (request.selectionVersion !== videoSelectionVersionRef.current) return;
      setSourceVideoFileID(input.fileId);
      setSourceVideoURL("");
    },
  });

  const statusQuery = useQuery({
    queryKey: ["creative-console", "video", job?.requestId],
    queryFn: ({ signal }) =>
      getVideo(apiClient, { apiKey: job!.apiKey, requestId: job!.requestId, signal }),
    enabled: Boolean(job),
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 3_000 : false),
    retry: 2,
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (
      !apiKey ||
      !activeModel ||
      createMutation.isPending ||
      uploadMutation.isPending ||
      videoUploadMutation.isPending
    )
      return;
    if (action === "generate") {
      if ((!prompt.trim() && !hasFirstFrame && !isReferenceMode) || !validDuration(duration))
        return;
      if (isReferenceMode && !prompt.trim()) return;
    } else {
      if (!prompt.trim() || !hasSourceVideo) return;
      if (action === "extend" && !validExtendDuration(extendDuration)) return;
    }
    setJob(null);
    createMutation.reset();
    createMutation.mutate();
  }

  const placeholder =
    action === "generate"
      ? t("creativeConsole.videoPlaceholder")
      : action === "edit"
        ? t("creativeConsole.videoEditPlaceholder")
        : t("creativeConsole.videoExtendPlaceholder");
  const welcome =
    action === "generate"
      ? t("creativeConsole.welcomeVideo")
      : action === "edit"
        ? t("creativeConsole.welcomeVideoEdit")
        : t("creativeConsole.welcomeVideoExtend");
  const submitLabel =
    action === "generate"
      ? t("creativeConsole.generateVideo")
      : action === "edit"
        ? t("creativeConsole.editVideo")
        : t("creativeConsole.extendVideo");
  const canSubmit = Boolean(
    apiKey &&
    activeModel &&
    !createMutation.isPending &&
    !uploadMutation.isPending &&
    !videoUploadMutation.isPending &&
    (action === "generate"
      ? (prompt.trim() || hasFirstFrame || isReferenceMode) &&
        (!isReferenceMode || prompt.trim()) &&
        validDuration(duration) &&
        !(hasFirstFrame && isReferenceMode)
      : prompt.trim() &&
        hasSourceVideo &&
        (action !== "extend" || validExtendDuration(extendDuration))),
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        <div className="flex min-h-full w-full flex-col justify-center px-3 sm:px-6">
          {!job && !createMutation.isPending ? <WelcomeState title={welcome} /> : null}
          {createMutation.isPending ? (
            <LoadingResult text={t("creativeConsole.submittingVideo")} />
          ) : null}
          {job ? (
            <VideoResult
              requestId={job.requestId}
              {...(statusQuery.data === undefined ? {} : { status: statusQuery.data })}
              loading={statusQuery.isPending || statusQuery.isFetching}
              error={statusQuery.isError ? statusQuery.error.message : ""}
              onRetry={() => void statusQuery.refetch()}
            />
          ) : null}
        </div>
      </div>

      <form className="w-full shrink-0 px-3 pb-2 sm:px-6 sm:pb-3" onSubmit={submit}>
        <div className={composerClassName}>
          <div className="flex flex-wrap items-center gap-1 px-3 pt-3">
            {(
              [
                ["generate", t("creativeConsole.videoActions.generate")],
                ["edit", t("creativeConsole.videoActions.edit")],
                ["extend", t("creativeConsole.videoActions.extend")],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 rounded-full px-3 text-xs font-normal",
                  action === value && "bg-secondary/70 text-foreground",
                )}
                onClick={() => {
                  setAction(value);
                  setJob(null);
                  createMutation.reset();
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <Textarea
            id="video-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={placeholder}
            className="min-h-24 resize-none border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-3 px-3 pb-3">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
              <CompactModelSelect
                value={activeModel}
                models={activeModels}
                onChange={onModelChange}
              />
              {action === "generate" ? (
                <>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-8 gap-1.5 px-2 font-normal",
                          hasFirstFrame && "bg-secondary/70 text-foreground",
                        )}
                        aria-label={t("creativeConsole.firstFrameImage")}
                        disabled={isReferenceMode}
                      >
                        <ImagePlus />
                        {hasFirstFrame
                          ? t("creativeConsole.firstFrameImageAdded")
                          : t("creativeConsole.firstFrameImageShort")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-80 p-3">
                      <div className="mb-2 text-xs font-medium">
                        {t("creativeConsole.firstFrameImage")}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          id="video-image"
                          type="url"
                          value={imageURL}
                          onChange={(event) => {
                            imageSelectionVersionRef.current += 1;
                            referenceSelectionVersionRef.current += 1;
                            setImageURL(event.target.value);
                            setImageFileID("");
                            setReferenceURL("");
                            setReferenceFileID("");
                            setReferenceVoiceId("");
                          }}
                          placeholder={
                            imageFileID ? t("creativeConsole.firstFrameImageAdded") : "https://..."
                          }
                          aria-label={t("creativeConsole.firstFrameImage")}
                        />
                        {hasFirstFrame ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            aria-label={t("creativeConsole.clearFirstFrameImage")}
                            onClick={() => {
                              imageSelectionVersionRef.current += 1;
                              setImageURL("");
                              setImageFileID("");
                            }}
                          >
                            <X />
                          </Button>
                        ) : null}
                      </div>
                      <input
                        ref={imageFileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            const selectionVersion = imageSelectionVersionRef.current + 1;
                            imageSelectionVersionRef.current = selectionVersion;
                            referenceSelectionVersionRef.current += 1;
                            setImageURL("");
                            setImageFileID("");
                            setReferenceURL("");
                            setReferenceFileID("");
                            setReferenceVoiceId("");
                            uploadMutation.reset();
                            uploadMutation.mutate({ file, target: "first", selectionVersion });
                          }
                          event.target.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="mt-2 w-full"
                        disabled={uploadMutation.isPending}
                        onClick={() => imageFileInputRef.current?.click()}
                      >
                        {uploadMutation.isPending ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Upload />
                        )}
                        {t("creativeConsole.uploadImage")}
                      </Button>
                      {uploadMutation.isError ? (
                        <p className="mt-1 text-[11px] text-destructive">
                          {uploadMutation.error.message}
                        </p>
                      ) : null}
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-8 gap-1.5 px-2 font-normal",
                          hasReferenceImage && "bg-secondary/70 text-foreground",
                        )}
                        aria-label={t("creativeConsole.referenceImage")}
                        disabled={hasFirstFrame}
                      >
                        <Images />
                        {hasReferenceImage
                          ? t("creativeConsole.referenceImageAdded")
                          : t("creativeConsole.referenceImageShort")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-80 p-3">
                      <div className="mb-2 text-xs font-medium">
                        {t("creativeConsole.referenceImage")}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          id="video-reference"
                          type="url"
                          value={referenceURL}
                          onChange={(event) => {
                            referenceSelectionVersionRef.current += 1;
                            imageSelectionVersionRef.current += 1;
                            setReferenceURL(event.target.value);
                            setReferenceFileID("");
                            setImageURL("");
                            setImageFileID("");
                          }}
                          placeholder={
                            referenceFileID
                              ? t("creativeConsole.referenceImageAdded")
                              : "https://..."
                          }
                          aria-label={t("creativeConsole.referenceImage")}
                        />
                        {hasReferenceImage ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            aria-label={t("creativeConsole.clearReferenceImage")}
                            onClick={() => {
                              referenceSelectionVersionRef.current += 1;
                              setReferenceURL("");
                              setReferenceFileID("");
                            }}
                          >
                            <X />
                          </Button>
                        ) : null}
                      </div>
                      <input
                        ref={referenceFileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            const selectionVersion = referenceSelectionVersionRef.current + 1;
                            referenceSelectionVersionRef.current = selectionVersion;
                            imageSelectionVersionRef.current += 1;
                            setReferenceURL("");
                            setReferenceFileID("");
                            setImageURL("");
                            setImageFileID("");
                            uploadMutation.reset();
                            uploadMutation.mutate({ file, target: "reference", selectionVersion });
                          }
                          event.target.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="mt-2 w-full"
                        disabled={uploadMutation.isPending}
                        onClick={() => referenceFileInputRef.current?.click()}
                      >
                        {uploadMutation.isPending ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Upload />
                        )}
                        {t("creativeConsole.uploadImage")}
                      </Button>
                      {uploadMutation.isError ? (
                        <p className="mt-1 text-[11px] text-destructive">
                          {uploadMutation.error.message}
                        </p>
                      ) : null}
                    </PopoverContent>
                  </Popover>
                  <Select
                    value={referenceVoiceId || "__none__"}
                    onValueChange={(value) => {
                      setReferenceVoiceId(value === "__none__" ? "" : value);
                      if (value !== "__none__") {
                        imageSelectionVersionRef.current += 1;
                        setImageURL("");
                        setImageFileID("");
                      }
                    }}
                    disabled={hasFirstFrame}
                  >
                    <SelectTrigger
                      className={cn(
                        "h-8 w-auto gap-1.5 border-0 bg-transparent px-2 shadow-none",
                        hasReferenceAudio && "bg-secondary/70",
                      )}
                      aria-label={t("creativeConsole.referenceVoice")}
                    >
                      <AudioLines className="size-3.5" />
                      <SelectValue placeholder={t("creativeConsole.referenceVoiceShort")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        {t("creativeConsole.referenceVoiceNone")}
                      </SelectItem>
                      {voiceOptions.map((voice) => (
                        <SelectItem key={voice.voiceId} value={voice.voiceId}>
                          {voice.name || voice.voiceId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 gap-1.5 px-2 font-normal",
                        hasSourceVideo && "bg-secondary/70 text-foreground",
                      )}
                      aria-label={t("creativeConsole.sourceVideo")}
                    >
                      <Video />
                      {hasSourceVideo
                        ? t("creativeConsole.sourceVideoAdded")
                        : t("creativeConsole.sourceVideoShort")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-3">
                    <div className="mb-2 text-xs font-medium">
                      {t("creativeConsole.sourceVideo")}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        id="video-source"
                        type="url"
                        value={sourceVideoURL}
                        onChange={(event) => {
                          videoSelectionVersionRef.current += 1;
                          setSourceVideoURL(event.target.value);
                          setSourceVideoFileID("");
                        }}
                        placeholder={
                          sourceVideoFileID ? t("creativeConsole.sourceVideoAdded") : "https://..."
                        }
                        aria-label={t("creativeConsole.sourceVideo")}
                      />
                      {hasSourceVideo ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          aria-label={t("creativeConsole.clearSourceVideo")}
                          onClick={() => {
                            videoSelectionVersionRef.current += 1;
                            setSourceVideoURL("");
                            setSourceVideoFileID("");
                          }}
                        >
                          <X />
                        </Button>
                      ) : null}
                    </div>
                    <input
                      ref={videoFileInputRef}
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          const selectionVersion = videoSelectionVersionRef.current + 1;
                          videoSelectionVersionRef.current = selectionVersion;
                          setSourceVideoURL("");
                          setSourceVideoFileID("");
                          videoUploadMutation.reset();
                          videoUploadMutation.mutate({ file, selectionVersion });
                        }
                        event.target.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-2 w-full"
                      disabled={videoUploadMutation.isPending}
                      onClick={() => videoFileInputRef.current?.click()}
                    >
                      {videoUploadMutation.isPending ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Upload />
                      )}
                      {t("creativeConsole.uploadVideo")}
                    </Button>
                    {videoUploadMutation.isError ? (
                      <p className="mt-1 text-[11px] text-destructive">
                        {videoUploadMutation.error.message}
                      </p>
                    ) : null}
                  </PopoverContent>
                </Popover>
              )}
              {action === "generate" ? (
                <>
                  <CompactSelect
                    value={duration}
                    options={videoDurations}
                    onChange={setDuration}
                    ariaLabel={t("creativeConsole.duration")}
                    suffix="s"
                    icon={<Clock3 />}
                  />
                  <CompactSelect
                    value={aspectRatio}
                    options={mediaAspectRatios}
                    onChange={setAspectRatio}
                    ariaLabel={t("creativeConsole.aspectRatio")}
                    icon={<TvMinimal />}
                  />
                  <CompactSelect
                    value={selectedVideoResolution}
                    options={generateResolutions}
                    onChange={setResolution}
                    ariaLabel={t("creativeConsole.resolution")}
                    icon={<ImageUpscale />}
                  />
                </>
              ) : null}
              {action === "extend" ? (
                <CompactSelect
                  value={extendDuration}
                  options={videoExtendDurations}
                  onChange={setExtendDuration}
                  ariaLabel={t("creativeConsole.extendDuration")}
                  suffix="s"
                  icon={<Clock3 />}
                />
              ) : null}
            </div>
            <Button type="submit" size="icon" aria-label={submitLabel} disabled={!canSubmit}>
              {createMutation.isPending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          </div>
        </div>
        {createMutation.isError ? (
          <div className="mt-1 px-2 text-[11px] text-destructive">
            {createMutation.error.message}
          </div>
        ) : null}
      </form>
    </div>
  );
}

function validDuration(value: string): boolean {
  const duration = Number(value);
  return Number.isInteger(duration) && duration >= 1 && duration <= 15;
}

function validExtendDuration(value: string): boolean {
  const duration = Number(value);
  return Number.isInteger(duration) && duration >= 2 && duration <= 10;
}
