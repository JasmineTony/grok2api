import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "sonner";
import { vi } from "vitest";
import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { DegradeAccountsPanel } from "@/features/quality-guard/degrade-accounts-panel";
import { QualityGuardPage } from "@/features/quality-guard/quality-guard-page";
import { i18n } from "@/shared/i18n";

// 质量守护测试共用的网络边界替身与渲染脚手架（仅测试引用）。
// 只替换全局 fetch：页面、hooks、解码器与 React Query 状态流全部使用真实实现。

// Radix 弹层（Dialog / AlertDialog / DropdownMenu）定位时会用到 ResizeObserver，jsdom 未实现。
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// Radix Select 在 jsdom 中需要指针捕获 API；缺失时补最小替身，避免把环境缺口误判成组件缺陷。
if (typeof Element !== "undefined" && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
}

// jsdom 未实现 scrollIntoView，Radix Select 打开/移动高亮项时会调用它。
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

export type RecordedRequest = { url: string; method: string; body: unknown };

export type GuardApiFailure =
  "status" | "nodes" | "profiles" | "degrade" | "accounts" | "nodeAction" | "nodeTest" | "profileAction" | "policySave";

export type GuardApiOptions = {
  status?: Record<string, unknown>;
  nodes?: Record<string, unknown>[];
  nodesTotal?: number;
  enabledTotal?: number;
  profiles?: Record<string, unknown>[];
  activeProfileId?: string;
  degrade?: Record<string, unknown>;
  nodeTestResult?: Record<string, unknown>;
  failure?: GuardApiFailure;
};

const DEFAULT_USER_AGENTS = {
  grok_build: "grok-build",
  grok_web: "grok-web",
  grok_console: "grok-console",
  grok_web_asset: "grok-web-asset",
  grok_console_asset: "grok-console-asset",
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

// 完整的守护状态：字段与 decodeStatus 的校验一致，updatedAt 保持新鲜以命中「运行正常」。
function guardProfiles(): Record<string, unknown>[] {
  return [
    {
      id: "profile-builtin",
      name: "内置方案",
      built_in: true,
      match_mode: "last_line",
      has_expected: true,
      require_thinking: false,
    },
    {
      id: "profile-custom",
      name: "自定义方案",
      built_in: false,
      match_mode: "regex",
      has_expected: false,
      require_thinking: true,
    },
  ];
}

function guardConfig(): Record<string, unknown> {
  return {
    mode: "hybrid",
    model: "grok-4",
    node_ids: ["node-1", "node-2"],
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
}

export function guardNodeState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    active_soft_strikes: 0,
    passive_soft_strikes: 0,
    error_strikes: 0,
    quarantined_until: 0,
    disabled_by_guard: false,
    last_reason: "within_threshold",
    last_probe_at: nowSeconds() - 60,
    last_observed_at: nowSeconds() - 60,
    last_source: "passive",
    last_classification: "healthy",
    last_output_tps: 320,
    last_output_tokens: 96,
    last_first_token_ms: 280,
    last_duration_ms: 2000,
    ...overrides,
  };
}

function guardNodes(): Record<string, Record<string, unknown>> {
  return {
    "node-1": guardNodeState({
      active_soft_strikes: 2,
      disabled_by_guard: true,
      last_reason: "hard_tps",
      last_source: "active",
      last_classification: "hard",
      last_output_tps: 1200,
      last_output_tokens: 128,
      last_first_token_ms: 320,
      last_duration_ms: 1500,
    }),
    "node-2": guardNodeState(),
  };
}

function guardEvent(): Record<string, unknown> {
  return {
    ts: nowSeconds() - 60,
    event: "node_quarantined",
    node_id: "node-1",
    node_name: "东京出口",
    account_id: "acc-1",
    request_id: "req-1",
    reason: "hard_tps",
    classification: "hard",
    output_tps: 1200,
  };
}

