import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { FormEvent, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import type { AccountDTO, AccountProvider } from "@/features/accounts/accounts-dto";
import { useAccountCleanupFlow } from "@/features/accounts/use-account-cleanup-flow";
import { useAccountDeleteFlow } from "@/features/accounts/use-account-delete-flow";
import { useAccountEditFlow } from "@/features/accounts/use-account-edit-flow";
import { useAccountRowMutations } from "@/features/accounts/use-account-row-mutations";
import { useAccountsFilters, useAccountsScopeState } from "@/features/accounts/use-accounts-filters";
import { useAccountsSelection } from "@/features/accounts/use-accounts-selection";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 账号记录级流程 hook 测试（AGENTS.md TEST-2/TEST-3）：只替换网络边界，
// 覆盖选择集合、筛选收敛、单行凭据动作、删除预览与清理预览的状态机与失败路径。

const mocks = vi.hoisted(() => ({
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  deleteAccounts: vi.fn(),
  previewAccountDeletion: vi.fn(),
  cleanupAccounts: vi.fn(),
  previewCleanup: vi.fn(),
  refreshAccountBilling: vi.fn(),
  refreshAccountToken: vi.fn(),
  clearAccountCooldown: vi.fn(),
  refreshAccountQuota: vi.fn(),
  acceptWebAccountTerms: vi.fn(),
  setWebAccountBirthDate: vi.fn(),
  enableWebAccountNSFW: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), loading: vi.fn(() => "toast-id"), dismiss: vi.fn() },
}));

vi.mock("@/features/accounts/accounts-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/accounts/accounts-api")>();
  return { ...actual, ...mocks };
});

vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return { ...actual, toast: mocks.toast };
});

type MockedFn = { mock: { calls: unknown[][] } };

/** mutationFn 与 onError 由 react-query 追加额外上下文参数，这里只比较首参（调用变量或错误对象）。 */
function firstArgOf(fn: MockedFn): unknown[] {
  return fn.mock.calls.map((call) => call[0]);
}

/** showError 以 vi.fn 实现，测试才能读取失败路径实际传入的错误对象。 */
type AccountsFlowHarness = Omit<AccountsFlowContext, "showError"> & { showError: Mock<(error: unknown) => void> };

function createContext(overrides: Partial<Omit<AccountsFlowContext, "showError">> = {}): AccountsFlowHarness {
  return {
    t: (key, options) => i18n.t(key, options),
    provider: "grok_build",
    language: "zh-CN",
    selectedIds: [],
    selectedCount: 0,
    clearSelection: vi.fn(),
    invalidate: vi.fn(),
    invalidateModels: vi.fn(),
    invalidateEgressNodes: vi.fn(),
    showError: vi.fn<(error: unknown) => void>(),
    ...overrides,
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

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useRealTimers();
  await i18n.changeLanguage("zh-CN");
  mocks.toast.loading.mockReturnValue("toast-id");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAccountsSelection", () => {
  it("勾选与取消勾选按页维护集合，并在切换账号池时丢弃旧选择", () => {
    const { result, rerender } = renderHook(
      ({ provider }: { provider: AccountProvider }) => useAccountsSelection(provider),
      {
        wrapper: createWrapper(),
        initialProps: { provider: "grok_build" },
      },
    );

    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.hasSelection).toBe(false);

    act(() => result.current.toggleAccount("b", true));
    act(() => result.current.toggleAccount("a", true));
    // 选中集合按字典序输出，保证请求参数稳定。
    expect(result.current.selectedIds).toEqual(["a", "b"]);
    expect(result.current.selectedIdsKey).toBe("a,b");
    expect(result.current.hasSelection).toBe(true);

    act(() => result.current.toggleAccount("a", false));
    expect(result.current.selectedIds).toEqual(["b"]);

    rerender({ provider: "grok_web" });
    expect(result.current.selectedIds).toEqual([]);
    rerender({ provider: "grok_build" });
    expect(result.current.selectedIds).toEqual(["b"]);

    act(() => result.current.togglePage(["c", "d"], true));
    expect(result.current.selectedIds).toEqual(["b", "c", "d"]);
    act(() => result.current.togglePage(["b", "c", "d"], false));
    expect(result.current.selectedIds).toEqual([]);

    act(() => result.current.clearSelection());
    expect(result.current.selectedIds).toEqual([]);
  });
});

