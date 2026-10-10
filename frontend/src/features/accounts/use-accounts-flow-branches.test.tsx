import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import type { AccountDTO, AccountProvider } from "@/features/accounts/accounts-dto";
import { useAccountCleanupFlow } from "@/features/accounts/use-account-cleanup-flow";
import { useAccountDeleteFlow } from "@/features/accounts/use-account-delete-flow";
import { useAccountEditFlow } from "@/features/accounts/use-account-edit-flow";
import { useAccountsExportFlow } from "@/features/accounts/use-account-export-flow";
import { useAccountsEgressFilterGroups } from "@/features/accounts/use-accounts-egress-filter-options";
import { useAccountsEgressFlow } from "@/features/accounts/use-accounts-egress-flow";
import { useAccountsPageModel } from "@/features/accounts/use-accounts-page-model";
import { useAccountsSelection } from "@/features/accounts/use-accounts-selection";
import { useAccountsImportFlow, useAccountsScriptsFlow } from "@/features/accounts/use-accounts-transfer-flows";
import { useAccountsQuotaSyncFlow } from "@/features/accounts/use-accounts-task-flows";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 账号流程 hook 的剩余分支补齐（AGENTS.md TEST-2）：覆盖取消后的迟到响应、关闭清理、
// 非 Build 池的提交回退与页面组合入口的 provider 收敛，断言用户可见状态而非 mock 调用次数。

