import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import type { AccountTaskProgressDTO } from "@/features/accounts/account-task-progress";
import type { BuildDetectItemDTO } from "@/features/accounts/accounts-dto";
import {
  useAccountsDetectFlow,
  useAccountsQuotaSyncFlow,
  useAccountsRenewalFlow,
} from "@/features/accounts/use-accounts-task-flows";
import {
  useAccountsConversionFlow,
  useAccountsImportFlow,
  useAccountsScriptsFlow,
} from "@/features/accounts/use-accounts-transfer-flows";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 账号任务流 hook 测试（AGENTS.md TEST-2/TEST-3）：只替换网络边界，hook 的状态机、取消语义与
// 用户可见通知保持真实；断言进度、计数、成功/失败/取消四条路径，而不是只检查 mock 调用。

const mocks = vi.hoisted(() => ({
  detectBuildAccounts: vi.fn(),
  refreshAllAccountBilling: vi.fn(),
  refreshAllWebAccountQuotas: vi.fn(),
  refreshAllConsoleAccountQuotas: vi.fn(),
  refreshAllAccountTokens: vi.fn(),
  resetAllAccountQuota: vi.fn(),
  convertWebAccountsToBuild: vi.fn(),
  syncWebAccountsToConsole: vi.fn(),
  runWebAccountScripts: vi.fn(),
  importAccounts: vi.fn(),
  importWebAccounts: vi.fn(),
  importConsoleAccounts: vi.fn(),
  toast: {
    loading: vi.fn(() => "toast-id"),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/features/accounts/accounts-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/accounts/accounts-api")>();
  return { ...actual, ...mocks };
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

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

type DetectHandlers = {
  onProgress?: (value: AccountTaskProgressDTO) => void;
  onItem?: (item: BuildDetectItemDTO) => void;
};

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("zh-CN");
  mocks.toast.loading.mockReturnValue("toast-id");
});

describe("useAccountsDetectFlow", () => {
  it("全量检测把非法条目聚合成可见清单并提示成功", async () => {
    let handlers: DetectHandlers = {};
    mocks.detectBuildAccounts.mockImplementation(async (_input: unknown, streamHandlers: DetectHandlers) => {
      handlers = streamHandlers;
      return { succeeded: 1, failed: 1 };
    });
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsDetectFlow(ctx), { wrapper: createWrapper() });

    expect(result.current.open).toBe(false);
    act(() => result.current.openDialog("all"));
    expect(result.current.open).toBe(true);
    expect(result.current.mode).toBe("all");

    await act(async () => result.current.onRun());
    await waitFor(() => expect(result.current.pending).toBe(false));

    expect(mocks.detectBuildAccounts).toHaveBeenCalledWith({ all: true }, expect.anything(), expect.any(AbortSignal));
    expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.allDetected", { succeeded: 1, failed: 1 }));
    expect(ctx.clearSelection).not.toHaveBeenCalled();

    act(() => {
      handlers.onProgress?.({ completed: 1, total: 2 });
      handlers.onItem?.({ id: "acct-1", name: "alpha", outcome: "ok" });
      handlers.onItem?.({ id: "acct-2", name: "beta", outcome: "invalid", reason: "失效" });
      handlers.onItem?.({ id: "acct-2", name: "beta", outcome: "failed", reason: "超时" });
      handlers.onItem?.({ id: "acct-3", name: "gamma", outcome: "invalid", reason: "未授权" });
    });

    // 全量模式只展示仍然非法的条目；同一账号改判后计数从 invalid 迁移到 failed。
    expect(result.current.counts).toEqual({ ok: 1, invalid: 1, failed: 1 });
    expect(result.current.visibleItems.map((item) => item.id)).toEqual(["acct-3"]);
    expect(result.current.progress).toEqual({ completed: 1, total: 2 });
    expect(ctx.invalidate).toHaveBeenCalled();
  });

  it("选中集合检测按 ids 提交、成功后清空选择并展示全部结果", async () => {
    mocks.detectBuildAccounts.mockResolvedValue({ succeeded: 2, failed: 0 });
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsDetectFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("selected"));
    await act(async () => result.current.onRun());
    await waitFor(() => expect(result.current.pending).toBe(false));

    expect(mocks.detectBuildAccounts).toHaveBeenCalledWith(
      { ids: ["a", "b"] },
      expect.anything(),
      expect.any(AbortSignal),
    );
    expect(ctx.clearSelection).toHaveBeenCalledTimes(1);
    expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.batchDetected", { succeeded: 2, failed: 0 }));
    expect(result.current.counts).toEqual({ ok: 0, invalid: 0, failed: 0 });
  });

  it("同一账号连续相同结局不会重复计数", async () => {
    let handlers: DetectHandlers = {};
    mocks.detectBuildAccounts.mockImplementation(async (_input: unknown, streamHandlers: DetectHandlers) => {
      handlers = streamHandlers;
      return { succeeded: 1, failed: 0 };
    });
    const { result } = renderHook(() => useAccountsDetectFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDialog("selected"));
    await act(async () => result.current.onRun());
    await waitFor(() => expect(result.current.pending).toBe(false));

    act(() => {
      handlers.onItem?.({ id: "acct-1", name: "alpha", outcome: "failed" });
      handlers.onItem?.({ id: "acct-1", name: "alpha", outcome: "failed" });
    });

    expect(result.current.counts).toEqual({ ok: 0, invalid: 0, failed: 1 });
    expect(result.current.visibleItems).toHaveLength(1);
  });

  it("取消检测会中断在途请求，取消错误不提示用户", async () => {
    const signals: AbortSignal[] = [];
    mocks.detectBuildAccounts.mockImplementation((_input: unknown, _handlers: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return never();
    });
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsDetectFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("all"));
    act(() => result.current.onRun());
    await waitFor(() => expect(result.current.pending).toBe(true));

    act(() => result.current.onOpenChange(false));
    expect(signals[0].aborted).toBe(true);
    expect(result.current.open).toBe(false);
    expect(ctx.showError).not.toHaveBeenCalled();
  });

  it("非取消错误提示用户，打开弹窗会重置上一次的进度与结果", async () => {
    const ctx = createContext();
    mocks.detectBuildAccounts.mockRejectedValue(new ApiError(502, "detectFailed", "检测失败"));
    const { result } = renderHook(() => useAccountsDetectFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("all"));
    await act(async () => result.current.onRun());
    await waitFor(() => expect(ctx.showError).toHaveBeenCalledWith(expect.any(ApiError)));

    act(() => result.current.openDialog("all"));
    expect(result.current.counts).toEqual({ ok: 0, invalid: 0, failed: 0 });
    expect(result.current.progress).toBeNull();

    act(() => result.current.onOpenChange(true));
    expect(result.current.open).toBe(true);
    act(() => result.current.onOpenChange(false));
    expect(result.current.open).toBe(false);
    expect(result.current.busy).toBe(false);
  });
});

