import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WebAccountSettingsDialogs, WebAccountSettingsMenu } from "@/features/accounts/web-account-settings";
import { AccountsPage } from "@/features/accounts/accounts-page";
import type { AccountDTO, AccountSummaryDTO } from "@/features/accounts/accounts-api";
import { ApiError, type PaginatedDTO } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 账号页任务流集成测试（AGENTS.md TEST-3）：只替换网络边界，hook、状态流与弹窗保持真实。
const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  getAccountSummary: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  deleteAccounts: vi.fn(),
  previewAccountDeletion: vi.fn(),
  cleanupAccounts: vi.fn(),
  previewCleanup: vi.fn(),
  refreshAllAccountBilling: vi.fn(),
  refreshAllWebAccountQuotas: vi.fn(),
  refreshAllConsoleAccountQuotas: vi.fn(),
  refreshAllAccountTokens: vi.fn(),
  resetAllAccountQuota: vi.fn(),
  refreshAccountsQuota: vi.fn(),
  resetAccountsQuota: vi.fn(),
  refreshAccountsTokens: vi.fn(),
  updateAccountsEnabled: vi.fn(),
  updateAccountsMaxConcurrent: vi.fn(),
  convertWebAccountsToBuild: vi.fn(),
  syncWebAccountsToConsole: vi.fn(),
  runWebAccountScripts: vi.fn(),
  importAccounts: vi.fn(),
  importWebAccounts: vi.fn(),
  importConsoleAccounts: vi.fn(),
  exportSelectedAccounts: vi.fn(),
  exportAccountBatch: vi.fn(),
  detectBuildAccounts: vi.fn(),
  startDeviceAuthorization: vi.fn(),
  pollDeviceAuthorization: vi.fn(),
  refreshAccountBilling: vi.fn(),
  refreshAccountToken: vi.fn(),
  refreshAccountQuota: vi.fn(),
  clearAccountCooldown: vi.fn(),
  acceptWebAccountTerms: vi.fn(),
  setWebAccountBirthDate: vi.fn(),
  enableWebAccountNSFW: vi.fn(),
  listAllEgressNodes: vi.fn(),
  assignEgressAccounts: vi.fn(),
  unassignEgressAccounts: vi.fn(),
  listEgressNodes: vi.fn(),
  listEgressSources: vi.fn(),
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
    assignEgressAccounts: mocks.assignEgressAccounts,
    unassignEgressAccounts: mocks.unassignEgressAccounts,
    listEgressNodes: mocks.listEgressNodes,
    listEgressSources: mocks.listEgressSources,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  mocks.listAccounts.mockImplementation(
    async (input: { provider: AccountDTO["provider"]; page: number; pageSize: number }) =>
      accountPage(
        [account({ id: `acct-${input.provider}`, provider: input.provider, name: `${input.provider}-alpha` })],
        25,
      ),
  );
  mocks.getAccountSummary.mockImplementation(async () =>
    summary({
      providers: {
        grok_build: { total: 1, available: 1 },
        grok_web: { total: 1, available: 1 },
        grok_console: { total: 1, available: 1 },
      },
    }),
  );
  mocks.previewAccountDeletion.mockResolvedValue({ rootCount: 1, linkedByProvider: { grok_web: 2 }, total: 3 });
  mocks.previewCleanup.mockResolvedValue({ rootsByStatus: {}, rootCount: 0, linkedByProvider: {}, total: 0 });
  mocks.listAllEgressNodes.mockResolvedValue({
    items: [{ id: "node-1", name: "node-1", enabled: true, proxyConfigured: true, scope: "grok_build" }],
    total: 1,
  });
  mocks.listEgressNodes.mockImplementation(async (input: { page: number }) => egressPage(input.page));
  mocks.listEgressSources.mockImplementation(async (input: { page: number }) => egressPage(input.page));
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
    cooldownUntil: "2999-01-02T03:04:05Z",
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

function egressPage(page: number): {
  items: Array<{ id: string; name: string; scope: string }>;
  page: number;
  pageSize: number;
  total: number;
} {
  return {
    items: [{ id: `egress-${page}`, name: `egress-${page}`, scope: "grok_build" }],
    page,
    pageSize: 100,
    total: 200,
  };
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

function button(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`未找到账号行：${name}`);
  await user.click(within(row).getByRole("button", { name: i18n.t("common.actions") }));
}

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

