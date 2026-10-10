import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback } from "react";

import { getAccountSummary, listAccounts, type AccountDTO } from "@/features/accounts/accounts-api";
import type { AccountsFiltersModel } from "@/features/accounts/use-accounts-filters";
import type { PaginatedDTO } from "@/shared/api/client";

export type AccountsListQuery = {
  query: UseQueryResult<PaginatedDTO<AccountDTO>, Error>;
  result: PaginatedDTO<AccountDTO> | undefined;
  pageIds: string[];
};

function buildListAccountsInput(filters: AccountsFiltersModel, provider: AccountsFiltersModel["provider"]) {
  return {
    provider,
    page: filters.page,
    pageSize: filters.pageSize,
    search: filters.debouncedSearch,
    type: filters.typeFilter,
    status: filters.statusFilter,
    egress: filters.egressFilter,
    renewal: provider === "grok_build" ? filters.renewalFilter : undefined,
    risk: provider === "grok_build" ? filters.riskFilter : undefined,
    agreement: provider === "grok_web" ? filters.agreementFilter : undefined,
    association: filters.associationFilter || undefined,
    sortBy: filters.sort.field,
    sortOrder: filters.sort.order,
  };
}

export function useAccountsListQuery(filters: AccountsFiltersModel): AccountsListQuery {
  const provider = filters.provider;
  const query = useQuery({
    queryKey: [
      "accounts",
      provider,
      filters.page,
      filters.pageSize,
      filters.debouncedSearch,
      filters.typeFilter,
      filters.statusFilter,
      filters.egressFilter,
      filters.renewalFilter,
      filters.riskFilter,
      filters.agreementFilter,
      filters.associationFilter,
      filters.sort.field,
      filters.sort.order,
    ],
    queryFn: () => listAccounts(buildListAccountsInput(filters, provider)),
  });
  const result = query.data;
  return { query, result, pageIds: result?.items.map((account) => account.id) ?? [] };
}

export function useAccountSummaryQuery() {
  return useQuery({ queryKey: ["accounts", "summary"], queryFn: getAccountSummary });
}

/** 账号与总览共用同一个失效入口，避免各处漏刷其中一侧。 */
export function useAccountInvalidation(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["accounts", "summary"] });
  }, [queryClient]);
}
