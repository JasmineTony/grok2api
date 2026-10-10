import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import type { AccountDTO } from "@/features/accounts/accounts-dto";
import { useAccountCleanupFlow } from "@/features/accounts/use-account-cleanup-flow";
import { useAccountDeleteFlow } from "@/features/accounts/use-account-delete-flow";
import { useAccountEditFlow } from "@/features/accounts/use-account-edit-flow";
import { useAccountsPageModel } from "@/features/accounts/use-accounts-page-model";
import { useAccountsRenewalFlow, useAccountsQuotaSyncFlow } from "@/features/accounts/use-accounts-task-flows";
import {
  useAccountsConversionFlow,
  useAccountsImportFlow,
  useAccountsScriptsFlow,
} from "@/features/accounts/use-accounts-transfer-flows";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 账号流程 hook 的分支补齐（AGENTS.md TEST-2）：覆盖成功路径被外部取消后的迟到响应、
// 未选关联目标/未填 Cookie 的提交回退、模型同步与冷却告警、非取消错误提示与
// 组合入口的模型/出口查询失效。全部断言用户可见状态，不检查 mock 调用次数以外无意义的细节。

const mocks = vi.hoisted(() => ({
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  previewAccountDeletion: vi.fn(),
  previewCleanup: vi.fn(),
  refreshAllAccountBilling: vi.fn(),
  refreshAllAccountTokens: vi.fn(),
  runWebAccountScripts: vi.fn(),
  convertWebAccountsToBuild: vi.fn(),
  syncWebAccountsToConsole: vi.fn(),
  importAccounts: vi.fn(),
  listAccounts: vi.fn(),
  getAccountSummary: vi.fn(),
  assignEgressAccounts: vi.fn(),
  unassignEgressAccounts: vi.fn(),
  listAllEgressNodes: vi.fn(),
  listEgressNodes: vi.fn(),
  listEgressSources: vi.fn(),
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    loading: vi.fn((): string | number | null => "toast-id"),
    dismiss: vi.fn(),
  },
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
    unassignEgressAccounts: mocks.unassignEgressAccounts,
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

let activeClient: QueryClient | undefined;

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  activeClient = client;
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

function summary(providers: Record<string, { total: number; available: number }>) {
  return {
    total: 1,
    enabled: 1,
    available: 1,
    cooldown: 0,
    risk: 0,
    providers,
    recovery: { cooldown: 0, waitingReset: 0, probing: 0 },
    issues: { disabled: 0, reauthRequired: 0 },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useRealTimers();
  await i18n.changeLanguage("zh-CN");
  mocks.toast.loading.mockReturnValue("toast-id");
  mocks.listAccounts.mockResolvedValue({ items: [account()], total: 1, page: 1, pageSize: 20 });
  mocks.getAccountSummary.mockResolvedValue(
    summary({ grok_build: { total: 1, available: 1 }, grok_web: { total: 0, available: 0 } }),
  );
  mocks.listAllEgressNodes.mockResolvedValue({ items: [] });
});

afterEach(() => {
  vi.useRealTimers();
  activeClient?.clear();
});

describe("清理预览被外部取消", () => {
  it("取消后到达的预览失败不写错误状态也不提示用户", async () => {
    vi.useFakeTimers();
    let rejectPreview: ((error: unknown) => void) | undefined;
    mocks.previewCleanup.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectPreview = reject;
        }),
    );
    const { result } = renderHook(() => useAccountCleanupFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    act(() => result.current.onToggleStatus("disabled", true));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    act(() => result.current.reset());
    await act(async () => {
      rejectPreview?.(new DOMException("aborted", "AbortError"));
    });

    expect(result.current.open).toBe(false);
    expect(result.current.statuses.size).toBe(0);
    expect(result.current.previewError).toBe(false);
    expect(result.current.previewTotals).toBeNull();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("重置后仍可重新打开并重新计数", async () => {
    mocks.previewCleanup.mockResolvedValue({
      rootsByStatus: { cooldown: 4 },
      rootCount: 4,
      linkedByProvider: {},
      total: 4,
    });
    const { result } = renderHook(() => useAccountCleanupFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.reset());
    expect(result.current.open).toBe(false);

    act(() => result.current.openDialog());
    act(() => result.current.onToggleStatus("cooldown", true));
    await waitFor(() => expect(result.current.previewTotals?.total).toBe(4));
    expect(result.current.previewFresh).toBe(true);
  });
});

describe("关联删除预览被外部取消", () => {
  it("取消后到达的预览成功结果不写入关联计数", async () => {
    vi.useFakeTimers();
    let resolvePreview: ((value: unknown) => void) | undefined;
    mocks.previewAccountDeletion.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
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
      resolvePreview?.({ rootCount: 1, linkedByProvider: { grok_web: 9 }, total: 10 });
    });

    expect(result.current.single.counts).toEqual({});
    expect(result.current.single.previewError).toBe(false);
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });
});

