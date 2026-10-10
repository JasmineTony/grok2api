import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import type { AccountDTO } from "@/features/accounts/accounts-dto";
import { useAccountCleanupFlow } from "@/features/accounts/use-account-cleanup-flow";
import { useAccountsPageModel } from "@/features/accounts/use-accounts-page-model";
import { useAccountsImportFlow } from "@/features/accounts/use-accounts-transfer-flows";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 账号流程 hook 的集合操作与错误回退分支补齐（AGENTS.md TEST-2），断言用户可见状态变化：
//  - 清理弹窗取消已选关联目标后按新集合重新计数（驱动 targets 过滤回调）；
//  - 导入失败时“进行中提示”句柄为空，不误关他人提示但错误仍回传；
//  - 导入弹窗收到打开事件时保留已填文本，关闭事件才清空；
//  - 组合入口收到非 Error 拒绝值时展示通用错误文案且弹窗保持打开。

const mocks = vi.hoisted(() => ({
  cleanupAccounts: vi.fn(),
  previewCleanup: vi.fn(),
  importAccounts: vi.fn(),
  listAccounts: vi.fn(),
  getAccountSummary: vi.fn(),
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
    createdAt: "2026-01-02T03:04:05Z",
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useRealTimers();
  await i18n.changeLanguage("zh-CN");
  mocks.toast.loading.mockReturnValue("toast-id");
  mocks.listAccounts.mockResolvedValue({ items: [account()], total: 1, page: 1, pageSize: 20 });
  mocks.getAccountSummary.mockResolvedValue({
    total: 1,
    enabled: 1,
    available: 1,
    cooldown: 0,
    risk: 0,
    providers: { grok_build: { total: 1, available: 1 }, grok_web: { total: 0, available: 0 } },
    recovery: { cooldown: 0, waitingReset: 0, probing: 0 },
    issues: { disabled: 0, reauthRequired: 0 },
  });
  mocks.listAllEgressNodes.mockResolvedValue({ items: [] });
});

afterEach(() => {
  vi.useRealTimers();
  activeClient?.clear();
});

describe("清理关联目标的取消选择", () => {
  it("取消已选关联目标后按新集合重新计数", async () => {
    mocks.previewCleanup.mockImplementation((_provider: string, _statuses: string[], targets: string[]) =>
      Promise.resolve({
        rootsByStatus: { cooldown: 3 },
        rootCount: 3,
        linkedByProvider: {},
        total: targets.length > 0 ? 5 : 3,
      }),
    );
    const { result } = renderHook(() => useAccountCleanupFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    act(() => result.current.onToggleStatus("cooldown", true));
    await waitFor(() => expect(result.current.previewTotals?.total).toBe(3));

    act(() => result.current.onToggleTarget("grok_web", true));
    expect(result.current.targets).toEqual(["grok_web"]);
    await waitFor(() => expect(result.current.previewTotals?.total).toBe(5));

    act(() => result.current.onToggleTarget("grok_web", false));
    expect(result.current.targets).toEqual([]);
    await waitFor(() => expect(result.current.previewTotals?.total).toBe(3));
    expect(result.current.previewError).toBe(false);
  });
});

describe("导入失败时的进行中提示清理", () => {
  it("进行中提示句柄为空时不误关提示，但错误仍回传且状态复位", async () => {
    mocks.toast.loading.mockReturnValue(null);
    const failure = new ApiError(502, "importFailed", "导入失败");
    mocks.importAccounts.mockRejectedValue(failure);
    const ctx = createContext();
    const { result } = renderHook(() => useAccountsImportFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.importFiles([new File(["token"], "tokens.txt", { type: "text/plain" })]));
    await waitFor(() => expect(ctx.showError).toHaveBeenCalledWith(failure));

    expect(mocks.toast.dismiss).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    expect(result.current.pending).toBe(false);
  });
});

describe("导入弹窗的打开事件", () => {
  it("打开事件保留已填文本，关闭事件才清空", () => {
    const { result } = renderHook(() => useAccountsImportFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.onOpenChange(true));
    expect(result.current.open).toBe(true);

    act(() => result.current.onTokensChange("token-a"));
    act(() => result.current.onOpenChange(true));
    expect(result.current.open).toBe(true);
    expect(result.current.tokens).toBe("token-a");

    act(() => result.current.onOpenChange(false));
    expect(result.current.open).toBe(false);
    expect(result.current.tokens).toBe("");
  });
});

describe("组合入口的非 Error 拒绝值", () => {
  it("清理接口抛出非 Error 值时展示通用错误文案并保持弹窗打开", async () => {
    mocks.cleanupAccounts.mockRejectedValue("cleanup exploded");
    mocks.previewCleanup.mockResolvedValue({
      rootsByStatus: { cooldown: 3 },
      rootCount: 3,
      linkedByProvider: {},
      total: 3,
    });
    const { result } = renderHook(() => useAccountsPageModel(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.result?.total).toBe(1));

    act(() => result.current.tasks.cleanup.openDialog());
    act(() => result.current.tasks.cleanup.onToggleStatus("cooldown", true));
    await waitFor(() => expect(result.current.tasks.cleanup.previewTotals?.total).toBe(3));
    await act(async () => result.current.tasks.cleanup.onConfirm());

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(i18n.t("errors.generic")));
    expect(result.current.tasks.cleanup.open).toBe(true);
    expect(result.current.tasks.cleanup.busy).toBe(false);
  });
});
