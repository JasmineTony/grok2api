import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { GallerySummary } from "@/features/media/media-summary";
import { MediaSelectionActions } from "@/features/media/media-selection-actions";
import type { ImageStatsDTO } from "@/features/media/types";

export type GalleryToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  allPageSelected: boolean;
  somePageSelected: boolean;
  onTogglePage: (checked: boolean) => void;
  /** 仅在有关键字且列表已返回时展示命中数。 */
  pageSummary?: { count: number; total: number };
  selectedCount: number;
  onRequestDelete: () => void;
  stats?: ImageStatsDTO;
  statsLoading: boolean;
  statsUnavailable: boolean;
  locale: string;
};

/** 图库工具栏：整页选择、搜索与统计；有选中项时切换为批量操作入口。 */
export function GalleryToolbar(props: GalleryToolbarProps) {
  return (
    <>
      <GalleryFilterBar {...props} />
      {props.selectedCount > 0 ? (
        <MediaSelectionActions selectedCount={props.selectedCount} onRequestDelete={props.onRequestDelete} />
      ) : (
        <GallerySummary
          loading={props.statsLoading}
          unavailable={props.statsUnavailable}
          totalImages={props.stats?.totalImages ?? 0}
          totalBytes={props.stats?.totalBytes ?? 0}
          locale={props.locale}
        />
      )}
    </>
  );
}

function GalleryFilterBar({
  search,
  onSearchChange,
  allPageSelected,
  somePageSelected,
  onTogglePage,
  pageSummary,
}: GalleryToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto">
      <Checkbox
        checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
        onCheckedChange={(checked) => onTogglePage(checked === true)}
        aria-label={t("common.selectPage")}
        data-testid="gallery-select-page"
      />
      <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-9 text-xs"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("media.images.search")}
          aria-label={t("media.images.search")}
          data-testid="gallery-search"
        />
      </div>
      {pageSummary ? (
        <span className="hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground md:inline">
          {t("media.images.pageSummary", pageSummary)}
        </span>
      ) : null}
    </div>
  );
}
