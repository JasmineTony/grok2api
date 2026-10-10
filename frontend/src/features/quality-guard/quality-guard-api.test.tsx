import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProbeProfile,
  deleteProbeProfile,
  getDegradeAccounts,
  getQualityGuardStatus,
  listProbeProfiles,
  runQualityTest,
  updateProbeProfile,
  updateQualityGuardPolicy,
  type QualityGuardStatus,
} from "@/features/quality-guard/quality-guard-api";
import { qualityGuardStatusPath } from "@/features/quality-guard/quality-guard-query";

// 质量守护 API 层测试：只替换 apiRequest 这一个网络边界，请求路径/查询串/请求体与
// decoder 全部走真实实现（含 sidecar 未连接与缺少配置的失败路径）。

const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

type RecordedCall = { path: string; method: string; body: unknown };

const calls: RecordedCall[] = [];

/** 记录调用并把 wire 数据交给真实 decoder（与真实 apiRequest 的解包语义一致）。 */
function install(payload: unknown, method = "GET"): void {
  calls.length = 0;
  apiMock.request.mockImplementation(
    async (path: string, options: { method?: string; body?: unknown }, decode: (value: unknown) => unknown) => {
      calls.push({ path, method: options.method ?? method, body: options.body });
      return decode(payload);
    },
  );
}

function lastCall(): RecordedCall {
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1];
}

const guardConfig = {
  mode: "hybrid" as const,
  model: "grok-4",
  node_ids: ["node-1"],
  active_interval_seconds: 1800,
  passive_poll_seconds: 5,
  soft_tps: 500,
  hard_tps: 1000,
  consecutive_soft: 2,
  consecutive_errors: 2,
  quarantine_seconds: 300,
  min_healthy_nodes: 1,
  max_output_tokens: 512,
  fail_closed: false,
  min_generation_ms: 0,
};

const guardPayload = {
  available: true,
  editable: true,
  startedAt: 1,
  updatedAt: 2,
  lastActiveCycleAt: 3,
  lastPassivePollAt: 4,
  activeProfileId: "profile-1",
  profiles: [
    {
      id: "profile-1",
      name: "方案一",
      built_in: true,
      match_mode: "last_line",
      has_expected: true,
      require_thinking: false,
    },
  ],
  config: guardConfig,
  nodes: {},
  nodeSummary: { total: 1, quarantined: 0, quarantinedLeases: 0 },
  protectedNodeIds: ["node-1"],
  recentEvents: [
    {
      ts: 1,
      event: "node_quarantined",
      node_id: "node-1",
      node_name: "",
      reason: "hard_tps",
      classification: "hard",
      output_tps: 1200,
    },
  ],
  statistics: {
    started_at: 1,
    active: { total: 1, healthy: 1, soft: 0, hard: 0, errors: 0, output_tokens: 10 },
    passive: { total: 1, healthy: 1, soft: 0, hard: 0, errors: 0, output_tokens: 10 },
    actions: { quarantined: 0, restored: 0, suppressed: 0 },
  },
} as unknown as QualityGuardStatus;

beforeEach(() => {
  apiMock.request.mockReset();
});

describe("qualityGuardStatusPath", () => {
  it("省略节点时使用裸路径，空数组显式写入空 nodeId", () => {
    expect(qualityGuardStatusPath()).toBe("/api/admin/v1/egress-quality-guard");
    expect(qualityGuardStatusPath([])).toBe("/api/admin/v1/egress-quality-guard?nodeId=");
    expect(qualityGuardStatusPath(["node-1", "node-2"])).toBe(
      "/api/admin/v1/egress-quality-guard?nodeId=node-1&nodeId=node-2",
    );
  });
});

describe("getQualityGuardStatus", () => {
  it("解码完整状态，并按节点列表拼接查询串", async () => {
    install(guardPayload);
    await getQualityGuardStatus(["node-1"]);

    expect(lastCall().path).toBe("/api/admin/v1/egress-quality-guard?nodeId=node-1");
    expect(lastCall().method).toBe("GET");
  });

  it("sidecar 未连接时按原样返回不可用状态，不要求配置字段", async () => {
    install({ available: false });

    await expect(getQualityGuardStatus()).resolves.toEqual({ available: false });
    expect(lastCall().path).toBe("/api/admin/v1/egress-quality-guard");
  });

  it("缺少必需字段时拒绝解码", async () => {
    install({ available: true, updatedAt: 1 });

    await expect(getQualityGuardStatus()).rejects.toThrow();
  });
});

describe("runQualityTest", () => {
  it("缺少守护配置时抛出明确错误，不发请求", async () => {
    install({});
    const status: QualityGuardStatus = { available: true };

    // 配置缺失是同步失败（不产生请求），因此断言同步抛出而不是 rejected promise。
    expect(() => runQualityTest("node-1", status)).toThrow("Quality guard configuration is unavailable");
    expect(calls).toHaveLength(0);
  });

  it("指定方案时提交 profileId，否则提交空对象", async () => {
    const result = {
      nodeId: "node-1",
      statusCode: 200,
      firstTokenMs: 100,
      durationMs: 2_000,
      outputTokens: 64,
      reasoningTokens: 8,
      visibleTokens: 56,
      outputTokensPerSecond: 320,
      generationMs: 1_900,
      expectedMatched: true,
      thinkingRequired: false,
    };
    install(result, "POST");

    await expect(runQualityTest("node-1", guardPayload, "profile-1")).resolves.toEqual(result);
    expect(lastCall()).toMatchObject({
      path: "/api/admin/v1/egress-quality-guard/nodes/node-1/test",
      method: "POST",
      body: { profileId: "profile-1" },
    });

    await runQualityTest("node-1", guardPayload);
    expect(lastCall().body).toEqual({});
  });
});