const mocks = vi.hoisted(() => ({
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  previewAccountDeletion: vi.fn(),
  exportAccountBatch: vi.fn(),
  exportSelectedAccounts: vi.fn(),
  previewCleanup: vi.fn(),
  refreshAllAccountBilling: vi.fn(),
  runWebAccountScripts: vi.fn(),
  listAccounts: vi.fn(),
  getAccountSummary: vi.fn(),
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

function account(overrides: Partial<AccountDTO> = {}): AccountDTO {
  return {
    id: "acct-1",
    provider: "grok_build",
    authType: "oauth",
    name: "build-alpha",
    enabled: true,
    authStatus: "active",
    refreshable: true,
    cloudflareCookieConfigured: false,
    buildSuperEntitled: false,
    buildRouteMode: "auto",
    buildBotFlagged: false,
    refreshFailureCount: 0,
    priority: 1,
    maxConcurrent: 8,
    minimumRemaining: 0,
    failureCount: 0,
    createdAt: "2026-01-02T03:04:05Z",
    quota: {
      type: "free",
      source: "responseModel",
      confidence: "confirmed",
      status: "active",
      used: 1,
      limit: 10,
      remaining: 9,
      usagePercent: 10,
      limitKnown: true,
      observed: true,
      confirmed: true,
    },
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useRealTimers();
  await i18n.changeLanguage("zh-CN");
  mocks.toast.loading.mockReturnValue("toast-id");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAccountsQuotaSyncFlow 取消语义", () => {
  it("关闭弹窗中断在途同步并清空进度，取消错误不提示用户", async () => {
    const signals: AbortSignal[] = [];
    mocks.refreshAllAccountBilling.mockImplementation(
      (_progress: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signals.push(signal);
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsQuotaSyncFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("sync"));
    act(() => result.current.onConfirm());
    await waitFor(() => expect(result.current.busy).toBe(true));

    act(() => result.current.onOpenChange(false));
    expect(signals[0].aborted).toBe(true);
    expect(result.current.open).toBe(false);
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.progress).toBeNull();
    expect(ctx.showError).not.toHaveBeenCalled();
  });
});

describe("useAccountCleanupFlow 迟到与幂等", () => {
  it("关闭后到达的预览成功结果不写入计数，重新打开时状态已清空", async () => {
    vi.useFakeTimers();
    let release: ((value: unknown) => void) | undefined;
    mocks.previewCleanup.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useAccountCleanupFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    act(() => result.current.onToggleStatus("cooldown", true));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    act(() => result.current.onOpenChange(false));
    await act(async () => {
      release?.({ rootsByStatus: { cooldown: 9 }, rootCount: 9, linkedByProvider: {}, total: 9 });
    });
    expect(result.current.previewTotals).toBeNull();
    expect(result.current.previewFresh).toBe(false);

    act(() => result.current.openDialog());
    expect(result.current.statuses.size).toBe(0);
    expect(result.current.previewError).toBe(false);
  });

  it("打开弹窗不清空已有选择，取消勾选关联目标后再次取消保持空集合", () => {
    const { result } = renderHook(() => useAccountCleanupFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.onOpenChange(true));
    act(() => result.current.onOpenChange(true));
    expect(result.current.open).toBe(true);

    act(() => result.current.onToggleStatus("cooldown", true));
    expect(result.current.statuses.has("cooldown")).toBe(true);
    // 已打开的弹窗再次收到 open=true 不重置状态，避免重复打开时丢失勾选。
    act(() => result.current.onOpenChange(true));
    expect(result.current.statuses.has("cooldown")).toBe(true);

    act(() => result.current.onToggleTarget("grok_web", false));
    expect(result.current.targets).toEqual([]);
  });

  it("预览失败标记在下一次勾选时清除并得到新计数", async () => {
    vi.useFakeTimers();
    mocks.previewCleanup.mockRejectedValueOnce(new ApiError(502, "previewFailed", "预览失败"));
    const { result } = renderHook(() => useAccountCleanupFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    act(() => result.current.onToggleStatus("disabled", true));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => undefined);
    expect(result.current.previewError).toBe(true);

    mocks.previewCleanup.mockResolvedValue({
      rootsByStatus: { disabled: 1 },
      rootCount: 1,
      linkedByProvider: {},
      total: 1,
    });
    act(() => result.current.onToggleStatus("cooldown", true));
    expect(result.current.previewError).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => undefined);
    expect(result.current.previewTotals?.total).toBe(1);
  });
});

describe("useAccountDeleteFlow 迟到与关闭", () => {
  it("关闭后到达的预览失败不写假 0 也不弹错误", async () => {
    vi.useFakeTimers();
    let reject: ((error: unknown) => void) | undefined;
    mocks.previewAccountDeletion.mockImplementation(
      () =>
        new Promise((_resolve, rejectFn) => {
          reject = rejectFn;
        }),
    );
    const { result } = renderHook(() => useAccountDeleteFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDelete(account()));
    act(() => result.current.single.onToggleTarget("grok_web", true));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    act(() => result.current.single.onOpenChange(false));

    await act(async () => {
      reject?.(new ApiError(502, "previewFailed", "预览失败"));
    });
    expect(result.current.single.counts).toEqual({});
    expect(result.current.single.previewError).toBe(false);
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("批量弹窗开关切换保留目标，未选账号时单账号确认不发起请求", () => {
    const { result } = renderHook(() => useAccountDeleteFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.batch.onOpenChange(true));
    expect(result.current.batch.open).toBe(true);
    act(() => result.current.batch.onOpenChange(false));
    expect(result.current.batch.open).toBe(false);

    act(() => result.current.single.onConfirm());
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
    act(() => result.current.single.onOpenChange(true));
    expect(result.current.single.account).toBeNull();
  });

  it("取消已勾选的关联目标会清掉对应计数，再次勾选重新计数", async () => {
    vi.useFakeTimers();
    mocks.previewAccountDeletion.mockResolvedValue({
      rootCount: 1,
      linkedByProvider: { grok_web: 3, grok_console: 2 },
      total: 6,
    });
    const { result } = renderHook(() => useAccountDeleteFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDelete(account()));
    act(() => result.current.single.onSelectAll());
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => undefined);
    expect(result.current.single.counts).toEqual({ grok_web: 3, grok_console: 2 });

    // 部分取消：只删除被取消目标的计数，其余保留。
    act(() => result.current.single.onToggleTarget("grok_console", false));
    expect(result.current.single.targets).toEqual(["grok_web"]);
    expect(result.current.single.counts).toEqual({ grok_web: 3 });
    expect(result.current.single.blocking).toBe(false);

    // 取消最后一个目标时计数整体清空。
    act(() => result.current.single.onToggleTarget("grok_web", false));
    expect(result.current.single.counts).toEqual({});
  });
});

describe("useAccountsSelection provider 收敛", () => {
  it("切换账号池后勾选以空集合起算，原池选择不会被静默带过来", () => {
    const { result, rerender } = renderHook(
      ({ provider }: { provider: AccountProvider }) => useAccountsSelection(provider),
      {
        wrapper: createWrapper(),
        initialProps: { provider: "grok_build" as AccountProvider },
      },
    );

    act(() => result.current.toggleAccount("x", true));
    expect(result.current.selectedIds).toEqual(["x"]);

    // 切池后 useMemo 立即返回空集合，旧池选择不再对外可见。
    rerender({ provider: "grok_web" });
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.hasSelection).toBe(false);

    // 在新池勾选时从空集合起算，旧池的 x 不会被继承。
    act(() => result.current.togglePage(["y", "z"], true));
    expect(result.current.selectedIds).toEqual(["y", "z"]);

    rerender({ provider: "grok_build" });
    expect(result.current.selectedIds).toEqual([]);
  });
});

describe("useAccountsExportFlow 收尾与失败", () => {
  it("最后一批 hasMore 为 false 时收尾并清空进度计数", async () => {
    mocks.exportAccountBatch.mockResolvedValue({
      blob: new Blob(["{}"]),
      count: 3,
      nextId: "3",
      snapshotMaxId: "3",
      hasMore: false,
    });
    const ctx = createContext({ selectedCount: 0, selectedIds: [] });
    const { result } = renderHook(() => useAccountsExportFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openProviderExport());
    act(() => result.current.onLimitChange("10"));
    await act(async () => result.current.onConfirm());

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accountExport.completed", { count: 3 })),
    );
    expect(mocks.exportAccountBatch).toHaveBeenCalledWith("grok_build", 10, "0", "0");
    expect(result.current.open).toBe(false);
    expect(result.current.completedCount).toBe(0);
    expect(mocks.exportSelectedAccounts).not.toHaveBeenCalled();
  });

  it("导出失败时保留弹窗并提示用户可见错误", async () => {
    mocks.exportSelectedAccounts.mockRejectedValue(new ApiError(502, "exportFailed", "导出失败"));
    const ctx = createContext({ selectedCount: 2, selectedIds: ["a", "b"] });
    const { result } = renderHook(() => useAccountsExportFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openSelectedExport());
    await act(async () => result.current.onConfirm());

    await waitFor(() => expect(ctx.showError).toHaveBeenCalled());
    expect(vi.mocked(ctx.showError).mock.calls[0][0]).toBeInstanceOf(ApiError);
    expect(result.current.open).toBe(true);
  });
});

describe("useAccountEditFlow 表单初始值", () => {
  it("开始编辑时把路由模式与权益写入表单，未提交不触达接口", () => {
    const { result } = renderHook(() => useAccountEditFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.beginEdit(account({ buildRouteMode: "build", buildSuperEntitled: true })));
    expect(result.current.buildRouteMode).toBe("build");
    expect(result.current.buildSuperEntitled).toBe(true);
    expect(result.current.clearCloudflareCookies).toBe(false);
    expect(mocks.updateAccount).not.toHaveBeenCalled();
  });
});

describe("非 Build 池提交回退", () => {
  it("Console 池提交清空 Cloudflare Cookie 且不写 Build 路由字段", async () => {
    mocks.updateAccount.mockResolvedValue(account({ provider: "grok_console" }));
    const { result } = renderHook(() => useAccountEditFlow(createContext({ provider: "grok_console" })), {
      wrapper: createWrapper(),
    });

    act(() => result.current.beginEdit(account({ provider: "grok_console" })));
    act(() => {
      result.current.form.setValue("clearCloudflareCookies", true);
    });
    expect(result.current.clearCloudflareCookies).toBe(true);

    await act(async () =>
      result.current.onSubmit({ preventDefault: () => undefined } as Parameters<typeof result.current.onSubmit>[0]),
    );
    await waitFor(() => expect(mocks.updateAccount).toHaveBeenCalledTimes(1));
    const payload = mocks.updateAccount.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.clearCloudflareCookies).toBe(true);
    expect(payload).not.toHaveProperty("buildRouteMode");
  });

  it("脚本任务缺少目标时不发起请求，选中集合才提交", async () => {
    mocks.runWebAccountScripts.mockResolvedValue({ succeeded: 1, failed: 0 });
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountsScriptsFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.onRun({ acceptTerms: true, setBirthDate: true, enableNSFW: true }));
    expect(mocks.runWebAccountScripts).not.toHaveBeenCalled();

    act(() => result.current.openDialog(["acct-1"]));
    await act(async () => result.current.onRun({ acceptTerms: true, setBirthDate: false, enableNSFW: false }));
    await waitFor(() =>
      expect(mocks.runWebAccountScripts).toHaveBeenCalledWith(
        { ids: ["acct-1"], actions: { acceptTerms: true, setBirthDate: false, enableNSFW: false } },
        expect.any(Function),
        expect.any(AbortSignal),
      ),
    );
  });

  it("导入弹窗在关闭事件中清空文本，重复打开保持可用", () => {
    const { result } = renderHook(() => useAccountsImportFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openQuickImport());
    act(() => result.current.onTokensChange("token"));
    act(() => result.current.onOpenChange(false));
    expect(result.current.open).toBe(false);
    expect(result.current.tokens).toBe("");

    act(() => result.current.openQuickImport());
    expect(result.current.open).toBe(true);
  });
});