describe("useAccountsFilters", () => {
  it("切换账号池与筛选都会回到第 1 页，并把筛选值收敛到同一份 view model", () => {
    const { result } = renderHook(() => useAccountsFilters(), { wrapper: createWrapper() });

    expect(result.current.provider).toBe("grok_build");
    expect(result.current.page).toBe(1);
    expect(result.current.filterValues).toEqual({
      type: "",
      status: "",
      egress: "",
      egressSelectedLabel: "",
      renewal: "",
      risk: "",
      agreement: "",
      association: "",
    });

    act(() => result.current.setPage(4));
    act(() => result.current.changePageSize(50));
    expect(result.current.pageSize).toBe(50);
    expect(result.current.page).toBe(1);

    act(() => result.current.setPage(3));
    act(() => result.current.changeSort("createdAt", "asc"));
    expect(result.current.sort).toEqual({ field: "createdAt", order: "asc" });
    expect(result.current.page).toBe(1);

    act(() => result.current.filterChanges.type("free"));
    act(() => result.current.filterChanges.status("active"));
    act(() => result.current.filterChanges.egress("node:1"));
    act(() => result.current.setEgressFilterSelectedLabel("东京"));
    act(() => result.current.filterChanges.renewal("refreshable"));
    act(() => result.current.filterChanges.risk("flagged"));
    act(() => result.current.filterChanges.agreement("nsfwEnabled"));
    act(() => result.current.filterChanges.association("webLinked"));

    expect(result.current.filterValues).toEqual({
      type: "free",
      status: "active",
      egress: "node:1",
      egressSelectedLabel: "东京",
      renewal: "refreshable",
      risk: "flagged",
      agreement: "nsfwEnabled",
      association: "webLinked",
    });

    act(() => result.current.changeSearch("alpha"));
    expect(result.current.search).toBe("alpha");

    act(() => result.current.changeProvider("grok_console"));
    expect(result.current.provider).toBe("grok_console");
    // 搜索词与具体出口选择跨池保留，其余维度按新账号池重置。
    expect(result.current.search).toBe("alpha");
    expect(result.current.egressFilter).toBe("bound");
    expect(result.current.egressFilterSelectedLabel).toBe("");
    expect(result.current.filterValues.type).toBe("");
    expect(result.current.filterValues.status).toBe("");
    expect(result.current.filterValues.risk).toBe("");
    expect(result.current.associationFilter).toBe("");

    act(() => result.current.setEgressFilterOptionsOpen(true));
    act(() => result.current.setEgressFilterOptionsSearch("tok"));
    act(() => result.current.changeProvider("grok_web"));
    expect(result.current.egressFilterOptionsOpen).toBe(false);
    expect(result.current.egressFilterOptionsSearch).toBe("");
    expect(result.current.egressFilter).toBe("bound");
  });

  it("范围状态独立收敛 provider 与分页", () => {
    const { result } = renderHook(() => useAccountsScopeState(), { wrapper: createWrapper() });

    act(() => result.current.setPage(9));
    act(() => result.current.selectProvider("grok_web"));
    expect(result.current.provider).toBe("grok_web");
    expect(result.current.page).toBe(1);
    expect(result.current.sort).toEqual({ field: "createdAt", order: "desc" });
  });
});

