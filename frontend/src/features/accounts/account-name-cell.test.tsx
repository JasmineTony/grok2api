import { render, screen, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountNameCell } from "@/features/accounts/account-name-cell";
import type { AccountDTO } from "@/features/accounts/accounts-dto";
import {
  buildAbnormalBreakdown,
  buildAbnormalDetailItems,
  downloadAccountExport,
  isAbortError,
  linkedTargetLabel,
  linkedTargetOptions,
} from "@/features/accounts/accounts-view-model";
import { i18n } from "@/shared/i18n";

// 账号名称单元格与账号视图模型测试（AGENTS.md TEST-1）：
// 名称单元格的分支集中在“多账号关联 / 协议标记 / 机器人风险”组合，视图模型是纯函数。

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

function renderCell(node: ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={0}>
        <div data-testid="cell">{node}</div>
      </TooltipProvider>
    </I18nextProvider>,
  );
}

function cell(): HTMLElement {
  return screen.getByTestId("cell");
}

async function openTooltip(): Promise<HTMLElement> {
  const trigger = cell().querySelector<HTMLElement>('[tabindex="0"]');
  if (!trigger) throw new Error("未找到 tooltip 触发器");
  fireEvent.focus(trigger);
  return screen.findByRole("tooltip");
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
});

describe("accounts-view-model", () => {
  it("isAbortError 只识别 AbortError 名称的错误", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    const error = new Error("x");
    error.name = "AbortError";
    expect(isAbortError(error)).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });

  it("导出下载按 provider 与后缀生成文件名并释放对象 URL", () => {
    const createObjectURL = vi.fn(() => "blob:accounts");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.useFakeTimers();

    downloadAccountExport(new Blob(["{}"]), "grok_web", "batch-1");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:accounts");

    click.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("关联目标排除当前账号池", () => {
    expect(linkedTargetOptions("grok_build")).toEqual(["grok_web", "grok_console"]);
    expect(linkedTargetOptions("grok_console")).toEqual(["grok_web", "grok_build"]);
    expect(linkedTargetOptions("grok_web")).toEqual(["grok_build", "grok_console"]);
  });

  it("关联目标标签覆盖三个账号池", () => {
    expect(linkedTargetLabel("grok_build")).toBe("Grok Build");
    expect(linkedTargetLabel("grok_console")).toBe("Grok Console");
    expect(linkedTargetLabel("grok_web")).toBe("Grok Web");
  });

  const counts = { cooldown: 1, waitingReset: 2, probing: 3, risk: 4, disabled: 5, reauthRequired: 6 };

  it("异常明细按固定顺序与配色展开", () => {
    const breakdown = buildAbnormalBreakdown(t, counts);

    expect(breakdown.map((item) => item.label)).toEqual([
      t("accounts.statusCooldown"),
      t("accounts.waitingReset"),
      t("accounts.probing"),
      t("accounts.riskFilter"),
      t("accounts.statusDisabled"),
      t("accounts.statusReauthRequired"),
    ]);
    expect(breakdown.map((item) => item.count)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(breakdown[0].tone).toBe("bg-amber-500/10 text-amber-700 dark:text-amber-300");
    expect(breakdown[2].tone).toBe("bg-sky-500/10 text-sky-700 dark:text-sky-300");
    expect(breakdown[3].tone).toBe("bg-orange-500/10 text-orange-700 dark:text-orange-300");
    expect(breakdown[4].tone).toBe("bg-muted text-muted-foreground");
    expect(breakdown[5].tone).toBe("bg-red-500/10 text-red-700 dark:text-red-300");
  });

  it("总览不可用时退化为占位明细", () => {
    const items = buildAbnormalDetailItems(buildAbnormalBreakdown(t, counts), t, String, true);

    expect(items).toEqual([{ label: "-", value: "", tone: "bg-muted text-muted-foreground" }]);
  });

  it("只展示计数大于 0 的异常项", () => {
    const items = buildAbnormalDetailItems(
      buildAbnormalBreakdown(t, { cooldown: 0, waitingReset: 2, probing: 0, risk: 0, disabled: 0, reauthRequired: 0 }),
      t,
      (value) => `${value} 个`,
      false,
    );

    expect(items).toEqual([
      {
        label: t("accounts.waitingReset"),
        value: "2 个",
        tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      },
    ]);
  });

  it("没有任何异常时展示正常状态占位", () => {
    const items = buildAbnormalDetailItems(
      buildAbnormalBreakdown(t, { cooldown: 0, waitingReset: 0, probing: 0, risk: 0, disabled: 0, reauthRequired: 0 }),
      t,
      String,
      false,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: t("accounts.statusActive"), value: "", count: 0 });
  });
});

describe("AccountNameCell", () => {
  it("无关联账号时只展示自身图标与名称", async () => {
    renderCell(<AccountNameCell account={account()} />);

    expect(cell()).toHaveTextContent("build-alpha");
    const trigger = cell().querySelector<HTMLElement>('[tabindex="0"]');
    expect(trigger).toHaveAttribute("aria-label", t("models.providerGrokBuild"));

    const tooltip = await openTooltip();
    expect(within(tooltip).getByText("build-alpha")).toBeInTheDocument();
    expect(within(tooltip).getByText(t("models.providerGrokBuild"))).toBeInTheDocument();
  });

  it("使用 linkedAccounts 时按 provider 顺序排列并过滤同池关联", async () => {
    renderCell(
      <AccountNameCell
        account={account({
          provider: "grok_web",
          linkedAccounts: [
            { id: "console-1", provider: "grok_console", name: "console-a" },
            { id: "build-2", provider: "grok_build", name: "build-b" },
            { id: "web-9", provider: "grok_web", name: "self-duplicate" },
          ],
        })}
      />,
    );

    const trigger = cell().querySelector<HTMLElement>('[tabindex="0"]');
    // 自身排在 Web 位，Build（provider 顺序 0）在前、Console（顺序 2）在后，同池的重复关联被过滤。
    expect(trigger).toHaveAttribute(
      "aria-label",
      [t("models.providerGrokBuild"), t("models.providerGrokWeb"), t("console.name")].join(", "),
    );

    const tooltip = await openTooltip();
    expect(within(tooltip).getByText(t("models.providerGrokBuild"))).toBeInTheDocument();
    expect(within(tooltip).getByText(t("console.name"))).toBeInTheDocument();
    expect(tooltip).not.toHaveTextContent("self-duplicate");
  });

  it("退化的关联字段按 linkedProvider 合成单个关联", async () => {
    renderCell(
      <AccountNameCell
        account={account({
          provider: "grok_build",
          name: "build-a",
          linkedAccountId: "web-1",
          linkedProvider: "grok_web",
          linkedAccountName: "web-a",
          email: "build@example.com",
          userId: "uid-1",
        })}
      />,
    );

    const trigger = cell().querySelector<HTMLElement>('[tabindex="0"]');
    expect(trigger).toHaveAttribute(
      "aria-label",
      [t("models.providerGrokBuild"), t("models.providerGrokWeb")].join(", "),
    );

    const tooltip = await openTooltip();
    expect(within(tooltip).getByText("build@example.com")).toBeInTheDocument();
    expect(within(tooltip).getByText("uid-1")).toBeInTheDocument();
    expect(within(tooltip).getByText("web-a")).toBeInTheDocument();
  });

  it("邮箱或用户 ID 重复时去重，缺失时回退到名称", async () => {
    const duplicate = renderCell(
      <AccountNameCell
        account={account({ name: "Build-Name", email: "SAME@example.com", userId: "same@example.com" })}
      />,
    );
    let tooltip = await openTooltip();
    expect(within(tooltip).getAllByText(/same@example.com/i)).toHaveLength(1);
    duplicate.unmount();

    renderCell(<AccountNameCell account={account({ name: "只有名称" })} />);
    tooltip = await openTooltip();
    expect(within(tooltip).getByText("只有名称")).toBeInTheDocument();
  });

  it("协议与 NSFW 标记按时间展示并在缺失时隐藏", async () => {
    const withMarks = renderCell(
      <AccountNameCell
        account={account({ termsAcceptedAt: "2026-02-01T00:00:00Z", nsfwEnabledAt: "2026-02-02T00:00:00Z" })}
      />,
    );
    expect(screen.getByLabelText(t("webAccountSettings.acceptTerms"))).toBeInTheDocument();
    expect(screen.getByLabelText(t("accounts.nsfwEnabledMark"))).toBeInTheDocument();
    withMarks.unmount();

    const termsOnly = renderCell(<AccountNameCell account={account({ termsAcceptedAt: "2026-02-01T00:00:00Z" })} />);
    expect(screen.getByLabelText(t("webAccountSettings.acceptTerms"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("accounts.nsfwEnabledMark"))).not.toBeInTheDocument();
    termsOnly.unmount();

    renderCell(<AccountNameCell account={account()} />);
    expect(screen.queryByLabelText(t("webAccountSettings.acceptTerms"))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t("accounts.nsfwEnabledMark"))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t("accounts.botRisk"))).not.toBeInTheDocument();
  });

  it("机器人风险标记按来源切换配色与提示文案", async () => {
    const source2 = renderCell(<AccountNameCell account={account({ buildBotFlagged: true, buildBotFlagSource: 2 })} />);
    fireEvent.focus(screen.getByLabelText(t("accounts.botRisk")));
    let tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(t("accounts.botRiskTooltipSource2"));
    source2.unmount();

    const source1 = renderCell(<AccountNameCell account={account({ buildBotFlagged: true, buildBotFlagSource: 1 })} />);
    fireEvent.focus(screen.getByLabelText(t("accounts.botRisk")));
    tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(t("accounts.botRiskTooltipSource1"));
    source1.unmount();

    renderCell(<AccountNameCell account={account({ buildBotFlagged: true })} />);
    fireEvent.focus(screen.getByLabelText(t("accounts.botRisk")));
    tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(t("accounts.botRiskTooltip"));
  });
});