describe("删除单个账号与关联目标回退", () => {
  it("未选关联目标时省略 links 参数并提示已删除", async () => {
    mocks.deleteAccount.mockResolvedValue({ deleted: 1 });
    const { result } = renderHook(() => useAccountDeleteFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDelete(account()));
    await act(async () => result.current.single.onConfirm());

    await waitFor(() => expect(result.current.single.account).toBeNull());
    expect(mocks.deleteAccount).toHaveBeenCalledWith("acct-1", undefined);
    expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.deleted"));
  });

  it("未选关联目标的单个删除不刷新关联计数，弹窗关闭后预览保持空", async () => {
    mocks.deleteAccount.mockResolvedValue({ deleted: 1 });
    const { result } = renderHook(() => useAccountDeleteFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openBatchDelete());
    act(() => result.current.batch.onOpenChange(false));
    act(() => result.current.openDelete(account()));
    await act(async () => result.current.single.onConfirm());
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());

    expect(mocks.previewAccountDeletion).not.toHaveBeenCalled();
    expect(result.current.batch.open).toBe(false);
    expect(result.current.single.targets).toEqual([]);
  });
});

describe("编辑提交的权益与告警分支", () => {
  it("Build 池改动权益时刷新模型查询并提示模型同步失败", async () => {
    mocks.updateAccount.mockResolvedValue(account({ buildSuperEntitled: true, modelSyncFailed: true }));
    const ctx = createContext();
    const { result } = renderHook(() => useAccountEditFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.beginEdit(account({ buildSuperEntitled: false })));
    act(() => {
      result.current.form.setValue("buildSuperEntitled", true);
    });
    await act(async () =>
      result.current.onSubmit({ preventDefault: () => undefined } as Parameters<typeof result.current.onSubmit>[0]),
    );

    await waitFor(() => expect(mocks.updateAccount).toHaveBeenCalledTimes(1));
    const payload = mocks.updateAccount.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.buildSuperEntitled).toBe(true);
    expect(ctx.invalidateModels).toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.toast.warning).toHaveBeenCalledWith(i18n.t("accounts.updatedWithModelSyncFailure")),
    );
  });

  it("启用不会立即清除冷却时给出对应警告而不是成功提示", async () => {
    mocks.updateAccount.mockResolvedValue(account({ enabledDoesNotClearCooldown: true }));
    const { result } = renderHook(() => useAccountEditFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.beginEdit(account()));
    await act(async () =>
      result.current.onSubmit({ preventDefault: () => undefined } as Parameters<typeof result.current.onSubmit>[0]),
    );

    await waitFor(() =>
      expect(mocks.toast.warning).toHaveBeenCalledWith(i18n.t("accounts.enabledDoesNotClearCooldown")),
    );
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("非 Build 池未填写 Cookie 时提交不写凭据与路由字段", async () => {
    mocks.updateAccount.mockResolvedValue(account({ provider: "grok_web" }));
    const { result } = renderHook(() => useAccountEditFlow(createContext({ provider: "grok_web" })), {
      wrapper: createWrapper(),
    });

    act(() => result.current.beginEdit(account({ provider: "grok_web" })));
    await act(async () =>
      result.current.onSubmit({ preventDefault: () => undefined } as Parameters<typeof result.current.onSubmit>[0]),
    );

    await waitFor(() => expect(mocks.updateAccount).toHaveBeenCalledTimes(1));
    const payload = mocks.updateAccount.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("cloudflareCookies");
    expect(payload).not.toHaveProperty("clearCloudflareCookies");
    expect(payload).not.toHaveProperty("buildRouteMode");
    expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.updated"));
  });
});