describe("useAccountRowMutations", () => {
  it("四个单行动作各自调用接口并刷新账号查询", async () => {
    mocks.refreshAccountBilling.mockResolvedValue({});
    mocks.refreshAccountToken.mockResolvedValue(account());
    mocks.clearAccountCooldown.mockResolvedValue(account());
    mocks.refreshAccountQuota.mockResolvedValue({});
    const ctx = createContext();
    const { result } = renderHook(() => useAccountRowMutations(ctx), { wrapper: createWrapper() });

    await act(async () => result.current.refreshBilling("acct-1"));
    await waitFor(() => expect(firstArgOf(mocks.refreshAccountBilling)).toEqual(["acct-1"]));
    expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.billingRefreshed"));

    await act(async () => result.current.refreshToken("acct-1"));
    await waitFor(() => expect(firstArgOf(mocks.refreshAccountToken)).toEqual(["acct-1"]));
    expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.authRefreshed"));

    await act(async () => result.current.refreshQuota("acct-1"));
    await waitFor(() => expect(firstArgOf(mocks.refreshAccountQuota)).toEqual(["acct-1"]));

    await waitFor(() => expect(ctx.invalidate).toHaveBeenCalled());
    expect(result.current.cooldownPending).toBe(false);
  });

  it("清除冷却成功后提示并失效查询，失败时回传用户可见错误", async () => {
    mocks.clearAccountCooldown.mockResolvedValue(account());
    const ctx = createContext();
    const { result } = renderHook(() => useAccountRowMutations(ctx), { wrapper: createWrapper() });

    await act(async () => result.current.clearCooldown("acct-1"));
    await waitFor(() => expect(firstArgOf(mocks.clearAccountCooldown)).toEqual(["acct-1"]));
    expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.cooldownCleared"));

    mocks.refreshAccountBilling.mockRejectedValue(new ApiError(502, "billingFailed", "刷新计费失败"));
    await act(async () => result.current.refreshBilling("acct-2"));
    await waitFor(() => expect(firstArgOf(ctx.showError)[0]).toBeInstanceOf(ApiError));
  });

  it("Web 协议动作按类型调用各自接口并在成功后关闭确认框", async () => {
    mocks.acceptWebAccountTerms.mockResolvedValue(account({ provider: "grok_web" }));
    mocks.setWebAccountBirthDate.mockResolvedValue(account({ provider: "grok_web" }));
    mocks.enableWebAccountNSFW.mockResolvedValue(account({ provider: "grok_web" }));
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountRowMutations(ctx), { wrapper: createWrapper() });
    const web = account({ provider: "grok_web", id: "acct-web" });

    expect(result.current.confirmation.target).toBeNull();
    expect(result.current.confirmation.busy).toBe(false);

    act(() => result.current.confirmation.onTargetChange({ account: web, action: "acceptTerms" }));
    expect(result.current.confirmation.target?.action).toBe("acceptTerms");

    await act(async () => result.current.confirmation.onConfirm({ account: web, action: "acceptTerms" }));
    await waitFor(() => expect(firstArgOf(mocks.acceptWebAccountTerms)).toEqual(["acct-web"]));
    expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("webAccountSettings.termsAccepted"));

    await act(async () => result.current.confirmation.onConfirm({ account: web, action: "setBirthDate" }));
    await waitFor(() => expect(firstArgOf(mocks.setWebAccountBirthDate)).toEqual(["acct-web"]));
    expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("webAccountSettings.birthDateSaved"));

    await act(async () => result.current.confirmation.onConfirm({ account: web, action: "enableNSFW" }));
    await waitFor(() => expect(firstArgOf(mocks.enableWebAccountNSFW)).toEqual(["acct-web"]));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("webAccountSettings.nsfwEnabled")));
    await waitFor(() => expect(result.current.confirmation.target).toBeNull());
    expect(ctx.invalidate).toHaveBeenCalled();
  });

  it("Web 协议动作失败时不关闭确认框并提示错误", async () => {
    mocks.acceptWebAccountTerms.mockRejectedValue(new ApiError(502, "termsFailed", "接受条款失败"));
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountRowMutations(ctx), { wrapper: createWrapper() });
    const web = account({ provider: "grok_web" });

    act(() => result.current.confirmation.onTargetChange({ account: web, action: "acceptTerms" }));
    await act(async () => result.current.confirmation.onConfirm({ account: web, action: "acceptTerms" }));

    await waitFor(() => expect(firstArgOf(ctx.showError)[0]).toBeInstanceOf(ApiError));
    expect(result.current.confirmation.target?.action).toBe("acceptTerms");
  });
});

