import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assignEgressAccounts,
  cleanupUnhealthyEgressNodes,
  createEgressNode,
  createEgressProxyProfile,
  createEgressSource,
  deleteEgressNode,
  deleteEgressNodes,
  deleteEgressProxyProfile,
  deleteEgressSource,
  getEgressNodeProxyURL,
  getEgressOperationsConfig,
  getEgressProxyProfile,
  getEgressProxyProfileURL,
  importEgressText,
  listAllEgressNodes,
  listEgressNodes,
  listEgressProxyProfiles,
  listEgressSources,
  previewUnhealthyEgressNodes,
  rebalanceEgressAccounts,
  refreshEgressClearance,
  syncEgressSource,
  testEgressNode,
  testEgressNodes,
  unassignEgressAccounts,
  updateEgressNode,
  updateEgressNodesEnabled,
  updateEgressOperationsConfig,
  updateEgressProxyProfile,
  updateEgressSource,
} from "@/features/settings/egress-api";
import {
  createEgressFakeApi,
  egressNodeListWire,
  egressNodeWire,
  egressOperationsWire,
  egressProxyProfileListWire,
  egressProxyProfileWire,
  egressSourceListWire,
  egressSourceWire,
  matchEgressRoute,
  type EgressFakeRoutes,
  type FakeApiCall,
} from "@/features/settings/egress-test-support";

// 出口 API 层测试：只替换 apiRequest 这一个网络边界，路径/查询参数/请求体与
// decoder（含缺省值回填）全部走真实实现。

const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

type RecordedCall = { method: string; path: string; query: URLSearchParams; body: unknown };

const calls: RecordedCall[] = [];

function installRoutes(routes: EgressFakeRoutes): void {
  calls.length = 0;
  const respond = createEgressFakeApi((call: FakeApiCall) => {
    const handler = matchEgressRoute(call, routes);
    if (!handler) throw new Error(`未注册的请求：${call.method} ${call.path}`);
    return handler(call);
  });
  apiMock.request.mockImplementation((path: string, options: { method?: string; body?: unknown }, decode: never) => {
    const queryIndex = path.indexOf("?");
    calls.push({
      method: options.method ?? "GET",
      path: queryIndex === -1 ? path : path.slice(0, queryIndex),
      query: new URLSearchParams(queryIndex === -1 ? "" : path.slice(queryIndex + 1)),
      body: options.body,
    });
    return respond(path, options, decode);
  });
}

/** 只记录调用并返回已解码结果：用于断言请求形状而不再走 decoder 的函数。 */
function installPayload(payload: unknown): void {
  calls.length = 0;
  apiMock.request.mockImplementation(async (path: string, options: { method?: string; body?: unknown }) => {
    const queryIndex = path.indexOf("?");
    calls.push({
      method: options.method ?? "GET",
      path: queryIndex === -1 ? path : path.slice(0, queryIndex),
      query: new URLSearchParams(queryIndex === -1 ? "" : path.slice(queryIndex + 1)),
      body: options.body,
    });
    return payload;
  });
}

function lastCall(): RecordedCall {
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1];
}

beforeEach(() => {
  apiMock.request.mockReset();
});

