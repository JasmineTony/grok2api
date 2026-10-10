import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelRouteDTO } from "@/entities/model/types";
import {
  auditDTO,
  auditFilterModel,
  auditPage,
  auditSummary,
  createFakeApi,
  type FakeApiCall,
} from "@/features/audits/audit-test-support";
import { useAuditList } from "@/features/audits/use-audit-list";
import { ApiError } from "@/shared/api/client";

// 审计列表 hook 测试（AGENTS.md TEST-2）：只替换网络边界，游标/防抖/刷新状态保持真实实现。
const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

type Routes = {
  list?: (call: FakeApiCall) => unknown;
  summary?: (call: FakeApiCall) => unknown;
  models?: ModelRouteDTO[];
};

function installRoutes(routes: Routes = {}): void {
  apiMock.request.mockImplementation(
    createFakeApi((call) => {
      if (call.path === "/api/admin/v1/request-audits" && call.method === "GET") {
        return routes.list ? routes.list(call) : auditPage([auditDTO({ id: "audit-1" })]);
      }
      if (call.path === "/api/admin/v1/request-audits/summary") {
        return routes.summary ? routes.summary(call) : auditSummary();
      }
      if (call.path === "/api/admin/v1/models") {
        const models = routes.models ?? [];
        return { items: models, page: 1, pageSize: 100, total: models.length };
      }
      throw new ApiError(500, "unexpectedRequest", `未注册的请求：${call.method} ${call.path}`);
    }),
  );
}

function callsOf(path: string): URLSearchParams[] {
  return apiMock.request.mock.calls
    .filter(([called]) => String(called).startsWith(path))
    .map(([called]) => new URLSearchParams(String(called).slice(String(called).indexOf("?") + 1)));
}

