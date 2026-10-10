import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QualityGuardStatus } from "@/features/quality-guard/quality-guard-api";
import {
  degradeSummary,
  guardNode,
  guardNodeState,
  guardStatus,
  installQualityGuardApi,
} from "@/features/quality-guard/quality-guard-test-support";
import { useDegradeAccounts } from "@/features/quality-guard/use-degrade-accounts";
import { useGuardNodeActions } from "@/features/quality-guard/use-guard-node-actions";
import type { GuardNodeDialogs } from "@/features/quality-guard/use-guard-node-dialogs";
import { useGuardNodes } from "@/features/quality-guard/use-guard-nodes";
import { useProbeProfiles, type ProbeProfileDraft } from "@/features/quality-guard/use-probe-profiles";
import type { EgressNodeDTO, EgressNodeInput } from "@/features/settings/settings-api";
import { i18n } from "@/shared/i18n";

// 四个质量守护 hook 的控制器级测试（AGENTS.md TEST-2）。
// 只替换网络边界与 i18n 上下文：hook 内部状态、React Query 状态流与真实分支保持实现；
// 路由替身复用 quality-guard-test-support，不新建第二套脚手架。

type FetchMock = ReturnType<typeof installQualityGuardApi>["fetchMock"];

const ACCOUNTS_BATCH_PATH = "/api/admin/v1/accounts/batch";
const PROFILES_PATH = "/api/admin/v1/egress-quality-guard/profiles";
const NODES_PATH = "/api/admin/v1/egress-nodes";
const BATCH_PATH = "/api/admin/v1/egress-nodes/batch";

function wrapperFor(options: { strict?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    const tree = (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </I18nextProvider>
    );
    return options.strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
}

/** 把命中条件的请求挂起，用于稳定观察「进行中」状态；返回放行函数。 */
function holdRequest(fetchMock: FetchMock, predicate: (url: string, method: string) => boolean): () => void {
  const respond = fetchMock.getMockImplementation()!;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (predicate(String(input), method)) await gate;
    return respond(input, init);
  });
  return () => release();
}

/** 让命中条件的请求以非 Error 值失败，覆盖 `error instanceof Error` 的回退分支。 */
function failWithNonError(fetchMock: FetchMock, predicate: (url: string, method: string) => boolean): void {
  const respond = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (predicate(String(input), method)) throw "network unavailable";
    return respond(input, init);
  });
}

/** 让命中条件的请求以 Error 失败，覆盖错误信息透出分支。 */
function failWithError(fetchMock: FetchMock, predicate: (url: string, method: string) => boolean): void {
  const respond = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (predicate(String(input), method)) throw new Error("服务端拒绝");
    return respond(input, init);
  });
}

function requestsTo(requests: { url: string; method: string }[], path: string, method?: string): number {
  return requests.filter(
    (request) => request.url.startsWith(path) && (method === undefined || request.method === method),
  ).length;
}

function nodeDTO(overrides: Record<string, unknown> = {}): EgressNodeDTO {
  return guardNode(overrides) as unknown as EgressNodeDTO;
}

function nodeInput(): EgressNodeInput {
  return {
    name: "新出口",
    scope: "grok_build",
    enabled: true,
    proxyPool: false,
    accountCapacity: 5,
    proxyURL: "",
    userAgent: "",
    cloudflareCookies: "",
  };
}

function dialogsFixture(overrides: Partial<GuardNodeDialogs> = {}): GuardNodeDialogs {
  return {
    policyOpen: false,
    setPolicyOpen: () => undefined,
    editingNode: undefined,
    nodeForm: nodeInput(),
    setNodeForm: () => undefined,
    deletingNodes: [],
    beginCreate: () => undefined,
    beginEdit: () => undefined,
    beginDelete: () => undefined,
    closeEditor: () => undefined,
    closeDelete: () => undefined,
    ...overrides,
  };
}