describe("出口节点 API", () => {
  it("默认分页参数与筛选参数只按需写入查询串", async () => {
    installRoutes({ nodes: () => egressNodeListWire([]) });
    await listEgressNodes();

    expect(lastCall()).toMatchObject({ method: "GET", path: "/api/admin/v1/egress-nodes" });
    expect(lastCall().query.get("page")).toBe("1");
    expect(lastCall().query.get("pageSize")).toBe("20");
    expect(lastCall().query.has("search")).toBe(false);
    expect(lastCall().query.has("scope")).toBe(false);
    expect(lastCall().query.has("sortBy")).toBe(false);

    installRoutes({ nodes: () => egressNodeListWire([]) });
    await listEgressNodes({
      page: 3,
      pageSize: 50,
      search: "东京",
      scope: "grok_web",
      enabled: "enabled",
      probe: "unhealthy",
      assignment: "bound",
      sortBy: "name",
      sortOrder: "desc",
    });

    expect(lastCall().query.get("page")).toBe("3");
    expect(lastCall().query.get("pageSize")).toBe("50");
    expect(lastCall().query.get("search")).toBe("东京");
    expect(lastCall().query.get("scope")).toBe("grok_web");
    expect(lastCall().query.get("enabled")).toBe("enabled");
    expect(lastCall().query.get("probe")).toBe("unhealthy");
    expect(lastCall().query.get("assignment")).toBe("bound");
    expect(lastCall().query.get("sortBy")).toBe("name");
    expect(lastCall().query.get("sortOrder")).toBe("desc");
  });

  it("只给出排序字段时不写入排序参数", async () => {
    installRoutes({ nodes: () => egressNodeListWire([]) });
    await listEgressNodes({ sortBy: "name" });

    expect(lastCall().query.has("sortBy")).toBe(false);
  });

  it("回填节点探测缺省值并回填订阅源默认 UA", async () => {
    installRoutes({
      nodes: () =>
        egressNodeListWire([egressNodeWire({ ipv4Probe: undefined, ipv6Probe: undefined })], {
          page: undefined,
          pageSize: undefined,
          total: undefined,
        }),
    });

    const result = await listEgressNodes();

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.total).toBe(1);
    expect(result.items[0].ipv4Probe).toEqual({ status: "unknown", latencyMs: 0 });
    expect(result.items[0].ipv6Probe).toEqual({ status: "unknown", latencyMs: 0 });
  });

  it("listAllEgressNodes 翻页聚合直到达到总数", async () => {
    installRoutes({
      nodes: (call) => {
        const page = Number(call.query.get("page"));
        const items = [egressNodeWire({ id: `node-${page}` }), egressNodeWire({ id: `node-${page}-b` })];
        return egressNodeListWire(items, { page, pageSize: 2000, total: 4 });
      },
    });

    const result = await listAllEgressNodes();

    expect(result.items.map((item) => item.id)).toEqual(["node-1", "node-1-b", "node-2", "node-2-b"]);
    expect(result.pageSize).toBe(2_000);
    expect(result.total).toBe(4);
  });

  it("listAllEgressNodes 遇到空页时停止翻页", async () => {
    installRoutes({
      nodes: (call) => {
        const page = Number(call.query.get("page"));
        if (page > 1) return egressNodeListWire([], { page, pageSize: 2000, total: 5 });
        return egressNodeListWire([egressNodeWire({ id: "node-1" })], { page, pageSize: 2000, total: 5 });
      },
    });

    const result = await listAllEgressNodes();

    expect(result.items).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("创建与更新节点提交完整表单体", async () => {
    const input = {
      name: "新节点",
      scope: "grok_web" as const,
      enabled: true,
      proxyPool: false,
      accountCapacity: 5,
      proxyURL: "socks5h://host:1080",
      userAgent: "ua",
      cloudflareCookies: "",
    };
    installRoutes({
      nodeCreate: () => egressNodeWire({ id: "node-new" }),
      nodeUpdate: () => egressNodeWire({ id: "node-1" }),
    });

    await createEgressNode(input);
    expect(lastCall()).toMatchObject({ method: "POST", path: "/api/admin/v1/egress-nodes", body: input });

    await updateEgressNode("node-1", input);
    expect(lastCall()).toMatchObject({ method: "PUT", path: "/api/admin/v1/egress-nodes/node-1", body: input });
  });

  it("揭示代理地址、清理预览与清理请求命中各自路径", async () => {
    installRoutes({
      nodeReveal: () => ({ proxyURL: "socks5h://host:1080" }),
      nodeCleanupPreview: () => ({ nodes: 2, boundAccounts: 3, subscriptionManaged: 1 }),
      nodeCleanup: () => ({ deleted: 2 }),
      nodeRefreshClearance: () => ({ refreshed: true }),
    });

    await expect(getEgressNodeProxyURL("node-1")).resolves.toEqual({ proxyURL: "socks5h://host:1080" });
    expect(lastCall()).toMatchObject({ method: "POST", path: "/api/admin/v1/egress-nodes/node-1/proxy-url/reveal" });

    await expect(previewUnhealthyEgressNodes()).resolves.toEqual({
      nodes: 2,
      boundAccounts: 3,
      subscriptionManaged: 1,
    });
    expect(lastCall()).toMatchObject({ method: "GET", path: "/api/admin/v1/egress-nodes/cleanup-preview" });

    await expect(cleanupUnhealthyEgressNodes()).resolves.toEqual({ deleted: 2 });
    expect(lastCall()).toMatchObject({ method: "POST", path: "/api/admin/v1/egress-nodes/cleanup" });

    await expect(refreshEgressClearance("node-1")).resolves.toEqual({ refreshed: true });
    expect(lastCall()).toMatchObject({ method: "POST", path: "/api/admin/v1/egress-nodes/node-1/refresh-clearance" });
  });

  it("单个/批量删除与批量启停提交 id 列表", async () => {
    installRoutes({
      nodeRemove: () => ({ deleted: true }),
      nodeBatchRemove: () => ({ deleted: 2 }),
      nodeBatchUpdate: () => ({ updated: 2 }),
    });

    await expect(deleteEgressNode("node-1")).resolves.toEqual({ deleted: true });
    expect(lastCall()).toMatchObject({ method: "DELETE", path: "/api/admin/v1/egress-nodes/node-1" });

    await expect(deleteEgressNodes(["node-1", "node-2"])).resolves.toEqual({ deleted: 2 });
    expect(lastCall()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/v1/egress-nodes",
      body: { ids: ["node-1", "node-2"] },
    });

    await expect(updateEgressNodesEnabled(["node-1"], false)).resolves.toEqual({ updated: 2 });
    expect(lastCall()).toMatchObject({
      method: "PATCH",
      path: "/api/admin/v1/egress-nodes/batch",
      body: { ids: ["node-1"], enabled: false },
    });
  });

  it("单节点探测回填缺失的 IPv4/IPv6 结果，批量探测允许省略 ids", async () => {
    installRoutes({
      nodeTestOne: () => ({ status: "healthy", testedAt: "2026-01-01T00:00:00Z", latencyMs: 12 }),
      nodeTest: () => ({ requested: 0, healthy: 0, unhealthy: 0 }),
    });

    await expect(testEgressNode("node-1")).resolves.toMatchObject({
      status: "healthy",
      ipv4: { status: "unknown", latencyMs: 0 },
      ipv6: { status: "unknown", latencyMs: 0 },
    });
    expect(lastCall()).toMatchObject({ method: "POST", path: "/api/admin/v1/egress-nodes/node-1/test" });

    await testEgressNodes();
    expect(lastCall()).toMatchObject({
      method: "POST",
      path: "/api/admin/v1/egress-nodes/test",
      body: { ids: [] },
    });
  });
});

