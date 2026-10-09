import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { listModelGroups } from "@/entities/model/model-api";
import type { ModelRouteDTO, ModelRouteGroupDTO } from "@/entities/model/types";
import { newModelRouteGroup, type ModelRouteGroup } from "@/features/models/model-display";
import type { PaginatedDTO } from "@/shared/api/client";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";

// 模型列表的筛选/分页/排序状态与查询：从 models-page.tsx 拆出。
// 任何影响查询条件的改动都会重置到第 1 页并通知调用方（用于清空跨页选择）。

export type ModelListController = {
  page: number;
  pageSize: number;
  search: string;
  statusFilter: string;
  providerFilter: ModelRouteDTO["provider"] | "";
  sort: TableSort;
  query: UseQueryResult<PaginatedDTO<ModelRouteGroupDTO>, Error>;
  result: PaginatedDTO<ModelRouteGroup> | undefined;
  pageIDs: string[];
  setSearch: (value: string) => void;
  setStatusFilter: (value: string) => void;
  setProviderFilter: (value: ModelRouteDTO["provider"] | "") => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  changeSort: (field: string, initialOrder: SortOrder) => void;
};

type ModelListFilters = {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  provider: ModelRouteDTO["provider"] | "";
  sort: TableSort;
};

function modelGroupQueryKey({ page, pageSize, search, status, provider, sort }: ModelListFilters) {
  return ["models", "grouped", page, pageSize, search, status, provider, sort.field, sort.order] as const;
}

function listModelGroupPage(filters: ModelListFilters): Promise<PaginatedDTO<ModelRouteGroupDTO>> {
  return listModelGroups({
    page: filters.page,
    pageSize: filters.pageSize,
    search: filters.search,
    status: filters.status,
    provider: filters.provider,
    sortBy: filters.sort.field || undefined,
    sortOrder: filters.sort.field ? filters.sort.order : undefined,
  });
}

export function useModelList(onQueryChange: () => void): ModelListController {
  const { t } = useTranslation();
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(20);
  const [search, setSearchState] = useState("");
  const [status, setStatusState] = useState("");
  const [provider, setProviderState] = useState<ModelRouteDTO["provider"] | "">("");
  const [sort, setSortState] = useState<TableSort>({ field: "", order: "asc" });
  const debouncedSearch = useDebouncedValue(search);
  const filters: ModelListFilters = { page, pageSize, search: debouncedSearch, status, provider, sort };

  const query = useQuery({
    queryKey: modelGroupQueryKey(filters),
    queryFn: () => listModelGroupPage(filters),
  });
  const result = useMemo(
    () =>
      query.data ? { ...query.data, items: query.data.items.map((group) => newModelRouteGroup(group, t)) } : undefined,
    [query.data, t],
  );
  const pageIDs = result?.items.flatMap((group) => group.routes.map((route) => route.id)) ?? [];

  function applyFilterChange(update: () => void): void {
    update();
    setPageState(1);
    onQueryChange();
  }

  return {
    page,
    pageSize,
    search,
    statusFilter: status,
    providerFilter: provider,
    sort,
    query,
    result,
    pageIDs,
    setSearch: (value) => applyFilterChange(() => setSearchState(value)),
    setStatusFilter: (value) => applyFilterChange(() => setStatusState(value)),
    setProviderFilter: (value) => applyFilterChange(() => setProviderState(value)),
    setPageSize: (value) => applyFilterChange(() => setPageSizeState(value)),
    changeSort: (field, initialOrder) =>
      applyFilterChange(() => setSortState((current) => nextTableSort(current, field, initialOrder))),
    setPage: (value) => {
      setPageState(value);
      onQueryChange();
    },
  };
}
