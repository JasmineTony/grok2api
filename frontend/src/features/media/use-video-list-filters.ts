import { useState } from "react";

import type { VideoStatusFilter } from "@/features/media/video-gallery-toolbar";
import type { MediaListState } from "@/features/media/use-media-list-state";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";

export type VideoListFilters = {
  statusFilter: VideoStatusFilter;
  sort: TableSort;
  changeStatusFilter: (value: VideoStatusFilter) => void;
  changeSort: (field: string, initialOrder: SortOrder) => void;
};

/** 视频列表的筛选与排序状态：使用统一的分页状态，变更筛选时回到第一页。 */
export function useVideoListFilters(list: MediaListState): VideoListFilters {
  const [statusFilter, setStatusFilter] = useState<VideoStatusFilter>("");
  const [sort, setSort] = useState<TableSort>({ field: "createdAt", order: "desc" });

  function changeStatusFilter(value: VideoStatusFilter): void {
    setStatusFilter(value);
    list.changePage(1);
  }

  function changeSort(field: string, initialOrder: SortOrder): void {
    setSort((current) => nextTableSort(current, field, initialOrder));
    list.changePage(1);
  }

  return { statusFilter, sort, changeStatusFilter, changeSort };
}
