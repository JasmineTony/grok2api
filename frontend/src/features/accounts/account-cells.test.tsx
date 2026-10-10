import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountStatus, AccountType, AccountTypeText, WebAccountType } from "@/features/accounts/account-cells";
import type { AccountDTO, QuotaDTO } from "@/features/accounts/accounts-dto";
import { i18n } from "@/shared/i18n";
import { formatDateTime } from "@/shared/lib/format";

// 账号表格单元格测试（AGENTS.md TEST-1）：只渲染单元格本身，断言用户可见文本与被提示的分支行为。
// tooltip 内容在 Radix 里属于“关闭时不渲染”的分支，必须用 focus 真实打开才能覆盖。

function renderCell(ui: ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={0}>
        <div data-testid="cell">{ui}</div>
      </TooltipProvider>
    </I18nextProvider>,
  );
}

function cell(): HTMLElement {
  return screen.getByTestId("cell");
}

function quota(overrides: Partial<QuotaDTO> = {}): QuotaDTO {
  return {
    type: "free",
    source: "responseModel",
    confidence: "confirmed",
    status: "active",
    used: 120,
    limit: 1_000,
    remaining: 880,
    usagePercent: 12,
    limitKnown: true,
    observed: true,
    confirmed: true,
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
    quota: quota(),
    ...overrides,
  };
}

