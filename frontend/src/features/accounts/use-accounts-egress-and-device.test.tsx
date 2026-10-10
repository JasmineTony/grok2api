import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import { useAccountsBatchFlow } from "@/features/accounts/use-accounts-batch-flow";
import { useAccountsDeviceFlow } from "@/features/accounts/use-account-device-flow";
import { useAccountsEgressFilterGroups } from "@/features/accounts/use-accounts-egress-filter-options";
import { useAccountsEgressFlow } from "@/features/accounts/use-accounts-egress-flow";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 设备授权 / 批量操作 / 出口绑定 / 出口筛选选项 hook 测试（AGENTS.md TEST-2/TEST-3）：
// 只替换网络边界，断言轮询退避、批量提交参数、出口作用域收窄与筛选分页的用户可见结果。

const mocks = vi.hoisted(() => ({
  startDeviceAuthorization: vi.fn(),
  pollDeviceAuthorization: vi.fn(),
  updateAccountsEnabled: vi.fn(),
  updateAccountsMaxConcurrent: vi.fn(),
  refreshAccountsQuota: vi.fn(),
  resetAccountsQuota: vi.fn(),
  refreshAccountsTokens: vi.fn(),
  assignEgressAccounts: vi.fn(),
  unassignEgressAccounts: vi.fn(),
  listAllEgressNodes: vi.fn(),
  listEgressNodes: vi.fn(),
  listEgressSources: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), loading: vi.fn(() => "toast-id"), dismiss: vi.fn() },
}));

vi.mock("@/features/accounts/accounts-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/accounts/accounts-api")>();
  return { ...actual, ...mocks };
});

vi.mock("@/features/settings/settings-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/settings/settings-api")>();
  return {
    ...actual,
    assignEgressAccounts: mocks.assignEgressAccounts,
    unassignEgressAccounts: mocks.unassignEgressAccounts,
    listAllEgressNodes: mocks.listAllEgressNodes,
    listEgressNodes: mocks.listEgressNodes,
    listEgressSources: mocks.listEgressSources,
  };
});

vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return { ...actual, toast: mocks.toast };
});

function createContext(overrides: Partial<AccountsFlowContext> = {}): AccountsFlowContext {
  return {
    t: (key, options) => i18n.t(key, options),
    provider: "grok_build",
    language: "zh-CN",
    selectedIds: ["a", "b"],
    selectedCount: 2,
    clearSelection: vi.fn(),
    invalidate: vi.fn(),
    invalidateModels: vi.fn(),
    invalidateEgressNodes: vi.fn(),
    showError: vi.fn(),
    ...overrides,
  };
}

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </I18nextProvider>
    );
  };
}

