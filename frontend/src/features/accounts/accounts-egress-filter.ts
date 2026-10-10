import type { DataTableFilterOptionGroup } from "@/shared/components/data-table-filters";

import type { AccountProvider } from "@/features/accounts/accounts-dto";
import type { Translate } from "@/features/accounts/accounts-view-model";
import type { EgressScope } from "@/features/settings/settings-api";

/** 出口筛选选项的单页大小：节点与订阅源都以有界分页加载，避免大出口池灌满页面。 */
export const EGRESS_FILTER_NODE_PAGE_SIZE = 100;
export const EGRESS_FILTER_SOURCE_PAGE_SIZE = 100;

/** 账号池主作用域与 provider 一一对应；Console 额外接受 Grok Web 出口。 */
export function accountProviderPrimaryEgressScope(provider: AccountProvider): EgressScope {
  return provider;
}

export function scopeSupportsAccountProvider(scope: EgressScope, provider: AccountProvider): boolean {
  if (provider === "grok_build") return scope === "grok_build";
  if (provider === "grok_web") return scope === "grok_web";
  return scope === "grok_web" || scope === "grok_console";
}

export type EgressOptionEntry = { id: string; name: string; scope: EgressScope };

/** 合并分页结果，只保留当前账号池可用且匹配搜索词的选项。 */
export function collectScopedEgressOptions<T extends EgressOptionEntry>(
  pages: T[][],
  provider: AccountProvider,
  searchTerm: string,
): T[] {
  const term = searchTerm.trim().toLocaleLowerCase();
  return pages
    .flatMap((page) => page)
    .filter((entry) => scopeSupportsAccountProvider(entry.scope, provider))
    .filter((entry) => !term || entry.name.toLocaleLowerCase().includes(term));
}

/** 已选中的具体节点/订阅源需要回显名称；分组里找不到就退回空标签。 */
export function resolveEgressFilterLabel(groups: DataTableFilterOptionGroup[], value: string): string {
  if (!value.includes(":")) return "";
  for (const group of groups) {
    const match = group.options.find((option) => option.value === value);
    if (match) return match.label;
  }
  return "";
}

export type EgressFilterPageSource = {
  isFetching: boolean;
  isError: boolean;
  hasNextPage: boolean;
  refetch: () => void;
  fetchNextPage: () => void;
};

/**
 * 分页选项的“加载更多 / 重试”动作：只有全部来源都成功时才继续翻页，
 * 任一来源失败都先重试，避免用户看到半截结果。
 */
export function loadMoreEgressFilterOptions(sources: EgressFilterPageSource[]): void {
  const failed = sources.some((source) => source.isError);
  for (const source of sources) {
    if (source.isError) source.refetch();
  }
  if (failed) return;
  for (const source of sources) {
    if (source.hasNextPage) source.fetchNextPage();
  }
}

export type EgressFilterGroupInput = {
  t: Translate;
  kind: "nodes" | "sources";
  options: Array<{ value: string; label: string }>;
  failed: boolean;
  fetching: boolean;
  hasMore: boolean;
  onAction: () => void;
};

function egressFilterGroupKeys(kind: EgressFilterGroupInput["kind"]) {
  if (kind === "nodes") {
    return {
      labelKey: "accounts.egressNodeGroup",
      emptyKey: "accounts.egressNodeGroupEmpty",
      moreKey: "accounts.egressFilterOptionsLoadMore",
    };
  }
  return {
    labelKey: "accounts.egressSourceGroup",
    emptyKey: "accounts.egressSourceGroupEmpty",
    moreKey: "accounts.egressFilterSourcesLoadMore",
  };
}

function egressFilterActionLabel(input: EgressFilterGroupInput, moreKey: string): string {
  if (input.failed) return input.t("common.retry");
  if (input.fetching) return input.t("common.loading");
  return input.t(moreKey);
}

function egressFilterEmptyLabel(input: EgressFilterGroupInput, emptyKey: string): string {
  if (input.failed) return input.t("accounts.egressFilterOptionsLoadFailed");
  if (input.fetching) return input.t("common.loading");
  return input.t(emptyKey);
}

export function buildEgressFilterGroup(input: EgressFilterGroupInput): DataTableFilterOptionGroup {
  const keys = egressFilterGroupKeys(input.kind);
  return {
    id: input.kind,
    label: input.t(keys.labelKey),
    emptyLabel: egressFilterEmptyLabel(input, keys.emptyKey),
    options: input.options.map((option) => ({ ...option })),
    loading: input.fetching,
    hasMore: input.hasMore,
    actionLabel: egressFilterActionLabel(input, keys.moreKey),
    onAction: input.onAction,
  };
}

/** 出口选项分页的“下一页”判定：按 page*pageSize 与 total 比较。 */
export function nextEgressFilterPage(lastPage: { page: number; pageSize: number; total: number }): number | undefined {
  return lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined;
}