describe("出口查询条件分支", () => {
  it("未开启筛选菜单时不发起任何查询且选项为空", () => {
    const { result } = renderHook(
      () => useAccountsEgressFilterGroups({ open: false, provider: "grok_build", search: "" }),
      {
        wrapper: createWrapper(),
      },
    );

    expect(mocks.listEgressNodes).not.toHaveBeenCalled();
    expect(mocks.listEgressSources).not.toHaveBeenCalled();
    expect(result.current[0].options).toEqual([]);
    expect(result.current[1].options).toEqual([]);
  });

  it("解绑任务打开弹窗不查询节点，切换任务保留当前选择", async () => {
    const { result } = renderHook(() => useAccountsEgressFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.onTaskChange("unbind"));
    act(() => result.current.onOpenChange(true));
    expect(result.current.open).toBe(true);
    expect(result.current.task).toBe("unbind");
    await act(async () => undefined);
    expect(mocks.listAllEgressNodes).not.toHaveBeenCalled();

    act(() => result.current.onOpenChange(false));
    expect(result.current.open).toBe(false);
    expect(result.current.task).toBe("bind");
    expect(result.current.nodeId).toBe("");
  });
});

describe("useAccountsPageModel provider 切换收敛", () => {
  it("切换账号池会关闭导入弹窗、清空文本并重置清理状态", async () => {
    mocks.listAccounts.mockResolvedValue({ items: [account()], total: 1, page: 1, pageSize: 20 });
    mocks.getAccountSummary.mockResolvedValue({
      total: 1,
      enabled: 1,
      available: 1,
      cooldown: 0,
      risk: 0,
      providers: {
        grok_build: { total: 1, available: 1 },
        grok_web: { total: 0, available: 0 },
        grok_console: { total: 0, available: 0 },
      },
      recovery: { cooldown: 0, waitingReset: 0, probing: 0 },
      issues: { disabled: 0, reauthRequired: 0 },
    });
    mocks.previewCleanup.mockResolvedValue({ rootsByStatus: {}, rootCount: 0, linkedByProvider: {}, total: 0 });
    const { result } = renderHook(() => useAccountsPageModel(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.result?.total).toBe(1));

    act(() => result.current.tasks.importFlow.openQuickImport());
    act(() => result.current.tasks.importFlow.onTokensChange("token"));
    act(() => result.current.tasks.cleanup.openDialog());
    act(() => result.current.tasks.cleanup.onToggleStatus("cooldown", true));
    expect(result.current.tasks.importFlow.open).toBe(true);
    expect(result.current.tasks.cleanup.open).toBe(true);

    act(() => result.current.changeProvider("grok_web"));
    await waitFor(() => expect(result.current.filters.provider).toBe("grok_web"));
    expect(result.current.tasks.importFlow.open).toBe(false);
    expect(result.current.tasks.importFlow.tokens).toBe("");
    expect(result.current.tasks.cleanup.open).toBe(false);
    expect(result.current.tasks.cleanup.statuses.size).toBe(0);
  });
});

describe("清理预览等待期间的表现", () => {
  it("预览未返回前不展示计数，迟到成功后按 key 命中才展示", async () => {
    vi.useFakeTimers();
    let release: ((value: unknown) => void) | undefined;
    mocks.previewCleanup.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useAccountCleanupFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    act(() => result.current.onToggleStatus("cooldown", true));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.previewTotals).toBeNull();
    expect(result.current.previewError).toBe(false);

    await act(async () => {
      release?.({
        rootsByStatus: { cooldown: 2 },
        rootCount: 2,
        linkedByProvider: {},
        total: 2,
      });
    });
    expect(result.current.previewTotals?.total).toBe(2);
    expect(result.current.previewFresh).toBe(true);

    // 勾选关联目标后 key 变化，旧计数立即失效。
    act(() => result.current.onToggleTarget("grok_web", true));
    expect(result.current.previewFresh).toBe(false);
    expect(result.current.previewTotals).toBeNull();
    // 勾选后 key 不再命中，确认按钮回到等待预览的状态。
    expect(result.current.targets).toEqual(["grok_web"]);
  });
});