const session = {
  sessionId: "session-1",
  userCode: "AAAA-BBBB",
  verificationUri: "https://example.com/device",
  intervalSeconds: 1,
  expiresAt: "2999-01-01T00:00:00Z",
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useRealTimers();
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAccountsDeviceFlow", () => {
  it("启动授权成功后进入等待态，轮询成功即关闭并提示创建结果", async () => {
    vi.useFakeTimers();
    mocks.startDeviceAuthorization.mockResolvedValue(session);
    mocks.pollDeviceAuthorization.mockResolvedValue({ status: "succeeded", synced: 1 });
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsDeviceFlow(ctx), { wrapper: createWrapper() });

    expect(result.current.open).toBe(false);
    expect(result.current.status).toBe("starting");
    expect(result.current.language).toBe("zh-CN");

    await act(async () => result.current.login());
    expect(result.current.open).toBe(true);
    expect(result.current.status).toBe("pending");
    expect(result.current.session?.userCode).toBe("AAAA-BBBB");

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => undefined);

    expect(mocks.pollDeviceAuthorization).toHaveBeenCalledWith("session-1", expect.any(AbortSignal));
    expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.created"));
    expect(result.current.open).toBe(false);
    expect(result.current.session).toBeNull();
    expect(ctx.invalidate).toHaveBeenCalled();
  });

  it("轮询返回同步失败时提示警告并关闭", async () => {
    vi.useFakeTimers();
    mocks.startDeviceAuthorization.mockResolvedValue(session);
    mocks.pollDeviceAuthorization.mockResolvedValue({ status: "syncFailed" });
    const { result } = renderHook(() => useAccountsDeviceFlow(createContext()), { wrapper: createWrapper() });

    await act(async () => result.current.login());
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => undefined);

    expect(mocks.toast.warning).toHaveBeenCalledWith(i18n.t("accounts.createdWithSyncFailure"));
    expect(result.current.open).toBe(false);
  });

  it("仍待授权时按会话间隔继续轮询", async () => {
    vi.useFakeTimers();
    mocks.startDeviceAuthorization.mockResolvedValue(session);
    mocks.pollDeviceAuthorization
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "succeeded", synced: 1 });
    const { result } = renderHook(() => useAccountsDeviceFlow(createContext()), { wrapper: createWrapper() });

    await act(async () => result.current.login());
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => undefined);
    expect(mocks.pollDeviceAuthorization).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("pending");

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => undefined);
    expect(mocks.pollDeviceAuthorization).toHaveBeenCalledTimes(2);
    expect(result.current.open).toBe(false);
  });

  it("429 按 5 秒退避重试，其他错误落失败态并提示", async () => {
    vi.useFakeTimers();
    mocks.startDeviceAuthorization.mockResolvedValue(session);
    mocks.pollDeviceAuthorization
      .mockRejectedValueOnce(new ApiError(429, "rateLimited", "过于频繁"))
      .mockRejectedValueOnce(new ApiError(502, "deviceFailed", "设备授权失败"));
    const { result } = renderHook(() => useAccountsDeviceFlow(createContext()), { wrapper: createWrapper() });

    await act(async () => result.current.login());
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => undefined);
    expect(mocks.pollDeviceAuthorization).toHaveBeenCalledTimes(1);
    // 429 后进入 5 秒退避，1 秒时不会重试。
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(mocks.pollDeviceAuthorization).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    await act(async () => undefined);
    expect(mocks.pollDeviceAuthorization).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("failed");
    expect(mocks.toast.error).toHaveBeenCalledWith("设备授权失败");
  });

  it("启动授权失败时落失败态并回传错误；重试复用同一条路径", async () => {
    mocks.startDeviceAuthorization.mockRejectedValue(new ApiError(502, "deviceFailed", "设备授权失败"));
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsDeviceFlow(ctx), { wrapper: createWrapper() });

    await act(async () => result.current.login());
    expect(result.current.status).toBe("failed");
    expect(ctx.showError).toHaveBeenCalledWith(expect.any(ApiError));

    mocks.startDeviceAuthorization.mockResolvedValue(session);
    await act(async () => result.current.onRetry());
    expect(result.current.status).toBe("pending");
    expect(result.current.session?.sessionId).toBe("session-1");

    act(() => result.current.onOpenChange(false));
    expect(result.current.open).toBe(false);
  });
});

