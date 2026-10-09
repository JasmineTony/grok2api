import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { updateAccountsEnabled } from "@/features/accounts/accounts-api";
import {
  getDegradeAccounts,
  type DegradeAccountDTO,
  type DegradeClass,
  type DegradeSummaryDTO,
  type DegradeWindow,
} from "@/features/quality-guard/quality-guard-api";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";

// 降级账号 tab 的筛选/分页状态、汇总查询与「批量停用」mutation。
// 查询 key、15s 轮询与失效语义与拆分前一致；筛选条件变化一律回到第 1 页并清空选择。

const MUTE_TOAST_ID = "quality-guard-degrade-mute";

export type DegradeStatusFilter = "all" | "enabled" | "disabled" | "deleted";

export type DegradeFilters = {
  period: DegradeWindow;
  search: string;
  status: DegradeStatusFilter;
  cls: "all" | DegradeClass;
  hitsMin: number;
  page: number;
  pageSize: number;
  debouncedSearch: string;
  setPeriod: (value: DegradeWindow) => void;
  setSearch: (value: string) => void;
  setStatus: (value: DegradeStatusFilter) => void;
  setCls: (value: "all" | DegradeClass) => void;
  setHitsMin: (value: number) => void;
  setPage: (value: number) => void;
  setPageSize: (value: number) => void;
};

export type DegradeThresholds = {
  softTPS?: number;
  hardTPS?: number;
  failClosed?: boolean;
  minGenMs?: number;
};

export type DegradeAccountsController = {
  query: UseQueryResult<DegradeSummaryDTO, Error>;
  rows: DegradeAccountDTO[];
  selectable: DegradeAccountDTO[];
  selectedRows: DegradeAccountDTO[];
  selected: Set<string>;
  allSelected: boolean;
  busy: boolean;
  filters: DegradeFilters;
  toggleRow: (id: string, checked?: boolean) => void;
  toggleAll: (checked: boolean) => void;
  muteSelected: (ids: string[]) => void;
};

function useDegradeFilters(onFilterChange: () => void): DegradeFilters {
  const [period, setPeriodState] = useState<DegradeWindow>("24h");
  const [search, setSearchState] = useState("");
  const [status, setStatusState] = useState<DegradeStatusFilter>("all");
  const [cls, setClsState] = useState<"all" | DegradeClass>("all");
  const [hitsMin, setHitsMinState] = useState(1);
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(50);
  const debouncedSearch = useDebouncedValue(search);

  const applyFilterChange = (update: () => void) => {
    update();
    setPageState(1);
    onFilterChange();
  };

  return {
    period,
    search,
    status,
    cls,
    hitsMin,
    page,
    pageSize,
    debouncedSearch,
    setPeriod: (value) => applyFilterChange(() => setPeriodState(value)),
    setSearch: (value) => applyFilterChange(() => setSearchState(value)),
    setStatus: (value) => applyFilterChange(() => setStatusState(value)),
    setCls: (value) => applyFilterChange(() => setClsState(value)),
    setHitsMin: (value) => applyFilterChange(() => setHitsMinState(value)),
    setPage: (value) => {
      setPageState(value);
      onFilterChange();
    },
    setPageSize: (value) => applyFilterChange(() => setPageSizeState(value)),
  };
}

function useDegradeQuery(thresholds: DegradeThresholds, filters: DegradeFilters) {
  const { softTPS, hardTPS, failClosed, minGenMs } = thresholds;
  return useQuery({
    queryKey: [
      "quality-guard-degrade-accounts",
      filters.period,
      softTPS,
      hardTPS,
      failClosed,
      minGenMs,
      filters.debouncedSearch,
      filters.status,
      filters.cls,
      filters.hitsMin,
      filters.page,
      filters.pageSize,
    ],
    queryFn: () =>
      getDegradeAccounts({
        window: filters.period,
        softTPS,
        hardTPS,
        failClosed,
        minGenMs,
        search: filters.debouncedSearch || undefined,
        status: filters.status === "all" ? undefined : filters.status,
        class: filters.cls === "all" ? undefined : filters.cls,
        minHits: filters.hitsMin,
        page: filters.page,
        pageSize: filters.pageSize,
      }),
    refetchInterval: 15_000,
  });
}

function useDegradeMute(clearSelection: () => void) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (ids: string[]) => updateAccountsEnabled(ids, false, "grok_build"),
    onMutate: () => toast.loading(t("qualityGuard.degrade.muting"), { id: MUTE_TOAST_ID }),
    onSuccess: (_, ids) => {
      clearSelection();
      void queryClient.invalidateQueries({ queryKey: ["quality-guard-degrade-accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success(t("qualityGuard.degrade.muted", { count: ids.length }), { id: MUTE_TOAST_ID });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("qualityGuard.degrade.muteFailed"), {
        id: MUTE_TOAST_ID,
      }),
  });
  return { muteSelected: mutation.mutate, busy: mutation.isPending };
}

export function useDegradeAccounts(thresholds: DegradeThresholds): DegradeAccountsController {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const filters = useDegradeFilters(clearSelection);
  const query = useDegradeQuery(thresholds, filters);
  const { muteSelected, busy } = useDegradeMute(clearSelection);

  const rows = useMemo(() => query.data?.accounts ?? [], [query.data?.accounts]);
  const selectable = useMemo(() => rows.filter((account) => account.found && account.enabled), [rows]);
  const selectedRows = selectable.filter((account) => selected.has(account.id));

  const toggleRow = (id: string, checked?: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      const shouldSelect = checked ?? !next.has(id);
      if (shouldSelect) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleAll = (checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      selectable.forEach((account) => {
        if (checked) next.add(account.id);
        else next.delete(account.id);
      });
      return next;
    });

  return {
    query,
    rows,
    selectable,
    selectedRows,
    selected,
    allSelected: selectable.length > 0 && selectedRows.length === selectable.length,
    busy,
    filters,
    toggleRow,
    toggleAll,
    muteSelected,
  };
}
