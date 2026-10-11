import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createModel,
  deleteModel,
  deleteModels,
  listModelAccountOptions,
  listModelGroups,
  listModels,
  syncModels,
  updateModel,
  updateModelsEnabled,
  type ModelSyncProgressDTO,
} from "@/entities/model/model-api";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 模型 API 层直测（AGENTS.md TEST-1/TEST-3）：只替换 apiRequest / apiEventStream 两个网络边界，
// 查询串拼装、decoder 校验、SSE 事件分派、进度裁剪与错误分类全部走真实实现。

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), apiEventStream: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: mocks.apiRequest, apiEventStream: mocks.apiEventStream };
});

type RequestCall = { path: string; query: URLSearchParams; method: string | undefined; body: unknown };

const calls: RequestCall[] = [];

/** 记录请求形状后把 payload 交给被测模块自带的真实 decoder。 */
function respondWith(payload: unknown): void {
  calls.length = 0;
  mocks.apiRequest.mockImplementation(
    async (path: string, options: { method?: string; body?: unknown }, decode: (value: unknown) => unknown) => {
      const queryIndex = path.indexOf("?");
      calls.push({
        path: queryIndex === -1 ? path : path.slice(0, queryIndex),
        query: new URLSearchParams(queryIndex === -1 ? "" : path.slice(queryIndex + 1)),
        method: options.method,
        body: options.body,
      });
      return decode(payload);
    },
  );
}

function lastCall(): RequestCall {
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1];
}

type StreamEvent = { event: string; data: Record<string, unknown> };

/** 用给定事件序列驱动一次模型同步流。 */
function respondWithStream(events: StreamEvent[]): void {
  mocks.apiEventStream.mockImplementation(
    async (_path: string, _options: unknown, _decode: unknown, onEvent: (value: StreamEvent) => void) => {
      for (const event of events) onEvent(event);
    },
  );
}