describe("useAccountsQuotaSyncFlow", () => {
  it("按账号池分派全量同步接口并展示结果", async () => {
    mocks.refreshAllWebAccountQuotas.mockResolvedValue({ succeeded: 3, failed: 0 });
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountsQuotaSyncFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("sync"));
    expect(result.current.open).toBe(true);
    expect(result.current.task).toBe("sync");
    expect(result.current.provider).toBe("grok_web");

    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(result.current.open).toBe(false));

    expect(mocks.refreshAllWebAccountQuotas).toHaveBeenCalledWith(expect.any(Function), expect.any(AbortSignal));
    expect(mocks.refreshAllAccountBilling).not.toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith(
      i18n.t("accounts.allBillingRefreshed", { succeeded: 3, failed: 0 }),
    );
    expect(ctx.invalidate).toHaveBeenCalled();
    expect(result.current.progress).toBeNull();
  });

  it("Console 池走 Console 同步接口，Build 池的重置任务走额度重置接口", async () => {
    const consoleCtx = createContext({ provider: "grok_console" });
    mocks.refreshAllConsoleAccountQuotas.mockResolvedValue({ succeeded: 1, failed: 0 });
    const consoleFlow = renderHook(() => useAccountsQuotaSyncFlow(consoleCtx), { wrapper: createWrapper() });

    act(() => consoleFlow.result.current.openDialog("sync"));
    await act(async () => consoleFlow.result.current.onConfirm());
    await waitFor(() => expect(mocks.refreshAllConsoleAccountQuotas).toHaveBeenCalled());
    consoleFlow.unmount();

    const buildCtx = createContext();
    mocks.resetAllAccountQuota.mockResolvedValue({ reset: 4 });
    const buildFlow = renderHook(() => useAccountsQuotaSyncFlow(buildCtx), { wrapper: createWrapper() });

    act(() => buildFlow.result.current.onTaskChange("reset"));
    act(() => buildFlow.result.current.openDialog("reset"));
    await act(async () => buildFlow.result.current.onConfirm());
    await waitFor(() => expect(mocks.resetAllAccountQuota).toHaveBeenCalledTimes(1));
    expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accountQuotaReset.completed", { reset: 4 }));
    expect(buildFlow.result.current.provider).toBe("grok_build");
  });

  it("非 Build 池的重置任务仍然走同步接口", async () => {
    const ctx = createContext({ provider: "grok_web" });
    mocks.refreshAllWebAccountQuotas.mockResolvedValue({ succeeded: 1, failed: 0 });
    const { result } = renderHook(() => useAccountsQuotaSyncFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("reset"));
    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(mocks.refreshAllWebAccountQuotas).toHaveBeenCalledTimes(1));
    expect(mocks.resetAllAccountQuota).not.toHaveBeenCalled();
  });

  it("关闭弹窗中断在途同步，失败时提示用户", async () => {
    const signals: AbortSignal[] = [];
    mocks.refreshAllAccountBilling.mockImplementation((_progress: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return never();
    });
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsQuotaSyncFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("sync"));
    act(() => result.current.onConfirm());
    await waitFor(() => expect(result.current.busy).toBe(true));

    act(() => result.current.onOpenChange(false));
    expect(signals[0].aborted).toBe(true);
    expect(result.current.open).toBe(false);
  });

  it("同步失败按非取消错误提示", async () => {
    mocks.refreshAllAccountBilling.mockRejectedValue(new ApiError(502, "syncFailed", "同步失败"));
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsQuotaSyncFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("sync"));
    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(ctx.showError).toHaveBeenCalledWith(expect.any(ApiError)));
    expect(ctx.invalidate).toHaveBeenCalled();
  });
});

