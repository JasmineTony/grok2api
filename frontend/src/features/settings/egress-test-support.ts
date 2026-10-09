import type { EgressOperationsConfigDTO } from "@/features/settings/settings-api";

/**
 * 出口组件集成测试的假 API 与 wire DTO 构造器（仅被 *.test.tsx 使用）。
 * 只替换网络边界：apiRequest 由测试注入，settings-api 的 decoder 与业务代码保持真实。
 */
export type FakeApiCall = {
  path: string;
  method: string;
  body: unknown;
  query: URLSearchParams;
};

export type FakeApiHandler = (call: FakeApiCall) => unknown;

/** 把 handler 的返回值交给真实 decoder，模拟 apiRequest 的「解包 + 校验」行为。 */
export function createEgressFakeApi(handler: FakeApiHandler) {
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

export type EgressFakeRoutes = {
  nodes?: FakeApiHandler;
  nodeCreate?: FakeApiHandler;
  nodeUpdate?: FakeApiHandler;
  nodeRemove?: FakeApiHandler;
  nodeBatchRemove?: FakeApiHandler;
  nodeBatchUpdate?: FakeApiHandler;
  nodeTest?: FakeApiHandler;
  nodeTestOne?: FakeApiHandler;
  nodeReveal?: FakeApiHandler;
  nodeRefreshClearance?: FakeApiHandler;
  nodeCleanupPreview?: FakeApiHandler;
  nodeCleanup?: FakeApiHandler;
  importText?: FakeApiHandler;
  sources?: FakeApiHandler;
  sourceCreate?: FakeApiHandler;
  sourceUpdate?: FakeApiHandler;
  sourceRemove?: FakeApiHandler;
  sourceSync?: FakeApiHandler;
  operations?: FakeApiHandler;
  operationsSave?: FakeApiHandler;
  rebalance?: FakeApiHandler;
  profiles?: FakeApiHandler;
  profileSelected?: FakeApiHandler;
  profileCreate?: FakeApiHandler;
  profileUpdate?: FakeApiHandler;
  profileReveal?: FakeApiHandler;
  profileRemove?: FakeApiHandler;
};

/** 按 method + path 选择处理函数；未注册的请求返回 undefined 由测试显式失败。 */
export function matchEgressRoute(call: FakeApiCall, routes: EgressFakeRoutes): FakeApiHandler | undefined {
  const { path, method } = call;
  if (path === "/api/admin/v1/egress-nodes") {
    if (method === "GET") return routes.nodes;
    if (method === "POST") return routes.nodeCreate;
    if (method === "DELETE") return routes.nodeBatchRemove;
  }
  if (path === "/api/admin/v1/egress-nodes/batch" && method === "PATCH") return routes.nodeBatchUpdate;
  if (path === "/api/admin/v1/egress-nodes/test" && method === "POST") return routes.nodeTest;
  if (path === "/api/admin/v1/egress-nodes/cleanup-preview") return routes.nodeCleanupPreview;
  if (path === "/api/admin/v1/egress-nodes/cleanup" && method === "POST") return routes.nodeCleanup;
  if (/^\/api\/admin\/v1\/egress-nodes\/[^/]+$/.test(path)) {
    if (method === "PUT") return routes.nodeUpdate;
    if (method === "DELETE") return routes.nodeRemove;
  }
  if (/^\/api\/admin\/v1\/egress-nodes\/[^/]+\/proxy-url\/reveal$/.test(path)) return routes.nodeReveal;
  if (/^\/api\/admin\/v1\/egress-proxy-profiles\/[^/]+\/proxy-url\/reveal$/.test(path)) return routes.profileReveal;
  if (/^\/api\/admin\/v1\/egress-nodes\/[^/]+\/test$/.test(path)) return routes.nodeTestOne;
  if (/^\/api\/admin\/v1\/egress-nodes\/[^/]+\/refresh-clearance$/.test(path)) return routes.nodeRefreshClearance;
  if (path === "/api/admin/v1/egress-imports" && method === "POST") return routes.importText;
  if (path === "/api/admin/v1/egress-sources") {
    if (method === "GET") return routes.sources;
    if (method === "POST") return routes.sourceCreate;
  }
  if (/^\/api\/admin\/v1\/egress-sources\/[^/]+\/sync$/.test(path)) return routes.sourceSync;
  if (/^\/api\/admin\/v1\/egress-sources\/[^/]+$/.test(path)) {
    if (method === "PUT") return routes.sourceUpdate;
    if (method === "DELETE") return routes.sourceRemove;
  }
  if (path === "/api/admin/v1/egress-operations") {
    if (method === "GET") return routes.operations;
    if (method === "PUT") return routes.operationsSave;
  }
  if (path === "/api/admin/v1/egress-operations/rebalance" && method === "POST") return routes.rebalance;
  if (path === "/api/admin/v1/egress-proxy-profiles") {
    if (method === "GET") return routes.profiles;
    if (method === "POST") return routes.profileCreate;
  }
  if (/^\/api\/admin\/v1\/egress-proxy-profiles\/[^/]+$/.test(path)) {
    if (method === "GET") return routes.profileSelected;
    if (method === "PUT") return routes.profileUpdate;
    if (method === "DELETE") return routes.profileRemove;
  }
  return undefined;
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

export function egressNodeWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "node-1",
    name: "节点一",
    scope: "grok_build",
    enabled: true,
    proxyConfigured: true,
    proxyDisplay: "socks5h://host:1080",
    userAgent: "",
    cookieConfigured: false,
    accountBoundProxy: false,
    proxyPool: false,
    health: 1,
    failureCount: 0,
    accountCapacity: 0,
    assignedAccountCount: 0,
    probeStatus: "unknown",
    probeLatencyMs: 0,
    ...overrides,
  };
}

export function egressNodeListWire(
  items: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
    defaultUserAgents: {
      grok_build: "",
      grok_web: "grok-web-ua",
      grok_console: "grok-console-ua",
      grok_web_asset: "grok-web-asset-ua",
      grok_console_asset: "grok-console-asset-ua",
    },
    ...overrides,
  };
}

export function egressSourceWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "src-1",
    name: "订阅源一",
    scope: "grok_build",
    enabled: true,
    urlConfigured: true,
    proxyConfigured: false,
    refreshIntervalSeconds: 900,
    defaultAccountCapacity: 0,
    lastSyncImported: 0,
    ...overrides,
  };
}

export function egressSourceListWire(
  items: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { items, page: 1, pageSize: 20, total: items.length, ...overrides };
}

export function egressProxyProfileWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "prof-1",
    name: "机房代理",
    proxyDisplay: "socks5h://host:1080",
    proxyFingerprint: "abcd1234",
    boundNodeCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function egressProxyProfileListWire(
  items: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { items, page: 1, pageSize: 20, total: items.length, ...overrides };
}

export function egressOperationsWire(overrides: Partial<EgressOperationsConfigDTO> = {}): Record<string, unknown> {
  return {
    probeProvider: "cloudflare",
    probeIntervalSeconds: 900,
    autoAssignEnabled: false,
    autoBalanceEnabled: false,
    assignmentIntervalSeconds: 300,
    fallbacks: {
      grok_build: { mode: "none" },
      grok_web: { mode: "none" },
      grok_console: { mode: "none" },
      grok_web_asset: { mode: "none" },
      grok_console_asset: { mode: "none" },
    },
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