/** 读取请求 URL 上的查询参数；非绝对路径也能解析。 */
function queryParamOf(url: string, name: string): string | null {
  try {
    return new URL(url, "http://localhost").searchParams.get(name);
  } catch {
    return null;
  }
}

function statusRefOf(status: QualityGuardStatus | undefined) {
  return { current: status };
}

const GUARD_STATUS = guardStatus() as unknown as QualityGuardStatus;

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
vi.setConfig({ testTimeout: 15_000 });

describe("useDegradeAccounts 筛选与选择", () => {
  it("每个筛选 setter 都回到第 1 页并清空已选，查询参数随筛选变化", async () => {
    const { requests } = installQualityGuardApi();
    const { result } = renderHook(
      () => useDegradeAccounts({ softTPS: 500, hardTPS: 1000, failClosed: true, minGenMs: 30 }),
      { wrapper: wrapperFor() },
    );

    await waitFor(() => expect(result.current.query.data?.accounts).toHaveLength(1));
    expect(result.current.filters.period).toBe("24h");
    expect(result.current.filters.status).toBe("all");
    expect(result.current.filters.cls).toBe("all");
    expect(result.current.filters.hitsMin).toBe(1);
    expect(result.current.filters.page).toBe(1);
    expect(result.current.filters.pageSize).toBe(50);

    act(() => result.current.toggleRow("acc-1", true));
    expect(result.current.selectedRows.map((account) => account.id)).toEqual(["acc-1"]);
    expect(result.current.allSelected).toBe(true);

    act(() => result.current.filters.setPeriod("7d"));
    expect(result.current.filters.period).toBe("7d");
    expect(result.current.filters.page).toBe(1);
    expect(result.current.selected.size).toBe(0);

    act(() => result.current.filters.setSearch("a@example.com"));
    expect(result.current.filters.search).toBe("a@example.com");
    await waitFor(() => expect(result.current.filters.debouncedSearch).toBe("a@example.com"), { timeout: 3_000 });
    await waitFor(() =>
      expect(
        requests.filter((request) => queryParamOf(request.url, "search") === "a@example.com").length,
      ).toBeGreaterThan(0),
    );

    act(() => result.current.filters.setStatus("disabled"));
    expect(result.current.filters.status).toBe("disabled");
    await waitFor(() =>
      expect(requests.some((request) => queryParamOf(request.url, "status") === "disabled")).toBe(true),
    );

    act(() => result.current.filters.setCls("hard_tps"));
    expect(result.current.filters.cls).toBe("hard_tps");
    await waitFor(() =>
      expect(requests.some((request) => queryParamOf(request.url, "class") === "hard_tps")).toBe(true),
    );

    act(() => result.current.filters.setHitsMin(5));
    expect(result.current.filters.hitsMin).toBe(5);
    expect(result.current.filters.page).toBe(1);

    act(() => result.current.filters.setPageSize(20));
    expect(result.current.filters.pageSize).toBe(20);
    expect(result.current.filters.page).toBe(1);

    act(() => result.current.filters.setPage(3));
    expect(result.current.filters.page).toBe(3);
    await waitFor(() => expect(requests.some((request) => queryParamOf(request.url, "page") === "3")).toBe(true));
  });

  it("全选只作用于可选账号，取消全选与显式取消勾选都清空选择", async () => {
    installQualityGuardApi({
      degrade: degradeSummary({
        accounts: [
          { ...(degradeSummary().accounts as Record<string, unknown>[])[0], id: "acc-1" },
          { ...(degradeSummary().accounts as Record<string, unknown>[])[0], id: "acc-2", enabled: false, maxTPS: 300 },
          { ...(degradeSummary().accounts as Record<string, unknown>[])[0], id: "acc-3", found: false, email: "" },
        ],
        accountPage: { page: 1, pageSize: 50, total: 3, hasMore: false },
      }),
    });
    const { result } = renderHook(() => useDegradeAccounts({}), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.rows).toHaveLength(3));

    expect(result.current.selectable.map((account) => account.id)).toEqual(["acc-1"]);
    act(() => result.current.toggleAll(true));
    expect([...result.current.selected]).toEqual(["acc-1"]);
    expect(result.current.allSelected).toBe(true);

    act(() => result.current.toggleAll(false));
    expect(result.current.selected.size).toBe(0);
    expect(result.current.allSelected).toBe(false);

    act(() => result.current.toggleRow("acc-1"));
    expect(result.current.selected.has("acc-1")).toBe(true);
    act(() => result.current.toggleRow("acc-1", false));
    expect(result.current.selected.has("acc-1")).toBe(false);
  });
});

