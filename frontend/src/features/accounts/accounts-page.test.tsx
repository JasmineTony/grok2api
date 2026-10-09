import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountsPage } from "@/features/accounts/accounts-page";
import type {
  AccountDTO,
  AccountSummaryDTO,
  BuildDetectHandlers,
  BuildDetectItemDTO,
  DetectBuildAccountsInput,
} from "@/features/accounts/accounts-api";
import type { AccountTaskProgressDTO } from "@/features/accounts/account-task-progress";
import { ApiError, type PaginatedDTO } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 账号列表关键路径的组件集成测试（AGENTS.md TEST-3）：
// 只替换网络边界（accounts-api 的请求函数），组件、hook、decoder 与状态流保持真实。
const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  getAccountSummary: vi.fn(),
  importAccounts: vi.fn(),
  detectBuildAccounts: vi.fn(),
  updateAccountsEnabled: vi.fn(),
  updateAccount: vi.fn(),
  previewAccountDeletion: vi.fn(),
  deleteAccount: vi.fn(),
  refreshAllAccountBilling: vi.fn(),
}));

vi.mock("@/features/accounts/accounts-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/accounts/accounts-api")>();
  return {
    ...actual,
    listAccounts: mocks.listAccounts,
    getAccountSummary: mocks.getAccountSummary,
    importAccounts: mocks.importAccounts,
    detectBuildAccounts: mocks.detectBuildAccounts,
    updateAccountsEnabled: mocks.updateAccountsEnabled,
    updateAccount: mocks.updateAccount,
    previewAccountDeletion: mocks.previewAccountDeletion,
    deleteAccount: mocks.deleteAccount,
    refreshAllAccountBilling: mocks.refreshAllAccountBilling,
  };
});

// jsdom 缺少 Radix 菜单/选择器与弹层依赖的指针捕获、滚动与尺寸观察 API，
// 仅在测试内补齐，不改变产品代码。
beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

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
      used: 120,
      limit: 1000,
      remaining: 880,
      usagePercent: 12,
      limitKnown: true,
      observed: true,
      confirmed: true,
    },
    ...overrides,
  };
}

function accountPage(items: AccountDTO[], total = items.length): PaginatedDTO<AccountDTO> {
  return { items, page: 1, pageSize: 20, total };
}

function summary(overrides: Partial<AccountSummaryDTO> = {}): AccountSummaryDTO {
  return {
    total: 1,
    available: 1,
    recovering: 0,
    attention: 0,
    risk: 0,
    providers: {
      grok_build: { total: 1, available: 1 },
      grok_web: { total: 0, available: 0 },
      grok_console: { total: 0, available: 0 },
    },
    recovery: { cooldown: 0, waitingReset: 0, probing: 0 },
    issues: { disabled: 0, reauthRequired: 0 },
    ...overrides,
  };
}

function renderAccountsPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={0}>
          <AccountsPage />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { ...view, client, user };
}

function accountRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`未找到账号行：${name}`);
  return row;
}

function importFileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]');
  if (!input) throw new Error("未找到账号导入文件输入框");
  return input;
}

async function openDetectDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: i18n.t("accountCredential.detectAction") }));
  await screen.findByText(i18n.t("accounts.detectAllTitle"));
}

describe("AccountsPage 列表加载", () => {
  it("加载成功时渲染账号行、类型与状态单元格", async () => {
    mocks.listAccounts.mockResolvedValue(accountPage([account()]));
    mocks.getAccountSummary.mockResolvedValue(summary());
    renderAccountsPage();

    expect(await screen.findByText("build-alpha")).toBeInTheDocument();
    const row = accountRow("build-alpha");
    expect(within(row).getByText(i18n.t("accountType.free"))).toBeInTheDocument();
    expect(within(row).getByText(i18n.t("accounts.statusActive"))).toBeInTheDocument();
    expect(mocks.listAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "grok_build", page: 1, pageSize: 20 }),
    );
  });

  it("空结果时展示空态", async () => {
    mocks.listAccounts.mockResolvedValue(accountPage([], 0));
    mocks.getAccountSummary.mockResolvedValue(
      summary({ total: 0, available: 0, providers: { grok_build: { total: 0, available: 0 } } as never }),
    );
    renderAccountsPage();

    expect(await screen.findByText(i18n.t("common.noData"))).toBeInTheDocument();
  });

  it("加载失败时展示用户可见错误与重试入口", async () => {
    mocks.listAccounts.mockRejectedValue(new ApiError(500, "accountsLoadFailed", "账号列表加载失败"));
    mocks.getAccountSummary.mockResolvedValue(summary());
    renderAccountsPage();

    expect(await screen.findByText("账号列表加载失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("common.retry") })).toBeInTheDocument();
  });
});

