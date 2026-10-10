import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { listModels } from "@/entities/model/model-api";
import {
  getRequestAudits,
  getRequestAuditSummary,
  type AuditCursorPageDTO,
  type AuditDTO,
  type AuditPeriod,
  type AuditSummaryDTO,
} from "@/features/audits/request-audits-api";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { toPeriodValue, type PeriodDays } from "@/shared/lib/period";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";

const AUDIT_PAGE_CACHE_TIME_MS = 60_000;
const AUDIT_SUMMARY_CACHE_TIME_MS = 120_000;
// 手动刷新后强制重取汇总，最短停留时间避免刷新反馈一闪而过。
const AUDIT_MANUAL_REFRESH_MIN_MS = 400;

export type AuditListQueryState<TData> = {
  data: TData | undefined;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  isPlaceholderData: boolean;
  refetch: () => Promise<unknown>;
};

export type AuditSummaryState = {
  data: AuditSummaryDTO | undefined;
  isPending: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
};

/** 筛选/分页/排序等页面级入参；所有 setter 与控制器同名，便于组合导出。 */
type AuditFilterState = {
  pageSize: number;
  setPageSize: (value: number) => void;
  search: string;
  setSearch: (value: string) => void;
  modelFilter: string;
  setModelFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  modeFilter: string;
  setModeFilter: (value: string) => void;
  keyFilter: string;
  setKeyFilter: (value: string) => void;
  accountFilter: string;
  setAccountFilter: (value: string) => void;
  periodDays: PeriodDays;
  setPeriodDays: (value: PeriodDays) => void;
  sort: TableSort;
  changeSort: (field: string, initialOrder: SortOrder) => void;
};

/** 请求实际使用的参数（搜索类输入已防抖）与游标作用域。 */
type AuditQueryScope = {
  debouncedSearch: string;
  debouncedKeyFilter: string;
  debouncedAccountFilter: string;
  period: AuditPeriod;
  cursorScope: string;
};

type AuditCursorControls = {
  cursors: string[];
  cursor: string;
  goToFirstPage: () => void;
  goToPreviousPage: () => void;
  pushCursor: (next: string) => void;
};

type AuditPageQuery = {
  query: AuditListQueryState<AuditCursorPageDTO>;
  nextCursor: string;
  refetch: () => Promise<unknown>;
};

type AuditSummaryQuery = {
  query: AuditSummaryState;
  refetch: () => Promise<unknown>;
};

type AuditRefreshState = {
  manualRefreshing: boolean;
  refreshAll: () => void;
};

export type AuditListController = {
  pageSize: number;
  search: string;
  modelFilter: string;
  statusFilter: string;
  modeFilter: string;
  keyFilter: string;
  accountFilter: string;
  periodDays: PeriodDays;
  sort: TableSort;
  modelOptions: Array<{ value: string; label: string }>;
  auditsQuery: AuditListQueryState<AuditCursorPageDTO>;
  summaryQuery: AuditSummaryState;
  cursors: string[];
  // 低层游标原语：由 useAuditList 直接返回（运行时已存在），分页动作 goToNextPage 基于它构造。
  // 游标状态机的边界与陈旧闭包行为由 use-audit-list.test.tsx 直接驱动它验证。
  pushCursor: (next: string) => void;
  nextCursor: string;
  manualRefreshing: boolean;
  selectedAudit: AuditDTO | null;
  setSearch: (value: string) => void;
  setModelFilter: (value: string) => void;
  setStatusFilter: (value: string) => void;
  setModeFilter: (value: string) => void;
  setKeyFilter: (value: string) => void;
  setAccountFilter: (value: string) => void;
  setPeriodDays: (value: PeriodDays) => void;
  setPageSize: (value: number) => void;
  setSelectedAudit: (audit: AuditDTO | null) => void;
  changeSort: (field: string, initialOrder: SortOrder) => void;
  refreshAll: () => void;
  goToFirstPage: () => void;
  goToPreviousPage: () => void;
  goToNextPage: () => void;
};

