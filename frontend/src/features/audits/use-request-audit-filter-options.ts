import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";

import {
  type AuditDTO,
  listAuditAccountFilterOptions,
  listAuditClientKeyFilterOptions,
} from "@/features/audits/request-audits-api";
import type { ApiClient } from "@/shared/api/client";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";

const FILTER_PAGE_SIZE = 50;
const FILTER_MAX_HEIGHT = "max-h-56 overflow-y-auto py-0.5";

function filterOptionSearch(value: string): string {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? `#${trimmed}` : trimmed;
}

function providerShortLabel(provider: AuditDTO["provider"]): string {
  switch (provider) {
    case "grok_build":
      return "Build";
    case "grok_web":
      return "Web";
    case "grok_console":
      return "Console";
  }
}

export function useRequestAuditFilterOptions({
  apiClient,
  keyOpen,
  accountOpen,
  keySearch,
  accountSearch,
  t,
}: {
  apiClient: ApiClient;
  keyOpen: boolean;
  accountOpen: boolean;
  keySearch: string;
  accountSearch: string;
  t: TFunction;
}) {
  const debouncedKeySearch = useDebouncedValue(keySearch);
  const debouncedAccountSearch = useDebouncedValue(accountSearch);
  const keyQuery = useQuery({
    queryKey: ["client-keys", "audit-filter", debouncedKeySearch],
    queryFn: () =>
      listAuditClientKeyFilterOptions(apiClient, {
        pageSize: FILTER_PAGE_SIZE,
        search: filterOptionSearch(debouncedKeySearch),
      }),
    enabled: keyOpen,
    staleTime: 60_000,
  });
  const accountQuery = useQuery({
    queryKey: ["accounts", "audit-filter", debouncedAccountSearch],
    queryFn: () =>
      listAuditAccountFilterOptions(apiClient, {
        pageSize: FILTER_PAGE_SIZE,
        search: filterOptionSearch(debouncedAccountSearch),
      }),
    enabled: accountOpen,
    staleTime: 60_000,
  });
  const keys = keyQuery.data?.items ?? [];
  const accounts = accountQuery.data?.items ?? [];
  const keyGroups = [
    {
      id: "keys",
      label: t("audits.key"),
      emptyLabel: keyQuery.isError
        ? t("audits.filterOptionsLoadFailed")
        : keyQuery.isFetching
          ? t("common.loading")
          : t("audits.filterOptionsEmpty"),
      options: keys.map((key) => ({
        value: String(key.id),
        label: key.name || key.prefix,
        description: `#${key.id} · ${key.prefix}`,
      })),
      loading: keyQuery.isFetching,
      hasMore: keyQuery.isError,
      actionLabel: t("common.retry"),
      onAction: () => void keyQuery.refetch(),
      ...(!keyQuery.isError && (keyQuery.data?.total ?? 0) > keys.length
        ? { noteLabel: t("audits.filterOptionsTruncated") }
        : {}),
      hideLabel: true,
      maxHeightClassName: FILTER_MAX_HEIGHT,
    },
  ];
  const accountGroups = [
    {
      id: "accounts",
      label: t("audits.account"),
      emptyLabel: accountQuery.isError
        ? t("audits.filterOptionsLoadFailed")
        : accountQuery.isFetching
          ? t("common.loading")
          : t("audits.filterOptionsEmpty"),
      options: accounts.map((account) => ({
        value: String(account.id),
        label: account.name || account.email || `#${account.id}`,
        description: `#${account.id}`,
        badge: providerShortLabel(account.provider),
      })),
      loading: accountQuery.isFetching,
      hasMore: accountQuery.isError,
      actionLabel: t("common.retry"),
      onAction: () => void accountQuery.refetch(),
      ...(!accountQuery.isError && (accountQuery.data?.total ?? 0) > accounts.length
        ? { noteLabel: t("audits.filterOptionsTruncated") }
        : {}),
      hideLabel: true,
      maxHeightClassName: FILTER_MAX_HEIGHT,
    },
  ];
  return { keyGroups, accountGroups };
}
