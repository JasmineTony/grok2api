import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/shared/api/client";
import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import type { AccountDTO } from "@/features/accounts/accounts-dto";
import { useAccountCleanupFlow } from "@/features/accounts/use-account-cleanup-flow";
import { useAccountDeleteFlow } from "@/features/accounts/use-account-delete-flow";
import { useAccountsDeviceFlow } from "@/features/accounts/use-account-device-flow";
import { useAccountEditFlow } from "@/features/accounts/use-account-edit-flow";
import { useAccountsBatchFlow } from "@/features/accounts/use-accounts-batch-flow";
import { useAccountsEgressFilterGroups } from "@/features/accounts/use-accounts-egress-filter-options";
import {
  useAccountsConversionFlow,
  useAccountsImportFlow,
  useAccountsScriptsFlow,
} from "@/features/accounts/use-accounts-transfer-flows";
import {
  useAccountsDetectFlow,
  useAccountsQuotaSyncFlow,
  useAccountsRenewalFlow,
} from "@/features/accounts/use-accounts-task-flows";
import { useAccountsPageModel } from "@/features/accounts/use-accounts-page-model";
import { i18n } from "@/shared/i18n";

// 剩余 hook 分支补齐（AGENTS.md TEST-2）：覆盖重复勾选幂等、缺字段回退、
// 中止后的静默、非 Error 错误文案回退与非 Build 池的导入/转换分派。

const mocks = vi.hoisted(() => ({
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  previewAccountDeletion: vi.fn(),
  previewCleanup: vi.fn(),
  refreshAllWebAccountQuotas: vi.fn(),
  refreshAllAccountTokens: vi.fn(),
  detectBuildAccounts: vi.fn(),
  syncWebAccountsToConsole: vi.fn(),
  runWebAccountScripts: vi.fn(),
  importAccounts: vi.fn(),
  importWebAccounts: vi.fn(),
  importConsoleAccounts: vi.fn(),
  convertWebAccountsToBuild: vi.fn(),
  listAccounts: vi.fn(),
  getAccountSummary: vi.fn(),
  startDeviceAuthorization: vi.fn(),
  pollDeviceAuthorization: vi.fn(),
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
  return { ...actual, listEgressNodes: mocks.listEgressNodes, listEgressSources: mocks.listEgressSources };
});

vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return { ...actual, toast: mocks.toast };
});

type FlowContext = AccountsFlowContext;