describe("AccountsPage 搜索与筛选", () => {
  it("搜索与切换 provider 会生成新的查询 key 与请求参数", async () => {
    mocks.listAccounts.mockResolvedValue(accountPage([account()]));
    mocks.getAccountSummary.mockResolvedValue(summary());
    const { client, user } = renderAccountsPage();
    await screen.findByText("build-alpha");

    await user.type(screen.getByLabelText(i18n.t("accounts.search")), "alpha");
    await waitFor(() =>
      expect(mocks.listAccounts).toHaveBeenLastCalledWith(expect.objectContaining({ search: "alpha", page: 1 })),
    );
    const searchKeys = client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(searchKeys.some((key) => Array.isArray(key) && key[0] === "accounts" && key.includes("alpha"))).toBe(true);

    await user.click(screen.getByRole("tab", { name: /grok web/i }));
    await waitFor(() =>
      expect(mocks.listAccounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ provider: "grok_web", search: "alpha", page: 1 }),
      ),
    );
    const providerKeys = client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(providerKeys.some((key) => Array.isArray(key) && key[0] === "accounts" && key.includes("grok_web"))).toBe(
      true,
    );
  });
});

describe("AccountsPage 额度与模型级封锁", () => {
  it("列表单元格同时展示额度受限标记与账号级状态", async () => {
    mocks.listAccounts.mockResolvedValue(
      accountPage([
        account({
          quota: {
            ...account().quota,
            modelQuotaBlocks: [{ model: "grok-4", reason: "model_quota_depleted" }],
          },
        }),
      ]),
    );
    mocks.getAccountSummary.mockResolvedValue(summary());
    renderAccountsPage();

    await screen.findByText("build-alpha");
    const row = accountRow("build-alpha");
    expect(within(row).getByTestId("account-status-model-quota-block-badge")).toHaveTextContent(
      i18n.t("accounts.statusActive"),
    );
    expect(within(row).getByTestId("account-quota-model-block-marker")).toHaveAccessibleName(
      i18n.t("accounts.modelQuotaBlockedTitle", { count: 1 }),
    );
  });
});

describe("AccountsPage 导入", () => {
  it("导入失败时提示服务端校验信息，且只发出一次请求", async () => {
    mocks.listAccounts.mockResolvedValue(accountPage([account()]));
    mocks.getAccountSummary.mockResolvedValue(summary());
    mocks.importAccounts.mockRejectedValue(new ApiError(400, "accountImportInvalid", "第 2 行凭据非法"));
    const { user } = renderAccountsPage();
    await screen.findByText("build-alpha");

    await user.upload(importFileInput(), new File(["{}"], "accounts.json", { type: "application/json" }));

    expect(await screen.findByText("第 2 行凭据非法")).toBeInTheDocument();
    expect(mocks.importAccounts).toHaveBeenCalledTimes(1);
  });

  it("快速导入超出大小上限的文件时给出校验提示且不发起导入", async () => {
    mocks.listAccounts.mockResolvedValue(accountPage([account()]));
    mocks.getAccountSummary.mockResolvedValue(summary());
    const { user } = renderAccountsPage();
    await screen.findByText("build-alpha");

    await user.click(screen.getByRole("button", { name: i18n.t("accounts.connectAccount") }));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("accounts.quickImportRT") }));
    const dialog = await screen.findByRole("dialog");
    const input = dialog.querySelector<HTMLInputElement>('input[type="file"][accept="text/plain,.txt"]');
    if (!input) throw new Error("未找到快速导入文件输入框");

    const oversized = new File(["token"], "tokens.txt", { type: "text/plain" });
    Object.defineProperty(oversized, "size", { value: 31 * 1024 * 1024 });
    await user.upload(input, oversized);

    expect(await screen.findByText(i18n.t("apiErrors.accountImportFileTooLarge"))).toBeInTheDocument();
    expect(mocks.importAccounts).not.toHaveBeenCalled();
  });
});

describe("AccountsPage 批量任务", () => {
  it("检测任务进行中展示进度与结果，关闭弹窗会中断请求", async () => {
    mocks.listAccounts.mockResolvedValue(accountPage([account()]));
    mocks.getAccountSummary.mockResolvedValue(summary());
    let handlers: BuildDetectHandlers | undefined;
    let signal: AbortSignal | undefined;
    mocks.detectBuildAccounts.mockImplementation(
      (_input: DetectBuildAccountsInput, nextHandlers: BuildDetectHandlers, nextSignal?: AbortSignal) => {
        handlers = nextHandlers;
        signal = nextSignal;
        return new Promise(() => {});
      },
    );
    const { user } = renderAccountsPage();
    await screen.findByText("build-alpha");

    await openDetectDialog(user);
    await user.click(screen.getByRole("button", { name: i18n.t("accounts.detectAll") }));
    await waitFor(() => expect(mocks.detectBuildAccounts).toHaveBeenCalledTimes(1));
    expect(mocks.detectBuildAccounts.mock.calls[0][0]).toEqual({ all: true });

    act(() => handlers?.onProgress?.({ completed: 2, total: 5 } as AccountTaskProgressDTO));
    expect((await screen.findAllByText("2 / 5")).length).toBeGreaterThan(0);

    const item: BuildDetectItemDTO = {
      id: "acct-2",
      name: "build-beta",
      outcome: "invalid",
      reason: "refresh token 已失效",
    };
    act(() => handlers?.onItem?.(item));
    expect(await screen.findByText("refresh token 已失效")).toBeInTheDocument();
    expect(screen.getByText(i18n.t("accounts.detectOutcome.invalid"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: i18n.t("common.cancel") }));
    expect(signal?.aborted).toBe(true);
  });

  it("检测任务失败时提示用户可见错误", async () => {
    mocks.listAccounts.mockResolvedValue(accountPage([account()]));
    mocks.getAccountSummary.mockResolvedValue(summary());
    mocks.detectBuildAccounts.mockRejectedValue(new ApiError(502, "accountDetectFailed", "检测任务执行失败"));
    const { user } = renderAccountsPage();
    await screen.findByText("build-alpha");

    await openDetectDialog(user);
    await user.click(screen.getByRole("button", { name: i18n.t("accounts.detectAll") }));

    expect(await screen.findByText("检测任务执行失败")).toBeInTheDocument();
  });
});