describe("useAccountsBatchFlow", () => {
  it("启用/禁用与刷新凭据按选中集合提交", async () => {
    mocks.updateAccountsEnabled.mockResolvedValue({ updated: 2 });
    mocks.refreshAccountsTokens.mockResolvedValue({ succeeded: 2, failed: 0, skipped: 0 });
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsBatchFlow(ctx), { wrapper: createWrapper() });

    await act(async () => result.current.onEnableSelected());
    await waitFor(() => expect(mocks.updateAccountsEnabled).toHaveBeenCalledWith(["a", "b"], true, "grok_build"));
    expect(ctx.clearSelection).toHaveBeenCalled();

    await act(async () => result.current.onDisableSelected());
    await waitFor(() => expect(mocks.updateAccountsEnabled).toHaveBeenLastCalledWith(["a", "b"], false, "grok_build"));

    await act(async () => result.current.onRefreshSelectedTokens());
    await waitFor(() => expect(mocks.refreshAccountsTokens).toHaveBeenCalledWith(["a", "b"], "grok_build"));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        i18n.t("accounts.allTokensRefreshed", { succeeded: 2, failed: 0, skipped: 0 }),
      ),
    );
  });

  it("并发上限弹窗按输入值提交并关闭", async () => {
    mocks.updateAccountsMaxConcurrent.mockResolvedValue({ updated: 2 });
    const { result } = renderHook(() => useAccountsBatchFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.onOpenConcurrency());
    expect(result.current.concurrency.open).toBe(true);
    expect(result.current.concurrency.value).toBe("1");
    expect(result.current.concurrency.selectedCount).toBe(2);

    act(() => result.current.concurrency.onValueChange("4"));
    await act(async () => result.current.concurrency.onConfirm());

    await waitFor(() => expect(mocks.updateAccountsMaxConcurrent).toHaveBeenCalledWith(["a", "b"], 4, "grok_build"));
    expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.batchConcurrencyUpdated"));
    expect(result.current.concurrency.open).toBe(false);
    expect(result.current.concurrency.value).toBe("4");
  });

  it("Build 池的额度弹窗支持同步与重置，非 Build 池直接同步", async () => {
    mocks.refreshAccountsQuota.mockResolvedValue({ succeeded: 2, failed: 0 });
    mocks.resetAccountsQuota.mockResolvedValue({ reset: 2 });
    const build = renderHook(() => useAccountsBatchFlow(createContext()), { wrapper: createWrapper() });

    act(() => build.result.current.onOpenQuotaSync());
    expect(build.result.current.quotaTask.open).toBe(true);
    expect(build.result.current.quotaTask.task).toBe("sync");

    await act(async () => build.result.current.quotaTask.onConfirm());
    await waitFor(() => expect(mocks.refreshAccountsQuota).toHaveBeenCalledWith(["a", "b"], "grok_build"));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        i18n.t("accounts.batchBillingRefreshed", { succeeded: 2, failed: 0 }),
      ),
    );
    expect(build.result.current.quotaTask.open).toBe(false);

    act(() => build.result.current.onOpenQuotaSync());
    act(() => build.result.current.quotaTask.onTaskChange("reset"));
    await act(async () => build.result.current.quotaTask.onConfirm());
    await waitFor(() => expect(mocks.resetAccountsQuota).toHaveBeenCalledWith(["a", "b"], "grok_build"));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accountQuotaReset.completed", { reset: 2 })),
    );
    build.unmount();

    // 非 Build 池没有额度重置入口，同步动作直接提交。
    mocks.refreshAccountsQuota.mockResolvedValue({ succeeded: 1, failed: 0 });
    const web = renderHook(() => useAccountsBatchFlow(createContext({ provider: "grok_web" })), {
      wrapper: createWrapper(),
    });
    await act(async () => web.result.current.onOpenQuotaSync());
    expect(web.result.current.quotaTask.open).toBe(false);
    expect(mocks.refreshAccountsQuota).toHaveBeenLastCalledWith(["a", "b"], "grok_web");
  });

  it("批量失败时提示用户且不提交成功提示", async () => {
    mocks.updateAccountsEnabled.mockRejectedValue(new ApiError(502, "batchFailed", "批量失败"));
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsBatchFlow(ctx), { wrapper: createWrapper() });

    await act(async () => result.current.onEnableSelected());
    await waitFor(() => expect(ctx.showError).toHaveBeenCalled());
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });
});

