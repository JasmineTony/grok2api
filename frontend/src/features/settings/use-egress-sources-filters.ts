import { useState } from "react";

import type { EgressSourcesListQuery } from "@/features/settings/egress-source-model";

export type EgressSourcesFilters = EgressSourcesListQuery & {
  changeSearch: (value: string) => void;
  changeScopeFilter: (value: string) => void;
  changePageSize: (value: number) => void;
  changePage: (page: number) => void;
  resetPage: () => void;
};

/** 订阅源列表的筛选与分页状态：任一筛选变化后都回到第 1 页。 */
export function useEgressSourcesFilters(): EgressSourcesFilters {
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  return {
    search,
    scopeFilter,
    pageSize,
    page,
    changeSearch: (value) => {
      setSearch(value);
      setPage(1);
    },
    changeScopeFilter: (value) => {
      setScopeFilter(value);
      setPage(1);
    },
    changePageSize: (value) => {
      setPageSize(value);
      setPage(1);
    },
    changePage: setPage,
    resetPage: () => setPage(1),
  };
}