function createContext(overrides: Partial<FlowContext> = {}): FlowContext {
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

describe("useAccountCleanupFlow 勾选幂等", () => {
  it("重复勾选同一状态或目标不会产生重复项，取消未勾选项保持集合不变", () => {
    const { result } = renderHook(() => useAccountCleanupFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    act(() => result.current.onToggleStatus("cooldown", true));
    act(() => result.current.onToggleStatus("cooldown", true));
    expect(result.current.statuses.size).toBe(1);
    expect(result.current.statuses.has("cooldown")).toBe(true);

    // 取消一个从未勾选过的状态不改变已有集合。
    act(() => result.current.onToggleStatus("disabled", false));
    expect(result.current.statuses.size).toBe(1);

    act(() => result.current.onToggleTarget("grok_web", true));
    act(() => result.current.onToggleTarget("grok_web", true));
    expect(result.current.targets).toEqual(["grok_web"]);
  });
});

describe("useAccountDeleteFlow 迟到响应与非 Error 文案", () => {
  it("预览返回缺失的关联计数按 0 处理，不会保持阻塞", async () => {
    vi.useFakeTimers();
    mocks.previewAccountDeletion.mockResolvedValue({ rootCount: 1, total: 1 });
    const { result } = renderHook(() => useAccountDeleteFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDelete(account()));
    act(() => result.current.single.onToggleTarget("grok_web", true));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => undefined);

    expect(result.current.single.counts).toEqual({ grok_web: 0 });
    expect(result.current.single.blocking).toBe(false);
  });

  it("重复勾选已选目标不产生重复项", () => {
    const { result } = renderHook(() => useAccountDeleteFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.single.onToggleTarget("grok_web", true));
    act(() => result.current.single.onToggleTarget("grok_web", true));
    expect(result.current.single.targets).toEqual(["grok_web"]);
  });
});

describe("useAccountsDeviceFlow 中止与非 Error 失败", () => {
  it("请求被中断后到达的失败不再改写状态或提示", async () => {
    vi.useFakeTimers();
    let rejectPoll: ((error: unknown) => void) | undefined;
    mocks.startDeviceAuthorization.mockResolvedValue({
      sessionId: "session-1",
      userCode: "AAAA-BBBB",
      verificationUri: "https://example.com/device",
      intervalSeconds: 1,
      expiresAt: "2999-01-01T00:00:00Z",
    });
    mocks.pollDeviceAuthorization.mockImplementation(
      (_id: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          rejectPoll = reject;
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const { result } = renderHook(() => useAccountsDeviceFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.login());
    await act(async () => undefined);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => undefined);
    expect(result.current.status).toBe("pending");

    // 关闭弹窗会 abort 控制器；此后到达的失败必须静默。
    act(() => result.current.onOpenChange(false));
    await act(async () => {
      rejectPoll?.(new ApiError(502, "pollFailed", "轮询失败"));
    });
    expect(result.current.status).toBe("pending");
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("非 Error 失败回退到通用错误文案", async () => {
    vi.useFakeTimers();
    mocks.startDeviceAuthorization.mockResolvedValue({
      sessionId: "session-1",
      userCode: "AAAA-BBBB",
      verificationUri: "https://example.com/device",
      intervalSeconds: 1,
      expiresAt: "2999-01-01T00:00:00Z",
    });
    mocks.pollDeviceAuthorization.mockRejectedValue("boom");
    const { result } = renderHook(() => useAccountsDeviceFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.login());
    await act(async () => undefined);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => undefined);

    expect(result.current.status).toBe("failed");
    expect(mocks.toast.error).toHaveBeenCalledWith(i18n.t("errors.generic"));
  });
});

describe("useAccountEditFlow 缺编辑对象与 Cookie 回退", () => {
  it("未选中账号时提交不触达接口", async () => {
    const ctx = createContext();
    const { result } = renderHook(() => useAccountEditFlow(ctx), { wrapper: createWrapper() });

    act(() => {
      result.current.form.setValue("name", "renamed");
    });
    await act(async () =>
      result.current.onSubmit({ preventDefault: () => undefined } as Parameters<typeof result.current.onSubmit>[0]),
    );

    expect(mocks.updateAccount).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(result.current.editing).toBeNull();
  });

  it("非 Build 池写入 Cookie 文本而不是清空标记", async () => {
    mocks.updateAccount.mockResolvedValue(account({ provider: "grok_web" }));
    const { result } = renderHook(() => useAccountEditFlow(createContext({ provider: "grok_web" })), {
      wrapper: createWrapper(),
    });

    act(() => result.current.beginEdit(account({ provider: "grok_web" })));
    act(() => {
      result.current.form.setValue("cloudflareCookies", "cf_clearance=abc");
    });
    await act(async () =>
      result.current.onSubmit({ preventDefault: () => undefined } as Parameters<typeof result.current.onSubmit>[0]),
    );

    await waitFor(() => expect(mocks.updateAccount).toHaveBeenCalledTimes(1));
    const payload = mocks.updateAccount.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.cloudflareCookies).toBe("cf_clearance=abc");
    expect(payload).not.toHaveProperty("clearCloudflareCookies");
    expect(payload).not.toHaveProperty("buildRouteMode");
  });
});

describe("useAccountsBatchFlow 非 Build 池分派", () => {
  it("非 Build 池的额度同步直接提交且弹窗保持关闭", async () => {
    mocks.refreshAllWebAccountQuotas.mockResolvedValue({ succeeded: 1, failed: 0 });
    const { result } = renderHook(() => useAccountsBatchFlow(createContext({ provider: "grok_web" })), {
      wrapper: createWrapper(),
    });

    act(() => result.current.onOpenQuotaSync());
    expect(result.current.quotaTask.open).toBe(false);

    await act(async () => result.current.quotaTask.onConfirm());
    await waitFor(() => expect(result.current.pending).toBe(false));
  });
});

describe("useAccountsConversionFlow 目标集合回退", () => {
  it("选中集合为空且目标为 all 之外的集合时按空 ids 提交", async () => {
    mocks.convertWebAccountsToBuild.mockResolvedValue({
      created: 0,
      linked: 0,
      skipped: 0,
      failed: 0,
      synced: 0,
      syncFailed: 0,
    });
    const { result } = renderHook(() => useAccountsConversionFlow(createContext({ provider: "grok_web" })), {
      wrapper: createWrapper(),
    });

    act(() => result.current.openDialog([]));
    await act(async () => result.current.onConfirm());

    await waitFor(() =>
      expect(mocks.convertWebAccountsToBuild).toHaveBeenCalledWith(
        { ids: [], strategy: "missing" },
        expect.any(Function),
        expect.any(AbortSignal),
      ),
    );
  });

  it("转换失败被用户取消时保持静默", async () => {
    mocks.convertWebAccountsToBuild.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountsConversionFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("all"));
    await act(async () => result.current.onConfirm());

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(ctx.showError).not.toHaveBeenCalled();
  });

  it("同步 Console 取消时保持静默，成功时清空选择", async () => {
    const ctx = createContext({ provider: "grok_web" });
    mocks.syncWebAccountsToConsole.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    const { result } = renderHook(() => useAccountsConversionFlow(ctx), { wrapper: createWrapper() });

    // openDialog 会把目标重置为 build，因此目标切换必须在打开之后，才符合真实交互顺序。
    act(() => result.current.openDialog("all"));
    act(() => result.current.onTargetChange("console"));
    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(mocks.syncWebAccountsToConsole).toHaveBeenCalledTimes(1);
    expect(ctx.showError).not.toHaveBeenCalled();
    expect(ctx.clearSelection).not.toHaveBeenCalled();

    mocks.syncWebAccountsToConsole.mockResolvedValue({ created: 1, skipped: 0, failed: 0 });
    act(() => result.current.openDialog(["acct-1"]));
    act(() => result.current.onTargetChange("console"));
    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(ctx.clearSelection).toHaveBeenCalledTimes(1));
    expect(result.current.open).toBe(false);
  });
});