describe("useAccountDeleteFlow", () => {
  it("勾选关联目标先展示 pending，预览返回后展示计数；取消勾选清理计数", async () => {
    vi.useFakeTimers();
    mocks.previewAccountDeletion.mockResolvedValue({ rootCount: 1, linkedByProvider: { grok_web: 3 }, total: 4 });
    const ctx = createContext();
    const { result } = renderHook(() => useAccountDeleteFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDelete(account()));
    expect(result.current.single.account?.id).toBe("acct-1");

    act(() => result.current.single.onToggleTarget("grok_web", true));
    expect(result.current.single.targets).toEqual(["grok_web"]);
    expect(result.current.single.blocking).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mocks.previewAccountDeletion).toHaveBeenCalledWith(["acct-1"], "grok_build", ["grok_web"]);
    await act(async () => undefined);
    expect(result.current.single.counts).toEqual({ grok_web: 3 });
    expect(result.current.single.blocking).toBe(false);

    act(() => result.current.single.onToggleTarget("grok_web", false));
    expect(result.current.single.targets).toEqual([]);
    expect(result.current.single.counts).toEqual({});
    expect(result.current.batch.open).toBe(false);
  });

  it("预览失败时保持阻塞且不写假 0", async () => {
    vi.useFakeTimers();
    mocks.previewAccountDeletion.mockRejectedValue(new ApiError(502, "previewFailed", "预览失败"));
    const { result } = renderHook(() => useAccountDeleteFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDelete(account()));
    act(() => result.current.single.onToggleTarget("grok_web", true));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => undefined);

    expect(result.current.single.previewError).toBe(true);
    expect(result.current.single.counts).toEqual({});
    expect(result.current.single.blocking).toBe(true);
    expect(mocks.toast.error).toHaveBeenCalledWith(i18n.t("accounts.linkedDeletePreviewFailed"));
  });

  it("全选与再次全选在清空与全选之间切换", () => {
    const { result } = renderHook(() => useAccountDeleteFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDelete(account()));
    act(() => result.current.single.onSelectAll());
    expect(result.current.single.targets).toEqual(["grok_web", "grok_console"]);

    act(() => result.current.single.onSelectAll());
    expect(result.current.single.targets).toEqual([]);
  });

  it("单账号删除按关联目标提交，缺少关联目标时省略请求体", async () => {
    mocks.deleteAccount.mockResolvedValue({ deleted: 1 });
    const ctx = createContext();
    const { result } = renderHook(() => useAccountDeleteFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDelete(account()));
    await act(async () => result.current.single.onConfirm());
    await waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalledWith("acct-1", undefined));

    await act(async () => result.current.single.onOpenChange(false));
    expect(result.current.single.account).toBeNull();
    expect(ctx.invalidate).toHaveBeenCalled();
  });

  it("批量删除按选中集合作业并提示跳过数量", async () => {
    mocks.deleteAccounts.mockResolvedValue({ deleted: 2, skipped: 1 });
    const ctx = createContext({ selectedIds: ["a", "b"], selectedCount: 2 });
    const { result } = renderHook(() => useAccountDeleteFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openBatchDelete());
    expect(result.current.batch.open).toBe(true);
    expect(result.current.batch.selectedCount).toBe(2);

    act(() => result.current.batch.onToggleTarget("grok_web", true));
    await act(async () => result.current.batch.onConfirm());

    await waitFor(() => expect(mocks.deleteAccounts).toHaveBeenCalledWith(["a", "b"], "grok_build", ["grok_web"]));
    expect(mocks.toast.warning).toHaveBeenCalledWith(i18n.t("accounts.deletedWithSkipped", { deleted: 2, skipped: 1 }));
    expect(ctx.clearSelection).toHaveBeenCalled();
    expect(result.current.batch.open).toBe(false);
    expect(result.current.busy).toBe(false);
  });

  it("没有跳过时只提示删除成功", async () => {
    mocks.deleteAccounts.mockResolvedValue({ deleted: 1 });
    const { result } = renderHook(() => useAccountDeleteFlow(createContext({ selectedIds: ["a"], selectedCount: 1 })), {
      wrapper: createWrapper(),
    });

    act(() => result.current.openBatchDelete());
    await act(async () => result.current.batch.onConfirm());

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.deleted")));
  });

  it("批量删除失败时不关闭弹窗", async () => {
    mocks.deleteAccounts.mockRejectedValue(new ApiError(502, "deleteFailed", "删除失败"));
    const ctx = createContext({ selectedIds: ["a"], selectedCount: 1 });
    const { result } = renderHook(() => useAccountDeleteFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openBatchDelete());
    await act(async () => result.current.batch.onConfirm());
    await waitFor(() => expect(firstArgOf(ctx.showError)[0]).toBeInstanceOf(ApiError));
    expect(result.current.batch.open).toBe(true);
  });
});