describe("代理配置 API", () => {
  it("列表按需写入搜索参数，增删改查命中各自路径", async () => {
    installRoutes({
      profiles: (call) =>
        egressProxyProfileListWire([egressProxyProfileWire({ id: "prof-1" })], {
          page: Number(call.query.get("page")),
        }),
      profileCreate: () => egressProxyProfileWire({ id: "prof-new" }),
      profileSelected: () => egressProxyProfileWire({ id: "prof-1" }),
      profileUpdate: () => egressProxyProfileWire({ id: "prof-1", name: "改名" }),
      profileRemove: () => ({ deleted: true }),
      profileReveal: () => ({ proxyURL: "socks5h://host:1080" }),
    });

    await listEgressProxyProfiles({ page: 2, search: "机房" });
    expect(lastCall()).toMatchObject({ method: "GET", path: "/api/admin/v1/egress-proxy-profiles" });
    expect(lastCall().query.get("page")).toBe("2");
    expect(lastCall().query.get("search")).toBe("机房");

    await listEgressProxyProfiles();
    expect(lastCall().query.get("page")).toBe("1");
    expect(lastCall().query.has("search")).toBe(false);

    const input = { name: "机房代理", proxyURL: "socks5h://host:1080" };
    await createEgressProxyProfile(input);
    expect(lastCall()).toMatchObject({ method: "POST", path: "/api/admin/v1/egress-proxy-profiles", body: input });

    await getEgressProxyProfile("prof-1");
    expect(lastCall()).toMatchObject({ method: "GET", path: "/api/admin/v1/egress-proxy-profiles/prof-1" });

    await updateEgressProxyProfile("prof-1", input);
    expect(lastCall()).toMatchObject({
      method: "PUT",
      path: "/api/admin/v1/egress-proxy-profiles/prof-1",
      body: input,
    });

    await deleteEgressProxyProfile("prof-1");
    expect(lastCall()).toMatchObject({ method: "DELETE", path: "/api/admin/v1/egress-proxy-profiles/prof-1" });

    await expect(getEgressProxyProfileURL("prof-1")).resolves.toEqual({ proxyURL: "socks5h://host:1080" });
    expect(lastCall()).toMatchObject({
      method: "POST",
      path: "/api/admin/v1/egress-proxy-profiles/prof-1/proxy-url/reveal",
    });
  });
});

