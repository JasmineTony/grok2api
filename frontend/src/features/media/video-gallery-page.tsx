import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { deleteVideos } from "@/features/media/media-api";
import { MediaDeleteDialog } from "@/features/media/media-delete-dialog";
import { MediaPageHeader } from "@/features/media/media-page-header";
import { isTerminalVideoJob } from "@/features/media/media-format";
import type { MediaJobDTO } from "@/features/media/types";
import { useMediaDeletion } from "@/features/media/use-media-deletion";
import { useMediaListState } from "@/features/media/use-media-list-state";
import { useMediaSelection } from "@/features/media/use-media-selection";
import { useVideoJobs } from "@/features/media/use-video-jobs";
import { useVideoListFilters } from "@/features/media/use-video-list-filters";
import { VideoGalleryTable, type VideoGalleryTableProps } from "@/features/media/video-gallery-table";
import { VideoPreviewDialog } from "@/features/media/video-preview-dialog";

type VideoGalleryContentProps = {
  list: VideoGalleryTableProps["list"];
  filters: VideoGalleryTableProps["filters"];
  jobs: VideoGalleryTableProps["jobs"];
  selection: VideoGalleryTableProps["selection"];
  result: VideoGalleryTableProps["result"];
  selectionMeta: VideoGalleryTableProps["selectionMeta"];
  deletion: ReturnType<typeof useMediaDeletion>;
  previewing: MediaJobDTO | null;
  onPreview: (job: MediaJobDTO) => void;
  onClosePreview: () => void;
};

/** 视频任务页：持有分页/筛选/选中/预览状态与查询、删除变更；表格与弹窗均为独立组件。 */
export function VideoGalleryPage(): ReactElement {
  const list = useMediaListState();
  const filters = useVideoListFilters(list);
  const [previewing, setPreviewing] = useState<MediaJobDTO | null>(null);
  const jobs = useVideoJobs({
    page: list.page,
    pageSize: list.pageSize,
    status: filters.statusFilter,
    search: list.normalizedSearch,
    sort: filters.sort,
  });
  const selection = useMediaSelection();
  const result = jobs.videosQuery.data;
  const pageIDs = result?.items.filter(isTerminalVideoJob).map((job) => job.id) ?? [];
  const selectedOnPageCount = pageIDs.filter((id) => selection.selected.has(id)).length;
  const deletion = useMediaDeletion({
    ids: [...selection.selected],
    deleteRequest: deleteVideos,
    invalidateKey: ["media", "videos"],
    deletedMessageKey: "media.videos.deleted",
    trimPage: Boolean(result) && selectedOnPageCount === (result?.items.length ?? 0) && list.page > 1,
    page: list.page,
    onPageChange: list.changePage,
    onRemoved: () => {
      setPreviewing((current) => (current && selection.selected.has(current.id) ? null : current));
      selection.clear();
    },
  });

  return (
    <VideoGalleryContent
      list={list}
      filters={filters}
      jobs={jobs}
      selection={selection}
      result={result}
      selectionMeta={{ pageIDs, selectedCount: selectedOnPageCount }}
      deletion={deletion}
      previewing={previewing}
      onPreview={setPreviewing}
      onClosePreview={() => setPreviewing(null)}
    />
  );
}

/** 视频任务区：页头、表格、删除确认与预览弹窗。 */
function VideoGalleryContent({
  list,
  filters,
  jobs,
  selection,
  result,
  selectionMeta,
  deletion,
  previewing,
  onPreview,
  onClosePreview,
}: VideoGalleryContentProps) {
  const { t, i18n } = useTranslation();
  const table: VideoGalleryTableProps = {
    list,
    filters,
    jobs,
    selection,
    result,
    selectionMeta,
    locale: i18n.language,
    onRequestDelete: deletion.requestConfirm,
    onPreview,
  };

  return (
    <div className="space-y-5">
      <MediaPageHeader
        title={t("media.videos.title")}
        description={t("media.videos.description")}
        refreshing={jobs.refreshing}
        onRefresh={jobs.refreshAll}
      />
      <VideoGalleryTable {...table} />
      <MediaDeleteDialog
        open={deletion.confirmOpen}
        titleKey="media.videos.deleteTitle"
        descriptionKey="media.videos.deleteDescription"
        count={selection.selected.size}
        pending={deletion.isPending}
        onOpenChange={deletion.closeConfirm}
        onConfirm={deletion.confirm}
      />
      <VideoPreviewDialog job={previewing} onClose={onClosePreview} />
    </div>
  );
}
