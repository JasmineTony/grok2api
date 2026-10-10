import { useTranslation } from "react-i18next";

import { deleteImages } from "@/features/media/media-api";
import { MediaDeleteDialog } from "@/features/media/media-delete-dialog";
import { MediaPageHeader } from "@/features/media/media-page-header";
import { GalleryTable, type GalleryTableProps } from "@/features/media/gallery-table";
import { useGalleryImages } from "@/features/media/use-gallery-images";
import { useMediaDeletion } from "@/features/media/use-media-deletion";
import { useMediaListState } from "@/features/media/use-media-list-state";
import { useMediaSelection } from "@/features/media/use-media-selection";

/** 图库页：持有分页/搜索/选中状态与查询、删除变更；工具栏、卡片网格与确认弹窗均为独立组件。 */
export function GalleryPage() {
  const { t, i18n } = useTranslation();
  const list = useMediaListState();
  const gallery = useGalleryImages({ page: list.page, pageSize: list.pageSize, search: list.normalizedSearch });
  const selection = useMediaSelection();
  const result = gallery.imagesQuery.data;
  const pageIDs = result?.items.map((image) => image.id) ?? [];
  const selectedOnPageCount = pageIDs.filter((id) => selection.selected.has(id)).length;
  const deletion = useMediaDeletion({
    ids: [...selection.selected],
    deleteRequest: deleteImages,
    invalidateKey: ["media", "images"],
    deletedMessageKey: "media.images.deleted",
    trimPage: Boolean(result) && selectedOnPageCount === pageIDs.length && list.page > 1,
    page: list.page,
    onPageChange: list.changePage,
    onRemoved: selection.clear,
  });
  const table: GalleryTableProps = {
    list,
    gallery,
    selection,
    result,
    pageIDs,
    selectedOnPageCount,
    locale: i18n.language,
    onRequestDelete: deletion.requestConfirm,
  };

  return (
    <div className="space-y-5">
      <MediaPageHeader
        title={t("media.images.title")}
        description={t("media.images.description")}
        refreshing={gallery.refreshing}
        onRefresh={gallery.refreshAll}
      />
      <GalleryTable {...table} />
      <MediaDeleteDialog
        open={deletion.confirmOpen}
        titleKey="media.images.deleteTitle"
        descriptionKey="media.images.deleteDescription"
        count={selection.selected.size}
        pending={deletion.isPending}
        onOpenChange={deletion.closeConfirm}
        onConfirm={deletion.confirm}
      />
    </div>
  );
}
