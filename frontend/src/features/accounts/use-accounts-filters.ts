import { useState } from "react";

import type {
  AccountFilterChange,
  AccountFilterChanges,
  AccountFilterValues,
} from "@/features/accounts/accounts-filter-descriptors";
import type { AccountProvider } from "@/features/accounts/accounts-dto";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";

export type AccountsScopeState = {
  provider: AccountProvider;
  page: number;
  pageSize: number;
  sort: TableSort;
  setPage: (page: number) => void;
  changePageSize: (value: number) => void;
  changeSort: (field: string, initialOrder: SortOrder) => void;
  selectProvider: (value: AccountProvider) => void;
};

/** provider / 分页 / 排序：切换账号池必须回到第 1 页。 */
export function useAccountsScopeState(): AccountsScopeState {
  const [provider, setProvider] = useState<AccountProvider>("grok_build");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<TableSort>({ field: "createdAt", order: "desc" });
  const changeSort = (field: string, initialOrder: SortOrder): void => {
    setSort((current) => nextTableSort(current, field, initialOrder));
    setPage(1);
  };
  const changePageSize = (value: number): void => {
    setPageSize(value);
    setPage(1);
  };
  const selectProvider = (value: AccountProvider): void => {
    setProvider(value);
    setPage(1);
  };
  return { provider, page, pageSize, sort, setPage, changePageSize, changeSort, selectProvider };
}

export type AccountsListFilterState = {
  search: string;
  setSearch: (value: string) => void;
  debouncedSearch: string;
  typeFilter: string;
  setTypeFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  renewalFilter: string;
  setRenewalFilter: (value: string) => void;
  riskFilter: string;
  setRiskFilter: (value: string) => void;
  agreementFilter: string;
  setAgreementFilter: (value: string) => void;
  associationFilter: string;
  setAssociationFilter: (value: string) => void;
  resetForProvider: () => void;
};

/** 账号池相关筛选：搜索词保留，其余维度属于上一个池的作用域。 */
export function useAccountsListFilterState(): AccountsListFilterState {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [renewalFilter, setRenewalFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [agreementFilter, setAgreementFilter] = useState("");
  const [associationFilter, setAssociationFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const resetForProvider = (): void => {
    setTypeFilter("");
    setStatusFilter("");
    setRenewalFilter("");
    setRiskFilter("");
    setAgreementFilter("");
    setAssociationFilter("");
  };
  return {
    search,
    setSearch,
    debouncedSearch,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    renewalFilter,
    setRenewalFilter,
    riskFilter,
    setRiskFilter,
    agreementFilter,
    setAgreementFilter,
    associationFilter,
    setAssociationFilter,
    resetForProvider,
  };
}

export type AccountsEgressFilterState = {
  egressFilter: string;
  setEgressFilter: (value: string) => void;
  egressFilterSelectedLabel: string;
  setEgressFilterSelectedLabel: (value: string) => void;
  egressFilterOptionsOpen: boolean;
  setEgressFilterOptionsOpen: (open: boolean) => void;
  egressFilterOptionsSearch: string;
  setEgressFilterOptionsSearch: (value: string) => void;
  debouncedEgressFilterOptionsSearch: string;
  resetForProvider: () => void;
};

/** 出口筛选：节点/订阅源的收窄值只对当前账号池有效。 */
export function useAccountsEgressFilterState(): AccountsEgressFilterState {
  const [egressFilter, setEgressFilter] = useState("");
  const [egressFilterSelectedLabel, setEgressFilterSelectedLabel] = useState("");
  const [egressFilterOptionsOpen, setEgressFilterOptionsOpen] = useState(false);
  const [egressFilterOptionsSearch, setEgressFilterOptionsSearch] = useState("");
  const debouncedEgressFilterOptionsSearch = useDebouncedValue(egressFilterOptionsSearch);
  const resetForProvider = (): void => {
    setEgressFilter((current) => (current.includes(":") ? "bound" : current));
    setEgressFilterSelectedLabel("");
    setEgressFilterOptionsOpen(false);
    setEgressFilterOptionsSearch("");
  };
  return {
    egressFilter,
    setEgressFilter,
    egressFilterSelectedLabel,
    setEgressFilterSelectedLabel,
    egressFilterOptionsOpen,
    setEgressFilterOptionsOpen,
    egressFilterOptionsSearch,
    setEgressFilterOptionsSearch,
    debouncedEgressFilterOptionsSearch,
    resetForProvider,
  };
}

export type AccountsFiltersModel = AccountsScopeState &
  AccountsListFilterState &
  AccountsEgressFilterState & {
    changeProvider: (value: AccountProvider) => void;
    changeSearch: AccountFilterChange;
    filterValues: AccountFilterValues;
    filterChanges: AccountFilterChanges;
  };

/** 组合三层筛选状态，并把每次筛选变化统一收敛为“回到第 1 页”。 */
export function useAccountsFilters(): AccountsFiltersModel {
  const scope = useAccountsScopeState();
  const list = useAccountsListFilterState();
  const egress = useAccountsEgressFilterState();
  const changeProvider = (value: AccountProvider): void => {
    scope.selectProvider(value);
    list.resetForProvider();
    egress.resetForProvider();
  };
  const withPageReset =
    (setter: (value: string) => void): AccountFilterChange =>
    (value) => {
      setter(value);
      scope.setPage(1);
    };
  return {
    ...scope,
    ...list,
    ...egress,
    changeProvider,
    changeSearch: withPageReset(list.setSearch),
    filterValues: {
      type: list.typeFilter,
      status: list.statusFilter,
      egress: egress.egressFilter,
      egressSelectedLabel: egress.egressFilterSelectedLabel,
      renewal: list.renewalFilter,
      risk: list.riskFilter,
      agreement: list.agreementFilter,
      association: list.associationFilter,
    },
    filterChanges: {
      type: withPageReset(list.setTypeFilter),
      status: withPageReset(list.setStatusFilter),
      egress: withPageReset(egress.setEgressFilter),
      renewal: withPageReset(list.setRenewalFilter),
      risk: withPageReset(list.setRiskFilter),
      agreement: withPageReset(list.setAgreementFilter),
      association: withPageReset(list.setAssociationFilter),
    },
  };
}