describe("AccountsPage 账号池与任务流", () => {
  it("切换到 Console 池时按 provider 重新加载并渲染 Console 类型", async () => {
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");

    await user.click(screen.getByRole("tab", { name: /grok console/i }));

    expect(await screen.findByText("grok_console-alpha")).toBeInTheDocument();
    expect(mocks.listAccounts).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: "grok_console", page: 1, type: "", status: "" }),
    );
    expect(screen.getByText(t("accountType.console"))).toBeInTheDocument();
  });

  it("Build 池的全量额度同步支持 sync 与 reset 两种任务", async () => {
    mocks.refreshAllAccountBilling.mockResolvedValue({ succeeded: 1, failed: 0 });
    mocks.resetAllAccountQuota.mockResolvedValue({ reset: 2 });
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");

    await user.click(button(t("accountCredential.quotaSyncAction")));
    let dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: t("accountQuotaTask.execute") }));
    await waitFor(() => expect(mocks.refreshAllAccountBilling).toHaveBeenCalledTimes(1));

    await user.click(button(t("accountCredential.quotaSyncAction")));
    dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("tab", { name: t("accountQuotaReset.action") }));
    await user.click(within(dialog).getByRole("button", { name: t("accountQuotaTask.execute") }));
    await waitFor(() => expect(mocks.resetAllAccountQuota).toHaveBeenCalledTimes(1));
  });

  it("全量刷新凭据失败时提示用户可见错误", async () => {
    mocks.refreshAllAccountTokens.mockRejectedValue(new ApiError(502, "refreshFailed", "刷新凭据失败"));
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");

    await user.click(button(t("accountCredential.refreshAction")));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: t("accounts.renewAll") }));

    expect(await screen.findByText("刷新凭据失败")).toBeInTheDocument();
  });

  it("按选中集合导出账号文件", async () => {
    mocks.exportSelectedAccounts.mockResolvedValue(new Blob(["{}"]));
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");

    await user.click(screen.getByRole("checkbox", { name: t("common.selectItem", { name: "grok_build-alpha" }) }));
    await user.click(screen.getByRole("button", { name: t("accounts.exportAuth") }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: t("accounts.exportAuth") }));

    await waitFor(() => expect(mocks.exportSelectedAccounts).toHaveBeenCalledWith("grok_build", ["acct-grok_build"]));
  });

  it("分批导出按游标推进并可继续下一批", async () => {
    mocks.exportAccountBatch.mockResolvedValue({
      blob: new Blob(["{}"]),
      count: 2,
      nextId: "12",
      snapshotMaxId: "20",
      hasMore: true,
    });
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");

    await user.click(screen.getByRole("button", { name: t("accounts.connectAccount") }));
    await user.click(await screen.findByRole("menuitem", { name: t("accounts.exportAuth") }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: t("accounts.exportAuth") }));
    await waitFor(() => expect(mocks.exportAccountBatch).toHaveBeenCalledWith("grok_build", 1000, "0", "0"));

    await user.click(within(dialog).getByRole("button", { name: t("accountExport.nextBatch") }));
    await waitFor(() => expect(mocks.exportAccountBatch).toHaveBeenLastCalledWith("grok_build", 1000, "12", "20"));
  });
});

describe("AccountsPage Web 池与批量操作", () => {
  it("Web 池批量转 Build 与同步 Console 走各自接口", async () => {
    mocks.convertWebAccountsToBuild.mockResolvedValue({
      created: 1,
      linked: 0,
      skipped: 0,
      failed: 0,
      synced: 1,
      syncFailed: 0,
    });
    mocks.syncWebAccountsToConsole.mockResolvedValue({
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      synced: 1,
      syncFailed: 0,
    });
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");
    await user.click(screen.getByRole("tab", { name: /grok web/i }));
    await screen.findByText("grok_web-alpha");

    await user.click(button(t("accountConversion.action")));
    let dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: t("accountConversion.start") }));
    await waitFor(() =>
      expect(mocks.convertWebAccountsToBuild).toHaveBeenCalledWith(
        { all: true, strategy: "missing" },
        expect.anything(),
        expect.anything(),
      ),
    );

    await user.click(button(t("accountConversion.action")));
    dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("tab", { name: "Grok Console" }));
    await user.click(within(dialog).getByRole("button", { name: t("accountConversion.start") }));
    await waitFor(() =>
      expect(mocks.syncWebAccountsToConsole).toHaveBeenCalledWith(
        { all: true, strategy: "missing" },
        expect.anything(),
        expect.anything(),
      ),
    );
  });

  it("Web 行菜单可直接转单账号并带上选中集合", async () => {
    mocks.runWebAccountScripts.mockResolvedValue({ succeeded: 1, failed: 0 });
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");
    await user.click(screen.getByRole("tab", { name: /grok web/i }));
    await screen.findByText("grok_web-alpha");

    await openRowMenu(user, "grok_web-alpha");
    await user.click(await screen.findByRole("menuitem", { name: t("accountConversion.action") }));
    const target = await screen.findByRole("alertdialog");
    await user.click(within(target).getByRole("button", { name: t("accountConversion.start") }));
    await waitFor(() =>
      expect(mocks.convertWebAccountsToBuild).toHaveBeenCalledWith(
        { ids: ["acct-grok_web"], strategy: "missing" },
        expect.anything(),
        expect.anything(),
      ),
    );
  });
});

