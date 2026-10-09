import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { useModelList, type ModelListController } from "@/features/models/use-model-list";
import { i18n } from "@/shared/i18n";

// useModelList 的行为契约：筛选/分页/排序状态 → 列表请求参数映射，
// 以及“任何条件变更都通知调用方（清空跨页选择）”。只替换网络边界（全局 fetch）。

function queryParam(url: string, name: string): string | null {
  return new URL(url, "http://localhost").searchParams.get(name);
}

function installListApi() {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      return new Response(
        JSON.stringify({
          data: {
            items: [],
            page: Number(queryParam(url, "page") ?? 1),
            pageSize: Number(queryParam(url, "pageSize") ?? 20),
            total: 0,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  return { requests };
}

function lastUrl(requests: string[]): string {
  return requests.at(-1) ?? "";
}

let queryClient: QueryClient;
let onQueryChange: Mock<() => void>;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
}

async function renderList(): Promise<{ current: ModelListController }> {
  const { result } = renderHook(() => useModelList(onQueryChange), { wrapper });
  await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
  return result;
}

beforeEach(() => {
  onQueryChange = vi.fn();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
});

describe("useModelList", () => {
  it("默认请求第 1 页、每页 20 条，且不携带筛选与排序参数", async () => {
    const { requests } = installListApi();
    const result = await renderList();

    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(20);
    expect(requests).toHaveLength(1);
    expect(queryParam(lastUrl(requests), "page")).toBe("1");
    expect(queryParam(lastUrl(requests), "pageSize")).toBe("20");
    for (const name of ["search", "status", "provider", "sortBy", "sortOrder"]) {
      expect(queryParam(lastUrl(requests), name)).toBeNull();
    }
  });

  it("每页条数变更写入 pageSize 并回到第 1 页，同时通知调用方", async () => {
    const { requests } = installListApi();
    const result = await renderList();

    act(() => result.current.setPageSize(100));

    await waitFor(() => expect(queryParam(lastUrl(requests), "pageSize")).toBe("100"));
    expect(queryParam(lastUrl(requests), "page")).toBe("1");
    expect(onQueryChange).toHaveBeenCalledTimes(1);
  });

  it("排序首次使用列默认方向，重复点击同一列切换方向", async () => {
    const { requests } = installListApi();
    const result = await renderList();

    act(() => result.current.changeSort("publicId", "asc"));
    await waitFor(() => expect(queryParam(lastUrl(requests), "sortBy")).toBe("publicId"));
    expect(queryParam(lastUrl(requests), "sortOrder")).toBe("asc");

    act(() => result.current.changeSort("publicId", "asc"));
    await waitFor(() => expect(queryParam(lastUrl(requests), "sortOrder")).toBe("desc"));
    expect(onQueryChange).toHaveBeenCalledTimes(2);
  });

  it("带默认降序的列在首次点击时使用 desc", async () => {
    const { requests } = installListApi();
    const result = await renderList();

    act(() => result.current.changeSort("lastSyncedAt", "desc"));

    await waitFor(() => expect(queryParam(lastUrl(requests), "sortBy")).toBe("lastSyncedAt"));
    expect(queryParam(lastUrl(requests), "sortOrder")).toBe("desc");
  });

  it("搜索、状态与来源筛选都会回到第 1 页并通知调用方", async () => {
    const { requests } = installListApi();
    const result = await renderList();

    act(() => result.current.setStatusFilter("disabled"));
    await waitFor(() => expect(queryParam(lastUrl(requests), "status")).toBe("disabled"));

    act(() => result.current.setProviderFilter("grok_web"));
    await waitFor(() => expect(queryParam(lastUrl(requests), "provider")).toBe("grok_web"));

    act(() => result.current.setSearch("grok-4"));
    await waitFor(() => expect(queryParam(lastUrl(requests), "search")).toBe("grok-4"), { timeout: 3_000 });

    expect(onQueryChange).toHaveBeenCalledTimes(3);
    expect(result.current.statusFilter).toBe("disabled");
    expect(result.current.providerFilter).toBe("grok_web");
    expect(result.current.search).toBe("grok-4");
    expect(queryParam(lastUrl(requests), "page")).toBe("1");
  });

  it("翻页只改页码，不重置页码也不通知调用方以外的影响", async () => {
    const { requests } = installListApi();
    const result = await renderList();

    act(() => result.current.setPage(3));

    await waitFor(() => expect(queryParam(lastUrl(requests), "page")).toBe("3"));
    expect(result.current.page).toBe(3);
    expect(onQueryChange).toHaveBeenCalledTimes(1);
  });
});