function lastQuery(path: string): URLSearchParams {
  const queries = callsOf(path);
  expect(queries.length).toBeGreaterThan(0);
  return queries[queries.length - 1];
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const LIST = "/api/admin/v1/request-audits?";
const SUMMARY = "/api/admin/v1/request-audits/summary?";

beforeEach(() => {
  apiMock.request.mockReset();
});

describe("useAuditList 默认状态与查询参数", () => {
  it("首屏默认参数、空游标与模型去重选项", async () => {
    installRoutes({
      models: [
        auditFilterModel({ id: "route-1", publicId: "grok-4" }),
        auditFilterModel({ id: "route-2", publicId: "grok-4-fast" }),
        auditFilterModel({ id: "route-3", publicId: "grok-4-fast" }),
      ],
    });
    const { result } = renderHook(() => useAuditList(), { wrapper });

    expect(result.current.pageSize).toBe(20);
    expect(result.current.periodDays).toBe(1);
    expect(result.current.sort).toEqual({ field: "createdAt", order: "desc" });
    expect(result.current.cursors).toEqual([""]);
    expect(result.current.cursors.at(-1)).toBe("");
    expect(result.current.selectedAudit).toBeNull();
    expect(result.current.nextCursor).toBe("");
    expect(result.current.auditsQuery.isPending).toBe(true);
    expect(result.current.summaryQuery.isPending).toBe(true);

    await waitFor(() => expect(result.current.auditsQuery.data?.items).toHaveLength(1));
    const query = lastQuery(LIST);
    expect(query.get("pagination")).toBe("cursor");
    expect(query.get("pageSize")).toBe("20");
    expect(query.get("period")).toBe("24h");
    expect(query.get("sortBy")).toBe("createdAt");
    expect(query.get("sortOrder")).toBe("desc");
    expect(query.get("cursor")).toBeNull();

    await waitFor(() => expect(result.current.modelOptions).toHaveLength(2));
    expect(result.current.modelOptions).toEqual([
      { value: "grok-4", label: "grok-4" },
      { value: "grok-4-fast", label: "grok-4-fast" },
    ]);
    expect(await result.current.auditsQuery.refetch()).toBeDefined();
  });

  it("列表与汇总失败时暴露错误信息", async () => {
    installRoutes({
      list: () => Promise.reject(new ApiError(503, "auditListFailed", "审计列表暂不可用")),
      summary: () => {
        throw new ApiError(503, "auditSummaryFailed", "审计汇总暂不可用");
      },
    });
    const { result } = renderHook(() => useAuditList(), { wrapper });

    await waitFor(() => expect(result.current.auditsQuery.isError).toBe(true));
    expect(result.current.auditsQuery.error?.message).toBe("审计列表暂不可用");
    expect(result.current.summaryQuery.isFetching).toBe(false);
  });
});

describe("useAuditList 游标控制", () => {
  it("忽略空游标、前进后回退到首个游标、首页再回退保持不动", async () => {
    installRoutes();
    const { result } = renderHook(() => useAuditList(), { wrapper });
    await waitFor(() => expect(result.current.auditsQuery.data).toBeDefined());
    const before = callsOf(LIST).length;

    act(() => result.current.pushCursor(""));
    expect(result.current.cursors.at(-1)).toBe("");
    expect(callsOf(LIST)).toHaveLength(before);

    act(() => result.current.pushCursor("cursor-2"));
    expect(result.current.cursors).toEqual(["", "cursor-2"]);
    expect(result.current.cursors.at(-1)).toBe("cursor-2");
    await waitFor(() => expect(lastQuery(LIST).get("cursor")).toBe("cursor-2"));

    act(() => result.current.goToPreviousPage());
    expect(result.current.cursors).toEqual([""]);
    expect(result.current.cursors.at(-1)).toBe("");
    await waitFor(() => expect(lastQuery(LIST).get("cursor")).toBeNull());

    const afterPrevious = callsOf(LIST).length;
    act(() => result.current.goToPreviousPage());
    expect(result.current.cursors).toEqual([""]);
    expect(result.current.cursors.at(-1)).toBe("");
    expect(callsOf(LIST)).toHaveLength(afterPrevious);
  });

  it("筛选变化重置游标并写入查询参数", async () => {
    installRoutes();
    const { result } = renderHook(() => useAuditList(), { wrapper });
    await waitFor(() => expect(result.current.auditsQuery.data).toBeDefined());

    act(() => result.current.pushCursor("cursor-2"));
    expect(result.current.cursors.at(-1)).toBe("cursor-2");

    act(() => result.current.setStatusFilter("5xx"));
    expect(result.current.cursors).toEqual([""]);
    await waitFor(() => expect(lastQuery(LIST).get("status")).toBe("5xx"));
    expect(lastQuery(SUMMARY).get("status")).toBe("5xx");
  });

  it("旧作用域的游标回调不会把上一作用域游标带入新查询", async () => {
    installRoutes();
    const { result } = renderHook(() => useAuditList(), { wrapper });
    await waitFor(() => expect(result.current.auditsQuery.data).toBeDefined());

    // 模拟持有旧作用域回调的消费者（memo 子组件/缓存 handler）。
    const staleGoToPrevious = result.current.goToPreviousPage;
    const stalePushCursor = result.current.pushCursor;

    act(() => result.current.pushCursor("cursor-2"));
    expect(result.current.cursors).toEqual(["", "cursor-2"]);

    act(() => result.current.setStatusFilter("5xx"));
    expect(result.current.cursors).toEqual([""]);

    act(() => staleGoToPrevious());
    expect(result.current.cursors).toEqual([""]);

    act(() => stalePushCursor("cursor-legacy"));
    expect(result.current.cursors).toEqual([""]);
    await waitFor(() => expect(lastQuery(LIST).get("status")).toBe("5xx"));
    expect(lastQuery(LIST).get("cursor")).toBeNull();
  });

  it("搜索与密钥/账号筛选经防抖后同时作用于列表与汇总", async () => {
    installRoutes();
    const { result } = renderHook(() => useAuditList(), { wrapper });
    await waitFor(() => expect(result.current.auditsQuery.data).toBeDefined());

    act(() => {
      result.current.setSearch("审计");
      result.current.setModeFilter("stream");
      result.current.setKeyFilter("key-1");
      result.current.setAccountFilter("acc-1");
    });

    await waitFor(() => expect(lastQuery(LIST).get("search")).toBe("审计"), { timeout: 3_000 });
    await waitFor(() => expect(lastQuery(LIST).get("mode")).toBe("stream"), { timeout: 3_000 });
    await waitFor(() => expect(lastQuery(LIST).get("key")).toBe("key-1"), { timeout: 3_000 });
    await waitFor(() => expect(lastQuery(LIST).get("account")).toBe("acc-1"), { timeout: 3_000 });
    await waitFor(() => expect(lastQuery(SUMMARY).get("search")).toBe("审计"), { timeout: 3_000 });
    expect(lastQuery(SUMMARY).get("mode")).toBe("stream");
    expect(lastQuery(SUMMARY).get("key")).toBe("key-1");
    expect(lastQuery(SUMMARY).get("account")).toBe("acc-1");
  });
});

describe("useAuditList 排序、页大小与刷新", () => {
  it("排序与页大小写入查询参数并重置游标", async () => {
    installRoutes();
    const { result } = renderHook(() => useAuditList(), { wrapper });
    await waitFor(() => expect(result.current.auditsQuery.data).toBeDefined());

    act(() => result.current.pushCursor("cursor-2"));
    expect(result.current.cursors.at(-1)).toBe("cursor-2");

    act(() => result.current.changeSort("model", "asc"));
    expect(result.current.sort).toEqual({ field: "model", order: "asc" });
    await waitFor(() => expect(lastQuery(LIST).get("sortBy")).toBe("model"));
    expect(lastQuery(LIST).get("sortOrder")).toBe("asc");

    act(() => result.current.changeSort("model", "asc"));
    expect(result.current.sort).toEqual({ field: "model", order: "desc" });

    act(() => result.current.setPageSize(50));
    expect(result.current.pageSize).toBe(50);
    expect(result.current.cursors).toEqual([""]);
    await waitFor(() => expect(lastQuery(LIST).get("pageSize")).toBe("50"));
  });

  it("手动刷新强制重取汇总、列表并在最短停留时间后恢复可点击", async () => {
    installRoutes();
    const { result } = renderHook(() => useAuditList(), { wrapper });
    await waitFor(() => expect(result.current.auditsQuery.data).toBeDefined());
    const listBefore = callsOf(LIST).length;
    const summaryBefore = callsOf(SUMMARY).length;

    act(() => result.current.refreshAll());
    expect(result.current.manualRefreshing).toBe(true);

    await waitFor(() => expect(callsOf(LIST).length).toBeGreaterThan(listBefore), { timeout: 2_000 });
    await waitFor(() => expect(lastQuery(SUMMARY).get("refresh")).toBe("1"), { timeout: 2_000 });
    expect(callsOf(SUMMARY).length).toBeGreaterThan(summaryBefore);
    await waitFor(() => expect(result.current.manualRefreshing).toBe(false), { timeout: 2_000 });
  });

  it("选择与关闭详情回写 selectedAudit", async () => {
    installRoutes();
    const { result } = renderHook(() => useAuditList(), { wrapper });
    await waitFor(() => expect(result.current.auditsQuery.data).toBeDefined());

    const audit = auditDTO({ id: "audit-9" });
    act(() => result.current.setSelectedAudit(audit));
    expect(result.current.selectedAudit).toEqual(audit);

    act(() => result.current.setSelectedAudit(null));
    expect(result.current.selectedAudit).toBeNull();
  });
});
