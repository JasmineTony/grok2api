import type { ModelRouteDTO } from "@/entities/model/types";
import type { ClientKeyDTO } from "@/features/client-keys/client-keys-api";
import type { PaginatedDTO } from "@/shared/api/client";

/**
 * 客户端密钥组件集成测试的假 API 与 DTO 构造器（仅被 *.test.tsx 使用）。
 * 只替换网络边界：apiRequest 由测试注入，decoder 与业务代码保持真实。
 */
export type FakeApiCall = {
  path: string;
  method: string;
  body: unknown;
  query: URLSearchParams;
};

export type FakeApiHandler = (call: FakeApiCall) => unknown;

/** 把 handler 的返回值交给真实 decoder，模拟 apiRequest 的「解包 + 校验」行为。 */
export function createFakeApi(handler: FakeApiHandler) {
  return async function fakeApiRequest(
    path: string,
    options: { method?: string; body?: unknown },
    decode: (value: unknown) => unknown,
  ): Promise<unknown> {
    const queryIndex = path.indexOf("?");
    const call: FakeApiCall = {
      path: queryIndex === -1 ? path : path.slice(0, queryIndex),
      method: options.method ?? "GET",
      body: options.body,
      query: new URLSearchParams(queryIndex === -1 ? "" : path.slice(queryIndex + 1)),
    };
    return decode(await handler(call));
  };
}

/**
 * jsdom 未实现 ResizeObserver，而 Radix 的 useSize 在挂载时直接 new。
 * 仅用于测试环境补齐该浏览器 API。
 */
export class ResizeObserverStub {
  observe(): void {
    /* 测试不需要尺寸变化回调 */
  }

  unobserve(): void {
    /* 同上 */
  }

  disconnect(): void {
    /* 同上 */
  }
}

export type FakeApiRoutes = {
  list: FakeApiHandler;
  create?: FakeApiHandler;
  update?: FakeApiHandler;
  secret?: FakeApiHandler;
  remove?: FakeApiHandler;
  batchUpdate?: FakeApiHandler;
  batchDelete?: FakeApiHandler;
  models?: FakeApiHandler;
};

/** 按 method + path 选择处理函数；未注册的请求返回 undefined 由测试显式失败。 */
export function matchFakeRoute(call: FakeApiCall, routes: FakeApiRoutes): FakeApiHandler | undefined {
  if (call.path === "/api/admin/v1/client-keys") {
    if (call.method === "GET") return routes.list;
    if (call.method === "POST") return routes.create;
    if (call.method === "DELETE") return routes.batchDelete;
  }
  if (call.path === "/api/admin/v1/client-keys/batch" && call.method === "PATCH") return routes.batchUpdate;
  if (call.path === "/api/admin/v1/models" && call.method === "GET") return routes.models;
  if (/^\/api\/admin\/v1\/client-keys\/[^/]+\/secret$/.test(call.path) && call.method === "GET") return routes.secret;
  if (/^\/api\/admin\/v1\/client-keys\/[^/]+$/.test(call.path)) {
    if (call.method === "PATCH") return routes.update;
    if (call.method === "DELETE") return routes.remove;
  }
  return undefined;
}

export function clientKeyDTO(overrides: Partial<ClientKeyDTO> = {}): ClientKeyDTO {
  return {
    id: "key-1",
    name: "生产密钥",
    prefix: "abcd1234",
    enabled: true,
    rpmLimit: 120,
    maxConcurrent: 8,
    billingLimitUsdTicks: 0,
    billedUsageUsdTicks: 0,
    allowModelAliases: false,
    allowedModelIds: [],
    ...overrides,
  };
}

export function clientKeyPage(
  items: ClientKeyDTO[],
  overrides: Partial<PaginatedDTO<ClientKeyDTO>> = {},
): PaginatedDTO<ClientKeyDTO> {
  return { items, page: 1, pageSize: 20, total: items.length, ...overrides };
}

export function modelRouteDTO(overrides: Partial<ModelRouteDTO> = {}): ModelRouteDTO {
  return {
    id: "model-1",
    publicId: "grok-4",
    provider: "grok_build",
    upstreamModel: "grok-4-0801",
    capability: "chat",
    origin: "catalog",
    enabled: true,
    accountIds: [],
    bindingMode: false,
    supportedAccounts: 1,
    syncedAccounts: 1,
    totalAccounts: 1,
    capabilityKnown: true,
    available: true,
    ...overrides,
  };
}

export function modelPage(
  items: ModelRouteDTO[],
  overrides: Partial<PaginatedDTO<ModelRouteDTO>> = {},
): PaginatedDTO<ModelRouteDTO> {
  return { items, page: 1, pageSize: 50, total: items.length, ...overrides };
}