function useAuditFilterState(): AuditFilterState {
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [keyFilter, setKeyFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [periodDays, setPeriodDays] = useState<PeriodDays>(1);
  const [sort, setSort] = useState<TableSort>({ field: "createdAt", order: "desc" });
  const changeSort = useCallback((field: string, initialOrder: SortOrder): void => {
    setSort((current) => nextTableSort(current, field, initialOrder));
  }, []);
  return {
    pageSize,
    setPageSize,
    search,
    setSearch,
    modelFilter,
    setModelFilter,
    statusFilter,
    setStatusFilter,
    modeFilter,
    setModeFilter,
    keyFilter,
    setKeyFilter,
    accountFilter,
    setAccountFilter,
    periodDays,
    setPeriodDays,
    sort,
    changeSort,
  };
}

function useAuditQueryScope(state: AuditFilterState): AuditQueryScope {
  const debouncedSearch = useDebouncedValue(state.search);
  const debouncedKeyFilter = useDebouncedValue(state.keyFilter);
  const debouncedAccountFilter = useDebouncedValue(state.accountFilter);
  const period = toPeriodValue(state.periodDays);
  const cursorScope = useMemo(
    () =>
      JSON.stringify([
        state.pageSize,
        debouncedSearch,
        state.modelFilter,
        state.statusFilter,
        state.modeFilter,
        debouncedKeyFilter,
        debouncedAccountFilter,
        period,
        state.sort.field,
        state.sort.order,
      ]),
    [
      state.pageSize,
      debouncedSearch,
      state.modelFilter,
      state.statusFilter,
      state.modeFilter,
      debouncedKeyFilter,
      debouncedAccountFilter,
      period,
      state.sort.field,
      state.sort.order,
    ],
  );
  return { debouncedSearch, debouncedKeyFilter, debouncedAccountFilter, period, cursorScope };
}

function useAuditCursor(scope: string): AuditCursorControls {
  const [state, setState] = useState<{ scope: string; values: string[] }>(() => ({ scope, values: [""] }));
  if (state.scope !== scope) {
    setState({ scope, values: [""] });
  }
  const values = state.scope === scope ? state.values : [""];
  const update = useCallback(
    (next: (values: string[]) => string[]): void => {
      setState((current) => ({ scope, values: next(current.scope === scope ? current.values : [""]) }));
    },
    [scope],
  );
  const goToFirstPage = useCallback((): void => update(() => [""]), [update]);
  const goToPreviousPage = useCallback(
    (): void => update((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    [update],
  );
  const pushCursor = useCallback(
    (next: string): void => {
      if (next) update((current) => [...current, next]);
    },
    [update],
  );
  return { cursors: values, cursor: values[values.length - 1], goToFirstPage, goToPreviousPage, pushCursor };
}

function useAuditPageQuery(state: AuditFilterState, scope: AuditQueryScope, cursor: string): AuditPageQuery {
  const query = useQuery({
    queryKey: ["request-audits", "cursor", scope.cursorScope, cursor],
    queryFn: ({ signal }) =>
      getRequestAudits(
        {
          cursor,
          pageSize: state.pageSize,
          search: scope.debouncedSearch,
          model: state.modelFilter,
          status: state.statusFilter,
          mode: state.modeFilter,
          key: scope.debouncedKeyFilter,
          account: scope.debouncedAccountFilter,
          period: scope.period,
          sortBy: state.sort.field,
          sortOrder: state.sort.order,
        },
        signal,
      ),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === scope.cursorScope ? previous : undefined,
    gcTime: AUDIT_PAGE_CACHE_TIME_MS,
    structuralSharing: false,
  });
  return {
    nextCursor: query.data?.nextCursor ?? "",
    refetch: () => query.refetch(),
    query: {
      data: query.data,
      isPending: query.isPending,
      isFetching: query.isFetching,
      isError: query.isError,
      error: query.error,
      isPlaceholderData: query.isPlaceholderData,
      refetch: () => query.refetch(),
    },
  };
}

function useAuditSummaryQuery(
  state: AuditFilterState,
  scope: AuditQueryScope,
  forceRefreshRef: { current: boolean },
): AuditSummaryQuery {
  const query = useQuery({
    queryKey: [
      "request-audits",
      "summary",
      scope.debouncedSearch,
      state.modelFilter,
      state.statusFilter,
      state.modeFilter,
      scope.debouncedKeyFilter,
      scope.debouncedAccountFilter,
      scope.period,
    ],
    queryFn: ({ signal }) =>
      getRequestAuditSummary(
        {
          search: scope.debouncedSearch,
          model: state.modelFilter,
          status: state.statusFilter,
          mode: state.modeFilter,
          key: scope.debouncedKeyFilter,
          account: scope.debouncedAccountFilter,
          period: scope.period,
        },
        forceRefreshRef.current,
        signal,
      ),
    placeholderData: (previous) => previous,
    gcTime: AUDIT_SUMMARY_CACHE_TIME_MS,
  });
  return {
    refetch: () => query.refetch(),
    query: {
      data: query.data,
      isPending: query.isPending,
      isFetching: query.isFetching,
      isPlaceholderData: query.isPlaceholderData,
    },
  };
}

function useAuditModelOptions(): Array<{ value: string; label: string }> {
  const query = useQuery({
    queryKey: ["models", "audit-filter"],
    queryFn: () => listModels({ page: 1, pageSize: 100 }),
    staleTime: 60_000,
  });
  return useMemo(
    () => [
      ...new Map(
        (query.data?.items ?? []).map((model) => [model.publicId, { value: model.publicId, label: model.publicId }]),
      ).values(),
    ],
    [query.data?.items],
  );
}

function useAuditManualRefresh(
  forceRefreshRef: { current: boolean },
  refetchPage: () => Promise<unknown>,
  refetchSummary: () => Promise<unknown>,
): AuditRefreshState {
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const refreshAll = useCallback((): void => {
    setManualRefreshing(true);
    forceRefreshRef.current = true;
    void Promise.all([
      refetchPage(),
      refetchSummary(),
      new Promise<void>((resolve) => window.setTimeout(resolve, AUDIT_MANUAL_REFRESH_MIN_MS)),
    ]).finally(() => {
      forceRefreshRef.current = false;
      setManualRefreshing(false);
    });
  }, [forceRefreshRef, refetchPage, refetchSummary]);
  return { manualRefreshing, refreshAll };
}

export function useAuditList(): AuditListController {
  const filters = useAuditFilterState();
  const scope = useAuditQueryScope(filters);
  const forceSummaryRefresh = useRef(false);
  const [selectedAudit, setSelectedAudit] = useState<AuditDTO | null>(null);
  const { cursor, ...cursorControls } = useAuditCursor(scope.cursorScope);
  const page = useAuditPageQuery(filters, scope, cursor);
  const summary = useAuditSummaryQuery(filters, scope, forceSummaryRefresh);
  const modelOptions = useAuditModelOptions();
  const refresh = useAuditManualRefresh(forceSummaryRefresh, page.refetch, summary.refetch);
  const goToNextPage = useCallback(
    (): void => cursorControls.pushCursor(page.nextCursor),
    [cursorControls, page.nextCursor],
  );
  return {
    ...filters,
    ...cursorControls,
    ...refresh,
    auditsQuery: page.query,
    summaryQuery: summary.query,
    modelOptions,
    selectedAudit,
    setSelectedAudit,
    nextCursor: page.nextCursor,
    goToNextPage,
  };
}