describe("脚本任务失败告警", () => {
  it("全部脚本失败时给出带失败数的警告", async () => {
    mocks.runWebAccountScripts.mockResolvedValue({ succeeded: 0, failed: 2 });
    const { result } = renderHook(() => useAccountsScriptsFlow(createContext({ provider: "grok_web" })), {
      wrapper: createWrapper(),
    });

    act(() => result.current.openDialog(["acct-1"]));
    await act(async () => result.current.onRun({ acceptTerms: true, setBirthDate: false, enableNSFW: false }));

    await waitFor(() =>
      expect(mocks.toast.warning).toHaveBeenCalledWith(
        i18n.t("webAccountScripts.completedWithFailures", { succeeded: 0, failed: 2 }),
      ),
    );
    expect(result.current.targets).toBeNull();
  });
});

describe("任务弹窗打开事件", () => {
  it("额度同步弹窗收到打开事件时保持同步任务选中", async () => {
    const { result } = renderHook(() => useAccountsQuotaSyncFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.onTaskChange("reset"));
    act(() => result.current.onOpenChange(true));

    expect(result.current.open).toBe(true);
    expect(result.current.task).toBe("reset");

    act(() => result.current.onTaskChange("sync"));
    act(() => result.current.onOpenChange(true));
    expect(result.current.task).toBe("sync");
  });

  it("刷新凭据弹窗收到打开事件时可用，取消后才中断请求", async () => {
    mocks.refreshAllAccountTokens.mockImplementation(
      (_setProgress: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsRenewalFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.onOpenChange(true));
    expect(result.current.open).toBe(true);

    act(() => result.current.onConfirm());
    await waitFor(() => expect(result.current.busy).toBe(true));

    act(() => result.current.onOpenChange(false));
    expect(result.current.open).toBe(false);
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.progress).toBeNull();
    expect(ctx.showError).not.toHaveBeenCalled();
  });
});

describe("同步 Console 成功与非取消失败", () => {
  it("同步 Console 成功后关闭弹窗并提示完成结果", async () => {
    const result = { synced: 2, failed: 0, skipped: 0 };
    mocks.syncWebAccountsToConsole.mockResolvedValue(result);
    const ctx = createContext({ provider: "grok_web" });
    const { result: flow } = renderHook(() => useAccountsConversionFlow(ctx), { wrapper: createWrapper() });

    act(() => flow.current.openDialog(["a", "b"]));
    act(() => flow.current.onTargetChange("console"));
    await act(async () => flow.current.onConfirm());

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("webConsoleSync.completed", result)));
    expect(ctx.clearSelection).toHaveBeenCalled();
    expect(flow.current.open).toBe(false);
    expect(flow.current.syncProgress).toBeNull();
  });

  it("同步 Console 失败按用户可见错误提示", async () => {
    mocks.syncWebAccountsToConsole.mockRejectedValue(new ApiError(502, "syncFailed", "同步失败"));
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountsConversionFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("all"));
    act(() => result.current.onTargetChange("console"));
    await act(async () => result.current.onConfirm());

    await waitFor(() => expect(ctx.showError).toHaveBeenCalled());
    expect(vi.mocked(ctx.showError).mock.calls[0][0]).toBeInstanceOf(ApiError);
    expect(result.current.open).toBe(true);
  });
});