describe("useAccountCleanupFlow", () => {
  it("按状态去抖预览影响面，确认后按状态与关联目标提交", async () => {
    vi.useFakeTimers();
    mocks.previewCleanup.mockResolvedValue({
      rootCount: 2,
      total: 3,
      rootsByStatus: { cooldown: 2 },
      linkedByProvider: { grok_web: 1 },
    });
    mocks.cleanupAccounts.mockResolvedValue({ deleted: 2, linkedDeleted: 1, skipped: 0 });
    const ctx = createContext();
    const { result } = renderHook(() => useAccountCleanupFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    expect(result.current.open).toBe(true);
    expect(result.current.previewTotals).toBeNull();

    act(() => result.current.onToggleStatus("cooldown", true));
    expect(result.current.statuses.has("cooldown")).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => undefined);
    expect(mocks.previewCleanup).toHaveBeenCalledWith("grok_build", ["cooldown"], []);
    expect(result.current.previewFresh).toBe(true);
    expect(result.current.previewTotals?.total).toBe(3);

    act(() => result.current.onToggleTarget("grok_web", true));
    expect(result.current.targets).toEqual(["grok_web"]);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => undefined);
    expect(mocks.previewCleanup).toHaveBeenLastCalledWith("grok_build", ["cooldown"], ["grok_web"]);

    vi.useRealTimers();
    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(mocks.cleanupAccounts).toHaveBeenCalledWith("grok_build", ["cooldown"], ["grok_web"]));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        i18n.t("accounts.cleanupCompletedDetailed", { deleted: 2, linked: 1, skipped: 0 }),
      ),
    );
    expect(result.current.open).toBe(false);
    expect(result.current.statuses.size).toBe(0);
  });

  it("没有关联与跳过时提示简化文案", async () => {
    mocks.cleanupAccounts.mockResolvedValue({ deleted: 4 });
    const { result } = renderHook(() => useAccountCleanupFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    await act(async () => result.current.onConfirm());

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.cleanupCompleted", { deleted: 4 })),
    );
  });

  it("预览失败时不展示计数并提示错误，重新勾选会清掉失败标记", async () => {
    vi.useFakeTimers();
    mocks.previewCleanup.mockRejectedValue(new ApiError(502, "previewFailed", "预览失败"));
    const { result } = renderHook(() => useAccountCleanupFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    act(() => result.current.onToggleStatus("disabled", true));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => undefined);

    expect(result.current.previewError).toBe(true);
    expect(result.current.previewFresh).toBe(false);
    expect(result.current.previewTotals).toBeNull();
    expect(mocks.toast.error).toHaveBeenCalledWith(i18n.t("accounts.cleanupPreviewFailed"));

    act(() => result.current.onToggleStatus("reauthRequired", true));
    expect(result.current.previewError).toBe(false);
  });

  it("未选择状态时不触发预览；全选关联目标后再次全选清空", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAccountCleanupFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(mocks.previewCleanup).not.toHaveBeenCalled();

    act(() => result.current.onSelectAllTargets());
    expect(result.current.targets).toEqual(["grok_web", "grok_console"]);
    act(() => result.current.onSelectAllTargets());
    expect(result.current.targets).toEqual([]);

    act(() => result.current.onToggleTarget("grok_console", true));
    act(() => result.current.onToggleTarget("grok_console", true));
    expect(result.current.targets).toEqual(["grok_console"]);
  });

  it("清理失败时保留弹窗与选择，关闭弹窗会重置选择", async () => {
    mocks.cleanupAccounts.mockRejectedValue(new ApiError(502, "cleanupFailed", "清理失败"));
    const ctx = createContext();
    const { result } = renderHook(() => useAccountCleanupFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.openDialog());
    act(() => result.current.onToggleStatus("cooldown", true));
    await act(async () => result.current.onConfirm());
    await waitFor(() => expect(firstArgOf(ctx.showError)[0]).toBeInstanceOf(ApiError));
    expect(result.current.open).toBe(true);
    expect(result.current.statuses.has("cooldown")).toBe(true);

    act(() => result.current.onOpenChange(false));
    expect(result.current.open).toBe(false);
    expect(result.current.statuses.size).toBe(0);

    act(() => result.current.openDialog());
    act(() => result.current.onToggleStatus("cooldown", true));
    act(() => result.current.reset());
    expect(result.current.open).toBe(false);
    expect(result.current.statuses.size).toBe(0);
  });
});

