import { ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@/components/ui/checkbox";
import { formatBytes, formatMediaType, imageAssetURL } from "@/features/media/media-format";
import type { MediaAssetDTO } from "@/features/media/types";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";

type ImageCardProps = {
  image: MediaAssetDTO;
  locale: string;
  selectionMode: boolean;
  selected: boolean;
  onSelectedChange: (checked: boolean) => void;
};

/** 图片卡片：选择态高亮、原图打开与元信息展示。 */
export function ImageCard({ image, locale, selectionMode, selected, onSelectedChange }: ImageCardProps) {
  const { t } = useTranslation();
  const imageURL = imageAssetURL(image.id);
  return (
    <article
      className="group relative min-w-0 [content-visibility:auto] [contain-intrinsic-size:0_280px]"
      data-testid={`gallery-card-${image.id}`}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={(checked) => onSelectedChange(checked === true)}
        aria-label={t("common.selectItem", { name: image.id })}
        className={cn(
          "absolute left-2 top-2 z-10 bg-background/90 shadow-sm backdrop-blur-sm transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
          selected && "md:opacity-100",
        )}
      />
      <a
        href={imageURL}
        target="_blank"
        rel="noreferrer"
        aria-label={
          selectionMode ? t("common.selectItem", { name: image.id }) : t("media.images.openImage", { id: image.id })
        }
        className={cn(
          "block min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          selectionMode && "cursor-pointer",
        )}
        onClick={(event) => {
          if (!selectionMode) return;
          event.preventDefault();
          onSelectedChange(!selected);
        }}
      >
        <ImageCardMedia image={image} imageURL={imageURL} selected={selected} selectionMode={selectionMode} />
        <ImageCardMeta image={image} locale={locale} />
      </a>
    </article>
  );
}

function ImageCardMedia({
  image,
  imageURL,
  selected,
  selectionMode,
}: {
  image: MediaAssetDTO;
  imageURL: string;
  selected: boolean;
  selectionMode: boolean;
}) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
      <img
        src={imageURL}
        alt={image.id}
        loading="lazy"
        decoding="async"
        className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.025]"
      />
      {selected ? (
        <span
          className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-primary/70"
          aria-hidden="true"
        />
      ) : null}
      {!selectionMode ? (
        <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-background/85 text-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <ArrowUpRight className="size-3.5" />
        </span>
      ) : null}
    </div>
  );
}

function ImageCardMeta({ image, locale }: { image: MediaAssetDTO; locale: string }) {
  return (
    <div className="space-y-1 px-0.5 pt-2.5 text-xs">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate font-medium" title={image.id}>
          {image.id}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {formatBytes(image.sizeBytes, locale)}
        </span>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate uppercase" title={image.mimeType}>
          {formatMediaType(image)}
        </span>
        <span className="shrink-0 whitespace-nowrap">{formatDateTime(image.createdAt, locale)}</span>
      </div>
    </div>
  );
}
