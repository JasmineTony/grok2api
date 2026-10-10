import type { ReactNode } from "react";
import { Eye } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableActionCell,
  TableActionHead,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatSpec, isTerminalVideoJob } from "@/features/media/media-format";
import type { MediaJobDTO } from "@/features/media/types";
import type { MediaListState } from "@/features/media/use-media-list-state";
import type { MediaSelection } from "@/features/media/use-media-selection";
import type { VideoJobsResult } from "@/features/media/use-video-jobs";
import type { VideoListFilters } from "@/features/media/use-video-list-filters";
import { VideoGalleryToolbar } from "@/features/media/video-gallery-toolbar";
import { VideoProgress, VideoTimes } from "@/features/media/video-progress";
import type { PaginatedDTO } from "@/shared/api/client";
import { EmptyState, ErrorState, TableLoadingRow } from "@/shared/components/data-state";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { Pagination } from "@/shared/components/pagination";
import { SortableTableHead } from "@/shared/components/sortable-table-head";
import { VirtualTableBody } from "@/shared/components/virtual-table-body";
import type { SortOrder, TableSort } from "@/shared/lib/table-sort";

export type VideoGalleryTableProps = {
  list: MediaListState;
  filters: VideoListFilters;
  jobs: VideoJobsResult;
  selection: MediaSelection;
  result?: PaginatedDTO<MediaJobDTO>;
  /** 页内可选（终态）任务 ID 与其已选数量。 */
  selectionMeta: { pageIDs: readonly string[]; selectedCount: number };
  locale: string;
  onRequestDelete: () => void;
  onPreview: (job: MediaJobDTO) => void;
};

const COLUMN_COUNT = 8;
const ROW_HEIGHT = 72;

const VIDEO_SORT_COLUMNS: Array<{ field: string; labelKey: string; initialOrder?: SortOrder }> = [
  { field: "prompt", labelKey: "media.videos.prompt" },
  { field: "model", labelKey: "media.videos.model" },
  { field: "status", labelKey: "media.videos.statusProgress" },
  { field: "spec", labelKey: "media.videos.spec" },
  { field: "account", labelKey: "media.videos.owner" },
  { field: "createdAt", labelKey: "media.videos.time", initialOrder: "desc" },
];

/** 视频任务表格区：工具栏、分页与虚拟滚动行。 */
export function VideoGalleryTable(props: VideoGalleryTableProps) {
  return (
    <DataTableShell
      toolbar={<VideoTableToolbar {...props} />}
      footer={<VideoTableFooter list={props.list} result={props.result} />}
    >
      <VideoJobsTable {...props} />
    </DataTableShell>
  );
}

function VideoTableToolbar({
  list,
  filters,
  jobs,
  selection,
  result,
  locale,
  onRequestDelete,
}: VideoGalleryTableProps) {
  const pageSummary = list.normalizedSearch || filters.statusFilter ? summarizePage(result) : undefined;
  return (
    <VideoGalleryToolbar
      search={list.search}
      onSearchChange={list.changeSearch}
      statusFilter={filters.statusFilter}
      onStatusFilterChange={filters.changeStatusFilter}
      pageSummary={pageSummary}
      selectedCount={selection.selected.size}
      onRequestDelete={onRequestDelete}
      stats={jobs.statsQuery.data}
      statsLoading={jobs.statsQuery.isPending}
      statsUnavailable={jobs.statsQuery.isError}
      locale={locale}
    />
  );
}

function VideoTableFooter({ list, result }: { list: MediaListState; result?: PaginatedDTO<MediaJobDTO> }): ReactNode {
  if (!result || result.total === 0) return undefined;
  return (
    <Pagination
      page={result.page}
      pageSize={result.pageSize}
      total={result.total}
      onPageChange={list.changePage}
      onPageSizeChange={list.changePageSize}
    />
  );
}

function summarizePage(result?: PaginatedDTO<MediaJobDTO>): { count: number; total: number } | undefined {
  return result ? { count: result.items.length, total: result.total } : undefined;
}

function VideoJobsTable({
  jobs,
  selection,
  result,
  selectionMeta,
  filters,
  onPreview,
  locale,
}: VideoGalleryTableProps) {
  const { t } = useTranslation();
  const items = result?.items ?? [];
  return (
    <>
      {jobs.videosQuery.isError ? (
        <ErrorState message={jobs.videosQuery.error?.message ?? ""} onRetry={() => void jobs.videosQuery.refetch()} />
      ) : null}
      {result && items.length === 0 ? <EmptyState message={t("media.videos.empty")} /> : null}
      {jobs.videosQuery.isPending || items.length > 0 ? (
        <Table viewportRows={20} rowHeight={ROW_HEIGHT} className="min-w-[1096px] table-fixed text-xs">
          <VideoColumnWidths />
          <VideoJobsHeader
            pageIDs={selectionMeta.pageIDs}
            selectedCount={selectionMeta.selectedCount}
            sort={filters.sort}
            onSortChange={filters.changeSort}
            onTogglePage={(checked) => selection.togglePage(selectionMeta.pageIDs, checked)}
          />
          <VideoJobsBody jobs={jobs} selection={selection} items={items} onPreview={onPreview} locale={locale} />
        </Table>
      ) : null}
    </>
  );
}

/** 表格列宽，与 8 列结构一一对应。 */
function VideoColumnWidths() {
  return (
    <colgroup>
      <col className="w-10" />
      <col className="w-64" />
      <col className="w-40" />
      <col className="w-40" />
      <col className="w-28" />
      <col className="w-40" />
      <col className="w-44" />
      <col className="w-10" />
    </colgroup>
  );
}

