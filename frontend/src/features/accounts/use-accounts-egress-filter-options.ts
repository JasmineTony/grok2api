import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { DataTableFilterOptionGroup } from "@/shared/components/data-table-filters";

import {
  EGRESS_FILTER_NODE_PAGE_SIZE,
  EGRESS_FILTER_SOURCE_PAGE_SIZE,
  accountProviderPrimaryEgressScope,
  buildEgressFilterGroup,
  collectScopedEgressOptions,
  loadMoreEgressFilterOptions,
  nextEgressFilterPage,
  type EgressOptionEntry,
  type EgressFilterGroupInput,
  type EgressFilterPageSource,
} from "@/features/accounts/accounts-egress-filter";
import type { AccountProvider } from "@/features/accounts/accounts-dto";
import type { Translate } from "@/features/accounts/accounts-view-model";
import { listEgressNodes, listEgressSources, type EgressScope } from "@/features/settings/settings-api";

export type EgressFilterOptionsInput = { open: boolean; provider: AccountProvider; search: string };

/** Build/资产节点与 Console 原生出口各自分页，互不占用对方的结果页。 */
function useNodeFilterOptions(input: {
  open: boolean;
  provider: AccountProvider;
  search: string;
  primaryScope: EgressScope;
}) {
  const consoleEnabled = input.provider === "grok_console";
  const primary = useInfiniteQuery({
    queryKey: ["egress-nodes", "account-filter", input.primaryScope, input.search],
    queryFn: ({ pageParam }) =>
      listEgressNodes({
        page: pageParam,
        pageSize: EGRESS_FILTER_NODE_PAGE_SIZE,
        search: input.search,
        scope: input.primaryScope,
      }),
    initialPageParam: 1,
    getNextPageParam: nextEgressFilterPage,
    enabled: input.open,
    staleTime: 60_000,
  });
  const consoleWeb = useInfiniteQuery({
    queryKey: ["egress-nodes", "account-filter", "console-web", input.search],
    queryFn: ({ pageParam }) =>
      listEgressNodes({
        page: pageParam,
        pageSize: EGRESS_FILTER_NODE_PAGE_SIZE,
        search: input.search,
        scope: "grok_web",
      }),
    initialPageParam: 1,
    getNextPageParam: nextEgressFilterPage,
    enabled: input.open && consoleEnabled,
    staleTime: 60_000,
  });
  return { primary, consoleWeb, consoleEnabled };
}

function useSourceFilterOptions(input: {
  open: boolean;
  provider: AccountProvider;
  search: string;
  primaryScope: EgressScope;
}) {
  const consoleEnabled = input.provider === "grok_console";
  const primary = useInfiniteQuery({
    queryKey: ["egress-sources", "account-filter", input.primaryScope, input.search],
    queryFn: ({ pageParam }) =>
      listEgressSources({
        page: pageParam,
        pageSize: EGRESS_FILTER_SOURCE_PAGE_SIZE,
        search: input.search,
        scope: input.primaryScope,
      }),
    initialPageParam: 1,
    getNextPageParam: nextEgressFilterPage,
    enabled: input.open,
    staleTime: 60_000,
  });
  const consoleWeb = useInfiniteQuery({
    queryKey: ["egress-sources", "account-filter", "console-web", input.search],
    queryFn: ({ pageParam }) =>
      listEgressSources({
        page: pageParam,
        pageSize: EGRESS_FILTER_SOURCE_PAGE_SIZE,
        search: input.search,
        scope: "grok_web",
      }),
    initialPageParam: 1,
    getNextPageParam: nextEgressFilterPage,
    enabled: input.open && consoleEnabled,
    staleTime: 60_000,
  });
  return { primary, consoleWeb, consoleEnabled };
}

function pageItems<T>(pages: Array<{ items: T[] }> | undefined): T[][] {
  return (pages ?? []).map((page) => page.items);
}

function activeSources(
  primary: EgressFilterPageSource,
  extra: EgressFilterPageSource,
  enabled: boolean,
): EgressFilterPageSource[] {
  return enabled ? [primary, extra] : [primary];
}

type EgressOptionSources = {
  primary: EgressFilterPageSource;
  consoleWeb: EgressFilterPageSource;
  consoleEnabled: boolean;
};
type EgressScopedEntry = EgressOptionEntry;

function filterSourceFlag(sources: EgressOptionSources, read: (source: EgressFilterPageSource) => boolean): boolean {
  return read(sources.primary) || (sources.consoleEnabled && read(sources.consoleWeb));
}

function egressGroupInput(input: {
  t: Translate;
  provider: AccountProvider;
  search: string;
  sources: EgressOptionSources;
  pages: EgressScopedEntry[][];
  kind: "nodes" | "sources";
}): EgressFilterGroupInput {
  const failed = filterSourceFlag(input.sources, (source) => source.isError);
  return {
    t: input.t,
    kind: input.kind,
    options: collectScopedEgressOptions(input.pages, input.provider, input.search).map((entry) => ({
      value: `${input.kind === "nodes" ? "node" : "source"}:${entry.id}`,
      label: entry.name,
    })),
    failed,
    fetching: filterSourceFlag(input.sources, (source) => source.isFetching),
    hasMore: failed || filterSourceFlag(input.sources, (source) => source.hasNextPage),
    onAction: () =>
      loadMoreEgressFilterOptions(
        activeSources(input.sources.primary, input.sources.consoleWeb, input.sources.consoleEnabled),
      ),
  };
}

/** 出口筛选的三级菜单选项：节点与订阅源各自分页，只加载当前账号池可用项。 */
export function useAccountsEgressFilterGroups(input: EgressFilterOptionsInput): DataTableFilterOptionGroup[] {
  const { t } = useTranslation();
  const primaryScope = accountProviderPrimaryEgressScope(input.provider);
  const nodes = useNodeFilterOptions({ ...input, primaryScope });
  const sources = useSourceFilterOptions({ ...input, primaryScope });
  const nodePages = [
    ...pageItems(nodes.primary.data?.pages),
    ...(nodes.consoleEnabled ? pageItems(nodes.consoleWeb.data?.pages) : []),
  ];
  const sourcePages = [
    ...pageItems(sources.primary.data?.pages),
    ...(sources.consoleEnabled ? pageItems(sources.consoleWeb.data?.pages) : []),
  ];
  return [
    buildEgressFilterGroup(
      egressGroupInput({
        t,
        provider: input.provider,
        search: input.search,
        sources: nodes,
        pages: nodePages,
        kind: "nodes",
      }),
    ),
    buildEgressFilterGroup(
      egressGroupInput({
        t,
        provider: input.provider,
        search: input.search,
        sources: sources,
        pages: sourcePages,
        kind: "sources",
      }),
    ),
  ];
}
