import { useTranslation } from "react-i18next";

import { ImageCard } from "@/features/media/gallery-card";
import { GalleryEmptyState, ImageGridLoading } from "@/features/media/gallery-states";
import type { MediaAssetDTO } from "@/features/media/types";
import type { PaginatedDTO } from "@/shared/api/client";
import { ErrorState } from "@/shared/components/data-state";

type GalleryContentProps = {
  result?: PaginatedDTO<MediaAssetDTO>;
  isPending: boolean;
  isError: boolean;
  errorMessage: string;
  onRetry: () => void;
  searchActive: boolean;
  selected: ReadonlySet<string>;
  onSelectedChange: (id: string, checked: boolean) => void;
  locale: string;
};

/** 图库主体：错误态、加载骨架、空态与卡片网格，保持原有条件渲染顺序。 */
export function GalleryContent({
  result,
  isPending,
  isError,
  errorMessage,
  onRetry,
  searchActive,
  selected,
  onSelectedChange,
  locale,
}: GalleryContentProps) {
  const { t } = useTranslation();
  const items = result?.items ?? [];
  return (
    <>
      {isError ? <ErrorState message={errorMessage} onRetry={onRetry} /> : null}
      {isPending ? <ImageGridLoading /> : null}
      {!isPending && result && items.length === 0 ? (
        <GalleryEmptyState message={t(searchActive ? "media.images.noMatches" : "media.images.empty")} />
      ) : null}
      {!isPending && result && items.length > 0 ? (
        <div
          className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
          data-testid="gallery-grid"
        >
          {items.map((image) => (
            <ImageCard
              key={image.id}
              image={image}
              locale={locale}
              selectionMode={selected.size > 0}
              selected={selected.has(image.id)}
              onSelectedChange={(checked) => onSelectedChange(image.id, checked)}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
