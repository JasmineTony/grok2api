import { GalleryContent } from "@/features/media/gallery-content";
import { GalleryToolbar } from "@/features/media/gallery-toolbar";
import type { GalleryImagesResult } from "@/features/media/use-gallery-images";
import type { MediaListState } from "@/features/media/use-media-list-state";
import type { MediaSelection } from "@/features/media/use-media-selection";
import type { MediaAssetDTO } from "@/features/media/types";
import type { PaginatedDTO } from "@/shared/api/client";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { Pagination } from "@/shared/components/pagination";

export type GalleryTableProps = {
  list: MediaListState;
  gallery: GalleryImagesResult;
  selection: MediaSelection;
  result?: PaginatedDTO<MediaAssetDTO>;
  pageIDs: readonly string[];
  selectedOnPageCount: number;
  locale: string;
  onRequestDelete: () => void;
};

/** 图库表格区：工具栏、分页与卡片网格，条件渲染顺序与原实现一致。 */
export function GalleryTable(props: GalleryTableProps) {
  const { list, gallery, selection, result, pageIDs, selectedOnPageCount } = props;
  const allPageSelected = pageIDs.length > 0 && selectedOnPageCount === pageIDs.length;
  return (
    <DataTableShell
      toolbar={
        <GalleryToolbar
          search={list.search}
          onSearchChange={list.changeSearch}
          allPageSelected={allPageSelected}
          somePageSelected={selectedOnPageCount > 0}
          onTogglePage={(checked) => selection.togglePage(pageIDs, checked)}
          pageSummary={
            list.normalizedSearch && result ? { count: result.items.length, total: result.total } : undefined
          }
          selectedCount={selection.selected.size}
          onRequestDelete={props.onRequestDelete}
          stats={gallery.statsQuery.data}
          statsLoading={gallery.statsQuery.isPending}
          statsUnavailable={gallery.statsQuery.isError}
          locale={props.locale}
        />
      }
      footer={
        result && result.total > 0 ? (
          <Pagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            onPageChange={list.changePage}
            onPageSizeChange={list.changePageSize}
          />
        ) : undefined
      }
    >
      <GalleryContent
        result={result}
        isPending={gallery.imagesQuery.isPending}
        isError={gallery.imagesQuery.isError}
        errorMessage={gallery.imagesQuery.error?.message ?? ""}
        onRetry={() => void gallery.imagesQuery.refetch()}
        searchActive={Boolean(list.normalizedSearch)}
        selected={selection.selected}
        onSelectedChange={selection.toggleItem}
        locale={props.locale}
      />
    </DataTableShell>
  );
}
