import { ArrowUp, ExternalLink, Images, ImageUpscale, Loader2, TvMinimal } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ModelRouteDTO } from "@/entities/model/types";
import type { ImageResult } from "@/features/creative-console/creative-console-api";
import {
  composerClassName,
  imageAspectRatios,
  imageCounts,
  imageQualities,
  imageResolutions,
  type CreativePanelProps,
  type ImageQuality,
} from "@/features/creative-console/creative-panel-contract";
import {
  CompactModelSelect,
  CompactSelect,
  LoadingResult,
  WelcomeState,
} from "@/features/creative-console/creative-widgets";
import type { CreativeImageController } from "@/features/creative-console/use-creative-image";
import { useCreativeImage } from "@/features/creative-console/use-creative-image";

export function ImagePanel({ apiKey, model, modelOptions, onModelChange }: CreativePanelProps): ReactNode {
  const { t } = useTranslation();
  const controller = useCreativeImage({ apiKey, model });
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        <div className="flex min-h-full w-full flex-col justify-center px-3 sm:px-6">
          {controller.images.length === 0 && !controller.isPending ? (
            <WelcomeState title={t("creativeConsole.welcomeImage")} />
          ) : null}
          {controller.isPending ? <LoadingResult text={t("creativeConsole.generatingImage")} /> : null}
          {controller.images.length > 0 ? <ImageResults images={controller.images} /> : null}
        </div>
      </div>
      <ImageComposer
        controller={controller}
        apiKey={apiKey}
        model={model}
        models={modelOptions}
        onModelChange={onModelChange}
      />
    </div>
  );
}

function ImageResults({ images }: { images: ImageResult[] }): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-live="polite">
      {images.map((image, index) => (
        <ImageResultItem key={`${image.url}-${index}`} image={image} index={index} />
      ))}
    </div>
  );
}

function ImageResultItem({ image, index }: { image: ImageResult; index: number }): ReactNode {
  const { t } = useTranslation();
  return (
    <figure className="group min-w-0 overflow-hidden">
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
          <a href={image.url} target="_blank" rel="noreferrer" aria-label={t("creativeConsole.open")}>
            <ExternalLink />
          </a>
        </Button>
      </figcaption>
    </figure>
  );
}

function ImageComposer({
  controller,
  apiKey,
  model,
  models,
  onModelChange,
}: {
  controller: CreativeImageController;
  apiKey: string;
  model: string;
  models: ModelRouteDTO[];
  onModelChange: (model: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <form className="w-full shrink-0 px-3 pb-2 sm:px-6 sm:pb-3" onSubmit={controller.submit}>
      <div className={composerClassName}>
        <Textarea
          id="image-prompt"
          value={controller.prompt}
          onChange={(event) => controller.setPrompt(event.target.value)}
          placeholder={t("creativeConsole.imagePlaceholder")}
          className="min-h-24 resize-none border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-0"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3">
          <ImageShapeSelects controller={controller} model={model} models={models} onModelChange={onModelChange} />
          <ImageSubmitButton controller={controller} apiKey={apiKey} model={model} />
        </div>
      </div>
      {controller.errorMessage ? (
        <div className="mt-1 px-2 text-[11px] text-destructive">{controller.errorMessage}</div>
      ) : null}
    </form>
  );
}

function ImageSubmitButton({
  controller,
  apiKey,
  model,
}: {
  controller: CreativeImageController;
  apiKey: string;
  model: string;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <Button
      type="submit"
      size="icon"
      aria-label={t("creativeConsole.generateImage")}
      disabled={!apiKey || !model || !controller.prompt.trim() || controller.isPending}
    >
      {controller.isPending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
    </Button>
  );
}

function ImageShapeSelects({
  controller,
  model,
  models,
  onModelChange,
}: {
  controller: CreativeImageController;
  model: string;
  models: ModelRouteDTO[];
  onModelChange: (model: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <CompactModelSelect value={model} models={models} onChange={onModelChange} />
      <CompactSelect
        value={controller.count}
        options={imageCounts}
        onChange={controller.setCount}
        ariaLabel={t("creativeConsole.count")}
        suffix="×"
        icon={<Images />}
      />
      <CompactSelect
        value={controller.aspectRatio}
        options={imageAspectRatios}
        onChange={controller.setAspectRatio}
        ariaLabel={t("creativeConsole.aspectRatio")}
        icon={<TvMinimal />}
      />
      <CompactSelect
        value={controller.resolution}
        options={imageResolutions}
        onChange={controller.setResolution}
        ariaLabel={t("creativeConsole.resolution")}
        icon={<ImageUpscale />}
      />
      {controller.supportsQuality ? (
        <CompactSelect
          value={controller.quality}
          options={imageQualities}
          onChange={(value) => controller.setQuality(value as ImageQuality)}
          ariaLabel={t("creativeConsole.quality")}
        />
      ) : null}
    </div>
  );
}