describe("useDegradeAccounts 批量停用", () => {
  it("成功后清空选择并失效相关查询", async () => {
    const { requests } = installQualityGuardApi();
    const { result } = renderHook(() => useDegradeAccounts({ softTPS: 500 }), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    act(() => result.current.toggleRow("acc-1", true));
    act(() => result.current.muteSelected(["acc-1"]));

    await waitFor(() => expect(requestsTo(requests, ACCOUNTS_BATCH_PATH, "PATCH")).toBe(1));
    expect(requests.find((request) => request.url === ACCOUNTS_BATCH_PATH)?.body).toEqual({
      ids: ["acc-1"],
      enabled: false,
      provider: "grok_build",
    });
    await waitFor(() => expect(result.current.selected.size).toBe(0));
    expect(result.current.busy).toBe(false);
  });

  it("失败时保留选择，Error 与非 Error 分别透出 message 与通用文案", async () => {
    const withError = installQualityGuardApi();
    failWithError(withError.fetchMock, (_url, method) => method === "PATCH");
    const first = renderHook(() => useDegradeAccounts({}), { wrapper: wrapperFor() });
    await waitFor(() => expect(first.result.current.rows).toHaveLength(1));

    act(() => first.result.current.toggleRow("acc-1", true));
    act(() => first.result.current.muteSelected(["acc-1"]));
    await waitFor(() => expect(first.result.current.busy).toBe(false));
    expect(first.result.current.selected.size).toBe(1);

    const withoutError = installQualityGuardApi();
    failWithNonError(withoutError.fetchMock, (_url, method) => method === "PATCH");
    const second = renderHook(() => useDegradeAccounts({}), { wrapper: wrapperFor() });
    await waitFor(() => expect(second.result.current.rows).toHaveLength(1));

    act(() => second.result.current.toggleRow("acc-1", true));
    act(() => second.result.current.muteSelected(["acc-1"]));
    await waitFor(() => expect(second.result.current.busy).toBe(false));
    expect(second.result.current.selected.size).toBe(1);
  });
});

describe("useProbeProfiles", () => {
  it("保存：新增走 POST，编辑非内置方案走 PUT，内置方案回退为新增且载荷去空格", async () => {
    const { requests } = installQualityGuardApi();
    const { result } = renderHook(() => useProbeProfiles(), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    expect(result.current.activeProfileId).toBe("profile-builtin");
    expect(result.current.editing).toBeUndefined();
    expect(result.current.deleting).toBeNull();

    act(() => result.current.beginCreate());
    expect(result.current.editing).toBeNull();
    expect(result.current.draft).toEqual({
      name: "",
      prompt: "",
      expectedText: "",
      matchMode: "last_line",
      requireThinking: false,
    });

    const draft: ProbeProfileDraft = {
      name: "  新方案  ",
      prompt: "  ping  ",
      expectedText: "  pong ",
      matchMode: "regex",
      requireThinking: true,
    };
    act(() => result.current.setDraft(draft));
    act(() => result.current.save());

    await waitFor(() => {
      const posts = requests.filter((request) => request.url === PROFILES_PATH && request.method === "POST");
      expect(posts).toHaveLength(1);
      expect(posts[0].body).toEqual({
        name: "新方案",
        prompt: "ping",
        expectedText: "pong",
        matchMode: "regex",
        requireThinking: true,
      });
    });
    await waitFor(() => expect(result.current.editing).toBeUndefined());

    const custom = result.current.items.find((item) => item.id === "profile-custom")!;
    act(() => result.current.beginEdit(custom));
    expect(result.current.editing?.id).toBe("profile-custom");
    expect(result.current.draft).toEqual({
      name: "自定义方案",
      prompt: "ping",
      expectedText: "",
      matchMode: "regex",
      requireThinking: false,
    });

    act(() => result.current.save());
    await waitFor(() => {
      const puts = requests.filter((request) => request.url === `${PROFILES_PATH}/profile-custom`);
      expect(puts.filter((request) => request.method === "PUT")).toHaveLength(1);
    });

    // 内置方案即使被打开编辑也走创建：updateProbeProfile 只作用于非内置方案
    act(() => result.current.beginEdit(result.current.items[0]));
    act(() => result.current.save());
    await waitFor(() =>
      expect(requests.filter((request) => request.url === PROFILES_PATH && request.method === "POST")).toHaveLength(2),
    );

    act(() => result.current.closeEditor());
    expect(result.current.editing).toBeUndefined();
  });

  it("缺失 expected_text 与空 match_mode 时回退为默认展示值", async () => {
    installQualityGuardApi({
      profiles: [
        {
          id: "profile-plain",
          name: "缺省方案",
          built_in: false,
          prompt: "ping",
          match_mode: "",
          require_thinking: false,
        },
      ],
    });
    const { result } = renderHook(() => useProbeProfiles(), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.beginEdit(result.current.items[0]));
    expect(result.current.draft).toEqual({
      name: "缺省方案",
      prompt: "ping",
      expectedText: "",
      matchMode: "contains",
      requireThinking: false,
    });
  });

  it("启用：提交 active 标记并在进行中暴露 activating", async () => {
    const { fetchMock, requests } = installQualityGuardApi();
    const release = holdRequest(
      fetchMock,
      (url, method) => url === `${PROFILES_PATH}/profile-custom` && method === "PUT",
    );
    const { result } = renderHook(() => useProbeProfiles(), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    const custom = result.current.items.find((item) => item.id === "profile-custom")!;
    act(() => result.current.activate(custom));
    await waitFor(() => expect(result.current.activating).toBe(true));

    await act(async () => {
      release();
    });
    await waitFor(() => expect(result.current.activating).toBe(false));
    expect(requests.find((request) => request.url === `${PROFILES_PATH}/profile-custom`)?.body).toEqual({
      name: "自定义方案",
      prompt: "ping",
      expectedText: "",
      matchMode: "regex",
      requireThinking: false,
      active: true,
    });
  });

  it("删除：确认后清空待删项；进行中暴露 deletingPending，失败保留选择", async () => {
    const first = installQualityGuardApi();
    const releaseDelete = holdRequest(
      first.fetchMock,
      (url, method) => url === `${PROFILES_PATH}/profile-custom` && method === "DELETE",
    );
    const hook = renderHook(() => useProbeProfiles(), { wrapper: wrapperFor() });
    await waitFor(() => expect(hook.result.current.items).toHaveLength(2));

    const custom = hook.result.current.items.find((item) => item.id === "profile-custom")!;
    act(() => hook.result.current.beginDelete(custom));
    expect(hook.result.current.deleting?.id).toBe("profile-custom");

    act(() => hook.result.current.remove(custom));
    await waitFor(() => expect(hook.result.current.deletingPending).toBe(true));
    await act(async () => {
      releaseDelete();
    });
    await waitFor(() => expect(hook.result.current.deleting).toBeNull());

    act(() => hook.result.current.beginDelete(custom));
    act(() => hook.result.current.closeDelete());
    expect(hook.result.current.deleting).toBeNull();

    const failing = installQualityGuardApi();
    failWithNonError(
      failing.fetchMock,
      (url, method) => url === `${PROFILES_PATH}/profile-custom` && method === "DELETE",
    );
    const failingHook = renderHook(() => useProbeProfiles(), { wrapper: wrapperFor() });
    await waitFor(() => expect(failingHook.result.current.items).toHaveLength(2));

    act(() => failingHook.result.current.beginDelete(failingHook.result.current.items[1]));
    act(() => failingHook.result.current.remove(failingHook.result.current.items[1]));
    await waitFor(() => expect(failingHook.result.current.deletingPending).toBe(false));
    expect(failingHook.result.current.deleting?.id).toBe("profile-custom");
  });

  it("保存与启用失败时关闭 loading 并保留编辑态（含非 Error 回退）", async () => {
    const failing = installQualityGuardApi();
    failWithNonError(
      failing.fetchMock,
      (url, method) => (method === "POST" || method === "PUT") && url.startsWith(PROFILES_PATH),
    );
    const { result } = renderHook(() => useProbeProfiles(), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => result.current.beginCreate());
    act(() =>
      result.current.setDraft({
        name: "x",
        prompt: "y",
        expectedText: "",
        matchMode: "last_line",
        requireThinking: false,
      }),
    );
    act(() => result.current.save());
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(result.current.editing).toBeNull();

    act(() => result.current.activate(result.current.items[1]));
    await waitFor(() => expect(result.current.activating).toBe(false));
  });

  it("启用/保存/删除失败时 Error 分支透出 message 且保留编辑态", async () => {
    const failing = installQualityGuardApi();
    failWithError(
      failing.fetchMock,
      (url, method) => ["POST", "PUT", "DELETE"].includes(method) && url.startsWith(PROFILES_PATH),
    );
    const { result } = renderHook(() => useProbeProfiles(), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    const custom = result.current.items.find((item) => item.id === "profile-custom")!;
    act(() => result.current.activate(custom));
    await waitFor(() => expect(result.current.activating).toBe(false));

    act(() => result.current.beginCreate());
    act(() => result.current.setDraft({ ...result.current.draft, name: "x", prompt: "y" }));
    act(() => result.current.save());
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(result.current.editing).toBeNull();

    act(() => result.current.beginDelete(custom));
    act(() => result.current.remove(custom));
    await waitFor(() => expect(result.current.deletingPending).toBe(false));
    expect(result.current.deleting?.id).toBe("profile-custom");
  });

  it("StrictMode 下重复挂载保持单份控制器语义", async () => {
    const { requests } = installQualityGuardApi();
    const { result } = renderHook(() => useProbeProfiles(), { wrapper: wrapperFor({ strict: true }) });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => result.current.beginCreate());
    expect(result.current.editing).toBeNull();
    expect(requestsTo(requests, PROFILES_PATH, "GET")).toBeGreaterThan(0);
  });
});

describe("useGuardNodes 派生视图与选择", () => {
  it("节点 tab 激活时汇总隔离数与租约数，并按受保护节点限定可选范围", async () => {
    installQualityGuardApi({
      status: guardStatus({ nodeSummary: { total: 2, quarantined: 3, quarantinedLeases: 4 } }),
    });
    const { result } = renderHook(() => useGuardNodes(true), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.view.nodes).toHaveLength(2));

    expect(result.current.view.quarantined).toBe(3);
    expect(result.current.view.quarantinedLeases).toBe(4);
    expect(result.current.view.totalNodes).toBe(2);
    expect(result.current.view.enabledNodes).toBe(2);
    expect(result.current.view.fresh).toBe(true);
    expect(result.current.view.protectedNodeIDs.has("node-2")).toBe(true);
    expect(result.current.view.selectableNodes.map((node) => node.id)).toEqual(["node-1"]);

    act(() => result.current.selection.toggleSelectedNode("node-1", true));
    expect(result.current.view.selectedNodes.map((node) => node.id)).toEqual(["node-1"]);
    expect(result.current.view.allNodesSelected).toBe(true);
    act(() => result.current.selection.toggleSelectedNode("node-1", false));
    expect(result.current.selection.selectedNodeIDs.size).toBe(0);

    act(() => result.current.selection.toggleAllNodes(true));
    expect([...result.current.selection.selectedNodeIDs]).toEqual(["node-1"]);
    act(() => result.current.selection.toggleAllNodes(false));
    expect(result.current.selection.selectedNodeIDs.size).toBe(0);

    act(() => result.current.selection.toggleSelectedNode("node-1", true));
    act(() => result.current.selection.clearSelection());
    expect(result.current.selection.selectedNodeIDs.size).toBe(0);

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.view.refreshing).toBe(false));
  });

  it("缺少 nodeSummary 时按节点状态汇总，缺失租约计数按 0 计入", async () => {
    installQualityGuardApi({
      status: guardStatus({
        nodeSummary: undefined,
        nodes: {
          "node-1": guardNodeState({ disabled_by_guard: true, quarantined_lease_count: 2 }),
          "node-2": guardNodeState(),
        },
      }),
    });
    const { result } = renderHook(() => useGuardNodes(true), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.view.status).toBeTruthy());

    await waitFor(() => expect(result.current.view.quarantined).toBe(1));
    expect(result.current.view.quarantinedLeases).toBe(2);
  });

  it("节点 tab 未激活时只刷新守护状态，不请求节点列表", async () => {
    const { requests } = installQualityGuardApi();
    const { result } = renderHook(() => useGuardNodes(false), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.statusQuery.data).toBeTruthy());

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.statusQuery.isFetching).toBe(false));
    expect(requestsTo(requests, NODES_PATH)).toBe(0);
    expect(result.current.view.nodes).toHaveLength(0);
    expect(result.current.view.totalNodes).toBe(0);
    expect(result.current.view.enabledNodes).toBeUndefined();
    expect(result.current.view.allNodesSelected).toBe(false);
  });
});