describe("Web 账号设置协议动作", () => {
  it("行菜单协议动作与确认弹窗各自触发回调", async () => {
    const onConfirm = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <DropdownMenu open>
          <DropdownMenuTrigger>menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <WebAccountSettingsMenu
              account={account({ provider: "grok_web", id: "acct-web" })}
              disabled={false}
              onConfirm={onConfirm}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </I18nextProvider>,
    );

    const trigger = await screen.findByRole("menuitem", { name: t("webAccountSettings.menu") });
    const events = userEvent.setup();
    trigger.focus();
    await events.keyboard("{ArrowRight}");
    await events.click(await screen.findByRole("menuitem", { name: t("webAccountSettings.setBirthDate") }));
    expect(onConfirm).toHaveBeenCalledWith({
      account: expect.objectContaining({ id: "acct-web" }),
      action: "setBirthDate",
    });
  });

  it("确认弹窗按动作渲染并在点击后回调", async () => {
    const onConfirm = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <WebAccountSettingsDialogs
          confirmationTarget={{ account: account({ provider: "grok_web", id: "acct-web" }), action: "enableNSFW" }}
          confirmationPending={false}
          onConfirmationClose={vi.fn()}
          onConfirm={onConfirm}
        />
      </I18nextProvider>,
    );

    const events = userEvent.setup();
    const dialog = await screen.findByRole("alertdialog");
    await events.click(within(dialog).getByRole("button", { name: t("webAccountSettings.enableNSFW") }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ action: "enableNSFW" }));
  });
});

describe("AccountsPage 批量与清理", () => {
  it("批量设置并发上限按选中集合提交", async () => {
    mocks.updateAccountsMaxConcurrent.mockResolvedValue({ updated: 1 });
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");

    await user.click(screen.getByRole("checkbox", { name: t("common.selectItem", { name: "grok_build-alpha" }) }));
    await user.click(button(t("accounts.batchSetConcurrency")));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText(t("accounts.maxConcurrent"));
    await user.clear(input);
    await user.type(input, "4");
    await user.click(within(dialog).getByRole("button", { name: t("common.save") }));
    await waitFor(() =>
      expect(mocks.updateAccountsMaxConcurrent).toHaveBeenCalledWith(["acct-grok_build"], 4, "grok_build"),
    );
  });

  it("批量重置额度按选中集合提交", async () => {
    mocks.resetAccountsQuota.mockResolvedValue({ reset: 1 });
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");

    await user.click(screen.getByRole("checkbox", { name: t("common.selectItem", { name: "grok_build-alpha" }) }));
    await user.click(button(t("accountCredential.quotaSyncAction")));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("tab", { name: t("accountQuotaReset.action") }));
    await user.click(within(dialog).getByRole("button", { name: t("accountQuotaTask.execute") }));
    await waitFor(() => expect(mocks.resetAccountsQuota).toHaveBeenCalledWith(["acct-grok_build"], "grok_build"));
  });

  it("批量删除按选中集合提交并提示跳过数量", async () => {
    mocks.deleteAccounts.mockResolvedValue({ deleted: 1, skipped: 2 });
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");

    await user.click(screen.getByRole("checkbox", { name: t("common.selectItem", { name: "grok_build-alpha" }) }));
    await user.click(button(t("common.delete")));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("checkbox", { name: /Grok Web/ }));
    const confirm = within(dialog).getByRole("button", { name: t("accounts.deleteConfirm") });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    await waitFor(() =>
      expect(mocks.deleteAccounts).toHaveBeenCalledWith(["acct-grok_build"], "grok_build", ["grok_web"]),
    );
    expect(await screen.findByText(t("accounts.deletedWithSkipped", { deleted: 1, skipped: 2 }))).toBeInTheDocument();
  });

  it("清理弹窗按状态与关联目标预览后提交", async () => {
    mocks.cleanupAccounts.mockResolvedValue({ deleted: 2, linkedDeleted: 1, skipped: 0 });
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");

    await user.click(button(t("accounts.cleanupAction")));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: t("accounts.statusCooldown") }));
    await waitFor(() => expect(mocks.previewCleanup).toHaveBeenCalledWith("grok_build", ["cooldown"], []));
    await user.click(within(dialog).getByRole("checkbox", { name: /Grok Web/ }));
    const cleanupConfirm = within(dialog).getByRole("button", { name: t("accounts.cleanupStart") });
    await waitFor(() => expect(cleanupConfirm).toBeEnabled());
    await user.click(cleanupConfirm);
    await waitFor(() => expect(mocks.cleanupAccounts).toHaveBeenCalledWith("grok_build", ["cooldown"], ["grok_web"]));
  });

  it("出口配置未选节点时报错，解绑走独立接口", async () => {
    mocks.unassignEgressAccounts.mockResolvedValue({ updated: 1 });
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");
    await user.click(screen.getByRole("checkbox", { name: t("common.selectItem", { name: "grok_build-alpha" }) }));

    await user.click(button(t("accounts.egressConfiguration")));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: t("accountQuotaTask.execute") }));
    expect(await screen.findByText(t("accounts.bindEgressEmpty"))).toBeInTheDocument();

    await user.click(within(dialog).getByRole("tab", { name: t("accounts.unbindEgress") }));
    await user.click(within(dialog).getByRole("button", { name: t("accountQuotaTask.execute") }));
    await waitFor(() => expect(mocks.unassignEgressAccounts).toHaveBeenCalledWith("grok_build", ["acct-grok_build"]));
  });

  it("单账号删除在预览失败时阻断确认", async () => {
    mocks.previewAccountDeletion.mockRejectedValue(new ApiError(502, "previewFailed", "预览失败"));
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");

    await openRowMenu(user, "grok_build-alpha");
    await user.click(await screen.findByRole("menuitem", { name: t("common.delete") }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("checkbox", { name: /Grok Web/ }));

    expect(await screen.findByText(t("accounts.linkedDeletePreviewFailed"))).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("accounts.deleteConfirm") })).toBeDisabled();
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });
});