describe("useAccountsEgressFlow", () => {
  const nodes = [
    {
      id: "node-1",
      name: "东京",
      enabled: true,
      proxyConfigured: true,
      scope: "grok_build",
      assignedAccountCount: 1,
      accountCapacity: 10,
    },
    {
      id: "node-2",
      name: "未配置代理",
      enabled: true,
      proxyConfigured: false,
      scope: "grok_build",
      assignedAccountCount: 0,
      accountCapacity: 5,
    },
    {
      id: "node-3",
      name: "其他池节点",
      enabled: true,
      proxyConfigured: true,
      scope: "grok_web",
      assignedAccountCount: 0,
      accountCapacity: 5,
    },
    {
      id: "node-4",
      name: "已禁用",
      enabled: false,
      proxyConfigured: true,
      scope: "grok_build",
      assignedAccountCount: 0,
      accountCapacity: 5,
    },
  ];

  it("绑定任务只列出当前账号池可用且开启代理的节点", async () => {
    mocks.listAllEgressNodes.mockResolvedValue({ items: nodes, total: nodes.length });
    const { result } = renderHook(() => useAccountsEgressFlow(createContext()), { wrapper: createWrapper() });

    expect(result.current.open).toBe(false);
    expect(mocks.listAllEgressNodes).not.toHaveBeenCalled();

    act(() => result.current.openDialog());
    expect(result.current.open).toBe(true);
    expect(result.current.task).toBe("bind");
    expect(result.current.nodesPending).toBe(true);

    await waitFor(() => expect(result.current.nodesPending).toBe(false));
    expect(result.current.nodes.map((node) => node.id)).toEqual(["node-1"]);
    expect(result.current.nodesError).toBeNull();
  });

  it("节点查询失败时回传错误文案并允许重试", async () => {
    mocks.listAllEgressNodes.mockRejectedValue(new ApiError(502, "nodesFailed", "节点加载失败"));
    const { result } = renderHook(() => useAccountsEgressFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    await waitFor(() => expect(result.current.nodesError).toBe("节点加载失败"));

    mocks.listAllEgressNodes.mockResolvedValue({ items: nodes, total: nodes.length });
    act(() => result.current.onOpenChange(false));
    expect(result.current.open).toBe(false);
    expect(result.current.task).toBe("bind");
    expect(result.current.nodeId).toBe("");
  });

  it("绑定时缺少节点 ID 会被拒绝，选定节点后成功并刷新出口查询", async () => {
    mocks.listAllEgressNodes.mockResolvedValue({ items: nodes, total: nodes.length });
    mocks.assignEgressAccounts.mockResolvedValue({ updated: 2 });
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsEgressFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(ctx.showError).toHaveBeenCalled());
    expect(mocks.assignEgressAccounts).not.toHaveBeenCalled();

    act(() => result.current.onNodeIdChange("node-1"));
    await act(async () => result.current.onConfirm());

    await waitFor(() => expect(mocks.assignEgressAccounts).toHaveBeenCalledWith("node-1", "grok_build", ["a", "b"]));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.egressBound")));
    expect(ctx.invalidateEgressNodes).toHaveBeenCalled();
    expect(ctx.clearSelection).toHaveBeenCalled();
    expect(result.current.open).toBe(false);
  });

  it("解绑任务不查询节点并直接提交解绑", async () => {
    mocks.unassignEgressAccounts.mockResolvedValue({ updated: 2 });
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsEgressFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    act(() => result.current.onTaskChange("unbind"));
    expect(result.current.task).toBe("unbind");

    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(mocks.unassignEgressAccounts).toHaveBeenCalledWith("grok_build", ["a", "b"]));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.egressUnbound")));
    expect(result.current.busy).toBe(false);
  });

  it("解绑失败时提示用户且保持弹窗打开", async () => {
    mocks.unassignEgressAccounts.mockRejectedValue(new ApiError(502, "unbindFailed", "解绑失败"));
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsEgressFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    act(() => result.current.onTaskChange("unbind"));
    await act(async () => result.current.onConfirm());

    await waitFor(() => expect(ctx.showError).toHaveBeenCalled());
    expect(result.current.open).toBe(true);
  });
});