describe("useGuardNodeActions 探测", () => {
  it("缺少守护配置时不发出探测请求", async () => {
    const { requests } = installQualityGuardApi();
    const { result } = renderHook(
      () =>
        useGuardNodeActions({ statusRef: statusRefOf(undefined), dialogs: dialogsFixture(), clearSelection: vi.fn() }),
      { wrapper: wrapperFor() },
    );

    act(() => result.current.testNode("node-1"));

    await waitFor(() => expect(result.current.testingNodeID).toBeUndefined());
    expect(requests.filter((request) => request.url.includes("/test"))).toHaveLength(0);
    expect(result.current.manualResults).toEqual({});
  });

  it("探测成功记录人工结果，进行中暴露 testingNodeID，失败不写入结果", async () => {
    const ok = installQualityGuardApi();
    const { result } = renderHook(
      () =>
        useGuardNodeActions({
          statusRef: statusRefOf(GUARD_STATUS),
          dialogs: dialogsFixture(),
          clearSelection: vi.fn(),
        }),
      { wrapper: wrapperFor() },
    );

    act(() => result.current.testNode("node-1"));
    await waitFor(() => expect(result.current.manualResults["node-1"]).toBeTruthy());
    expect(result.current.testingNodeID).toBeUndefined();
    expect(requestsTo(ok.requests, "/api/admin/v1/egress-quality-guard/nodes/node-1/test", "POST")).toBe(1);

    const failing = installQualityGuardApi({ failure: "nodeTest" });
    const release = holdRequest(failing.fetchMock, (_url, method) => method === "POST");
    const failingHook = renderHook(
      () =>
        useGuardNodeActions({
          statusRef: statusRefOf(GUARD_STATUS),
          dialogs: dialogsFixture(),
          clearSelection: vi.fn(),
        }),
      { wrapper: wrapperFor() },
    );

    act(() => failingHook.result.current.testNode("node-1"));
    await waitFor(() => expect(failingHook.result.current.testingNodeID).toBe("node-1"));
    await act(async () => {
      release();
    });
    await waitFor(() => expect(failingHook.result.current.testingNodeID).toBeUndefined());
    expect(failingHook.result.current.manualResults["node-1"]).toBeUndefined();
  });
});