function VideoJobsHeader({
  pageIDs,
  selectedCount,
  sort,
  onSortChange,
  onTogglePage,
}: {
  pageIDs: readonly string[];
  selectedCount: number;
  sort: TableSort;
  onSortChange: (field: string, initialOrder: SortOrder) => void;
  onTogglePage: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const checked = selectedCount === 0 ? false : selectedCount === pageIDs.length ? true : "indeterminate";
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead>
          <Checkbox
            checked={checked}
            disabled={pageIDs.length === 0}
            onCheckedChange={(value) => onTogglePage(value === true)}
            aria-label={t("common.selectPage")}
            data-testid="video-gallery-select-page"
          />
        </TableHead>
        {VIDEO_SORT_COLUMNS.map((column) => (
          <SortableTableHead
            key={column.field}
            field={column.field}
            sortBy={sort.field}
            sortOrder={sort.order}
            initialOrder={column.initialOrder}
            onSort={onSortChange}
          >
            {t(column.labelKey)}
          </SortableTableHead>
        ))}
        <TableActionHead />
      </TableRow>
    </TableHeader>
  );
}

/** 表格主体：首屏加载行，或虚拟滚动的任务行。 */
function VideoJobsBody({
  jobs,
  selection,
  items,
  onPreview,
  locale,
}: {
  jobs: VideoJobsResult;
  selection: MediaSelection;
  items: readonly MediaJobDTO[];
  onPreview: (job: MediaJobDTO) => void;
  locale: string;
}) {
  if (jobs.videosQuery.isPending) {
    return (
      <TableBody>
        <TableLoadingRow colSpan={COLUMN_COUNT} />
      </TableBody>
    );
  }
  return (
    <VirtualTableBody
      items={items}
      colSpan={COLUMN_COUNT}
      rowHeight={ROW_HEIGHT}
      renderRow={(job) => (
        <VideoJobRow
          key={job.id}
          job={job}
          selected={selection.selected.has(job.id)}
          onToggle={selection.toggleItem}
          onPreview={onPreview}
          locale={locale}
        />
      )}
    />
  );
}

function VideoJobRow({
  job,
  selected,
  onToggle,
  onPreview,
  locale,
}: {
  job: MediaJobDTO;
  selected: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onPreview: (job: MediaJobDTO) => void;
  locale: string;
}) {
  return (
    <TableRow className="group h-[72px]" data-state={selected ? "selected" : undefined}>
      <VideoSelectCell job={job} selected={selected} onToggle={onToggle} />
      <VideoPromptCell job={job} />
      <VideoModelCell job={job} />
      <TableCell>
        <VideoProgress status={job.status} value={job.progress} errorMessage={job.errorMessage} locale={locale} />
      </TableCell>
      <VideoSpecCell job={job} />
      <VideoOwnerCell job={job} />
      <TableCell>
        <VideoTimes job={job} locale={locale} />
      </TableCell>
      <VideoPreviewAction job={job} onPreview={onPreview} />
    </TableRow>
  );
}

function VideoSelectCell({
  job,
  selected,
  onToggle,
}: {
  job: MediaJobDTO;
  selected: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <TableCell>
      <Checkbox
        checked={selected}
        disabled={!isTerminalVideoJob(job)}
        onCheckedChange={(checked) => onToggle(job.id, checked === true)}
        aria-label={t("common.selectItem", { name: job.id })}
        data-testid={`video-job-select-${job.id}`}
      />
    </TableCell>
  );
}

function VideoPreviewAction({ job, onPreview }: { job: MediaJobDTO; onPreview: (job: MediaJobDTO) => void }) {
  const { t } = useTranslation();
  if (job.status !== "completed") return <TableActionCell />;
  const label = job.assetId ? t("media.videos.preview") : t("media.videos.previewUnavailable");
  return (
    <TableActionCell>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        disabled={!job.assetId}
        title={label}
        onClick={() => onPreview(job)}
        aria-label={label}
        data-testid={`video-job-preview-${job.id}`}
      >
        <Eye />
      </Button>
    </TableActionCell>
  );
}

function VideoPromptCell({ job }: { job: MediaJobDTO }) {
  return (
    <TableCell className="min-w-0">
      <div className="min-w-0">
        <span className="block truncate text-xs font-medium" title={job.prompt}>
          {job.prompt || "-"}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground" title={job.id}>
          {job.id}
        </span>
      </div>
    </TableCell>
  );
}

function VideoModelCell({ job }: { job: MediaJobDTO }) {
  return (
    <TableCell className="min-w-0">
      <span className="block truncate" title={job.model}>
        {job.model || "-"}
      </span>
    </TableCell>
  );
}

function VideoSpecCell({ job }: { job: MediaJobDTO }) {
  const { t } = useTranslation();
  return (
    <TableCell>
      <div className="space-y-0.5 text-xs">
        <span className="block truncate" title={formatSpec(job)}>
          {formatSpec(job)}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {t("media.videos.seconds", { count: job.seconds })}
        </span>
      </div>
    </TableCell>
  );
}

function VideoOwnerCell({ job }: { job: MediaJobDTO }) {
  return (
    <TableCell className="min-w-0">
      <div className="min-w-0 space-y-0.5">
        <span className="block truncate" title={job.accountName}>
          {job.accountName || "-"}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground" title={job.clientKeyName}>
          {job.clientKeyName || "-"}
        </span>
      </div>
    </TableCell>
  );
}