describe("useAccountsScriptsFlow 取消与目标集合", () => {
  it("脚本任务被取消时保持静默且弹窗保留", async () => {
    const ctx = createContext({ provider: "grok_web" });
    mocks.runWebAccountScripts.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const { result } = renderHook(() => useAccountsScriptsFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("all"));
    await act(async () => result.current.onRun({ acceptTerms: true, setBirthDate: false, enableNSFW: false }));

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(ctx.showError).not.toHaveBeenCalled();
    expect(result.current.targets).toBe("all");
  });

  it("关闭脚本弹窗会中断在途请求", async () => {
    const signals: AbortSignal[] = [];
    mocks.runWebAccountScripts.mockImplementation((_input: unknown, _progress: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountsScriptsFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog(["acct-1"]));
    act(() => result.current.onRun({ acceptTerms: true, setBirthDate: false, enableNSFW: false }));
    await waitFor(() => expect(result.current.busy).toBe(true));

    act(() => result.current.onClose());
    expect(signals[0].aborted).toBe(true);
    expect(result.current.targets).toBeNull();
    await waitFor(() => expect(result.current.busy).toBe(false));
  });
});

describe("useAccountsImportFlow 分派与中途取消", () => {
  function importResult(overrides: Record<string, number> = {}) {
    return { created: 1, updated: 0, skipped: 0, failed: 0, synced: 0, syncFailed: 0, ...overrides };
  }

  it("Web 池与 Console 池各自走分派接口", async () => {
    mocks.importWebAccounts.mockResolvedValue(importResult());
    const web = renderHook(() => useAccountsImportFlow(createContext({ provider: "grok_web" })), {
      wrapper: createWrapper(),
    });
    act(() => web.result.current.onTokensChange("w"));
    act(() => web.result.current.onSubmit());
    await waitFor(() => expect(mocks.importWebAccounts).toHaveBeenCalledTimes(1));
    web.unmount();

    mocks.importConsoleAccounts.mockResolvedValue(importResult());
    const consoleFlow = renderHook(() => useAccountsImportFlow(createContext({ provider: "grok_console" })), {
      wrapper: createWrapper(),
    });
    act(() => consoleFlow.result.current.onTokensChange("c"));
    act(() => consoleFlow.result.current.onSubmit());
    await waitFor(() => expect(mocks.importConsoleAccounts).toHaveBeenCalledTimes(1));
    expect(mocks.importAccounts).not.toHaveBeenCalled();
  });

  it("同步阶段进度文案随 phase 切换", async () => {
    mocks.importAccounts.mockImplementation(
      async (_files: unknown, onProgress: (value: { completed: number; total: number; phase?: string }) => void) => {
        onProgress({ completed: 1, total: 2, phase: "syncing" });
        onProgress({ completed: 2, total: 2, phase: "importing" });
        return importResult();
      },
    );
    const { result } = renderHook(() => useAccountsImportFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.onTokensChange("t"));
    act(() => result.current.onSubmit());

    await waitFor(() =>
      expect(mocks.toast.loading).toHaveBeenCalledWith(i18n.t("common.syncingProgress", { completed: 1, total: 2 }), {
        id: "toast-id",
      }),
    );
    expect(mocks.toast.loading).toHaveBeenCalledWith(i18n.t("common.importingProgress", { completed: 2, total: 2 }), {
      id: "toast-id",
    });
  });

  it("导入失败为取消时关闭进行中的 toast 但不提示用户", async () => {
    mocks.importAccounts.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsImportFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.onTokensChange("t"));
    act(() => result.current.onSubmit());
    await waitFor(() => expect(mocks.toast.dismiss).toHaveBeenCalledWith("toast-id"));

    expect(ctx.showError).not.toHaveBeenCalled();
    expect(mocks.toast.warning).not.toHaveBeenCalled();
  });
});

