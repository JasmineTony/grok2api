import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountsDialogHost } from "@/features/accounts/accounts-flow-dialogs";
import type { AccountDTO } from "@/features/accounts/accounts-api";
import type { AccountsPageModel } from "@/features/accounts/use-accounts-page-model";
import { useAccountsPageModel } from "@/features/accounts/use-accounts-page-model";
import { i18n } from "@/shared/i18n";

// 账号页弹窗宿主的映射契约（AGENTS.md TEST-1/TEST-3）：只替换网络边界，
// 用真实的 useAccountsPageModel 得到流程状态，再断言脚本弹窗在各目标下的用户可见结果。
// 模型由真实 hook 组成，避免手写巨型结构体掩盖"宿主只做映射"的契约。

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  getAccountSummary: vi.fn(),
  listAllEgressNodes: vi.fn(),
  listEgressNodes: vi.fn(),
  listEgressSources: vi.fn(),
  previewCleanup: vi.fn(),
  runWebAccountScripts: vi.fn(),
}));

vi.mock("@/features/accounts/accounts-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/accounts/accounts-api")>();
  return {
    ...actual,
    listAccounts: mocks.listAccounts,
    getAccountSummary: mocks.getAccountSummary,
    previewCleanup: mocks.previewCleanup,
    runWebAccountScripts: mocks.runWebAccountScripts,
  };
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

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

function account(overrides: Partial<AccountDTO> = {}): AccountDTO {
  return {
    id: "acct-web",
    provider: "grok_web",
    authType: "oauth",
    name: "web-alpha",
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

/** 渲染真实模型 + 宿主，并把模型实例交给回调，用于按真实 hook 注入流程状态。 */
function renderHost(onModel: (model: AccountsPageModel) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const user = userEvent.setup();

  function Harness() {
    const model = useAccountsPageModel();
    onModel(model);
    return (
      <TooltipProvider delayDuration={0}>
        <AccountsDialogHost model={model} />
      </TooltipProvider>
    );
  }

  const view = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { ...view, user };
}

/** 宿主自身只渲染弹窗，没有页面级元素可等待；这里等待真实 hook 的模型挂载。 */
async function mountModel(): Promise<AccountsPageModel> {
  let model: AccountsPageModel | undefined;
  renderHost((current) => {
    model = current;
  });
  await waitFor(() => expect(model).toBeDefined());
  if (!model) throw new Error("模型未挂载");
  return model;
}

/** 打开脚本弹窗：先挂载模型，再通过真实流程 hook 打开，最后等待弹窗出现。 */
async function openScriptsDialog(targets: string[] | "all"): Promise<AccountsPageModel> {
  const model = await mountModel();
  model.tasks.scripts.openDialog(targets);
  await screen.findByRole("alertdialog");
  return model;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("zh-CN");
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
  mocks.listAccounts.mockResolvedValue({ items: [account()], total: 1, page: 1, pageSize: 20 });
  mocks.getAccountSummary.mockResolvedValue({
    total: 1,
    enabled: 1,
    available: 1,
    cooldown: 0,
    risk: 0,
    providers: {
      grok_build: { total: 0, available: 0 },
      grok_web: { total: 1, available: 1 },
      grok_console: { total: 0, available: 0 },
    },
    recovery: { cooldown: 0, waitingReset: 0, probing: 0 },
    issues: { disabled: 0, reauthRequired: 0 },
  });
  mocks.listAllEgressNodes.mockResolvedValue({ items: [], total: 0 });
  mocks.listEgressNodes.mockResolvedValue({ items: [], page: 1, pageSize: 100, total: 0 });
  mocks.listEgressSources.mockResolvedValue({ items: [], page: 1, pageSize: 100, total: 0 });
});

describe("AccountsDialogHost 脚本弹窗映射", () => {
  it("未选择脚本目标时不渲染脚本弹窗", async () => {
    await mountModel();

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("脚本目标为全量时渲染全量标题与说明", async () => {
    await openScriptsDialog("all");

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(t("webAccountScripts.allTitle", { count: 0 }));
    expect(dialog).toHaveTextContent(t("webAccountScripts.allDescription"));
    expect(screen.getByRole("button", { name: t("webAccountScripts.run") })).toBeEnabled();
  });

  it("脚本目标为选中集合时标题带数量，取消后弹窗关闭", async () => {
    const model = await mountModel();
    const user = userEvent.setup();
    model.tasks.scripts.openDialog(["acct-web"]);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(t("webAccountScripts.selectedTitle", { count: 1 }));
    expect(dialog).toHaveTextContent(t("webAccountScripts.selectedDescription"));

    await user.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("脚本执行进行中展示完成度并禁用执行", async () => {
    let resolveRun: (() => void) | undefined;
    mocks.runWebAccountScripts.mockImplementation(
      (_input: unknown, onProgress: (value: { completed: number; total: number }) => void) => {
        onProgress({ completed: 3, total: 9 });
        return new Promise((resolve) => {
          resolveRun = () => resolve({ succeeded: 9, failed: 0 });
        });
      },
    );
    const model = await mountModel();
    const user = userEvent.setup();
    model.tasks.scripts.openDialog("all");
    await screen.findByRole("alertdialog");

    await user.click(screen.getByRole("button", { name: t("webAccountScripts.run") }));

    const run = await screen.findByRole("button", { name: /3 \/ 9/ });
    expect(run).toBeDisabled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("3 / 9");

    resolveRun?.();
    await waitFor(() =>
      expect(mocks.runWebAccountScripts).toHaveBeenCalledWith(
        { all: true, actions: { acceptTerms: true, setBirthDate: true, enableNSFW: true } },
        expect.any(Function),
        expect.any(AbortSignal),
      ),
    );
  });
});