describe("导入进行中提示与文件读取回退", () => {
  it("进行中提示返回空句柄时成功不再关闭提示", async () => {
    mocks.toast.loading.mockReturnValue(null);
    mocks.importAccounts.mockResolvedValue({ imported: 1, failed: 0, syncFailed: 0 });
    const { result } = renderHook(() => useAccountsImportFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openQuickImport());
    act(() => result.current.onTokensChange("token"));
    await act(async () => result.current.onSubmit());

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.imported", expect.anything())),
    );
    expect(mocks.toast.dismiss).not.toHaveBeenCalled();
    expect(result.current.tokens).toBe("");
  });

  it("导入失败时先关闭进行中提示再回传用户可见错误", async () => {
    mocks.importAccounts.mockRejectedValue(new ApiError(502, "importFailed", "导入失败"));
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsImportFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.importFiles([new File(["token"], "tokens.txt", { type: "text/plain" })]));
    await waitFor(() => expect(ctx.showError).toHaveBeenCalled());

    expect(mocks.toast.dismiss).toHaveBeenCalledWith("toast-id");
    expect(result.current.busy).toBe(false);
  });

  it("文件读取失败时提示通用错误且不写入文本", async () => {
    const { result } = renderHook(() => useAccountsImportFlow(createContext()), { wrapper: createWrapper() });
    const file = new File(["token"], "tokens.txt", { type: "text/plain" });
    Object.defineProperty(file, "text", { value: () => Promise.reject(new Error("read failed")) });

    await act(async () => result.current.onFileSelected(file));

    expect(mocks.toast.error).toHaveBeenCalledWith(i18n.t("errors.generic"));
    expect(result.current.tokens).toBe("");
  });
});

describe("账号页组合入口的失效通知", () => {
  it("编辑改动权益会失效模型查询", async () => {
    mocks.updateAccount.mockResolvedValue(account({ buildSuperEntitled: true }));
    const { result } = renderHook(() => useAccountsPageModel(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.result?.total).toBe(1));
    const invalidateSpy = vi.spyOn(activeClient as QueryClient, "invalidateQueries");

    act(() => result.current.records.edit.beginEdit(account({ buildSuperEntitled: false })));
    act(() => {
      result.current.records.edit.form.setValue("buildSuperEntitled", true);
    });
    await act(async () =>
      result.current.records.edit.onSubmit({
        preventDefault: () => undefined,
      } as Parameters<typeof result.current.records.edit.onSubmit>[0]),
    );

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["models"] }));
  });
  it("解绑出口成功会失效出口节点查询", async () => {
    mocks.unassignEgressAccounts.mockResolvedValue({ updated: 1 });
    const { result } = renderHook(() => useAccountsPageModel(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.result?.total).toBe(1));
    const invalidateSpy = vi.spyOn(activeClient as QueryClient, "invalidateQueries");

    act(() => result.current.tasks.egress.openDialog());
    act(() => result.current.tasks.egress.onTaskChange("unbind"));
    await act(async () => result.current.tasks.egress.onConfirm());

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["egress-nodes"] }));
    expect(result.current.tasks.egress.open).toBe(false);
  });

  it("切换账号池不会重置记录级表单的编辑内容", async () => {
    const { result } = renderHook(() => useAccountsPageModel(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.result?.total).toBe(1));

    act(() => result.current.records.edit.beginEdit(account()));
    expect(result.current.records.edit.form.getValues("name")).toBe("build-alpha");

    act(() => result.current.changeProvider("grok_web"));
    await waitFor(() => expect(result.current.filters.provider).toBe("grok_web"));
    expect(result.current.records.edit.form.getValues("name")).toBe("build-alpha");
    expect(result.current.tasks.cleanup.statuses.size).toBe(0);
  });
});
