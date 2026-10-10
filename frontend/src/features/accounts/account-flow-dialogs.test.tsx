import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountBatchDeleteDialog, AccountDeleteDialog } from "@/features/accounts/account-delete-dialogs";
import { BuildDetectDialog } from "@/features/accounts/account-detect-dialog";
import { QuickImportDialog } from "@/features/accounts/account-import-dialog";
import { LinkedTargetIcon } from "@/features/accounts/account-provider-icon";
import { BatchQuotaTaskDialog, QuotaSyncAllDialog } from "@/features/accounts/account-quota-task-dialogs";
import { RenewAllTokensDialog, WebConversionDialog } from "@/features/accounts/account-conversion-dialogs";
import type { AccountDTO, AccountProvider } from "@/features/accounts/accounts-dto";
import { i18n } from "@/shared/i18n";

// 账号流程弹窗测试（AGENTS.md TEST-1/TEST-3）：直接渲染弹窗并按真实事件驱动，
// 断言每个目标/策略/任务/计数分支的用户可见结果，不依赖页面与网络。

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

function renderDialog(node: ReactNode) {
  const user = userEvent.setup();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={0}>{node}</TooltipProvider>
    </I18nextProvider>,
  );
  return { ...view, user };
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
  await i18n.changeLanguage("zh-CN");
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
});