function guardStatistics(): Record<string, unknown> {
  return {
    started_at: nowSeconds() - 600,
    active: { total: 12, healthy: 10, soft: 1, hard: 1, errors: 0, output_tokens: 4096 },
    passive: { total: 8, healthy: 7, soft: 1, hard: 0, errors: 0, output_tokens: 2048 },
    actions: { quarantined: 1, restored: 0, suppressed: 2 },
  };
}

export function guardStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    available: true,
    editable: true,
    startedAt: nowSeconds() - 600,
    updatedAt: nowSeconds() - 5,
    lastActiveCycleAt: nowSeconds() - 30,
    lastPassivePollAt: nowSeconds() - 5,
    activeProfileId: "profile-builtin",
    profiles: guardProfiles(),
    config: guardConfig(),
    nodes: guardNodes(),
    nodeSummary: { total: 2, quarantined: 1, quarantinedLeases: 1 },
    protectedNodeIds: ["node-2"],
    recentEvents: [guardEvent()],
    statistics: guardStatistics(),
    ...overrides,
  };
}

export function guardNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "node-1",
    name: "东京出口",
    scope: "grok_build",
    enabled: true,
    proxyConfigured: true,
    userAgent: "",
    cookieConfigured: false,
    accountBoundProxy: false,
    proxyPool: false,
    health: 1,
    failureCount: 0,
    accountCapacity: 10,
    assignedAccountCount: 3,
    probeStatus: "healthy",
    probeLatencyMs: 12,
    ...overrides,
  };
}

export function probeProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "profile-builtin",
    name: "内置方案",
    built_in: true,
    prompt: "ping",
    expected_text: "pong",
    match_mode: "last_line",
    require_thinking: false,
    ...overrides,
  };
}

function degradeTotals(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hits: 5,
    accounts: 2,
    stillEnabled: 1,
    disabled: 1,
    deleted: 0,
    hard: 2,
    soft: 1,
    burst: 1,
    thinking: 1,
    maxTPS: 1200,
    ...overrides,
  };
}

function degradeAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "acc-1",
    name: "a@example.com",
    email: "a@example.com",
    hits: 3,
    maxTPS: 1200,
    classes: { hard_tps: 2, missing_thinking: 1 },
    nodes: ["东京出口"],
    last: "2026-01-02T03:04:05Z",
    enabled: true,
    found: true,
    bfs: 0,
    ...overrides,
  };
}

function degradeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ev-1",
    requestId: "req-1",
    accountId: "acc-1",
    accountName: "a@example.com",
    nodeName: "东京出口",
    outputTokens: 40,
    tps: 1200,
    class: "missing_thinking",
    createdAt: "2026-01-02T03:04:05Z",
    model: "grok-4",
    ...overrides,
  };
}

export function degradeSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    window: "24h",
    generatedAt: "2026-01-02T03:04:05Z",
    thresholds: { softTPS: 500, hardTPS: 1000, minGenMs: 0, minOutputTokens: 32 },
    totals: degradeTotals(),
    series: [{ label: "01:00", count: 2, severe: 1 }],
    nodes: [{ name: "东京出口", hits: 3, accounts: 2, maxTPS: 1200 }],
    accounts: [degradeAccount()],
    accountPage: { page: 1, pageSize: 50, total: 1, hasMore: false },
    events: [degradeEvent()],
    ...overrides,
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
}