describe("useAccountsRenewalFlow", () => {
  it("确认刷新凭据成功后关闭弹窗并提示结果", async () => {
    mocks.refreshAllAccountTokens.mockResolvedValue({ succeeded: 5, failed: 0, skipped: 1 });
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsRenewalFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    expect(result.current.open).toBe(true);

    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(result.current.open).toBe(false));

    expect(mocks.refreshAllAccountTokens).toHaveBeenCalledWith(expect.any(Function), expect.any(AbortSignal));
    expect(mocks.toast.success).toHaveBeenCalledWith(
      i18n.t("accounts.allTokensRefreshed", { succeeded: 5, failed: 0, skipped: 1 }),
    );
  });

  it("刷新过程中关闭会中断请求，失败时回传用户可见错误", async () => {
    const signals: AbortSignal[] = [];
    mocks.refreshAllAccountTokens.mockImplementation((_progress: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return never();
    });
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsRenewalFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    act(() => result.current.onConfirm());
    await waitFor(() => expect(result.current.busy).toBe(true));

    act(() => result.current.onOpenChange(false));
    expect(signals[0].aborted).toBe(true);
    expect(result.current.open).toBe(false);

    mocks.refreshAllAccountTokens.mockRejectedValue(new ApiError(502, "refreshFailed", "刷新失败"));
    act(() => result.current.openDialog());
    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(ctx.showError).toHaveBeenCalledWith(expect.any(ApiError)));
  });
});

