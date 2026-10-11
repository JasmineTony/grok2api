import { emptyEgressSource, type EgressSourceForm } from "@/features/settings/egress-source-form";
import type { EgressSourceDTO, EgressSourceInput } from "@/entities/egress/egress-dto";

/** 订阅源列表的筛选与分页条件。 */
export type EgressSourcesListQuery = {
  search: string;
  scopeFilter: string;
  pageSize: number;
  page: number;
};

export type EgressSourcesPage = {
  filtered: EgressSourceDTO[];
  currentPage: number;
  items: EgressSourceDTO[];
  hasActiveFilters: boolean;
};

/** 打开弹窗时的表单初值：编辑态沿用已配置代理与容量，URL 留空等待重填。 */
export function sourceFormFor(value?: EgressSourceDTO): EgressSourceForm {
  if (!value) return emptyEgressSource;
  return {
    name: value.name,
    scope: value.scope,
    enabled: value.enabled,
    url: "",
    refreshIntervalSeconds: value.refreshIntervalSeconds,
    proxyEnabled: value.proxyConfigured,
    proxyURL: "",
    defaultAccountCapacity: value.defaultAccountCapacity,
  };
}

/** 表单 → 写入载荷：URL/代理留空表示不修改，关闭代理开关时显式请求清除。 */
export function sourceInputFrom(form: EgressSourceForm, editing: EgressSourceDTO | null): EgressSourceInput {
  return {
    name: form.name,
    scope: form.scope,
    enabled: form.enabled,
    url: form.url.trim() || undefined,
    proxyURL: form.proxyEnabled ? form.proxyURL.trim() || undefined : undefined,
    clearProxyURL: Boolean(editing?.proxyConfigured && !form.proxyEnabled),
    refreshIntervalSeconds: form.refreshIntervalSeconds,
    defaultAccountCapacity: form.defaultAccountCapacity,
  };
}

/** 按搜索与作用域筛选后切出当前页；页码越界时回落到最后一页。 */
export function paginateSources(sources: EgressSourceDTO[], query: EgressSourcesListQuery): EgressSourcesPage {
  const normalizedSearch = query.search.trim().toLocaleLowerCase();
  const filtered = sources.filter((source) => {
    if (normalizedSearch && !source.name.toLocaleLowerCase().includes(normalizedSearch)) return false;
    return !query.scopeFilter || source.scope === query.scopeFilter;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / query.pageSize));
  const currentPage = Math.min(query.page, pageCount);
  return {
    filtered,
    currentPage,
    items: filtered.slice((currentPage - 1) * query.pageSize, currentPage * query.pageSize),
    hasActiveFilters: Boolean(normalizedSearch || query.scopeFilter),
  };
}
