import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useEgressSourcesFilters } from "@/features/settings/use-egress-sources-filters";

// TEST-2：自定义 hook 的分支与函数必须全部被驱动，因此每个变更入口都要有断言。
describe("useEgressSourcesFilters", () => {
  it("默认无筛选、每页 20 条且停在第 1 页", () => {
    const { result } = renderHook(() => useEgressSourcesFilters());

    expect(result.current).toMatchObject({ search: "", scopeFilter: "", pageSize: 20, page: 1 });
  });

  it("改变搜索、作用域或每页条数后都回到第 1 页", () => {
    const { result } = renderHook(() => useEgressSourcesFilters());

    act(() => result.current.changePage(3));
    expect(result.current.page).toBe(3);

    act(() => result.current.changeSearch("主力"));
    expect(result.current.search).toBe("主力");
    expect(result.current.page).toBe(1);

    act(() => result.current.changePage(2));
    act(() => result.current.changeScopeFilter("grok_web"));
    expect(result.current.scopeFilter).toBe("grok_web");
    expect(result.current.page).toBe(1);

    act(() => result.current.changePage(2));
    act(() => result.current.changePageSize(100));
    expect(result.current.pageSize).toBe(100);
    expect(result.current.page).toBe(1);
  });

  it("resetPage 只回到第 1 页，保留已选筛选条件", () => {
    const { result } = renderHook(() => useEgressSourcesFilters());
    act(() => result.current.changeSearch("主力"));
    act(() => result.current.changeScopeFilter("grok_web"));
    act(() => result.current.changePageSize(100));
    act(() => result.current.changePage(4));
    expect(result.current.page).toBe(4);

    act(() => result.current.resetPage());

    expect(result.current.page).toBe(1);
    expect(result.current).toMatchObject({ search: "主力", scopeFilter: "grok_web", pageSize: 100 });
  });
});
