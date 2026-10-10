import type { TFunction } from "i18next";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { DataTableFilters, type DataTableFilter } from "@/shared/components/data-table-filters";
import { VideoSummary } from "@/features/media/media-summary";
import { MediaSelectionActions } from "@/features/media/media-selection-actions";
import type { MediaJobDTO, VideoStatsDTO } from "@/features/media/types";

export type VideoStatusFilter = MediaJobDTO["status"] | "";

const videoStatusOptions: MediaJobDTO["status"][] = ["queued", "in_progress", "completed", "failed"];

export type VideoGalleryToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: VideoStatusFilter;
  onStatusFilterChange: (value: VideoStatusFilter) => void;
  /** 仅在有关键字或状态筛选且列表已返回时展示命中数。 */
  pageSummary?: { count: number; total: number };
  selectedCount: number;
  onRequestDelete: () => void;
  stats?: VideoStatsDTO;
  statsLoading: boolean;
  statsUnavailable: boolean;
  locale: string;
};

/** 视频列表工具栏：搜索、状态筛选与统计；有选中项时切换为批量操作入口。 */
export function VideoGalleryToolbar(props: VideoGalleryToolbarProps) {
  return (
    <>
      <VideoFilterBar {...props} />
      {props.selectedCount > 0 ? (
        <MediaSelectionActions selectedCount={props.selectedCount} onRequestDelete={props.onRequestDelete} />
      ) : (
        <VideoSummary
          stats={props.stats}
          loading={props.statsLoading}
          unavailable={props.statsUnavailable}
          locale={props.locale}
        />
      )}
    </>
  );
}

function VideoFilterBar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  pageSummary,
}: VideoGalleryToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-9 text-xs"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("media.videos.search")}
          aria-label={t("media.videos.search")}
          data-testid="video-gallery-search"
        />
      </div>
      <DataTableFilters filters={[statusFilterDefinition(t, statusFilter, onStatusFilterChange)]} />
      {pageSummary ? (
        <span className="hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground md:inline">
          {t("media.videos.pageSummary", pageSummary)}
        </span>
      ) : null}
    </div>
  );
}

function statusFilterDefinition(
  t: TFunction,
  value: VideoStatusFilter,
  onChange: (value: VideoStatusFilter) => void,
): DataTableFilter {
  return {
    id: "status",
    label: t("media.videos.status"),
    value,
    onChange: (next) => onChange(next as VideoStatusFilter),
    options: videoStatusOptions.map((status) => ({ value: status, label: t(`media.videoStatus.${status}`) })),
  };
}