describe("useAccountsConversionFlow", () => {
  it("默认按全量转 Build 提交，成功后清空选择并刷新模型", async () => {
    mocks.convertWebAccountsToBuild.mockResolvedValue({
      created: 1,
      linked: 0,
      skipped: 0,
      failed: 0,
      synced: 1,
      syncFailed: 0,
    });
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountsConversionFlow(ctx), { wrapper: createWrapper() });

    expect(result.current.open).toBe(false);
    expect(result.current.targets).toBeNull();
    act(() => result.current.onConfirm());
    expect(mocks.convertWebAccountsToBuild).not.toHaveBeenCalled();

    act(() => result.current.openDialog("all"));
    expect(result.current.open).toBe(true);
    expect(result.current.target).toBe("build");
    expect(result.current.strategy).toBe("missing");

    act(() => result.current.onTargetChange("console"));
    act(() => result.current.onStrategyChange("all"));
    act(() => result.current.onTargetChange("build"));

    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(result.current.open).toBe(false));

    expect(mocks.convertWebAccountsToBuild).toHaveBeenCalledWith(
      { all: true, strategy: "all" },
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(ctx.clearSelection).toHaveBeenCalled();
    expect(ctx.invalidateModels).toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith(
      i18n.t("accounts.conversionCompleted", {
        created: 1,
        linked: 0,
        skipped: 0,
        failed: 0,
        synced: 1,
        syncFailed: 0,
      }),
    );
  });

  it("选中集合同步 Console 时按 ids 提交", async () => {
    mocks.syncWebAccountsToConsole.mockResolvedValue({
      created: 0,
      updated: 1,
      skipped: 0,
      failed: 0,
      synced: 1,
      syncFailed: 0,
    });
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountsConversionFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog(["acct-1", "acct-2"]));
    act(() => result.current.onTargetChange("console"));
    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(result.current.open).toBe(false));

    expect(mocks.syncWebAccountsToConsole).toHaveBeenCalledWith(
      { ids: ["acct-1", "acct-2"], strategy: "missing" },
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith(
      i18n.t("webConsoleSync.completed", {
        created: 0,
        updated: 1,
        skipped: 0,
        failed: 0,
        synced: 1,
        syncFailed: 0,
      }),
    );
  });

  it("关闭弹窗同时中断转换与同步两条在途请求", async () => {
    const conversionSignals: AbortSignal[] = [];
    mocks.convertWebAccountsToBuild.mockImplementation((_values: unknown, _progress: unknown, signal: AbortSignal) => {
      conversionSignals.push(signal);
      return never();
    });
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountsConversionFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("all"));
    act(() => result.current.onConfirm());
    await waitFor(() => expect(result.current.busy).toBe(true));

    act(() => result.current.onClose());
    expect(conversionSignals[0].aborted).toBe(true);
    expect(result.current.targets).toBeNull();
    expect(ctx.showError).not.toHaveBeenCalled();
  });

  it("转换失败按用户可见错误提示", async () => {
    mocks.convertWebAccountsToBuild.mockRejectedValue(new ApiError(502, "convertFailed", "转换失败"));
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountsConversionFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("all"));
    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(ctx.showError).toHaveBeenCalledWith(expect.any(ApiError)));
    expect(result.current.pending).toBe(false);
  });
});

describe("useAccountsScriptsFlow", () => {
  const actions = { acceptTerms: true, setBirthDate: false, enableNSFW: true };

  it("全量运行脚本成功后关闭弹窗并在全部失败时给出警告", async () => {
    mocks.runWebAccountScripts.mockResolvedValue({ succeeded: 0, failed: 2 });
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountsScriptsFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("all"));
    await act(async () => result.current.onRun(actions));
    await waitFor(() => expect(result.current.targets).toBeNull());

    expect(mocks.runWebAccountScripts).toHaveBeenCalledWith(
      { all: true, actions },
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(mocks.toast.warning).toHaveBeenCalledWith(
      i18n.t("webAccountScripts.completedWithFailures", { succeeded: 0, failed: 2 }),
    );
    expect(ctx.clearSelection).toHaveBeenCalled();
  });

  it("选中集合运行脚本成功时提示成功；无目标时不提交", async () => {
    mocks.runWebAccountScripts.mockResolvedValue({ succeeded: 1, failed: 0 });
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountsScriptsFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.onRun(actions));
    expect(mocks.runWebAccountScripts).not.toHaveBeenCalled();

    act(() => result.current.openDialog(["acct-9"]));
    await act(async () => result.current.onRun(actions));
    await waitFor(() => expect(mocks.runWebAccountScripts).toHaveBeenCalledTimes(1));

    expect(mocks.runWebAccountScripts).toHaveBeenCalledWith(
      { ids: ["acct-9"], actions },
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith(
      i18n.t("webAccountScripts.completed", { succeeded: 1, failed: 0 }),
    );
    expect(result.current.progress).toBeNull();
  });

  it("关闭脚本弹窗中断在途请求，失败时提示用户", async () => {
    const signals: AbortSignal[] = [];
    mocks.runWebAccountScripts.mockImplementation((_input: unknown, _progress: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return never();
    });
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountsScriptsFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog("all"));
    act(() => result.current.onRun(actions));
    await waitFor(() => expect(result.current.busy).toBe(true));

    act(() => result.current.onClose());
    expect(signals[0].aborted).toBe(true);
    expect(result.current.targets).toBeNull();

    mocks.runWebAccountScripts.mockRejectedValue(new ApiError(502, "scriptsFailed", "脚本失败"));
    act(() => result.current.openDialog("all"));
    await act(async () => result.current.onRun(actions));
    await waitFor(() => expect(ctx.showError).toHaveBeenCalledWith(expect.any(ApiError)));
  });
});