describe("AccountsPage 单行凭据操作与设备登录", () => {
  it("行菜单可刷新凭据、刷新计费并清除冷却", async () => {
    mocks.refreshAccountToken.mockResolvedValue(account());
    mocks.refreshAccountBilling.mockResolvedValue({});
    mocks.clearAccountCooldown.mockResolvedValue(account());
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");

    await openRowMenu(user, "grok_build-alpha");
    await user.click(await screen.findByRole("menuitem", { name: t("accounts.refreshToken") }));
    await waitFor(() => expect(mocks.refreshAccountToken).toHaveBeenCalledWith("acct-grok_build", expect.anything()));

    await openRowMenu(user, "grok_build-alpha");
    await user.click(await screen.findByRole("menuitem", { name: t("accounts.refreshBilling") }));
    await waitFor(() => expect(mocks.refreshAccountBilling).toHaveBeenCalledWith("acct-grok_build", expect.anything()));

    await openRowMenu(user, "grok_build-alpha");
    await user.click(await screen.findByRole("menuitem", { name: t("accounts.clearCooldown") }));
    await waitFor(() => expect(mocks.clearAccountCooldown).toHaveBeenCalledWith("acct-grok_build", expect.anything()));
  });

  it("设备登录轮询成功后提示创建结果", async () => {
    mocks.startDeviceAuthorization.mockResolvedValue({
      sessionId: "session-1",
      userCode: "AAAA-BBBB",
      verificationUri: "https://example.com/device",
      intervalSeconds: 1,
      expiresAt: "2999-01-01T00:00:00Z",
    });
    mocks.pollDeviceAuthorization.mockResolvedValue({ status: "succeeded", synced: 1 });
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");

    await user.click(screen.getByRole("button", { name: t("accounts.connectAccount") }));
    await user.click(await screen.findByRole("menuitem", { name: t("accounts.deviceLogin") }));

    expect(await screen.findByText(t("accounts.created"), {}, { timeout: 4000 })).toBeInTheDocument();
    expect(mocks.pollDeviceAuthorization).toHaveBeenCalledWith("session-1", expect.anything());
  });

  it("设备授权启动失败时提示错误并允许重试", async () => {
    mocks.startDeviceAuthorization.mockRejectedValue(new ApiError(502, "deviceFailed", "设备授权失败"));
    const { user } = renderAccountsPage();
    await screen.findByText("grok_build-alpha");

    await user.click(screen.getByRole("button", { name: t("accounts.connectAccount") }));
    await user.click(await screen.findByRole("menuitem", { name: t("accounts.deviceLogin") }));

    expect(await screen.findByText("设备授权失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("common.retry") })).toBeInTheDocument();
  });
});