/** 失败路径：先断言 reject 值确为 ApiError，再按 ApiError 契约读取 status / code / message。 */
async function rejectionOf(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

function modelRouteWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "route-1",
    publicId: "grok-4",
    provider: "grok_build",
    upstreamModel: "grok-4-0709",
    capability: "chat",
    origin: "catalog",
    enabled: true,
    accountIds: ["acc-1"],
    bindingMode: false,
    supportedAccounts: 2,
    syncedAccounts: 1,
    totalAccounts: 2,
    capabilityKnown: true,
    available: true,
    lastSyncedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function modelPage(items: Array<Record<string, unknown>> = []): Record<string, unknown> {
  return { items, page: 1, pageSize: 20, total: items.length };
}

function modelGroupWire(routes: unknown = [modelRouteWire()]): Record<string, unknown> {
  return { key: "grok_build:grok-4", routes, endpointCapabilities: ["responses", "messages"] };
}

beforeEach(async () => {
  vi.clearAllMocks();
  calls.length = 0;
  await i18n.changeLanguage("zh-CN");
});

describe("listModels", () => {
  it("只下发调用方显式传入的筛选参数", async () => {
    respondWith(modelPage());

    const page = await listModels({ page: 2, pageSize: 50 });

    expect(lastCall().path).toBe("/api/admin/v1/models");
    expect(lastCall().method).toBeUndefined();
    expect(lastCall().query.get("page")).toBe("2");
    expect(lastCall().query.get("pageSize")).toBe("50");
    expect([...lastCall().query.keys()]).toEqual(["page", "pageSize"]);
    expect(page).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it("序列化搜索、状态、供应商、作用域与排序参数", async () => {
    respondWith(modelPage([modelRouteWire()]));

    const page = await listModels({
      page: 1,
      pageSize: 20,
      search: "grok",
      status: "enabled",
      provider: "grok_web",
      providerScope: ["grok_build", "grok_web"],
      tierScope: ["free", "super"],
      activeScope: true,
      sortBy: "publicId",
      sortOrder: "desc",
    });

    const query = lastCall().query;
    expect(query.get("search")).toBe("grok");
    expect(query.get("status")).toBe("enabled");
    expect(query.get("provider")).toBe("grok_web");
    expect(query.getAll("providerScope")).toEqual(["grok_build", "grok_web"]);
    expect(query.getAll("tierScope")).toEqual(["free", "super"]);
    expect(query.get("activeScope")).toBe("true");
    expect(query.get("sortBy")).toBe("publicId");
    expect(query.get("sortOrder")).toBe("desc");

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      publicId: "grok-4",
      capability: "chat",
      accountIds: ["acc-1"],
      available: true,
      lastSyncedAt: "2026-01-01T00:00:00Z",
    });
  });

  it("缺少排序方向或供应商为空串时不下发对应参数", async () => {
    respondWith(modelPage());
    await listModels({ page: 1, pageSize: 20, provider: "", sortBy: "publicId" });
    expect(lastCall().query.has("provider")).toBe(false);
    expect(lastCall().query.has("sortBy")).toBe(false);
    expect(lastCall().query.has("sortOrder")).toBe(false);

    respondWith(modelPage());
    await listModels({ page: 1, pageSize: 20, sortOrder: "asc", providerScope: [], tierScope: [] });
    expect(lastCall().query.has("sortBy")).toBe(false);
    expect(lastCall().query.has("sortOrder")).toBe(false);
    expect(lastCall().query.has("providerScope")).toBe(false);
    expect(lastCall().query.has("tierScope")).toBe(false);
    expect(lastCall().query.has("activeScope")).toBe(false);
  });

  it("拒绝 capability 不在契约内的模型项", async () => {
    respondWith(modelPage([modelRouteWire({ capability: "unknown-capability" })]));

    await expect(listModels({ page: 1, pageSize: 20 })).rejects.toThrow("paginated result response shape is invalid");
  });
});

describe("listModelGroups", () => {
  it("复用同一套分页与排序查询串并返回分组内容", async () => {
    respondWith(modelPage([modelGroupWire()]));

    const page = await listModelGroups({
      page: 1,
      pageSize: 20,
      search: "grok-4",
      status: "enabled",
      provider: "grok_build",
      sortBy: "key",
      sortOrder: "asc",
    });

    expect(lastCall().path).toBe("/api/admin/v1/models/groups");
    expect(lastCall().query.get("page")).toBe("1");
    expect(lastCall().query.get("pageSize")).toBe("20");
    expect(lastCall().query.get("search")).toBe("grok-4");
    expect(lastCall().query.get("status")).toBe("enabled");
    expect(lastCall().query.get("provider")).toBe("grok_build");
    expect(lastCall().query.get("sortBy")).toBe("key");
    expect(lastCall().query.get("sortOrder")).toBe("asc");
    expect(page.items[0].key).toBe("grok_build:grok-4");
    expect(page.items[0].routes[0].publicId).toBe("grok-4");
    expect(page.items[0].endpointCapabilities).toEqual(["responses", "messages"]);
  });

  it("未提供完整排序参数时不下发排序", async () => {
    respondWith(modelPage([modelGroupWire()]));

    await listModelGroups({ page: 1, pageSize: 20, search: "grok" });

    expect(lastCall().query.get("search")).toBe("grok");
    expect(lastCall().query.has("sortBy")).toBe(false);
    expect(lastCall().query.has("sortOrder")).toBe(false);
  });

  it("要求 routes 是非空且全部合法的数组", async () => {
    respondWith(modelPage([modelGroupWire([])]));
    await expect(listModelGroups({ page: 1, pageSize: 20 })).rejects.toThrow(
      "paginated result response shape is invalid",
    );

    respondWith(modelPage([modelGroupWire([modelRouteWire({ provider: "grok_unknown" })])]));
    await expect(listModelGroups({ page: 1, pageSize: 20 })).rejects.toThrow(
      "paginated result response shape is invalid",
    );

    respondWith(modelPage([modelGroupWire("not-an-array")]));
    await expect(listModelGroups({ page: 1, pageSize: 20 })).rejects.toThrow(
      "paginated result response shape is invalid",
    );
  });
});

describe("模型写入接口", () => {
  it("listModelAccountOptions 按 provider 查询可选账号", async () => {
    respondWith({ items: [{ id: "acc-1", name: "主账号" }] });

    const result = await listModelAccountOptions("grok_console");

    expect(lastCall().path).toBe("/api/admin/v1/models/accounts");
    expect(lastCall().query.get("provider")).toBe("grok_console");
    expect(result).toEqual({ items: [{ id: "acc-1", name: "主账号" }] });
  });

  it("createModel 以 POST 提交创建体并返回解码后的路由", async () => {
    respondWith(modelRouteWire({ publicId: "grok-5", accountIds: ["acc-1", "acc-2"] }));
    const input = {
      publicId: "grok-5",
      provider: "grok_build" as const,
      upstreamModel: "grok-5-0710",
      capability: "chat" as const,
      enabled: true,
      accountIds: ["acc-1", "acc-2"],
    };

    const route = await createModel(input);

    expect(lastCall().path).toBe("/api/admin/v1/models");
    expect(lastCall().method).toBe("POST");
    expect(lastCall().body).toEqual(input);
    expect(route.publicId).toBe("grok-5");
    expect(route.accountIds).toEqual(["acc-1", "acc-2"]);
  });

  it("updateModel 以 PATCH 提交可编辑字段", async () => {
    respondWith(modelRouteWire({ enabled: false }));
    const input = { publicId: "grok-4", enabled: false, accountIds: [] };

    const route = await updateModel("route-1", input);

    expect(lastCall().path).toBe("/api/admin/v1/models/route-1");
    expect(lastCall().method).toBe("PATCH");
    expect(lastCall().body).toEqual(input);
    expect(route.enabled).toBe(false);
  });

  it("deleteModel 以 DELETE 返回布尔删除结果", async () => {
    respondWith({ deleted: true });

    await expect(deleteModel("route-1")).resolves.toEqual({ deleted: true });

    expect(lastCall().path).toBe("/api/admin/v1/models/route-1");
    expect(lastCall().method).toBe("DELETE");
    expect(lastCall().body).toBeUndefined();
  });

  it("deleteModels 以 DELETE 批量删除并返回删除数量", async () => {
    respondWith({ deleted: 2 });

    await expect(deleteModels(["route-1", "route-2"])).resolves.toEqual({ deleted: 2 });

    expect(lastCall().path).toBe("/api/admin/v1/models");
    expect(lastCall().method).toBe("DELETE");
    expect(lastCall().body).toEqual({ ids: ["route-1", "route-2"] });
  });

  it("updateModelsEnabled 以 PATCH 批量开关并返回更新数量", async () => {
    respondWith({ updated: 3 });

    await expect(updateModelsEnabled(["route-1", "route-2"], false)).resolves.toEqual({ updated: 3 });

    expect(lastCall().path).toBe("/api/admin/v1/models/batch");
    expect(lastCall().method).toBe("PATCH");
    expect(lastCall().body).toEqual({ ids: ["route-1", "route-2"], enabled: false });
  });

  it("批量接口拒绝非数值计数结果", async () => {
    respondWith({ deleted: "2" });
    await expect(deleteModels(["route-1"])).rejects.toThrow("count result response shape is invalid");

    respondWith({ updated: null });
    await expect(updateModelsEnabled(["route-1"], true)).rejects.toThrow("count result response shape is invalid");
  });
});

describe("syncModels", () => {
  it("以 POST 事件流请求并回传裁剪后的进度与完成结果", async () => {
    respondWithStream([
      { event: "progress", data: { completed: 5, total: 10 } },
      { event: "progress", data: { completed: 99, total: 10 } },
      { event: "progress", data: { completed: -3, total: 10 } },
      { event: "complete", data: { synced: 7 } },
    ]);
    const progress: ModelSyncProgressDTO[] = [];

    const result = await syncModels((value) => progress.push(value));

    const [path, options] = mocks.apiEventStream.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string> },
    ];
    expect(path).toBe("/api/admin/v1/models/sync");
    expect(options).toEqual({ method: "POST", headers: { Accept: "text/event-stream" } });
    expect(result).toEqual({ synced: 7 });
    expect(progress).toEqual([
      { completed: 5, total: 10 },
      { completed: 10, total: 10 },
      { completed: 0, total: 10 },
    ]);
  });

  it("没有进度回调时仍返回完成结果", async () => {
    respondWithStream([
      { event: "progress", data: { completed: 1, total: 2 } },
      { event: "complete", data: { synced: 2 } },
    ]);

    await expect(syncModels()).resolves.toEqual({ synced: 2 });
  });

  it("忽略非进度事件与不完整的进度载荷", async () => {
    respondWithStream([
      { event: "message", data: {} },
      { event: "progress", data: { total: 10 } },
      { event: "progress", data: { completed: 1 } },
      { event: "progress", data: { completed: 1, total: 0 } },
      { event: "complete", data: { synced: "7" } },
      { event: "complete", data: { synced: 4 } },
    ]);
    const progress: ModelSyncProgressDTO[] = [];

    const result = await syncModels((value) => progress.push(value));

    expect(result).toEqual({ synced: 4 });
    expect(progress).toEqual([]);
  });

  it("error 事件优先使用已本地化的错误码文案", async () => {
    respondWithStream([{ event: "error", data: { code: "requestFailed", message: "服务端原始信息" } }]);

    const error = await rejectionOf(syncModels());

    expect(error.status).toBe(502);
    expect(error.code).toBe("requestFailed");
    expect(error.message).toBe(i18n.t("apiErrors.requestFailed"));
    expect(error.message).not.toBe("服务端原始信息");
  });

  it("未知错误码回退到服务端 message", async () => {
    respondWithStream([{ event: "error", data: { code: "upstreamThrottled", message: "上游限流" } }]);

    const error = await rejectionOf(syncModels());

    expect(error.status).toBe(502);
    expect(error.code).toBe("upstreamThrottled");
    expect(error.message).toBe("上游限流");
  });

  it("未知错误码且没有 message 时回退到通用请求失败文案", async () => {
    respondWithStream([{ event: "error", data: { code: "upstreamThrottled" } }]);

    const error = await rejectionOf(syncModels());

    expect(error.status).toBe(502);
    expect(error.code).toBe("upstreamThrottled");
    expect(error.message).toBe(i18n.t("apiErrors.requestFailed"));
  });

  it("缺少错误码时使用 modelSyncFailed 默认码", async () => {
    respondWithStream([{ event: "error", data: {} }]);

    const error = await rejectionOf(syncModels());

    expect(error.status).toBe(502);
    expect(error.code).toBe("modelSyncFailed");
    expect(error.message).toBe(i18n.t("apiErrors.modelSyncFailed"));
  });

  it("流结束但没有 complete 事件时按 invalidResponse 失败", async () => {
    respondWithStream([{ event: "progress", data: { completed: 1, total: 2 } }]);

    const error = await rejectionOf(syncModels());

    expect(error.status).toBe(502);
    expect(error.code).toBe("invalidResponse");
    expect(error.message).toBe(i18n.t("apiErrors.invalidResponse"));
  });
});
