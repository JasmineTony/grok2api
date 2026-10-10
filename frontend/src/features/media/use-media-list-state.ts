import { useState } from "react";

import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";

export type MediaListState = {
  page: number;
  pageSize: number;
  search: string;
  normalizedSearch: string;
  changePage: (page: number) => void;
  changePageSize: (pageSize: number) => void;
  changeSearch: (value: string) => void;
};

/** 媒体列表分页与搜索状态：搜索去抖 300ms，调整筛选或页大小时回到第一页。 */
export function useMediaListState(): MediaListState {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const normalizedSearch = useDebouncedValue(search).trim();

  function changePageSize(value: number): void {
    setPageSize(value);
    setPage(1);
  }

  function changeSearch(value: string): void {
    setSearch(value);
    setPage(1);
  }

  return { page, pageSize, search, normalizedSearch, changePage: setPage, changePageSize, changeSearch };
}