// 错误码刻意不落在 apiErrors 文案表里，便于断言真实透出的 message（与生产错误信封一致）。
function errorResponse(code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

export function queryParam(url: string, name: string): string | null {
  return new URL(url, "http://localhost").searchParams.get(name);
}

export function urlsOf(requests: RecordedRequest[], pathPrefix: string): string[] {
  return requests.filter((request) => request.url.startsWith(pathPrefix)).map((request) => request.url);
}

export function lastUrlOf(requests: RecordedRequest[], pathPrefix: string): string {
  return urlsOf(requests, pathPrefix).at(-1) ?? "";
}

function guardProfilesResponse(options: GuardApiOptions): Response {
  if (options.failure === "profiles") return errorResponse("guardProfilesReadFailed", "探针方案读取失败");
  return jsonResponse({
    activeProfileId: options.activeProfileId ?? "profile-builtin",
    items: options.profiles ?? [
      probeProfile(),
      probeProfile({
        id: "profile-custom",
        name: "自定义方案",
        built_in: false,
        expected_text: undefined,
        match_mode: "regex",
      }),
    ],
  });
}

function egressNodesResponse(options: GuardApiOptions, url: string, nodes: Record<string, unknown>[]): Response {
  if (options.failure === "nodes") return errorResponse("guardNodesReadFailed", "出口节点读取失败");
  const page = Number(queryParam(url, "page") ?? 1);
  const pageSize = Number(queryParam(url, "pageSize") ?? 20);
  const enabledOnly = queryParam(url, "enabled") === "enabled";
  return jsonResponse({
    items: pageSize === 1 ? [] : nodes,
    page,
    pageSize,
    total: enabledOnly ? (options.enabledTotal ?? nodes.length) : (options.nodesTotal ?? nodes.length),
    defaultUserAgents: DEFAULT_USER_AGENTS,
  });
}

// 手动探测的默认结果：TPS 高于 hard 阈值，命中 hard_tps 分类（用于验证立即刷新表格）。
function defaultNodeTestResult(): Record<string, unknown> {
  return {
    nodeId: "node-1",
    statusCode: 200,
    firstTokenMs: 120,
    durationMs: 2_000,
    outputTokens: 128,
    reasoningTokens: 16,
    visibleTokens: 112,
    outputTokensPerSecond: 1_200,
    generationMs: 2_000,
    expectedMatched: true,
    thinkingRequired: false,
  };
}

function respondGuardRoutes(options: GuardApiOptions, path: string, method: string): Response | null {
  if (path === "/api/admin/v1/egress-quality-guard") {
    if (options.failure === "status") return errorResponse("guardStatusReadFailed", "守护状态读取失败");
    return jsonResponse(options.status ?? guardStatus());
  }
  if (path === "/api/admin/v1/egress-quality-guard/profiles" && method === "GET") {
    return guardProfilesResponse(options);
  }
  if (path === "/api/admin/v1/egress-quality-guard/profiles" && method === "POST") {
    if (options.failure === "profileAction") return errorResponse("guardProfileWriteFailed", "探针方案保存失败");
    return jsonResponse(probeProfile({ id: "profile-new", name: "新方案", built_in: false }));
  }
  if (/^\/api\/admin\/v1\/egress-quality-guard\/profiles\/[^/]+$/.test(path)) {
    if (options.failure === "profileAction") return errorResponse("guardProfileWriteFailed", "探针方案写入失败");
    if (method === "DELETE") return jsonResponse({ deleted: true });
    if (method === "PUT")
      return jsonResponse(probeProfile({ id: path.split("/").at(-1) ?? "profile-1", built_in: false }));
  }
  if (path === "/api/admin/v1/egress-quality-guard/config" && method === "PUT") {
    if (options.failure === "policySave") return errorResponse("guardPolicySaveFailed", "守护策略保存失败");
    return jsonResponse({ saved: true });
  }
  if (/^\/api\/admin\/v1\/egress-quality-guard\/nodes\/[^/]+\/test$/.test(path) && method === "POST") {
    if (options.failure === "nodeTest") return errorResponse("guardNodeTestFailed", "节点探测失败");
    return jsonResponse(options.nodeTestResult ?? defaultNodeTestResult());
  }
  return null;
}

function respondEgressNodeRoutes(
  options: GuardApiOptions,
  path: string,
  method: string,
  url: string,
  nodes: Record<string, unknown>[],
): Response | null {
  if (path === "/api/admin/v1/egress-nodes" && method === "GET") {
    return egressNodesResponse(options, url, nodes);
  }
  if (path === "/api/admin/v1/egress-nodes" && method === "POST") {
    if (options.failure === "nodeAction") return errorResponse("guardNodeCreateFailed", "节点创建失败");
    return jsonResponse(guardNode({ id: "node-new", name: "新出口" }));
  }
  if (path === "/api/admin/v1/egress-nodes" && method === "DELETE") {
    if (options.failure === "nodeAction") return errorResponse("guardNodeDeleteFailed", "节点删除失败");
    return jsonResponse({ deleted: 1 });
  }
  if (path === "/api/admin/v1/egress-nodes/batch" && method === "PATCH") {
    if (options.failure === "nodeAction") return errorResponse("guardNodeBatchFailed", "节点批量操作失败");
    return jsonResponse({ updated: 1 });
  }
  // 批量路径必须先于单节点正则判定，否则 /egress-nodes/batch 会被当成节点 ID。
  if (/^\/api\/admin\/v1\/egress-nodes\/[^/]+$/.test(path)) {
    if (options.failure === "nodeAction") return errorResponse("guardNodeWriteFailed", "节点写入失败");
    if (method === "PUT") return jsonResponse(guardNode());
    if (method === "DELETE") return jsonResponse({ deleted: true });
  }
  return null;
}

function respondAccountRoutes(options: GuardApiOptions, path: string, method: string): Response | null {
  if (path === "/api/admin/v1/request-audits/degrade-accounts") {
    if (options.failure === "degrade") return errorResponse("degradeAccountsReadFailed", "降智账号读取失败");
    return jsonResponse(options.degrade ?? degradeSummary());
  }
  if (path === "/api/admin/v1/accounts/batch" && method === "PATCH") {
    if (options.failure === "accounts") return errorResponse("accountsBatchFailed", "账号批量操作失败");
    return jsonResponse({ updated: 1 });
  }
  return null;
}

function createResponder(options: GuardApiOptions) {
  const nodes = options.nodes ?? [guardNode(), guardNode({ id: "node-2", name: "新加坡出口" })];
  return (url: string, method: string): Response => {
    const path = url.split("?")[0];
    const response =
      respondGuardRoutes(options, path, method) ??
      respondEgressNodeRoutes(options, path, method, url, nodes) ??
      respondAccountRoutes(options, path, method);
    if (response) return response;
    throw new Error(`unexpected request: ${method} ${url}`);
  };
}

export function installQualityGuardApi(options: GuardApiOptions = {}) {
  const requests: RecordedRequest[] = [];
  const respond = createResponder(options);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return respond(url, method);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

// 页面本身不挂载 Toaster（由 app shell 负责），测试里补上，才能断言操作失败/成功的用户可见提示。
function renderWithProviders(node: ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createQueryClient()}>
        <TooltipProvider delayDuration={0}>
          {node}
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

export function renderQualityGuardPage() {
  return renderWithProviders(<QualityGuardPage />);
}

export function renderDegradeAccountsPanel() {
  return renderWithProviders(<DegradeAccountsPanel softTPS={500} hardTPS={1000} failClosed />);
}

export function setupUser() {
  // 覆盖率插桩 + 并发环境下逐键等待很敏感，统一关闭按键间隔。
  return userEvent.setup({ delay: null });
}

export async function openTab(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(await screen.findByRole("tab", { name }));
}

// Radix 子菜单在 jsdom 中没有真实布局：指针移动会触发 SubTrigger 的 pointerleave，
// 因此只派发一次指针按下/抬起。
export async function clickRadioItem(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  const item = await screen.findByRole("menuitemradio", { name });
  await user.pointer({ target: item, keys: "[MouseLeft]" });
}

export function openNodeFilters(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  return user.click(screen.getByRole("button", { name: new RegExp(`^${i18n.t("common.filter")}`) }));
}