describe("useAccountsEgressFilterGroups", () => {
  function nodePage(page: number) {
    return {
      items: [{ id: `${page}`, name: `节点${page}`, scope: "grok_build", enabled: true, proxyConfigured: true }],
      page,
      pageSize: 100,
      total: 250,
    };
  }

  function sourcePage(page: number) {
    return {
      items: [{ id: `s${page}`, name: `订阅源${page}`, scope: "grok_build" }],
      page,
      pageSize: 100,
      total: 50,
    };
  }

  it("按账号池主作用域收集节点与订阅源选项，并给出分页动作", async () => {
    mocks.listEgressNodes.mockImplementation(async ({ page }: { page: number }) => nodePage(page));
    mocks.listEgressSources.mockImplementation(async ({ page }: { page: number }) => sourcePage(page));
    const { result } = renderHook(
      () => useAccountsEgressFilterGroups({ open: true, provider: "grok_build", search: "" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current[0].options).toHaveLength(1));
    expect(mocks.listEgressNodes).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, scope: "grok_build", search: "" }),
    );
    expect(result.current[0].id).toBe("nodes");
    expect(result.current[0].options?.[0]).toEqual({ value: "node:1", label: "节点1" });
    expect(result.current[0].hasMore).toBe(true);

    expect(result.current[1].id).toBe("sources");
    expect(result.current[1].options?.[0]).toEqual({ value: "source:s1", label: "订阅源1" });
    expect(result.current[1].hasMore).toBe(false);

    // “加载更多”只在存在下一页时触发翻页。
    result.current[0].onAction?.();
    result.current[1].onAction?.();
    await waitFor(() => expect(mocks.listEgressNodes).toHaveBeenCalledTimes(2));
    // 订阅源已经取满，不产生无意义的翻页请求。
    expect(mocks.listEgressSources).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current[0].options?.map((option) => option.value)).toEqual(["node:1", "node:2"]));
  });

  it("Console 池合并 Web 与 Console 两类出口，来源失败时提示重试", async () => {
    mocks.listEgressNodes.mockImplementation(async ({ scope }: { scope: string }) =>
      scope === "grok_web"
        ? {
            items: [{ id: "web-1", name: "Web 出口", scope: "grok_web", enabled: true, proxyConfigured: true }],
            page: 1,
            pageSize: 100,
            total: 1,
          }
        : {
            items: [
              { id: "console-1", name: "Console 出口", scope: "grok_console", enabled: true, proxyConfigured: true },
            ],
            page: 1,
            pageSize: 100,
            total: 1,
          },
    );
    mocks.listEgressSources.mockRejectedValue(new ApiError(502, "sourcesFailed", "订阅源加载失败"));
    const { result } = renderHook(
      () => useAccountsEgressFilterGroups({ open: true, provider: "grok_console", search: "出口" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current[0].options).toHaveLength(2));
    expect(result.current[0].options?.map((option) => option.value)).toEqual(["node:console-1", "node:web-1"]);
    expect(result.current[0].actionLabel).toBe(i18n.t("accounts.egressFilterOptionsLoadMore"));

    await waitFor(() => expect(result.current[1].emptyLabel).toBe(i18n.t("accounts.egressFilterOptionsLoadFailed")));
    expect(result.current[1].hasMore).toBe(true);
    expect(result.current[1].actionLabel).toBe(i18n.t("common.retry"));
  });

  it("弹窗关闭时不发起任何筛选选项查询", () => {
    const { result } = renderHook(
      () => useAccountsEgressFilterGroups({ open: false, provider: "grok_web", search: "" }),
      { wrapper: createWrapper() },
    );

    expect(mocks.listEgressNodes).not.toHaveBeenCalled();
    expect(mocks.listEgressSources).not.toHaveBeenCalled();
    expect(result.current[0].options).toEqual([]);
    expect(result.current[1].options).toEqual([]);
  });
});