/** 打开当前单元格里第一个 tooltip 触发器并返回内容节点。 */
async function openTooltip(): Promise<HTMLElement> {
  const trigger = cell().querySelector<HTMLElement>('[tabindex="0"]');
  if (!trigger) throw new Error("未找到 tooltip 触发器");
  fireEvent.focus(trigger);
  return screen.findByRole("tooltip");
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("WebAccountType", () => {
  it("四种分层各自渲染对应文案", () => {
    const cases: Array<[AccountDTO["webTier"], string]> = [
      ["basic", i18n.t("accountType.free")],
      ["super", i18n.t("accountType.super")],
      ["heavy", i18n.t("accountType.heavy")],
      ["auto", i18n.t("accountType.auto")],
    ];

    for (const [tier, label] of cases) {
      const rendered = renderCell(<WebAccountType tier={tier} />);
      expect(cell()).toHaveTextContent(label);
      if (tier !== "basic") expect(cell().querySelector("span")).toHaveClass("text-primary");
      rendered.unmount();
    }
  });

  it("未同步分层时回退为自动文案", () => {
    renderCell(<WebAccountType />);

    expect(cell()).toHaveTextContent(i18n.t("accountType.auto"));
  });
});

describe("AccountType", () => {
  it("额度类型未知时渲染待定标签并把说明写入 title", () => {
    renderCell(<AccountType quota={quota({ type: "unknown" })} />);

    const span = cell().querySelector("span");
    expect(span).toHaveTextContent(i18n.t("accountType.pending"));
    expect(span).toHaveAttribute("title", i18n.t("accountType.pendingDescription"));
  });

  it("免费与付费分别渲染各自文案", () => {
    const free = renderCell(<AccountType quota={quota({ type: "free" })} />);
    expect(cell()).toHaveTextContent(i18n.t("accountType.free"));
    expect(cell().querySelector("span")).toHaveAttribute("title", i18n.t("accountType.free"));
    expect(cell().querySelector("span")).toHaveClass("text-emerald-700");
    free.unmount();

    renderCell(<AccountType quota={quota({ type: "paid" })} />);
    expect(cell()).toHaveTextContent(i18n.t("accountType.paid"));
    expect(cell().querySelector("span")).toHaveClass("text-primary");
  });
});

describe("AccountTypeText", () => {
  it("显式 title 优先于 label", () => {
    renderCell(<AccountTypeText label="默认" title="自定义" variant="default" />);

    expect(cell().querySelector("span")).toHaveAttribute("title", "自定义");
    expect(cell()).toHaveTextContent("默认");
  });
});

describe("AccountStatus 账号级状态", () => {
  it("已禁用时展示禁用徽标", () => {
    renderCell(<AccountStatus account={account({ enabled: false })} />);

    expect(cell()).toHaveTextContent(i18n.t("accounts.statusDisabled"));
    expect(cell().querySelector('[tabindex="0"]')).toBeNull();
  });

  it("需要重新授权且无错误详情时展示纯徽标，不渲染提示触发器", () => {
    renderCell(<AccountStatus account={account({ authStatus: "reauthRequired" })} />);

    expect(cell()).toHaveTextContent(i18n.t("accounts.statusReauthRequired"));
    expect(cell().querySelector('[tabindex="0"]')).toBeNull();
  });

  it("需要重新授权时把状态码、错误码、错误信息与响应明细全部呈现", async () => {
    renderCell(
      <AccountStatus
        account={account({
          authStatus: "reauthRequired",
          lastRefreshErrorStatus: 502,
          lastRefreshErrorCode: "upstream_error",
          lastRefreshErrorMessage: "上游拒绝",
          lastRefreshErrorResponse: JSON.stringify({ error: "upstream_error", detail: "保留字段" }),
        })}
      />,
    );

    const tooltip = await openTooltip();
    expect(within(tooltip).getByText(i18n.t("accounts.refreshErrorStatus"))).toBeInTheDocument();
    expect(within(tooltip).getByText("502")).toBeInTheDocument();
    expect(within(tooltip).getByText(i18n.t("accounts.refreshErrorCode"))).toBeInTheDocument();
    expect(within(tooltip).getByText("upstream_error")).toBeInTheDocument();
    expect(within(tooltip).getByText("上游拒绝")).toBeInTheDocument();
    // error 与错误码相同被剔除，只保留真正的补充字段。
    expect(within(tooltip).getByText(i18n.t("accounts.refreshErrorResponse"))).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("保留字段");
    expect(tooltip).not.toHaveTextContent("upstream_error\n");
  });

  it("仅错误码时其余明细行不渲染", async () => {
    renderCell(<AccountStatus account={account({ authStatus: "reauthRequired", lastRefreshErrorCode: "x" })} />);

    const tooltip = await openTooltip();
    expect(within(tooltip).getByText("x")).toBeInTheDocument();
    expect(within(tooltip).queryByText(i18n.t("accounts.refreshErrorStatus"))).not.toBeInTheDocument();
    expect(within(tooltip).queryByText(i18n.t("accounts.refreshErrorMessage"))).not.toBeInTheDocument();
    expect(within(tooltip).queryByText(i18n.t("accounts.refreshErrorResponse"))).not.toBeInTheDocument();
  });

  it("仅错误信息时走 hasError 分支但仍不渲染响应明细", async () => {
    renderCell(
      <AccountStatus account={account({ authStatus: "reauthRequired", lastRefreshErrorMessage: "只有信息" })} />,
    );

    const tooltip = await openTooltip();
    expect(within(tooltip).getByText("只有信息")).toBeInTheDocument();
    expect(within(tooltip).queryByText(i18n.t("accounts.refreshErrorResponse"))).not.toBeInTheDocument();
  });

  it("空白响应不产生响应明细行", async () => {
    renderCell(
      <AccountStatus
        account={account({
          authStatus: "reauthRequired",
          lastRefreshErrorStatus: 500,
          lastRefreshErrorResponse: "   ",
        })}
      />,
    );

    const tooltip = await openTooltip();
    expect(within(tooltip).getByText("500")).toBeInTheDocument();
    expect(within(tooltip).queryByText(i18n.t("accounts.refreshErrorResponse"))).not.toBeInTheDocument();
  });

  it("Console 额度窗口耗尽时展示重置时间", async () => {
    renderCell(
      <AccountStatus
        account={account({
          provider: "grok_console",
          quotaWindows: [
            {
              mode: "console",
              remaining: 0,
              total: 10,
              usagePercent: 100,
              windowSeconds: 3_600,
              source: "upstream",
              resetAt: "2026-04-05T06:07:08Z",
            },
          ],
        })}
      />,
    );

    expect(cell()).toHaveTextContent(i18n.t("accounts.waitingReset"));
    const tooltip = await openTooltip();
    expect(tooltip).toHaveTextContent(
      i18n.t("accounts.quotaResetAt", { time: formatDateTime("2026-04-05T06:07:08Z", i18n.language) }),
    );
  });

  it("Console 窗口缺少重置时间时展示未知重置", async () => {
    renderCell(
      <AccountStatus
        account={account({
          provider: "grok_console",
          quotaWindows: [
            { mode: "console", remaining: 0, total: 10, usagePercent: 100, windowSeconds: 3_600, source: "upstream" },
          ],
        })}
      />,
    );

    const tooltip = await openTooltip();
    expect(tooltip).toHaveTextContent(i18n.t("accounts.quotaResetUnknown"));
  });

  it("非 Console 池即使存在耗尽窗口也走额度状态分支", () => {
    renderCell(
      <AccountStatus
        account={account({
          provider: "grok_build",
          quotaWindows: [
            {
              mode: "console",
              remaining: 0,
              total: 10,
              usagePercent: 100,
              windowSeconds: 3_600,
              source: "upstream",
              resetAt: "2026-04-05T06:07:08Z",
            },
          ],
        })}
      />,
    );

    expect(cell()).toHaveTextContent(i18n.t("accounts.statusActive"));
  });

  it("等待重置且给出下次探测时间时展示具体时间（付费文案）", async () => {
    renderCell(
      <AccountStatus
        account={account({
          quota: quota({ type: "paid", status: "waitingReset", nextProbeAt: "2026-05-06T07:08:09Z" }),
        })}
      />,
    );

    const tooltip = await openTooltip();
    expect(tooltip).toHaveTextContent(
      i18n.t("accounts.paidWaitingResetUntil", { time: formatDateTime("2026-05-06T07:08:09Z", i18n.language) }),
    );
  });

  it("等待重置且缺少探测时间时展示未知重置（免费文案）", async () => {
    renderCell(<AccountStatus account={account({ quota: quota({ type: "free", status: "waitingReset" }) })} />);

    const tooltip = await openTooltip();
    expect(tooltip).toHaveTextContent(i18n.t("accounts.quotaResetUnknown"));
  });

  it("探测中按额度类型展示对应文案", async () => {
    const paid = renderCell(<AccountStatus account={account({ quota: quota({ type: "paid", status: "probing" }) })} />);
    expect(await openTooltip()).toHaveTextContent(i18n.t("accounts.paidProbingQuota"));
    paid.unmount();

    renderCell(<AccountStatus account={account({ quota: quota({ type: "free", status: "probing" }) })} />);
    expect(cell()).toHaveTextContent(i18n.t("accounts.probing"));
    expect(cell().querySelector('[tabindex="0"]')).not.toBeNull();
  });

  it("冷却未过期时展示冷却徽标；冷却已过期则回到可用状态", () => {
    const cooling = renderCell(<AccountStatus account={account({ cooldownUntil: "2999-01-02T03:04:05Z" })} />);
    expect(cell()).toHaveTextContent(i18n.t("accounts.statusCooldown"));
    cooling.unmount();

    renderCell(<AccountStatus account={account({ cooldownUntil: "2000-01-02T03:04:05Z" })} />);
    expect(cell()).toHaveTextContent(i18n.t("accounts.statusActive"));
    expect(cell().querySelector('[tabindex="0"]')).toBeNull();
  });

  it("模型级封锁叠加在可用徽标上并提供模型明细", async () => {
    renderCell(
      <AccountStatus
        account={account({
          quota: quota({ modelQuotaBlocks: [{ model: "grok-4", reason: "model_quota_depleted" }] }),
        })}
      />,
    );

    expect(screen.getByTestId("account-status-model-quota-block-badge")).toHaveTextContent(
      i18n.t("accounts.statusActive"),
    );
    const tooltip = await openTooltip();
    expect(within(tooltip).getByTestId("account-quota-model-block-item-grok-4")).toHaveTextContent(
      i18n.t("accounts.modelQuotaReasonDepleted"),
    );
  });
});

describe("formatAdditionalRefreshErrorDetails（经响应明细提示验证）", () => {
  async function detailsFor(response: string, message?: string, code?: string): Promise<HTMLElement> {
    renderCell(
      <AccountStatus
        account={account({
          authStatus: "reauthRequired",
          lastRefreshErrorResponse: response,
          lastRefreshErrorMessage: message,
          lastRefreshErrorCode: code,
        })}
      />,
    );
    return openTooltip();
  }

  it("非 JSON 响应原样展示", async () => {
    const tooltip = await detailsFor("upstream said no");
    expect(tooltip).toHaveTextContent("upstream said no");
  });

  it("JSON 数组按原始响应展示", async () => {
    const tooltip = await detailsFor("[1,2]");
    expect(tooltip).toHaveTextContent("[1,2]");
  });

  it("JSON 标量按原始响应展示", async () => {
    const tooltip = await detailsFor("5");
    expect(tooltip).toHaveTextContent("5");
  });

  it("JSON null 按原始响应展示", async () => {
    const tooltip = await detailsFor("null");
    expect(tooltip).toHaveTextContent("null");
  });

  it("重复的 error 与 message 被剔除后无剩余字段则不展示明细", async () => {
    const tooltip = await detailsFor(JSON.stringify({ error: "code1", message: "M1" }), "M1", "code1");

    expect(tooltip).not.toHaveTextContent("{");
    expect(tooltip).toHaveTextContent("M1");
  });

  it("嵌套 error 字段被清理，剩余字段以格式化 JSON 展示", async () => {
    const tooltip = await detailsFor(
      JSON.stringify({ error: { code: "code1", message: "M1" }, extra: "保留" }),
      "M1",
      "code1",
    );

    // 错误码行本身仍显示 code1，这里断言的是“额外详情”已剔除重复的嵌套 code。
    expect(tooltip).toHaveTextContent('{ "extra": "保留" }');
  });

  it("嵌套 error 仍有内容时原样保留并展示", async () => {
    const tooltip = await detailsFor(JSON.stringify({ error: { detail: "仍有内容" } }));

    expect(tooltip).toHaveTextContent("仍有内容");
  });

  it("error 为字符串且与错误码不同时保留", async () => {
    const tooltip = await detailsFor(JSON.stringify({ error: "other_error" }), undefined, "code1");

    expect(tooltip).toHaveTextContent("other_error");
  });

  it("响应为 JSON 标量以外的空对象时同样回退为原始响应", async () => {
    const tooltip = await detailsFor(JSON.stringify({ error: "code1" }), undefined, "code1");

    expect(tooltip).not.toHaveTextContent("{");
  });
});