describe("AccountsPage 重复提交", () => {
  it("检测任务进行中重复点击执行不会重复发起请求", async () => {
    mocks.listAccounts.mockResolvedValue(accountPage([account()]));
    mocks.getAccountSummary.mockResolvedValue(summary());
    mocks.detectBuildAccounts.mockImplementation(() => new Promise(() => {}));
    const { user } = renderAccountsPage();
    await screen.findByText("build-alpha");

    await openDetectDialog(user);
    const execute = screen.getByRole("button", { name: i18n.t("accounts.detectAll") });
    await user.click(execute);
    await user.click(execute);

    expect(mocks.detectBuildAccounts).toHaveBeenCalledTimes(1);
  });

  it("选中账号后重复点击批量启用只发出一次请求", async () => {
    mocks.listAccounts.mockResolvedValue(accountPage([account()]));
    mocks.getAccountSummary.mockResolvedValue(summary());
    mocks.updateAccountsEnabled.mockImplementation(() => new Promise(() => {}));
    const { user } = renderAccountsPage();
    await screen.findByText("build-alpha");

    await user.click(screen.getByRole("checkbox", { name: i18n.t("common.selectItem", { name: "build-alpha" }) }));
    const enable = await screen.findByRole("button", { name: i18n.t("common.enable") });
    await user.click(enable);
    await user.click(enable);

    expect(mocks.updateAccountsEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.updateAccountsEnabled).toHaveBeenCalledWith(["acct-1"], true, "grok_build");
  });
});

describe("AccountsPage 编辑与删除确认", () => {
  it("编辑弹窗校验必填项并提交更新请求", async () => {
    mocks.listAccounts.mockResolvedValue(accountPage([account()]));
    mocks.getAccountSummary.mockResolvedValue(summary());
    mocks.updateAccount.mockResolvedValue(account());
    const { user } = renderAccountsPage();
    await screen.findByText("build-alpha");

    await user.click(screen.getByRole("button", { name: i18n.t("common.actions") }));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("common.edit") }));
    const dialog = await screen.findByRole("dialog");

    const nameInput = within(dialog).getByLabelText(i18n.t("accounts.name"));
    await user.clear(nameInput);
    await user.click(within(dialog).getByRole("button", { name: i18n.t("common.save") }));
    expect(await within(dialog).findByText(i18n.t("errors.required"))).toBeInTheDocument();
    expect(mocks.updateAccount).not.toHaveBeenCalled();

    await user.type(nameInput, "build-alpha-2");
    await user.click(within(dialog).getByRole("button", { name: i18n.t("common.save") }));
    await waitFor(() => expect(mocks.updateAccount).toHaveBeenCalledTimes(1));
    expect(mocks.updateAccount).toHaveBeenCalledWith(
      "acct-1",
      expect.objectContaining({ name: "build-alpha-2", buildRouteMode: "auto" }),
    );
  });

  it("删除确认弹窗展示关联删除计数并按快照提交级联删除", async () => {
    mocks.listAccounts.mockResolvedValue(accountPage([account()]));
    mocks.getAccountSummary.mockResolvedValue(summary());
    mocks.previewAccountDeletion.mockResolvedValue({ rootCount: 1, linkedByProvider: { grok_web: 2 }, total: 3 });
    mocks.deleteAccount.mockResolvedValue({ deleted: 1 });
    const { user } = renderAccountsPage();
    await screen.findByText("build-alpha");

    await user.click(screen.getByRole("button", { name: i18n.t("common.actions") }));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("common.delete") }));
    const dialog = await screen.findByRole("alertdialog");

    await user.click(within(dialog).getByRole("checkbox", { name: /Grok Web/ }));
    const confirm = within(dialog).getByRole("button", { name: i18n.t("accounts.deleteConfirm") });
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(mocks.previewAccountDeletion).toHaveBeenCalledWith(["acct-1"], "grok_build", ["grok_web"]);

    await user.click(confirm);
    await waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalledTimes(1));
    expect(mocks.deleteAccount).toHaveBeenCalledWith("acct-1", {
      provider: "grok_build",
      linkedDeleteTargets: ["grok_web"],
    });
  });
});