describe("useAccountEditFlow", () => {
  function submit(flow: ReturnType<typeof useAccountEditFlow>): void {
    flow.onSubmit({ preventDefault: () => undefined } as unknown as FormEvent<HTMLFormElement>);
  }

  function payloadOf(callIndex: number): Record<string, unknown> {
    return (mocks.updateAccount.mock.calls[callIndex]?.[1] ?? {}) as Record<string, unknown>;
  }

  it("开始编辑时把账号字段写入表单，关闭时清空编辑对象", () => {
    const { result } = renderHook(() => useAccountEditFlow(createContext()), { wrapper: createWrapper() });

    expect(result.current.editing).toBeNull();
    expect(result.current.accountEnabled).toBe(true);
    expect(result.current.buildRouteMode).toBe("auto");
    expect(result.current.clearCloudflareCookies).toBe(false);

    act(() =>
      result.current.beginEdit(account({ enabled: false, priority: 5, maxConcurrent: 3, minimumRemaining: 2 })),
    );
    expect(result.current.editing?.id).toBe("acct-1");
    expect(result.current.accountEnabled).toBe(false);
    expect(result.current.form.getValues()).toMatchObject({
      name: "build-alpha",
      enabled: false,
      priority: 5,
      maxConcurrent: 3,
      minimumRemaining: 2,
    });

    act(() => result.current.onClose());
    expect(result.current.editing).toBeNull();
  });

  it("Build 池提交路由与权益字段，并在权益变化时刷新模型", async () => {
    mocks.updateAccount.mockResolvedValue(account());
    const ctx = createContext();
    const { result } = renderHook(() => useAccountEditFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.beginEdit(account({ buildRouteMode: "auto", buildSuperEntitled: false })));
    act(() => {
      result.current.form.setValue("buildRouteMode", "xai");
      result.current.form.setValue("buildSuperEntitled", true);
    });

    await act(async () => submit(result.current));

    await waitFor(() => expect(mocks.updateAccount).toHaveBeenCalledTimes(1));
    expect(mocks.updateAccount.mock.calls[0][0]).toBe("acct-1");
    expect(payloadOf(0)).toEqual({
      name: "build-alpha",
      priority: 1,
      maxConcurrent: 8,
      minimumRemaining: 0,
      buildRouteMode: "xai",
      buildSuperEntitled: true,
    });
    expect(ctx.invalidateModels).toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith(i18n.t("accounts.updated"));
  });

  it("非 Build 池提交 Cloudflare Cookie，并按开关决定清空或写入", async () => {
    mocks.updateAccount.mockResolvedValue(account({ provider: "grok_web" }));
    const ctx = createContext({ provider: "grok_web" });
    const { result } = renderHook(() => useAccountEditFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.beginEdit(account({ provider: "grok_web" })));
    act(() => {
      result.current.form.setValue("cloudflareCookies", "cf_clearance=abc");
    });
    await act(async () => submit(result.current));
    await waitFor(() => expect(mocks.updateAccount).toHaveBeenCalledTimes(1));
    expect(payloadOf(0).cloudflareCookies).toBe("cf_clearance=abc");
    // 未变更权益时不需要刷新模型查询。
    expect(ctx.invalidateModels).not.toHaveBeenCalled();

    // 提交成功会关闭弹窗并清空编辑对象，第二次编辑必须重新打开账号。
    act(() => result.current.beginEdit(account({ provider: "grok_web" })));
    act(() => {
      result.current.form.setValue("clearCloudflareCookies", true);
    });
    await act(async () => submit(result.current));
    await waitFor(() => expect(mocks.updateAccount).toHaveBeenCalledTimes(2));
    expect(payloadOf(1).clearCloudflareCookies).toBe(true);
    expect(payloadOf(1)).not.toHaveProperty("cloudflareCookies");
  });

  it("启用状态变化才写入 enabled 字段", async () => {
    mocks.updateAccount.mockResolvedValue(account({ enabled: false }));
    const { result } = renderHook(() => useAccountEditFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.beginEdit(account({ enabled: true })));
    await act(async () => submit(result.current));
    await waitFor(() => expect(mocks.updateAccount).toHaveBeenCalledTimes(1));
    expect(payloadOf(0)).not.toHaveProperty("enabled");

    act(() => result.current.beginEdit(account({ enabled: true })));
    act(() => {
      result.current.form.setValue("enabled", false);
    });
    await act(async () => submit(result.current));
    await waitFor(() => expect(mocks.updateAccount).toHaveBeenCalledTimes(2));
    expect(payloadOf(1).enabled).toBe(false);
  });

  it("模型同步失败或冷却未清时给出对应警告", async () => {
    mocks.updateAccount.mockResolvedValueOnce(account({ modelSyncFailed: true }));
    const { result } = renderHook(() => useAccountEditFlow(createContext()), { wrapper: createWrapper() });

    act(() => result.current.beginEdit(account()));
    await act(async () => submit(result.current));
    await waitFor(() =>
      expect(mocks.toast.warning).toHaveBeenCalledWith(i18n.t("accounts.updatedWithModelSyncFailure")),
    );

    mocks.updateAccount.mockResolvedValueOnce(account({ enabledDoesNotClearCooldown: true }));
    act(() => result.current.beginEdit(account()));
    await act(async () => submit(result.current));
    await waitFor(() =>
      expect(mocks.toast.warning).toHaveBeenCalledWith(i18n.t("accounts.enabledDoesNotClearCooldown")),
    );
  });

  it("校验失败时不提交，接口失败时提示用户并保持编辑态", async () => {
    const ctx = createContext();
    const { result } = renderHook(() => useAccountEditFlow(ctx), { wrapper: createWrapper() });

    act(() => result.current.beginEdit(account()));
    act(() => {
      result.current.form.setValue("name", "");
    });
    await act(async () => submit(result.current));
    // 名称必填：非法输入不得触达接口，也不会有成功提示。
    expect(mocks.updateAccount).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();

    act(() => result.current.beginEdit(account()));
    mocks.updateAccount.mockRejectedValue(new ApiError(502, "updateFailed", "更新失败"));
    await act(async () => submit(result.current));
    await waitFor(() => expect(firstArgOf(ctx.showError)[0]).toBeInstanceOf(ApiError));

    expect(result.current.editing?.id).toBe("acct-1");
    expect(result.current.form.getValues("name")).toBe("build-alpha");
  });
});