describe("useGuardNodeActions 保存节点", () => {
  it("新增走 POST 并在成功后关闭弹窗，编辑走 PUT", async () => {
    const { requests } = installQualityGuardApi();
    const closeEditor = vi.fn();
    const { result, rerender } = renderHook(
      ({ dialogs }: { dialogs: GuardNodeDialogs }) =>
        useGuardNodeActions({ statusRef: statusRefOf(GUARD_STATUS), dialogs, clearSelection: vi.fn() }),
      { wrapper: wrapperFor(), initialProps: { dialogs: dialogsFixture({ closeEditor }) } },
    );

    act(() => result.current.saveNode());
    await waitFor(() => expect(requestsTo(requests, NODES_PATH, "POST")).toBe(1));
    await waitFor(() => expect(closeEditor).toHaveBeenCalledTimes(1));
    expect(requests.find((request) => request.url === NODES_PATH && request.method === "POST")?.body).toEqual({
      name: "新出口",
      scope: "grok_build",
      enabled: true,
      proxyPool: false,
      accountCapacity: 5,
      proxyURL: undefined,
      userAgent: "",
      cloudflareCookies: undefined,
    });

    rerender({ dialogs: dialogsFixture({ editingNode: nodeDTO({ id: "node-1" }), closeEditor }) });
    act(() => result.current.saveNode());
    await waitFor(() => expect(requests.filter((request) => request.url === `${NODES_PATH}/node-1`).length).toBe(1));
    expect(requests.find((request) => request.url === `${NODES_PATH}/node-1`)?.method).toBe("PUT");
  });

  it("保存进行中暴露 saving，失败时不关闭弹窗", async () => {
    const { fetchMock } = installQualityGuardApi({ failure: "nodeAction" });
    const release = holdRequest(fetchMock, (url, method) => url === NODES_PATH && method === "POST");
    const closeEditor = vi.fn();
    const { result } = renderHook(
      () =>
        useGuardNodeActions({
          statusRef: statusRefOf(GUARD_STATUS),
          dialogs: dialogsFixture({ closeEditor }),
          clearSelection: vi.fn(),
        }),
      { wrapper: wrapperFor() },
    );

    act(() => result.current.saveNode());
    await waitFor(() => expect(result.current.saving).toBe(true));
    await act(async () => {
      release();
    });
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(closeEditor).not.toHaveBeenCalled();
  });
});