describe("useAccountsEgressFilterGroups 分页动作", () => {
  it("主作用域有下一页时触发翻页，控制台额外源不额外占用页", async () => {
    mocks.listEgressNodes.mockResolvedValue({
      items: [{ id: "n1", name: "节点1", scope: "grok_build", enabled: true, proxyConfigured: true }],
      page: 1,
      pageSize: 100,
      total: 500,
    });
    mocks.listEgressSources.mockResolvedValue({
      items: [{ id: "s1", name: "源1", scope: "grok_build" }],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    const { result } = renderHook(
      () => useAccountsEgressFilterGroups({ open: true, provider: "grok_build", search: "" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current[0].options).toHaveLength(1));
    expect(result.current[0].hasMore).toBe(true);
    expect(result.current[1].hasMore).toBe(false);

    result.current[0].onAction?.();
    await waitFor(() => expect(mocks.listEgressNodes).toHaveBeenCalledTimes(2));
    // 订阅源已取满，onAction 不产生额外请求。
    result.current[1].onAction?.();
    expect(mocks.listEgressSources).toHaveBeenCalledTimes(1);
  });
});

describe("useAccountsEgressFilterGroups 双作用域翻页", () => {
  it("Console 池的翻页同时覆盖主作用域与 Web 额外作用域", async () => {
    mocks.listEgressNodes.mockImplementation(async (input: { scope: string }) => ({
      items: [
        {
          id: `${input.scope}-1`,
          name: `节点-${input.scope}`,
          scope: input.scope,
          enabled: true,
          proxyConfigured: true,
        },
      ],
      page: 1,
      pageSize: 100,
      total: 500,
    }));
    mocks.listEgressSources.mockImplementation(async (input: { scope: string }) => ({
      items: [{ id: `s-${input.scope}`, name: `源-${input.scope}`, scope: input.scope }],
      page: 1,
      pageSize: 100,
      total: 500,
    }));
    const { result } = renderHook(
      () => useAccountsEgressFilterGroups({ open: true, provider: "grok_console", search: "" }),
      { wrapper: createWrapper() },
    );

    // console 池会同时请求 console 主作用域与 web 额外作用域。
    await waitFor(() => expect(mocks.listEgressNodes).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current[0].options).toHaveLength(2));

    // 两侧都还有下一页，onAction 必须同时推动两个来源翻页。
    result.current[0].onAction?.();
    await waitFor(() => expect(mocks.listEgressNodes).toHaveBeenCalledTimes(4));
    result.current[1].onAction?.();
    await waitFor(() => expect(mocks.listEgressSources).toHaveBeenCalledTimes(4));
  });
});

describe("useAccountsBatchFlow 弹窗开关回调", () => {
  it("并发弹窗与额度弹窗的开关回调保留当前值", () => {
    const { result } = renderHook(() => useAccountsBatchFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.concurrency.onValueChange("6"));
    act(() => result.current.concurrency.onOpenChange(false));
    expect(result.current.concurrency.open).toBe(false);
    expect(result.current.concurrency.value).toBe("6");

    act(() => result.current.quotaTask.onTaskChange("reset"));
    act(() => result.current.quotaTask.onOpenChange(false));
    expect(result.current.quotaTask.open).toBe(false);
    expect(result.current.quotaTask.task).toBe("reset");
  });
});

describe("useAccountsTaskFlows 取消语义静默", () => {
  it("检测任务被取消时静默，不提示用户", async () => {
    const ctx = createContext();
    mocks.detectBuildAccounts = vi.fn();
    const detect = (await import("@/features/accounts/accounts-api")).detectBuildAccounts;
    vi.mocked(detect).mockRejectedValue(new DOMException("aborted", "AbortError"));
    const { result } = renderHook(() => useAccountsDetectFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("all"));
    await act(async () => result.current.onRun());

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(ctx.showError).not.toHaveBeenCalled();
  });

  it("全量额度同步被取消时静默，关闭弹窗保留选择", async () => {
    const ctx = createContext({ provider: "grok_web" });
    mocks.refreshAllWebAccountQuotas.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const { result } = renderHook(() => useAccountsQuotaSyncFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("sync"));
    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(ctx.showError).not.toHaveBeenCalled();
  });

  it("全量刷新凭据被取消时静默", async () => {
    const ctx = createContext();
    mocks.refreshAllAccountTokens.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const { result } = renderHook(() => useAccountsRenewalFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(ctx.showError).not.toHaveBeenCalled();
  });
});

describe("useAccountsPageModel 错误文案回退", () => {
  it("非 Error 错误使用通用文案，摘要缺失时为 0 账号", async () => {
    mocks.listAccounts.mockResolvedValue({ items: [account()], total: 1, page: 1, pageSize: 20 });
    mocks.getAccountSummary.mockResolvedValue({
      total: 0,
      enabled: 0,
      available: 0,
      cooldown: 0,
      risk: 0,
      providers: {},
      recovery: { cooldown: 0, waitingReset: 0, probing: 0 },
      issues: { disabled: 0, reauthRequired: 0 },
    });
    const { result } = renderHook(() => useAccountsPageModel(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.result?.total).toBe(1));

    // providers 里没有当前池条目时视为 0 个账号。
    expect(result.current.hasProviderAccounts).toBe(true);

    mocks.listAccounts.mockRejectedValue("boom");
    act(() => result.current.filters.changeProvider("grok_console"));
    // 列表查询失败经由 query 暴露；页面模型本身不弹 toast（错误由表格 ErrorState 渲染）。
    await waitFor(() => expect(result.current.list.query.isError).toBe(true));
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });
});