describe("探测方案与策略 API", () => {
  it("列表/新增/更新/删除命中各自路径", async () => {
    install({ activeProfileId: "profile-1", items: [] });
    await expect(listProbeProfiles()).resolves.toEqual({ activeProfileId: "profile-1", items: [] });
    expect(lastCall()).toMatchObject({ path: "/api/admin/v1/egress-quality-guard/profiles", method: "GET" });

    const profile = {
      id: "profile-new",
      name: "新方案",
      built_in: false,
      prompt: "ping",
      match_mode: "last_line",
      require_thinking: false,
    };
    install(profile, "POST");
    await expect(createProbeProfile({ name: "新方案", prompt: "ping", matchMode: "last_line" })).resolves.toEqual(
      profile,
    );
    expect(lastCall()).toMatchObject({
      path: "/api/admin/v1/egress-quality-guard/profiles",
      method: "POST",
      body: { name: "新方案", prompt: "ping", matchMode: "last_line" },
    });

    install({ ...profile, name: "改名" }, "PUT");
    await expect(
      updateProbeProfile("profile-new", { name: "改名", prompt: "ping", matchMode: "regex" }),
    ).resolves.toMatchObject({
      name: "改名",
    });
    expect(lastCall()).toMatchObject({
      path: "/api/admin/v1/egress-quality-guard/profiles/profile-new",
      method: "PUT",
    });

    install({ deleted: true }, "DELETE");
    await expect(deleteProbeProfile("profile-new")).resolves.toEqual({ deleted: true });
    expect(lastCall()).toMatchObject({
      path: "/api/admin/v1/egress-quality-guard/profiles/profile-new",
      method: "DELETE",
    });
  });

  it("保存策略提交完整表单并解码 saved", async () => {
    install({ saved: true }, "PUT");
    const policy = {
      mode: "hybrid" as const,
      activeIntervalSeconds: 1800,
      passivePollSeconds: 5,
      softTPS: 500,
      hardTPS: 1000,
      consecutiveSoft: 2,
      consecutiveErrors: 2,
      quarantineSeconds: 300,
      minHealthyNodes: 1,
    };

    await expect(updateQualityGuardPolicy(policy)).resolves.toEqual({ saved: true });
    expect(lastCall()).toMatchObject({
      path: "/api/admin/v1/egress-quality-guard/config",
      method: "PUT",
      body: policy,
    });
  });
});

describe("getDegradeAccounts", () => {
  const summary = {
    window: "24h",
    generatedAt: "2026-01-02T03:04:05Z",
    thresholds: { softTPS: 500, hardTPS: 1000, minGenMs: 0, minOutputTokens: 32 },
    totals: {
      hits: 0,
      accounts: 0,
      stillEnabled: 0,
      disabled: 0,
      deleted: 0,
      hard: 0,
      soft: 0,
      burst: 0,
      thinking: 0,
      maxTPS: 0,
    },
    series: [],
    nodes: [],
    accounts: [],
    accountPage: { page: 1, pageSize: 50, total: 0, hasMore: false },
    events: [],
  };

  it("只写基础分页参数，其余筛选条件按需追加", async () => {
    install(summary);
    await getDegradeAccounts({ window: "24h", page: 1, pageSize: 50 });

    const query = new URLSearchParams(lastCall().path.split("?")[1]);
    expect(lastCall().path.startsWith("/api/admin/v1/request-audits/degrade-accounts?")).toBe(true);
    expect(query.get("window")).toBe("24h");
    expect(query.get("page")).toBe("1");
    expect(query.get("pageSize")).toBe("50");
    expect(query.has("softTPS")).toBe(false);
    expect(query.has("failClosed")).toBe(false);
    expect(query.has("search")).toBe(false);
    expect(query.has("status")).toBe(false);
    expect(query.has("class")).toBe(false);
    expect(query.has("minHits")).toBe(false);
  });

  it("阈值、失败关闭、搜索、状态与分类筛选写入查询串", async () => {
    install(summary);
    await getDegradeAccounts({
      window: "7d",
      softTPS: 500,
      hardTPS: 1000,
      failClosed: false,
      minGenMs: 200,
      search: "a@example.com",
      status: "enabled",
      class: "missing_thinking",
      minHits: 3,
      page: 2,
      pageSize: 100,
    });

    const query = new URLSearchParams(lastCall().path.split("?")[1]);
    expect(query.get("softTPS")).toBe("500");
    expect(query.get("hardTPS")).toBe("1000");
    expect(query.get("failClosed")).toBe("false");
    expect(query.get("minGenMs")).toBe("200");
    expect(query.get("search")).toBe("a@example.com");
    expect(query.get("status")).toBe("enabled");
    expect(query.get("class")).toBe("missing_thinking");
    expect(query.get("minHits")).toBe("3");
    expect(query.get("page")).toBe("2");
    expect(query.get("pageSize")).toBe("100");
  });

  it("minHits 为 1 时不写入（1 与未筛选等价）", async () => {
    install(summary);
    await getDegradeAccounts({ window: "1h", minHits: 1, page: 1, pageSize: 50 });

    expect(new URLSearchParams(lastCall().path.split("?")[1]).has("minHits")).toBe(false);
  });
});