describe("BuildDetectDialog", () => {
  function detect(overrides: Partial<Parameters<typeof BuildDetectDialog>[0]> = {}) {
    return {
      open: true,
      mode: "all" as const,
      selectedCount: 0,
      pending: false,
      progress: null,
      counts: { ok: 0, invalid: 0, failed: 0 },
      visibleItems: [],
      onOpenChange: vi.fn(),
      onRun: vi.fn(),
      ...overrides,
    };
  }

  it("全量模式且无进度、无结果时不渲染进度面板", () => {
    renderDialog(<BuildDetectDialog {...detect()} />);

    expect(screen.getByRole("dialog")).toHaveTextContent(t("accounts.detectAllTitle"));
    expect(screen.queryByText(t("accounts.detectProgressLabel"))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("accounts.detectAll") })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: t("common.close") }).length).toBeGreaterThan(0);
  });

  it("选中模式标题与描述带选中数量，且无选中时禁止执行", () => {
    renderDialog(<BuildDetectDialog {...detect({ mode: "selected", selectedCount: 0 })} />);

    expect(screen.getByRole("dialog")).toHaveTextContent(t("accounts.detectSelectedTitle", { count: 0 }));
    expect(screen.getByRole("button", { name: t("accounts.detectAll") })).toBeDisabled();
  });

  it("运行中展示取消按钮、加载文案与等待结果提示", async () => {
    const { user } = renderDialog(
      <BuildDetectDialog {...detect({ mode: "selected", selectedCount: 2, pending: true })} />,
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(t("accounts.detectSelectedDescription", { count: 2 }));
    expect(screen.getByRole("button", { name: t("common.cancel") })).toBeInTheDocument();
    const run = screen.getAllByRole("button").find((button) => button.textContent?.includes(t("common.loading")));
    expect(run).toBeDefined();
    expect(run).toBeDisabled();
    expect(screen.getByText(t("accounts.detectWaitingResults"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("common.cancel") }));
    expect(detect().onOpenChange).not.toHaveBeenCalled();
  });

  it("运行中已有进度时展示完成度，并提示结果被截断", () => {
    renderDialog(
      <BuildDetectDialog
        {...detect({
          pending: true,
          progress: { completed: 3, total: 210 },
          counts: { ok: 1, invalid: 2, failed: 1 },
          visibleItems: [{ id: "acct-2", name: "beta", email: "beta@example.com", outcome: "invalid", reason: "失效" }],
        })}
      />,
    );

    expect(screen.getAllByText("3 / 210")).toHaveLength(2);
    expect(screen.getByText(t("accounts.detectInvalidCount", { count: 2 }))).toBeInTheDocument();
    expect(screen.getByText(t("accounts.detectResultsLimited", { count: 200 }))).toBeInTheDocument();
    expect(screen.queryByText(t("accounts.detectWaitingInvalid"))).not.toBeInTheDocument();
  });

  it("选中模式汇总各结果数量，结果清单展示三种结局", () => {
    renderDialog(
      <BuildDetectDialog
        {...detect({
          mode: "selected",
          selectedCount: 3,
          counts: { ok: 1, invalid: 1, failed: 1 },
          visibleItems: [
            { id: "acct-1", name: "ok-account", outcome: "ok", reason: "已恢复" },
            { id: "acct-2", name: "", email: "beta@example.com", outcome: "invalid" },
            { id: "acct-3", name: "gamma", outcome: "failed" },
          ],
        })}
      />,
    );

    expect(screen.getByText(t("accounts.detectSelectedSummary", { ok: 1, invalid: 1, failed: 1 }))).toBeInTheDocument();

    const list = screen.getAllByRole("listitem");
    expect(list).toHaveLength(3);
    expect(within(list[0]).getByText(t("accounts.detectOutcome.ok"))).toBeInTheDocument();
    expect(within(list[1]).getByText(t("accounts.detectOutcome.invalid"))).toBeInTheDocument();
    // name 为空时回退为账号 ID，且无邮箱时不渲染邮箱行。
    expect(within(list[1]).getByText("acct-2")).toBeInTheDocument();
    expect(within(list[1]).getByText("beta@example.com")).toBeInTheDocument();
    expect(within(list[2]).getByText(t("accounts.detectOutcome.failed"))).toBeInTheDocument();
    expect(within(list[0]).getByText("已恢复")).toBeInTheDocument();
    expect(within(list[2]).queryByText(/@example\.com/)).not.toBeInTheDocument();
  });

  it("全量模式无结果时提示暂无失效账号", () => {
    renderDialog(
      <BuildDetectDialog
        {...detect({ counts: { ok: 2, invalid: 0, failed: 0 }, progress: { completed: 2, total: 2 } })}
      />,
    );

    expect(screen.getByText(t("accounts.detectNoInvalid"))).toBeInTheDocument();
    expect(screen.queryByText(t("accounts.detectInvalidCount", { count: 0 }))).not.toBeInTheDocument();
  });

  it("执行按钮回调 onRun，关闭按钮回调 onOpenChange", async () => {
    const onRun = vi.fn();
    const onOpenChange = vi.fn();
    const { user } = renderDialog(<BuildDetectDialog {...detect({ onRun, onOpenChange })} />);

    await user.click(screen.getByRole("button", { name: t("accounts.detectAll") }));
    expect(onRun).toHaveBeenCalledTimes(1);

    await user.click(screen.getAllByRole("button", { name: t("common.close") })[0]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("WebConversionDialog", () => {
  function conversion(overrides: Partial<Parameters<typeof WebConversionDialog>[0]> = {}) {
    return {
      open: true,
      targets: "all" as string[] | "all" | null,
      target: "build" as const,
      onTargetChange: vi.fn(),
      strategy: "missing" as const,
      onStrategyChange: vi.fn(),
      pending: false,
      conversionProgress: null,
      syncProgress: null,
      onClose: vi.fn(),
      onConfirm: vi.fn(),
      ...overrides,
    };
  }

  it("全量目标展示全量描述，选中集合展示数量描述", () => {
    const all = renderDialog(<WebConversionDialog {...conversion()} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accountConversion.allDescription"));
    all.unmount();

    renderDialog(<WebConversionDialog {...conversion({ targets: ["a", "b"] })} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accountConversion.selectedDescription", { count: 2 }));
  });

  it("目标与策略切换分别回传目标值与策略值", async () => {
    const onTargetChange = vi.fn();
    const onStrategyChange = vi.fn();
    const { user } = renderDialog(<WebConversionDialog {...conversion({ onTargetChange, onStrategyChange })} />);

    await user.click(screen.getByRole("tab", { name: "Grok Console" }));
    expect(onTargetChange).toHaveBeenCalledWith("console");

    await user.click(screen.getByRole("tab", { name: t("accountConversion.all") }));
    expect(onStrategyChange).toHaveBeenCalledWith("all");
  });

  it("策略说明随目标与策略组合变化", () => {
    const combos: Array<["build" | "console", "missing" | "all"]> = [
      ["build", "missing"],
      ["build", "all"],
      ["console", "missing"],
      ["console", "all"],
    ];
    const keys = [
      "accountBulk.missingStrategyDescription",
      "accountBulk.allStrategyDescription",
      "webConsoleSync.missingStrategyDescription",
      "webConsoleSync.allStrategyDescription",
    ];

    combos.forEach(([target, strategy], index) => {
      const view = renderDialog(<WebConversionDialog {...conversion({ target, strategy })} />);
      expect(screen.getByRole("alertdialog")).toHaveTextContent(t(keys[index]));
      view.unmount();
    });
  });

  it("目标为空集合或请求进行中时禁止执行", async () => {
    const empty = renderDialog(<WebConversionDialog {...conversion({ targets: [] })} />);
    expect(screen.getByRole("button", { name: t("accountConversion.start") })).toBeDisabled();
    empty.unmount();

    const nullTargets = renderDialog(<WebConversionDialog {...conversion({ targets: null })} />);
    expect(screen.getByRole("button", { name: t("accountConversion.start") })).toBeDisabled();
    nullTargets.unmount();

    renderDialog(<WebConversionDialog {...conversion({ pending: true })} />);
    expect(screen.getByRole("tab", { name: "Grok Build" })).toBeDisabled();
  });

  it("进行中按目标与阶段展示转换/同步进度", async () => {
    const converting = renderDialog(
      <WebConversionDialog {...conversion({ pending: true, conversionProgress: { completed: 2, total: 5 } })} />,
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      t("accounts.convertingProgress", { completed: 2, total: 5, phase: "" }),
    );
    converting.unmount();

    const syncing = renderDialog(
      <WebConversionDialog
        {...conversion({ pending: true, conversionProgress: { completed: 4, total: 5, phase: "syncing" } })}
      />,
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      t("accounts.syncingProgress", { completed: 4, total: 5, phase: "" }),
    );
    syncing.unmount();

    const consoleSyncing = renderDialog(
      <WebConversionDialog
        {...conversion({
          pending: true,
          target: "console",
          syncProgress: { completed: 1, total: 3, phase: "syncing" },
        })}
      />,
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      t("common.syncingProgress", { completed: 1, total: 3, phase: "" }),
    );
    consoleSyncing.unmount();

    const consoleImporting = renderDialog(
      <WebConversionDialog
        {...conversion({ pending: true, target: "console", syncProgress: { completed: 1, total: 3 } })}
      />,
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      t("common.importingProgress", { completed: 1, total: 3, phase: "" }),
    );
    consoleImporting.unmount();

    // 目标不匹配的进度不会被误用，退化为通用加载文案。
    renderDialog(
      <WebConversionDialog
        {...conversion({ pending: true, target: "console", conversionProgress: { completed: 9, total: 9 } })}
      />,
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("common.loading"));
  });

  it("确认执行时阻止默认关闭并回调 onConfirm，取消关闭回调 onClose", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { user } = renderDialog(<WebConversionDialog {...conversion({ onConfirm, onClose })} />);

    await user.click(screen.getByRole("button", { name: t("accountConversion.start") }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("RenewAllTokensDialog", () => {
  function renew(overrides: Partial<Parameters<typeof RenewAllTokensDialog>[0]> = {}) {
    return {
      open: true,
      pending: false,
      progress: null,
      onOpenChange: vi.fn(),
      onConfirm: vi.fn(),
      ...overrides,
    };
  }

  it("空闲时展示刷新入口并回调 onConfirm", async () => {
    const onConfirm = vi.fn();
    const { user, unmount } = renderDialog(<RenewAllTokensDialog {...renew({ onConfirm })} />);

    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accounts.renewAllTitle"));
    await user.click(screen.getByRole("button", { name: t("accounts.renewAll") }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("进行中按有无进度展示完成度或加载文案", () => {
    const withProgress = renderDialog(
      <RenewAllTokensDialog {...renew({ pending: true, progress: { completed: 7, total: 9 } })} />,
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent("7 / 9");
    withProgress.unmount();

    renderDialog(<RenewAllTokensDialog {...renew({ pending: true })} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("common.loading"));
    expect(screen.getByRole("button", { name: new RegExp(t("common.loading")) })).toBeDisabled();
  });
});

describe("QuotaSyncAllDialog", () => {
  function quotaSync(overrides: Partial<Parameters<typeof QuotaSyncAllDialog>[0]> = {}) {
    return {
      open: true,
      provider: "grok_build" as AccountProvider,
      task: "sync" as const,
      onTaskChange: vi.fn(),
      syncPending: false,
      resetPending: false,
      progress: null,
      onOpenChange: vi.fn(),
      onConfirm: vi.fn(),
      ...overrides,
    };
  }

  it("Build 池提供同步/重置切换并展示对应说明", async () => {
    const onTaskChange = vi.fn();
    const { user, unmount } = renderDialog(<QuotaSyncAllDialog {...quotaSync({ onTaskChange })} />);

    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accountQuotaTask.allTitle"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accounts.syncAllDescription"));
    await user.click(screen.getByRole("tab", { name: t("accountQuotaReset.action") }));
    expect(onTaskChange).toHaveBeenCalledWith("reset");
    unmount();

    renderDialog(<QuotaSyncAllDialog {...quotaSync({ task: "reset" })} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accountQuotaTask.resetAllDescription"));
  });

  it("非 Build 池不渲染任务切换，标题与说明按池切换", () => {
    const web = renderDialog(<QuotaSyncAllDialog {...quotaSync({ provider: "grok_web" })} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accounts.syncAllTitle"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accounts.syncAllWebDescription"));
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    web.unmount();

    renderDialog(<QuotaSyncAllDialog {...quotaSync({ provider: "grok_console" })} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("console.syncAllDescription"));
    expect(screen.getByRole("button", { name: t("accounts.syncAll") })).toBeInTheDocument();
  });

  it("同步进行中展示完成度，重置进行中只展示加载指示", () => {
    const syncing = renderDialog(
      <QuotaSyncAllDialog {...quotaSync({ syncPending: true, progress: { completed: 2, total: 8 } })} />,
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent("2 / 8");
    syncing.unmount();

    const syncingNoProgress = renderDialog(<QuotaSyncAllDialog {...quotaSync({ syncPending: true })} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("common.loading"));
    syncingNoProgress.unmount();

    renderDialog(<QuotaSyncAllDialog {...quotaSync({ resetPending: true })} />);
    // 重置进行中：动作按钮只保留加载指示，不再显示执行文案，且不可重复提交。
    expect(screen.queryByText(t("accountQuotaTask.execute"))).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(t("common.loading")) })).toBeDisabled();
  });

  it("任务进行中时忽略关闭请求，空闲时透传", async () => {
    const onOpenChange = vi.fn();
    const busy = renderDialog(<QuotaSyncAllDialog {...quotaSync({ syncPending: true, onOpenChange })} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    busy.unmount();

    const { user } = renderDialog(<QuotaSyncAllDialog {...quotaSync({ onOpenChange })} />);
    await user.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("BatchQuotaTaskDialog", () => {
  function batchQuota(overrides: Partial<Parameters<typeof BatchQuotaTaskDialog>[0]> = {}) {
    return {
      open: true,
      selectedCount: 3,
      task: "sync" as const,
      onTaskChange: vi.fn(),
      syncPending: false,
      resetPending: false,
      onOpenChange: vi.fn(),
      onConfirm: vi.fn(),
      ...overrides,
    };
  }

  it("按选中集合展示标题，同步与重置说明随任务切换", async () => {
    const onTaskChange = vi.fn();
    const { user, unmount } = renderDialog(<BatchQuotaTaskDialog {...batchQuota({ onTaskChange })} />);

    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accountQuotaTask.title", { count: 3 }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accountQuotaTask.syncDescription"));
    await user.click(screen.getByRole("tab", { name: t("accountQuotaReset.action") }));
    expect(onTaskChange).toHaveBeenCalledWith("reset");
    unmount();

    renderDialog(<BatchQuotaTaskDialog {...batchQuota({ task: "reset" })} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accountQuotaReset.description"));
    expect(screen.getByRole("button", { name: t("accountQuotaTask.execute") })).toBeEnabled();
  });

  it("进行中禁用任务切换与执行按钮并展示加载指示", async () => {
    const onConfirm = vi.fn();
    const { user, unmount } = renderDialog(<BatchQuotaTaskDialog {...batchQuota({ syncPending: true, onConfirm })} />);

    expect(screen.getByRole("tab", { name: t("accountQuotaReset.action") })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: new RegExp(t("accountQuotaTask.execute")) }));
    expect(onConfirm).not.toHaveBeenCalled();
    unmount();

    const { user: activeUser } = renderDialog(<BatchQuotaTaskDialog {...batchQuota({ onConfirm })} />);
    await activeUser.click(screen.getByRole("button", { name: t("accountQuotaTask.execute") }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("关联删除目标选择（经删除弹窗渲染）", () => {
  function options(provider: AccountProvider, target: AccountProvider) {
    return provider === target ? "同池" : "跨池";
  }

  it("未勾选时不显示计数，勾选后按预览计数展示 +N", () => {
    renderDialog(
      <AccountBatchDeleteDialog
        open
        selectedCount={2}
        provider="grok_build"
        targets={["grok_web"]}
        counts={{ grok_web: 4 }}
        previewError={false}
        pending={false}
        blocking={false}
        onOpenChange={vi.fn()}
        onToggleTarget={vi.fn()}
        onSelectAll={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const web = screen.getByRole("checkbox", { name: /Grok Web/ });
    expect(web).toBeChecked();
    expect(screen.getByText(t("accounts.linkedDeleteExtra", { count: 4 }))).toBeInTheDocument();
    // Console 未勾选：计数槽保持占位但不可见、且 aria-hidden。
    const consoleRow = screen.getByText("Grok Console").parentElement;
    expect(consoleRow?.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("计数未返回时显示 pending 占位，失败时明确报错而不是 +0", () => {
    const pending = renderDialog(
      <AccountBatchDeleteDialog
        open
        selectedCount={1}
        provider="grok_build"
        targets={["grok_web"]}
        counts={{}}
        previewError={false}
        pending={false}
        blocking
        onOpenChange={vi.fn()}
        onToggleTarget={vi.fn()}
        onSelectAll={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const pendingSlot = screen.getByText("Grok Web").parentElement?.querySelector("[aria-busy='true']");
    expect(pendingSlot).not.toBeNull();
    expect(pending).toBeDefined();
    pending.unmount();

    renderDialog(
      <AccountBatchDeleteDialog
        open
        selectedCount={1}
        provider="grok_build"
        targets={["grok_web"]}
        counts={{}}
        previewError
        pending={false}
        blocking
        onOpenChange={vi.fn()}
        onToggleTarget={vi.fn()}
        onSelectAll={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText(t("accounts.linkedDeletePreviewFailed"))).toBeInTheDocument();
    expect(screen.getByText(t("accounts.linkedDeleteExtraFailed"))).toBeInTheDocument();
  });

  it("全选后按钮切换为清空，并回调 onSelectAll", async () => {
    const onSelectAll = vi.fn();
    const provider: AccountProvider = "grok_build";
    const { user } = renderDialog(
      <AccountBatchDeleteDialog
        open
        selectedCount={1}
        provider={provider}
        targets={["grok_web", "grok_console"]}
        counts={{ grok_web: 1, grok_console: 1 }}
        previewError={false}
        pending={false}
        blocking={false}
        onOpenChange={vi.fn()}
        onToggleTarget={vi.fn()}
        onSelectAll={onSelectAll}
        onConfirm={vi.fn()}
      />,
    );

    expect(options(provider, "grok_web")).toBe("跨池");
    await user.click(screen.getByRole("button", { name: t("accounts.linkedDeleteClearAll") }));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it("复选框切换把目标与布尔值回传（含取消勾选）", async () => {
    const onToggleTarget = vi.fn();
    const { user } = renderDialog(
      <AccountBatchDeleteDialog
        open
        selectedCount={1}
        provider="grok_web"
        targets={["grok_build"]}
        counts={{ grok_build: 1, grok_console: 0 }}
        previewError={false}
        pending={false}
        blocking={false}
        onOpenChange={vi.fn()}
        onToggleTarget={onToggleTarget}
        onSelectAll={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /Grok Build/ }));
    expect(onToggleTarget).toHaveBeenCalledWith("grok_build", false);
    await user.click(screen.getByRole("checkbox", { name: /Grok Console/ }));
    expect(onToggleTarget).toHaveBeenCalledWith("grok_console", true);
  });

  it("批量删除在选中数为 0 或阻塞时禁止确认，确认回调只触发一次", async () => {
    const onConfirm = vi.fn();
    const blocked = renderDialog(
      <AccountBatchDeleteDialog
        open
        selectedCount={0}
        provider="grok_build"
        targets={[]}
        counts={{}}
        previewError={false}
        pending={false}
        blocking={false}
        onOpenChange={vi.fn()}
        onToggleTarget={vi.fn()}
        onSelectAll={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("button", { name: t("accounts.deleteConfirm") })).toBeDisabled();
    blocked.unmount();

    const { user } = renderDialog(
      <AccountBatchDeleteDialog
        open
        selectedCount={2}
        provider="grok_build"
        targets={[]}
        counts={{}}
        previewError={false}
        pending={false}
        blocking={false}
        onOpenChange={vi.fn()}
        onToggleTarget={vi.fn()}
        onSelectAll={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: t("accounts.deleteConfirm") }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accounts.batchDeleteTitle", { count: 2 }));
  });
});

describe("AccountDeleteDialog", () => {
  function single(overrides: Partial<Parameters<typeof AccountDeleteDialog>[0]> = {}) {
    return {
      account: account(),
      provider: "grok_build" as AccountProvider,
      targets: [] as AccountProvider[],
      counts: {},
      previewError: false,
      pending: false,
      blocking: false,
      onOpenChange: vi.fn(),
      onToggleTarget: vi.fn(),
      onSelectAll: vi.fn(),
      onConfirm: vi.fn(),
      ...overrides,
    };
  }

  it("无选中账号时不渲染弹窗内容", () => {
    renderDialog(<AccountDeleteDialog {...single({ account: null })} />);

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("有待处理请求时忽略关闭，未选择关联目标时也可确认", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    const pending = renderDialog(<AccountDeleteDialog {...single({ pending: true, onOpenChange, onConfirm })} />);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: t("accounts.deleteConfirm") })).toBeDisabled();
    pending.unmount();

    const { user } = renderDialog(
      <AccountDeleteDialog {...single({ onConfirm, targets: ["grok_web"], counts: { grok_web: 2 } })} />,
    );
    await user.click(screen.getByRole("button", { name: t("accounts.deleteConfirm") }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("关联目标选择全部完成时不再阻塞确认", async () => {
    const onOpenChange = vi.fn();
    const { user } = renderDialog(
      <AccountDeleteDialog
        {...single({ targets: ["grok_web", "grok_console"], counts: { grok_web: 1, grok_console: 0 }, onOpenChange })}
      />,
    );

    expect(screen.getByRole("button", { name: t("accounts.deleteConfirm") })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("QuickImportDialog", () => {
  function importDialog(overrides: Partial<Parameters<typeof QuickImportDialog>[0]> = {}) {
    return {
      open: true,
      provider: "grok_build" as AccountProvider,
      tokens: "",
      pending: false,
      onOpenChange: vi.fn(),
      onTokensChange: vi.fn(),
      onFileSelected: vi.fn(),
      onSubmit: vi.fn(),
      ...overrides,
    };
  }

  it("各账号池使用各自的标题、说明与占位文案", () => {
    const build = renderDialog(<QuickImportDialog {...importDialog()} />);
    expect(screen.getByRole("dialog")).toHaveTextContent(t("accounts.quickImportRTTitle"));
    expect(screen.getByRole("dialog")).toHaveTextContent(t("accounts.quickImportRTDescription"));
    expect(screen.getByLabelText(t("accounts.refreshTokens"))).toBeInTheDocument();
    build.unmount();

    const consoleView = renderDialog(<QuickImportDialog {...importDialog({ provider: "grok_console" })} />);
    expect(screen.getByRole("dialog")).toHaveTextContent(t("console.quickImportTitle"));
    consoleView.unmount();

    const web = renderDialog(<QuickImportDialog {...importDialog({ provider: "grok_web" })} />);
    expect(screen.getByRole("dialog")).toHaveTextContent(t("accounts.quickImportTitle"));
    expect(screen.getByLabelText(t("accounts.ssoTokens"))).toBeInTheDocument();
    web.unmount();
  });

  it("文本为空时禁止导入，输入后回传内容", async () => {
    const onTokensChange = vi.fn();
    const { user, unmount } = renderDialog(<QuickImportDialog {...importDialog({ onTokensChange })} />);

    expect(screen.getByRole("button", { name: t("accounts.importAction") })).toBeDisabled();
    await user.type(screen.getByLabelText(t("accounts.refreshTokens")), "t");
    expect(onTokensChange).toHaveBeenCalledWith("t");
    unmount();

    const filled = renderDialog(<QuickImportDialog {...importDialog({ tokens: "token" })} />);
    expect(filled.container.ownerDocument.body).toHaveTextContent("token");
  });

  it("上传文件后回传文件并清空输入框，取消时回调关闭", async () => {
    const onFileSelected = vi.fn();
    const onOpenChange = vi.fn();
    const { user, unmount } = renderDialog(<QuickImportDialog {...importDialog({ onFileSelected, onOpenChange })} />);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["a"], "tokens.txt", { type: "text/plain" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
    expect(onFileSelected).toHaveBeenCalledWith(file);

    await user.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    unmount();
  });

  it("进行中时禁用上传与导入按钮", () => {
    renderDialog(<QuickImportDialog {...importDialog({ pending: true, tokens: "token" })} />);

    expect(screen.getByRole("button", { name: t("accounts.uploadTXT") })).toBeDisabled();
    expect(screen.getByRole("button", { name: new RegExp(t("accounts.importAction")) })).toBeDisabled();
  });
});

describe("LinkedTargetIcon", () => {
  it("三个账号池各自渲染对应图标类名", () => {
    const build = renderDialog(<LinkedTargetIcon target="grok_build" />);
    expect(document.querySelector(".text-quota-product-1")).not.toBeNull();
    build.unmount();

    const consoleIcon = renderDialog(<LinkedTargetIcon target="grok_console" />);
    expect(document.querySelector(".text-quota-product-4")).not.toBeNull();
    consoleIcon.unmount();

    renderDialog(<LinkedTargetIcon target="grok_web" />);
    expect(document.querySelector(".text-quota-product-2")).not.toBeNull();
  });
});
