import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { getImageStats, listImages } from "@/features/media/media-api";
import type { ImageStatsDTO, MediaAssetDTO } from "@/features/media/types";
import type { PaginatedDTO } from "@/shared/api/client";

export type GalleryImagesInput = {
  page: number;
  pageSize: number;
  search: string;
};

export type GalleryImagesResult = {
  imagesQuery: UseQueryResult<PaginatedDTO<MediaAssetDTO>>;
  statsQuery: UseQueryResult<ImageStatsDTO>;
  refreshing: boolean;
  refreshAll: () => void;
};

/** 图库图片列表与统计查询；查询 key、分页与搜索参数保持原实现。 */
export function useGalleryImages(input: GalleryImagesInput): GalleryImagesResult {
  const imagesQuery = useQuery({
    queryKey: ["media", "images", input.page, input.pageSize, input.search],
    queryFn: () => listImages({ page: input.page, pageSize: input.pageSize, search: input.search || undefined }),
  });
  const statsQuery = useQuery({
    queryKey: ["media", "images", "stats"],
    queryFn: getImageStats,
    staleTime: 30_000,
  });

  function refreshAll(): void {
    void imagesQuery.refetch();
    void statsQuery.refetch();
  }

  return {
    imagesQuery,
    statsQuery,
    refreshing: imagesQuery.isFetching || statsQuery.isFetching,
    refreshAll,
  };
}
