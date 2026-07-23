import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  Clock3,
  ExternalLink,
  ImagePlus,
  Images,
  ImageUpscale,
  Loader2,
  TvMinimal,
  X,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  createVideo,
  generateImage,
  getVideo,
  type ImageResult,
  type VideoStatus,
} from "@/features/creative-console/creative-console-api";
import {
  CompactModelSelect,
  CompactSelect,
  InlineError,
  LoadingResult,
  MetaItem,
  RetryableError,
  WelcomeState,
} from "@/features/creative-console/creative-console-components";
import type { CreativePanelProps } from "@/features/creative-console/creative-console-types";
import { useApiClient } from "@/shared/api/use-api-client";
import { cn } from "@/shared/lib/cn";

const mediaAspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;
const imageResolutions = ["1k", "2k"] as const;
const videoResolutions = ["480p", "720p", "1080p"] as const;
const videoDurations = ["6", "10", "15"] as const;
const composerClassName =
  "overflow-hidden rounded-2xl bg-secondary/45 ring-1 ring-transparent transition-colors focus-within:bg-secondary/60 focus-within:ring-ring";

export function ImagePanel({ apiKey, model, modelOptions, onModelChange }: CreativePanelProps) {
  const { t } = useTranslation();
  const apiClient = useApiClient();
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState("1");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [resolution, setResolution] = useState("1k");
  const [images, setImages] = useState<ImageResult[]>([]);

  const mutation = useMutation({
    mutationFn: (request: Parameters<typeof generateImage>[1]) => generateImage(apiClient, request),
    onSuccess: setImages,
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!apiKey || !model || !prompt.trim() || mutation.isPending) return;
    mutation.reset();
    mutation.mutate({
      apiKey,
      model,
      prompt: prompt.trim(),
      count: Number(count),
      aspectRatio,
      resolution,
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        <div className="flex min-h-full w-full flex-col justify-center px-3 sm:px-6">
          {images.length === 0 && !mutation.isPending ? (
            <WelcomeState title={t("creativeConsole.welcomeImage")} />
          ) : null}
          {mutation.isPending ? (
            <LoadingResult text={t("creativeConsole.generatingImage")} />
          ) : null}
          {images.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-live="polite">
              {images.map((image, index) => (
                <figure key={`${image.url}-${index}`} className="group min-w-0 overflow-hidden">
                  <img
                    src={image.url}
                    alt={t("creativeConsole.generatedImageAlt", { index: index + 1 })}
                    className="aspect-square w-full rounded-xl bg-muted object-contain"
                    loading="lazy"
                  />
                  <figcaption className="flex min-w-0 items-center justify-between gap-2 py-1.5">
                    <span className="truncate text-xs text-muted-foreground">
                      {t("creativeConsole.imageNumber", { index: index + 1 })}
                    </span>
                    <Button variant="ghost" size="icon" asChild>
                      <a
                        href={image.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={t("creativeConsole.open")}
                      >
                        <ExternalLink />
                      </a>
                    </Button>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <form className="w-full shrink-0 px-3 pb-2 sm:px-6 sm:pb-3" onSubmit={submit}>
        <div className={composerClassName}>
          <Textarea
            id="image-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t("creativeConsole.imagePlaceholder")}
            className="min-h-24 resize-none border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-0"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <CompactModelSelect value={model} models={modelOptions} onChange={onModelChange} />
              <CompactSelect
                value={count}
                options={["1", "2", "3", "4"]}
                onChange={setCount}
                ariaLabel={t("creativeConsole.count")}
                suffix="×"
                icon={<Images />}
              />
              <CompactSelect
                value={aspectRatio}
                options={mediaAspectRatios}
                onChange={setAspectRatio}
                ariaLabel={t("creativeConsole.aspectRatio")}
                icon={<TvMinimal />}
              />
              <CompactSelect
                value={resolution}
                options={imageResolutions}
                onChange={setResolution}
                ariaLabel={t("creativeConsole.resolution")}
                icon={<ImageUpscale />}
              />
            </div>
            <Button
              type="submit"
              size="icon"
              aria-label={t("creativeConsole.generateImage")}
              disabled={!apiKey || !model || !prompt.trim() || mutation.isPending}
            >
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          </div>
        </div>
        {mutation.isError ? (
          <div className="mt-1 px-2 text-[11px] text-destructive">{mutation.error.message}</div>
        ) : null}
      </form>
    </div>
  );
}

export function VideoPanel({ apiKey, model, modelOptions, onModelChange }: CreativePanelProps) {
  const { t } = useTranslation();
  const apiClient = useApiClient();
  const [prompt, setPrompt] = useState("");
  const [imageURL, setImageURL] = useState("");
  const [duration, setDuration] = useState("6");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720p");
  const [job, setJob] = useState<{ requestId: string; apiKey: string } | null>(null);

  const createMutation = useMutation({
    mutationFn: (request: Parameters<typeof createVideo>[1]) => createVideo(apiClient, request),
    onSuccess: (requestId, request) => setJob({ requestId, apiKey: request.apiKey }),
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
      !model ||
      (!prompt.trim() && !imageURL.trim()) ||
      !validDuration(duration) ||
      createMutation.isPending
    )
      return;
    setJob(null);
    createMutation.reset();
    createMutation.mutate({
      apiKey,
      model,
      prompt: prompt.trim(),
      ...(imageURL.trim() ? { imageURL: imageURL.trim() } : {}),
      duration: Number(duration),
      aspectRatio,
      resolution,
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        <div className="flex min-h-full w-full flex-col justify-center px-3 sm:px-6">
          {!job && !createMutation.isPending ? (
            <WelcomeState title={t("creativeConsole.welcomeVideo")} />
          ) : null}
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
          <Textarea
            id="video-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t("creativeConsole.videoPlaceholder")}
            className="min-h-24 resize-none border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-3 px-3 pb-3">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
              <CompactModelSelect value={model} models={modelOptions} onChange={onModelChange} />
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-8 gap-1.5 px-2 font-normal",
                      imageURL && "bg-secondary/70 text-foreground",
                    )}
                    aria-label={t("creativeConsole.referenceImage")}
                  >
                    <ImagePlus />
                    {imageURL
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
                      id="video-image"
                      type="url"
                      value={imageURL}
                      onChange={(event) => setImageURL(event.target.value)}
                      placeholder="https://..."
                      aria-label={t("creativeConsole.referenceImage")}
                    />
                    {imageURL ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        aria-label={t("creativeConsole.clearReferenceImage")}
                        onClick={() => setImageURL("")}
                      >
                        <X />
                      </Button>
                    ) : null}
                  </div>
                </PopoverContent>
              </Popover>
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
                value={resolution}
                options={videoResolutions}
                onChange={setResolution}
                ariaLabel={t("creativeConsole.resolution")}
                icon={<ImageUpscale />}
              />
            </div>
            <Button
              type="submit"
              size="icon"
              aria-label={t("creativeConsole.generateVideo")}
              disabled={
                !apiKey ||
                !model ||
                (!prompt.trim() && !imageURL.trim()) ||
                !validDuration(duration) ||
                createMutation.isPending
              }
            >
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

function VideoResult({
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

function validDuration(value: string): boolean {
  const duration = Number(value);
  return Number.isInteger(duration) && duration >= 1 && duration <= 15;
}