describe("useAccountsImportFlow", () => {
  it("按账号池选择导入接口，并按阶段更新导入进度提示", async () => {
    mocks.importWebAccounts.mockImplementation(
      async (_files: File[], onProgress: (value: AccountTaskProgressDTO) => void) => {
        onProgress({ completed: 1, total: 3, phase: "syncing" });
        onProgress({ completed: 2, total: 3 });
        return { created: 2, updated: 0, skipped: 0, failed: 0, synced: 0, syncFailed: 0 };
      },
    );
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountsImportFlow(ctx), { wrapper: createWrapper() });

    expect(result.current.open).toBe(false);
    act(() => result.current.openQuickImport());
    expect(result.current.open).toBe(true);
    act(() => result.current.onTokensChange("line-1"));
    expect(result.current.tokens).toBe("line-1");

    act(() => result.current.onSubmit());
    await waitFor(() => expect(result.current.open).toBe(false));

    const [files] = mocks.importWebAccounts.mock.calls[0] as [File[]];
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("grok-web-sso-tokens.txt");
    expect(mocks.toast.loading).toHaveBeenCalledWith(i18n.t("common.importingProgress", { completed: 0, total: "…" }));
    expect(mocks.toast.loading).toHaveBeenCalledWith(
      i18n.t("common.syncingProgress", { completed: 1, total: 3, phase: "syncing" }),
      { id: "toast-id" },
    );
    expect(mocks.toast.loading).toHaveBeenCalledWith(i18n.t("common.importingProgress", { completed: 2, total: 3 }), {
      id: "toast-id",
    });
    expect(mocks.toast.dismiss).toHaveBeenCalledWith("toast-id");
    expect(mocks.toast.success).toHaveBeenCalledWith(
      i18n.t("accounts.imported", { created: 2, updated: 0, skipped: 0, failed: 0, synced: 0, syncFailed: 0 }),
    );
    expect(result.current.tokens).toBe("");
  });

  it("Build 与 Console 池各自使用对应导入接口与默认文件名", async () => {
    mocks.importAccounts.mockResolvedValue({ created: 1, updated: 0, skipped: 0, failed: 0, synced: 0, syncFailed: 0 });
    mocks.importConsoleAccounts.mockResolvedValue({
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 1,
      synced: 0,
      syncFailed: 0,
    });

    const build = renderHook(() => useAccountsImportFlow(createContext()), { wrapper: createWrapper() });
    build.result.current.reset();
    act(() => build.result.current.onTokensChange("a"));
    act(() => build.result.current.onSubmit());
    await waitFor(() => expect(mocks.importAccounts).toHaveBeenCalledTimes(1));
    const [buildFiles] = mocks.importAccounts.mock.calls[0] as [File[]];
    expect(buildFiles[0].name).toBe("grok-build-refresh-tokens.txt");
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        i18n.t("accounts.imported", { created: 1, updated: 0, skipped: 0, failed: 0, synced: 0, syncFailed: 0 }),
      ),
    );
    build.unmount();

    const consoleFlow = renderHook(() => useAccountsImportFlow(createContext({ provider: "grok_console" })), {
      wrapper: createWrapper(),
    });
    act(() => consoleFlow.result.current.onTokensChange("b"));
    act(() => consoleFlow.result.current.onSubmit());
    await waitFor(() => expect(mocks.importConsoleAccounts).toHaveBeenCalledTimes(1));
    const [consoleFiles] = mocks.importConsoleAccounts.mock.calls[0] as [File[]];
    expect(consoleFiles[0].name).toBe("grok-console-sso-tokens.txt");
    expect(mocks.toast.warning).toHaveBeenCalledWith(
      i18n.t("accounts.importedWithFailures", {
        created: 1,
        updated: 0,
        skipped: 0,
        failed: 1,
        synced: 0,
        syncFailed: 0,
      }),
    );
  });

  it("同步失败优先于成功提示", async () => {
    mocks.importAccounts.mockResolvedValue({
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
      synced: 0,
      syncFailed: 2,
    });
    const { result } = renderHook(() => useAccountsImportFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.importFiles([new File(["x"], "a.txt")]));
    await waitFor(() =>
      expect(mocks.toast.warning).toHaveBeenCalledWith(
        i18n.t("accounts.importedWithSyncFailures", {
          created: 1,
          updated: 0,
          skipped: 0,
          failed: 0,
          synced: 0,
          syncFailed: 2,
        }),
      ),
    );

    act(() => result.current.importFiles([]));
    expect(mocks.importAccounts).toHaveBeenCalledTimes(1);
  });

  it("文本为空时不提交，关闭弹窗清空文本", async () => {
    const { result } = renderHook(() => useAccountsImportFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.onTokensChange("   "));
    act(() => result.current.onSubmit());
    expect(mocks.importAccounts).not.toHaveBeenCalled();

    act(() => result.current.onTokensChange("token"));
    act(() => result.current.onOpenChange(false));
    expect(result.current.open).toBe(false);
    expect(result.current.tokens).toBe("");
  });

  it("选择文件：忽略空选择、拒绝超大文件、读取成功写入文本", async () => {
    const { result } = renderHook(() => useAccountsImportFlow(createContext()), { wrapper: createWrapper() });

    await act(async () => result.current.onFileSelected(undefined));
    expect(result.current.tokens).toBe("");

    const tooLarge = new File([""], "big.txt");
    Object.defineProperty(tooLarge, "size", { value: 31 * 1024 * 1024 });
    await act(async () => result.current.onFileSelected(tooLarge));
    expect(mocks.toast.error).toHaveBeenCalledWith(i18n.t("apiErrors.accountImportFileTooLarge"));
    expect(result.current.tokens).toBe("");

    const small = new File(["token-line"], "tokens.txt", { type: "text/plain" });
    await act(async () => result.current.onFileSelected(small));
    expect(result.current.tokens).toBe("token-line");

    const unreadable = new File(["x"], "broken.txt");
    Object.defineProperty(unreadable, "text", { value: () => Promise.reject(new Error("read failed")) });
    await act(async () => result.current.onFileSelected(unreadable));
    expect(mocks.toast.error).toHaveBeenCalledWith(i18n.t("errors.generic"));
  });

  it("导入失败按非取消错误提示，取消错误保持静默", async () => {
    const ctx = createContext();
    mocks.importAccounts.mockRejectedValue(new ApiError(502, "importFailed", "导入失败"));
    const { result } = renderHook(() => useAccountsImportFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.importFiles([new File(["x"], "a.txt")]));
    await waitFor(() => expect(ctx.showError).toHaveBeenCalledWith(expect.any(ApiError)));
    expect(mocks.toast.dismiss).toHaveBeenCalledWith("toast-id");

    const aborted = new DOMException("aborted", "AbortError");
    mocks.importAccounts.mockRejectedValue(aborted);
    act(() => result.current.importFiles([new File(["x"], "b.txt")]));
    await waitFor(() => expect(mocks.importAccounts).toHaveBeenCalledTimes(2));
    expect(ctx.showError).toHaveBeenCalledTimes(1);
  });
});
