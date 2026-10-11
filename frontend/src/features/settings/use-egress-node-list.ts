import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";

import { listEgressNodes } from "@/entities/egress/egress-api";
import type { EgressNodeDTO, EgressNodeListDTO, EgressScope } from "@/entities/egress/egress-dto";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";

export type EgressNodeList = {
  search: string;
  setSearch: (value: string) => void;
  scopeFilter: string;
  setScopeFilter: (value: string) => void;
  enabledFilter: string;
  setEnabledFilter: (value: string) => void;
  probeFilter: string;
  setProbeFilter: (value: string) => void;
  assignmentFilter: string;
  setAssignmentFilter: (value: string) => void;
  hasActiveFilters: boolean;
  page: number;
  setPage: (page: number) => void;
  pageSize: number;
  sort: TableSort;
  changeFilter: (value: string, setter: (value: string) => void) => void;
  changeSort: (field: string, initialOrder: SortOrder) => void;
  changePageSize: (value: number) => void;
  query: UseQueryResult<EgressNodeListDTO>;
  data: EgressNodeListDTO | undefined;
  nodes: EgressNodeDTO[];
  refresh: () => void;
};

/** 搜索、筛选、分页与排序状态：筛选变化回到第 1 页，并由调用方清空选择集。 */
function useEgressNodeListState(onFilterChange: () => void) {
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const [probeFilter, setProbeFilter] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<TableSort>({ field: "", order: "asc" });
  const debouncedSearch = useDebouncedValue(search);

  function changeFilter(value: string, setter: (value: string) => void): void {
    setter(value);
    setPage(1);
    onFilterChange();
  }

  function changeSort(field: string, initialOrder: SortOrder): void {
    setSort((current) => nextTableSort(current, field, initialOrder));
    setPage(1);
  }

  function changePageSize(value: number): void {
    setPageSize(value);
    setPage(1);
  }

  return {
    search,
    setSearch,
    scopeFilter,
    setScopeFilter,
    enabledFilter,
    setEnabledFilter,
    probeFilter,
    setProbeFilter,
    assignmentFilter,
    setAssignmentFilter,
    debouncedSearch,
    page,
    setPage,
    pageSize,
    sort,
    changeFilter,
    changeSort,
    changePageSize,
  };
}

/** 节点分页查询：查询键与请求参数按状态生成，保持 15s 新鲜度与聚焦重取。 */
function useEgressNodeListQuery(state: ReturnType<typeof useEgressNodeListState>) {
  const query = useQuery({
    queryKey: [
      "egress-nodes",
      "page",
      state.page,
      state.pageSize,
      state.debouncedSearch,
      state.scopeFilter,
      state.enabledFilter,
      state.probeFilter,
      state.assignmentFilter,
      state.sort.field,
      state.sort.order,
    ],
    queryFn: () =>
      listEgressNodes({
        page: state.page,
        pageSize: state.pageSize,
        search: state.debouncedSearch,
        scope: state.scopeFilter as EgressScope | "",
        enabled: state.enabledFilter,
        probe: state.probeFilter,
        assignment: state.assignmentFilter,
        sortBy: state.sort.field || undefined,
        sortOrder: state.sort.field ? state.sort.order : undefined,
      }),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  function refresh(): void {
    void query.refetch();
  }

  return { query, data: query.data, nodes: query.data?.items ?? [], refresh };
}

/** 出口节点列表控制器：状态、查询结果与「筛选变化清空选择」的接线。 */
export function useEgressNodeList(onFilterChange: () => void): EgressNodeList {
  const state = useEgressNodeListState(onFilterChange);
  const query = useEgressNodeListQuery(state);
  const hasActiveFilters = Boolean(
    state.debouncedSearch || state.scopeFilter || state.enabledFilter || state.probeFilter || state.assignmentFilter,
  );
  return { ...state, hasActiveFilters, ...query };
}