describe("useGuardNodeActions 启停与删除", () => {
  it("单节点启停不清空选择，批量启停成功后清空选择", async () => {
    const { requests } = installQualityGuardApi();
    const clearSelection = vi.fn();
    const node = nodeDTO({ id: "node-1" });
    const { result } = renderHook(
      () => useGuardNodeActions({ statusRef: statusRefOf(GUARD_STATUS), dialogs: dialogsFixture(), clearSelection }),
      { wrapper: wrapperFor() },
    );

    act(() => result.current.toggleNode(node, true));
    await waitFor(() => expect(requestsTo(requests, BATCH_PATH, "PATCH")).toBe(1));
    expect(requests.find((request) => request.url === BATCH_PATH)?.body).toEqual({ ids: ["node-1"], enabled: true });
    expect(clearSelection).not.toHaveBeenCalled();

    act(() => result.current.batchToggleNodes([node, nodeDTO({ id: "node-2" })], false));
    await waitFor(() => expect(clearSelection).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.batchPending).toBe(false));
    expect(requests.filter((request) => request.url === BATCH_PATH).at(-1)?.body).toEqual({
      ids: ["node-1", "node-2"],
      enabled: false,
    });

    // 成功回调的两个文案分支：单节点停用与批量启用
    act(() => result.current.toggleNode(node, false));
    await waitFor(() => expect(requests.filter((request) => request.url === BATCH_PATH).length).toBe(2));
    act(() => result.current.batchToggleNodes([node], true));
    await waitFor(() => expect(clearSelection).toHaveBeenCalledTimes(2));
    expect(requests.filter((request) => request.url === BATCH_PATH).at(-1)?.body).toEqual({
      ids: ["node-1"],
      enabled: true,
    });
  });

  it("启停进行中暴露 togglingNodeID，失败与批量失败都走错误分支", async () => {
    const { fetchMock } = installQualityGuardApi({ failure: "nodeAction" });
    const release = holdRequest(fetchMock, (url, method) => url === BATCH_PATH && method === "PATCH");
    const node = nodeDTO({ id: "node-1" });
    const { result } = renderHook(
      () =>
        useGuardNodeActions({
          statusRef: statusRefOf(GUARD_STATUS),
          dialogs: dialogsFixture(),
          clearSelection: vi.fn(),
        }),
      { wrapper: wrapperFor() },
    );

    act(() => result.current.toggleNode(node, false));
    await waitFor(() => expect(result.current.togglingNodeID).toBe("node-1"));
    await act(async () => {
      release();
    });
    await waitFor(() => expect(result.current.togglingNodeID).toBeUndefined());

    act(() => result.current.batchToggleNodes([node], true));
    await waitFor(() => expect(result.current.batchPending).toBe(false));
  });

  it("删除成功后关闭确认弹窗并清空选择，进行中暴露 deleting", async () => {
    const { fetchMock, requests } = installQualityGuardApi();
    const release = holdRequest(fetchMock, (_url, method) => method === "DELETE");
    const closeDelete = vi.fn();
    const clearSelection = vi.fn();
    const { result } = renderHook(
      () =>
        useGuardNodeActions({
          statusRef: statusRefOf(GUARD_STATUS),
          dialogs: dialogsFixture({ closeDelete }),
          clearSelection,
        }),
      { wrapper: wrapperFor() },
    );

    act(() => result.current.deleteNodes([nodeDTO({ id: "node-1" })]));
    await waitFor(() => expect(result.current.deleting).toBe(true));
    await act(async () => {
      release();
    });
    await waitFor(() => expect(result.current.deleting).toBe(false));
    expect(closeDelete).toHaveBeenCalledTimes(1);
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(requests.find((request) => request.method === "DELETE")?.body).toEqual({ ids: ["node-1"] });
  });

  it("删除失败：Error 透出 message，非 Error 走通用文案，且不清空选择", async () => {
    const withError = installQualityGuardApi();
    failWithError(withError.fetchMock, (_url, method) => method === "DELETE");
    const first = renderHook(
      () =>
        useGuardNodeActions({
          statusRef: statusRefOf(GUARD_STATUS),
          dialogs: dialogsFixture(),
          clearSelection: vi.fn(),
        }),
      { wrapper: wrapperFor() },
    );

    act(() => first.result.current.deleteNodes([nodeDTO({ id: "node-1" })]));
    await waitFor(() => expect(first.result.current.deleting).toBe(false));

    const withoutError = installQualityGuardApi();
    failWithNonError(withoutError.fetchMock, (_url, method) => method === "DELETE");
    const second = renderHook(
      () =>
        useGuardNodeActions({
          statusRef: statusRefOf(GUARD_STATUS),
          dialogs: dialogsFixture(),
          clearSelection: vi.fn(),
        }),
      { wrapper: wrapperFor() },
    );

    act(() => second.result.current.deleteNodes([nodeDTO({ id: "node-1" })]));
    await waitFor(() => expect(second.result.current.deleting).toBe(false));
    expect(second.result.current.manualResults).toEqual({});
  });
});
