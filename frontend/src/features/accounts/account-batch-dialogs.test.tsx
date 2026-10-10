import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { BatchConcurrencyDialog, EgressConfigurationDialog } from "@/features/accounts/account-batch-dialogs";
import { DeviceLoginDialog } from "@/features/accounts/account-device-dialog";
import { ExportAccountsDialog } from "@/features/accounts/account-export-dialog";
import { i18n } from "@/shared/i18n";

// 批量/导出/设备登录弹窗测试（AGENTS.md TEST-1/TEST-3）：直接渲染弹窗并断言各校验与状态分支。

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

function renderDialog(node: ReactNode) {
  return {
    ...render(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={0}>{node}</TooltipProvider>
      </I18nextProvider>,
    ),
    user: userEvent.setup(),
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
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

describe("BatchConcurrencyDialog", () => {
  function concurrency(overrides: Partial<Parameters<typeof BatchConcurrencyDialog>[0]> = {}) {
    return {
      open: true,
      selectedCount: 2,
      value: "8",
      onValueChange: vi.fn(),
      pending: false,
      onOpenChange: vi.fn(),
      onConfirm: vi.fn(),
      ...overrides,
    };
  }

  it("按选中集合展示标题，输入变更回传原始文本", async () => {
    const onValueChange = vi.fn();
    const { user } = renderDialog(<BatchConcurrencyDialog {...concurrency({ onValueChange })} />);

    expect(screen.getByRole("dialog")).toHaveTextContent(t("accounts.batchConcurrencyTitle", { count: 2 }));
    await user.clear(screen.getByLabelText(t("accounts.maxConcurrent")));
    expect(onValueChange).toHaveBeenCalled();
  });

  it("并发上限超出 1..256 或非整数时禁止保存", () => {
    const cases = ["0", "257", "abc", "3.5", ""];
    for (const value of cases) {
      const view = renderDialog(<BatchConcurrencyDialog {...concurrency({ value })} />);
      expect(screen.getByRole("button", { name: t("common.save") })).toBeDisabled();
      view.unmount();
    }

    renderDialog(<BatchConcurrencyDialog {...concurrency({ value: "256" })} />);
    expect(screen.getByRole("button", { name: t("common.save") })).toBeEnabled();
  });

  it("进行中禁用输入与按钮，并忽略关闭请求", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    const { user } = renderDialog(
      <BatchConcurrencyDialog {...concurrency({ pending: true, onOpenChange, onConfirm })} />,
    );

    expect(screen.getByLabelText(t("accounts.maxConcurrent"))).toBeDisabled();
    expect(screen.getByRole("button", { name: t("common.cancel") })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: new RegExp(t("common.save")) }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("空闲时取消与保存分别回调", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    const { user } = renderDialog(<BatchConcurrencyDialog {...concurrency({ onOpenChange, onConfirm })} />);

    await user.click(screen.getByRole("button", { name: t("common.save") }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("ExportAccountsDialog", () => {
  function exportDialog(overrides: Partial<Parameters<typeof ExportAccountsDialog>[0]> = {}) {
    return {
      open: true,
      provider: "grok_build" as const,
      selectedCount: 0,
      limit: "1000",
      onLimitChange: vi.fn(),
      completedCount: 0,
      batchNumber: 0,
      snapshotMaxId: "0",
      pending: false,
      onOpenChange: vi.fn(),
      onConfirm: vi.fn(),
      ...overrides,
    };
  }

  it("按 provider 展示标题，选中集合存在时只展示数量", () => {
    const build = renderDialog(<ExportAccountsDialog {...exportDialog({ selectedCount: 3 })} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accounts.exportTitle", { provider: "Grok Build" }));
    expect(screen.getByText(t("common.selectedCount", { count: 3 }))).toBeInTheDocument();
    build.unmount();

    const web = renderDialog(<ExportAccountsDialog {...exportDialog({ selectedCount: 1, provider: "grok_web" })} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accounts.exportTitle", { provider: "Grok Web" }));
    web.unmount();

    renderDialog(<ExportAccountsDialog {...exportDialog({ selectedCount: 1, provider: "grok_console" })} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(t("accounts.exportTitle", { provider: "Grok Console" }));
  });

  it("未选中账号时展示分批字段并回传上限", async () => {
    const onLimitChange = vi.fn();
    const { user, unmount } = renderDialog(<ExportAccountsDialog {...exportDialog({ onLimitChange })} />);

    const limit = screen.getByLabelText(t("accounts.exportCount")) as HTMLInputElement;
    expect(limit).toHaveValue(1000);
    await user.clear(limit);
    expect(onLimitChange).toHaveBeenCalled();
    expect(screen.queryByText(t("common.selectedCount", { count: 0 }))).not.toBeInTheDocument();
    unmount();
  });

  it("分批导出已开始后上限被锁定，并展示批次进度与「下一批」", () => {
    const locked = renderDialog(
      <ExportAccountsDialog {...exportDialog({ completedCount: 20, batchNumber: 2, snapshotMaxId: "20" })} />,
    );
    expect(screen.getByLabelText(t("accounts.exportCount"))).toBeDisabled();
    expect(screen.getByText(t("accountExport.batchProgress", { count: 20, batch: 2 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("accountExport.nextBatch") })).toBeEnabled();
    locked.unmount();

    const unlocked = renderDialog(<ExportAccountsDialog {...exportDialog()} />);
    expect(screen.getByLabelText(t("accounts.exportCount"))).toBeEnabled();
    expect(screen.queryByText(t("accountExport.batchProgress", { count: 0, batch: 0 }))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("accounts.exportAuth") })).toBeInTheDocument();
    unlocked.unmount();
  });

  it("上限非法且未选中账号时禁止确认，非法上限不提供「下一批」入口", async () => {
    const onConfirm = vi.fn();
    const invalid = renderDialog(<ExportAccountsDialog {...exportDialog({ limit: "0", onConfirm })} />);
    expect(screen.getByRole("button", { name: t("accounts.exportAuth") })).toBeDisabled();
    invalid.unmount();

    const { user } = renderDialog(
      <ExportAccountsDialog
        {...exportDialog({ limit: "20000", completedCount: 5, batchNumber: 1, snapshotMaxId: "5", onConfirm })}
      />,
    );
    await user.click(screen.getByRole("button", { name: t("accountExport.nextBatch") }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("进行中时取消与确认都不可用，且忽略关闭请求", async () => {
    const onOpenChange = vi.fn();
    const pending = renderDialog(
      <ExportAccountsDialog {...exportDialog({ selectedCount: 2, pending: true, onOpenChange })} />,
    );

    expect(screen.getByRole("button", { name: t("common.cancel") })).toBeDisabled();
    expect(screen.getByRole("button", { name: new RegExp(t("accounts.exportAuth")) })).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalled();
    pending.unmount();

    const onConfirm = vi.fn();
    const { user } = renderDialog(<ExportAccountsDialog {...exportDialog({ selectedCount: 2, onConfirm })} />);
    await user.click(screen.getByRole("button", { name: t("accounts.exportAuth") }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("DeviceLoginDialog", () => {
  const session = {
    sessionId: "session-1",
    userCode: "AAAA-BBBB",
    verificationUri: "https://example.com/device",
    intervalSeconds: 1,
    expiresAt: "2999-01-01T00:00:00Z",
  };

  function device(overrides: Partial<Parameters<typeof DeviceLoginDialog>[0]> = {}) {
    return {
      open: true,
      status: "pending" as const,
      session: null,
      language: "zh-CN",
      onOpenChange: vi.fn(),
      onRetry: vi.fn(),
      ...overrides,
    };
  }

  it("启动中只展示加载状态", () => {
    renderDialog(<DeviceLoginDialog {...device({ status: "starting" })} />);

    expect(screen.getByRole("dialog")).toHaveTextContent(t("accounts.deviceTitle"));
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("AAAA-BBBB")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("common.retry") })).not.toBeInTheDocument();
  });

  it("等待授权时展示用户码、过期时间与打开验证页入口", async () => {
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    const { user } = renderDialog(<DeviceLoginDialog {...device({ session })} />);

    expect(screen.getByText("AAAA-BBBB")).toBeInTheDocument();
    expect(screen.getByText(t("accounts.waiting"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("accounts.openVerification") }));
    expect(openSpy).toHaveBeenCalledWith(session.verificationUri, "_blank", "noopener,noreferrer");
    vi.unstubAllGlobals();
  });

  it("等待授权优先使用完整验证地址", async () => {
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    const { user } = renderDialog(
      <DeviceLoginDialog
        {...device({ session: { ...session, verificationUriComplete: "https://example.com/complete" } })}
      />,
    );

    await user.click(screen.getByRole("button", { name: t("accounts.openVerification") }));
    expect(openSpy).toHaveBeenCalledWith("https://example.com/complete", "_blank", "noopener,noreferrer");
    vi.unstubAllGlobals();
  });

  it("已有会话但状态失败时展示重试按钮与会话信息", async () => {
    const onRetry = vi.fn();
    const { user } = renderDialog(<DeviceLoginDialog {...device({ status: "failed", session, onRetry })} />);

    expect(screen.getByText("AAAA-BBBB")).toBeInTheDocument();
    expect(screen.getByText(t("apiErrors.deviceLoginFailed"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("common.retry") }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("启动失败且无会话时提供整页重试入口", async () => {
    const onRetry = vi.fn();
    const { user } = renderDialog(<DeviceLoginDialog {...device({ status: "failed", onRetry })} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toHaveTextContent(t("apiErrors.deviceLoginFailed"));
    await user.click(screen.getByRole("button", { name: t("common.retry") }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("EgressConfigurationDialog", () => {
  const nodes = [
    { id: "node-1", name: "东京", assignedAccountCount: 3, accountCapacity: 50 },
    { id: "node-2", name: "无限节点", assignedAccountCount: 0, accountCapacity: 0 },
  ];

  function egress(overrides: Partial<Parameters<typeof EgressConfigurationDialog>[0]> = {}) {
    return {
      open: true,
      selectedCount: 4,
      task: "bind" as const,
      onTaskChange: vi.fn(),
      nodeId: "node-1",
      onNodeIdChange: vi.fn(),
      nodes,
      nodesPending: false,
      nodesError: null,
      pending: false,
      onOpenChange: vi.fn(),
      onConfirm: vi.fn(),
      ...overrides,
    };
  }

  it("绑定任务展示节点选择器，容量有限与无限两种节点都能选择", async () => {
    const onNodeIdChange = vi.fn();
    const { user } = renderDialog(<EgressConfigurationDialog {...egress({ onNodeIdChange })} />);

    expect(screen.getByRole("dialog")).toHaveTextContent(t("accounts.egressConfigurationTitle", { count: 4 }));
    await user.click(screen.getByLabelText(t("accounts.bindEgressNode")));

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["东京 (3 / 50)", "无限节点 (0 / 无限制)"]);
    await user.click(screen.getByRole("option", { name: "无限节点 (0 / 无限制)" }));
    expect(onNodeIdChange).toHaveBeenCalledWith("node-2");
  });

  it("节点查询进行中显示加载，失败显示错误文案", () => {
    const pending = renderDialog(<EgressConfigurationDialog {...egress({ nodesPending: true })} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByLabelText(t("accounts.bindEgressNode"))).not.toBeInTheDocument();
    pending.unmount();

    renderDialog(<EgressConfigurationDialog {...egress({ nodesError: "加载出口节点失败" })} />);
    expect(screen.getByText("加载出口节点失败")).toBeInTheDocument();
    expect(screen.queryByText(t("accounts.bindEgressNoNodes"))).not.toBeInTheDocument();
  });

  it("无可用节点时提示空态并阻止绑定执行", async () => {
    const onConfirm = vi.fn();
    const { user } = renderDialog(<EgressConfigurationDialog {...egress({ nodes: [], nodeId: "", onConfirm })} />);

    expect(screen.getByText(t("accounts.bindEgressNoNodes"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: new RegExp(t("accountQuotaTask.execute")) }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("解绑任务不展示节点选择，选中节点无关也能执行", async () => {
    const onTaskChange = vi.fn();
    const onConfirm = vi.fn();
    const { user, unmount } = renderDialog(
      <EgressConfigurationDialog {...egress({ task: "unbind", nodeId: "", onTaskChange, onConfirm })} />,
    );

    expect(screen.getByText(t("accounts.unbindEgressDescription"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("accounts.bindEgressNode"))).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: new RegExp(t("accountQuotaTask.execute")) }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    unmount();

    const { user: switching } = renderDialog(
      <EgressConfigurationDialog {...egress({ task: "unbind", onTaskChange })} />,
    );
    await switching.click(screen.getByRole("tab", { name: t("accounts.bindEgress") }));
    expect(onTaskChange).toHaveBeenCalledWith("bind");
  });

  it("进行中禁用任务切换与按钮，并忽略关闭请求", async () => {
    const onOpenChange = vi.fn();
    const { user } = renderDialog(<EgressConfigurationDialog {...egress({ pending: true, onOpenChange })} />);

    expect(screen.getByRole("tab", { name: t("accounts.unbindEgress") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("common.cancel") })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: new RegExp(t("accountQuotaTask.execute")) }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("空闲时取消关闭弹窗", async () => {
    const onOpenChange = vi.fn();
    const { user } = renderDialog(<EgressConfigurationDialog {...egress({ onOpenChange })} />);

    await user.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
