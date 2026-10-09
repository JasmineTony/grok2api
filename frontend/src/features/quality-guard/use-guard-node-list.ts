import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";

import { getQualityGuardStatus, type QualityGuardStatus } from "@/features/quality-guard/quality-guard-api";
import { listEgressNodes, type EgressNodeListDTO } from "@/features/settings/settings-api";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";

// 守护节点列表的筛选/分页状态与三个查询（列表、计数、守护状态）。
// 查询 key、轮询间隔与失效语义与拆分前完全一致：列表 15s、计数 30s、守护状态 5s。

export type GuardNodeFilters = {
  page: number;
  pageSize: number;
  search: string;
  enabledFilter: string;
  probeFilter: string;
  assignmentFilter: string;
  debouncedSearch: string;
  hasNodeFilters: boolean;
  setSearch: (value: string) => void;
  setEnabledFilter: (value: string) => void;
  setProbeFilter: (value: string) => void;
  setAssignmentFilter: (value: string) => void;
  changePage: (page: number) => void;
  changePageSize: (pageSize: number) => void;
};

export type GuardNodeCounts = { total: number; enabled: number };

// 任何影响查询条件的改动都回到第 1 页并通知调用方清空跨页选择。
export function useGuardNodeFilters(onFilterChange: () => void): GuardNodeFilters {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const [probeFilter, setProbeFilter] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const applyFilterChange = (update: () => void) => {
    update();
    setPage(1);
    onFilterChange();
  };

  return {
    page,
    pageSize,
    search,
    enabledFilter,
    probeFilter,
    assignmentFilter,
    debouncedSearch,
    hasNodeFilters: Boolean(debouncedSearch || enabledFilter || probeFilter || assignmentFilter),
    setSearch: (value) => applyFilterChange(() => setSearch(value)),
    setEnabledFilter: (value) => applyFilterChange(() => setEnabledFilter(value)),
    setProbeFilter: (value) => applyFilterChange(() => setProbeFilter(value)),
    setAssignmentFilter: (value) => applyFilterChange(() => setAssignmentFilter(value)),
    changePage: (value) => {
      setPage(value);
      onFilterChange();
    },
    changePageSize: (value) => applyFilterChange(() => setPageSize(value)),
  };
}

export function useGuardNodesListQuery(
  active: boolean,
  filters: GuardNodeFilters,
): UseQueryResult<EgressNodeListDTO, Error> {
  return useQuery({
    queryKey: [
      "quality-guard-egress-nodes",
      "page",
      filters.page,
      filters.pageSize,
      filters.debouncedSearch,
      filters.enabledFilter,
      filters.probeFilter,
      filters.assignmentFilter,
    ],
    queryFn: () =>
      listEgressNodes({
        page: filters.page,
        pageSize: filters.pageSize,
        search: filters.debouncedSearch,
        scope: "grok_build",
        enabled: filters.enabledFilter,
        probe: filters.probeFilter,
        assignment: filters.assignmentFilter,
      }),
    placeholderData: keepPreviousData,
    enabled: active,
    refetchInterval: active ? 15_000 : false,
    staleTime: 10_000,
  });
}

export function useGuardNodeCountsQuery(active: boolean): UseQueryResult<GuardNodeCounts, Error> {
  return useQuery({
    queryKey: ["quality-guard-egress-nodes", "counts"],
    queryFn: async () => {
      const [allNodes, enabledNodes] = await Promise.all([
        listEgressNodes({ page: 1, pageSize: 1, scope: "grok_build" }),
        listEgressNodes({ page: 1, pageSize: 1, scope: "grok_build", enabled: "enabled" }),
      ]);
      return { total: allNodes.total, enabled: enabledNodes.total };
    },
    enabled: active,
    refetchInterval: active ? 30_000 : false,
    staleTime: 20_000,
  });
}

// 守护状态轮询与拆分前一致：无论当前 tab 都按 5s 刷新，节点 tab 关闭时以空 nodeId 请求。
export function useGuardStatusQuery(nodeIDs: string[]): {
  statusQuery: UseQueryResult<QualityGuardStatus, Error>;
  statusRef: RefObject<QualityGuardStatus | undefined>;
} {
  const statusQuery = useQuery({
    queryKey: ["quality-guard", "nodes", nodeIDs],
    queryFn: () => getQualityGuardStatus(nodeIDs),
    placeholderData: keepPreviousData,
    refetchInterval: 5_000,
  });
  const statusRef = useRef<QualityGuardStatus | undefined>(statusQuery.data);
  useEffect(() => {
    statusRef.current = statusQuery.data;
  }, [statusQuery.data]);
  return { statusQuery, statusRef };
}