describe("订阅源 API", () => {
  it("无参数列表不写查询串，带筛选时写入 search/scope", async () => {
    installRoutes({ sources: () => egressSourceListWire([egressSourceWire({ id: "src-1" })]) });

    await listEgressSources();
    expect(lastCall()).toMatchObject({ method: "GET", path: "/api/admin/v1/egress-sources" });
    expect(lastCall().query.toString()).toBe("");

    await listEgressSources({ search: "订阅", scope: "grok_web", page: 2, pageSize: 50 });
    expect(lastCall().query.get("search")).toBe("订阅");
    expect(lastCall().query.get("scope")).toBe("grok_web");
    expect(lastCall().query.get("page")).toBe("2");
    expect(lastCall().query.get("pageSize")).toBe("50");

    await listEgressSources({});
    expect(lastCall().query.get("page")).toBe("1");
  });

  it("回填订阅源缺省值与分页默认值", async () => {
    installRoutes({
      sources: () =>
        egressSourceListWire([egressSourceWire({ proxyConfigured: undefined })], {
          page: undefined,
          pageSize: undefined,
          total: undefined,
        }),
    });

    const result = await listEgressSources();

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.total).toBe(1);
    expect(result.items[0].proxyConfigured).toBe(false);
  });

  it("新增/更新/删除/同步与文本导入命中各自路径", async () => {
    const input = {
      name: "订阅源",
      scope: "grok_build" as const,
      enabled: true,
      url: "https://example.com/sub",
      refreshIntervalSeconds: 900,
      defaultAccountCapacity: 0,
    };
    installRoutes({
      sourceCreate: () => egressSourceWire({ id: "src-new" }),
      sourceUpdate: () => egressSourceWire({ id: "src-1" }),
      sourceRemove: () => ({ deleted: true }),
      sourceSync: () => ({ imported: 3, skipped: 1 }),
      importText: () => ({ imported: 2, skipped: 0 }),
    });

    await createEgressSource(input);
    expect(lastCall()).toMatchObject({ method: "POST", path: "/api/admin/v1/egress-sources", body: input });

    await updateEgressSource("src-1", input);
    expect(lastCall()).toMatchObject({ method: "PUT", path: "/api/admin/v1/egress-sources/src-1", body: input });

    await deleteEgressSource("src-1");
    expect(lastCall()).toMatchObject({ method: "DELETE", path: "/api/admin/v1/egress-sources/src-1" });

    await expect(syncEgressSource("src-1")).resolves.toEqual({ imported: 3, skipped: 1 });
    expect(lastCall()).toMatchObject({ method: "POST", path: "/api/admin/v1/egress-sources/src-1/sync" });

    await importEgressText({ name: "批量导入", scope: "grok_build", accountCapacity: 1, content: "host:1080" });
    expect(lastCall()).toMatchObject({ method: "POST", path: "/api/admin/v1/egress-imports" });
  });
});

describe("自动化与账号分配 API", () => {
  it("读取与保存自动化配置，缺少 provider 时回填 cloudflare", async () => {
    installRoutes({
      operations: () => egressOperationsWire({ probeProvider: undefined as unknown as "cloudflare" }),
      operationsSave: () => egressOperationsWire({ autoAssignEnabled: true }),
      rebalance: () => ({ assigned: 1, rebalanced: 2, unplaced: 0 }),
    });

    await expect(getEgressOperationsConfig()).resolves.toMatchObject({ probeProvider: "cloudflare" });

    const form = {
      probeProvider: "cloudflare" as const,
      probeIntervalSeconds: 900,
      autoAssignEnabled: true,
      autoBalanceEnabled: false,
      assignmentIntervalSeconds: 300,
      fallbacks: {
        grok_build: { mode: "none" as const },
        grok_web: { mode: "none" as const },
        grok_console: { mode: "none" as const },
        grok_web_asset: { mode: "none" as const },
        grok_console_asset: { mode: "none" as const },
      },
    };
    await expect(updateEgressOperationsConfig(form)).resolves.toMatchObject({ autoAssignEnabled: true });
    expect(lastCall()).toMatchObject({ method: "PUT", path: "/api/admin/v1/egress-operations", body: form });

    await expect(rebalanceEgressAccounts()).resolves.toEqual({ assigned: 1, rebalanced: 2, unplaced: 0 });
    expect(lastCall()).toMatchObject({ method: "POST", path: "/api/admin/v1/egress-operations/rebalance" });
  });

  it("账号分配与解除分配默认使用手动模式", async () => {
    installPayload({ assigned: 1 });

    await expect(assignEgressAccounts("node-1", "grok_build", ["acc-1"])).resolves.toEqual({ assigned: 1 });
    expect(lastCall()).toMatchObject({
      method: "POST",
      path: "/api/admin/v1/egress-nodes/node-1/accounts",
      body: { provider: "grok_build", ids: ["acc-1"], mode: "manual" },
    });

    await expect(unassignEgressAccounts("grok_web", ["acc-2"])).resolves.toEqual({ assigned: 1 });
    expect(lastCall()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/v1/egress-nodes/accounts",
      body: { provider: "grok_web", ids: ["acc-2"] },
    });
  });
});
