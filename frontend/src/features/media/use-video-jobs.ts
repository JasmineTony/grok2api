import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { getVideoStats, listVideos } from "@/features/media/media-api";
import type { MediaJobDTO, VideoStatsDTO } from "@/features/media/types";
import type { PaginatedDTO } from "@/shared/api/client";
import type { TableSort } from "@/shared/lib/table-sort";

export type VideoJobsInput = {
  page: number;
  pageSize: number;
  status: MediaJobDTO["status"] | "";
  search: string;
  sort: TableSort;
};

export type VideoJobsResult = {
  videosQuery: UseQueryResult<PaginatedDTO<MediaJobDTO>>;
  statsQuery: UseQueryResult<VideoStatsDTO>;
  refreshing: boolean;
  refreshAll: () => void;
};

/** 视频任务列表与统计查询；查询 key、状态筛选与排序参数保持原实现。 */
export function useVideoJobs(input: VideoJobsInput): VideoJobsResult {
  const { page, pageSize, status, search, sort } = input;
  const videosQuery = useQuery({
    queryKey: ["media", "videos", page, pageSize, status, search, sort.field, sort.order],
    queryFn: () =>
      listVideos({
        page,
        pageSize,
        status,
        search: search || undefined,
        sortBy: sort.field,
        sortOrder: sort.order,
      }),
  });
  const statsQuery = useQuery({
    queryKey: ["media", "videos", "stats"],
    queryFn: getVideoStats,
    staleTime: 30_000,
  });

  function refreshAll(): void {
    void videosQuery.refetch();
    void statsQuery.refetch();
  }

  return {
    videosQuery,
    statsQuery,
    refreshing: videosQuery.isFetching || statsQuery.isFetching,
    refreshAll,
  };
}
