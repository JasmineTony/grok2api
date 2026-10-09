import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountQuota, ConsoleQuota, ModelQuotaBlockTooltip, WebQuota } from "@/features/accounts/account-quota";
import {
  listAccounts,
  type AccountDTO,
  type ModelQuotaBlockDTO,
  type QuotaDTO,
} from "@/features/accounts/accounts-api";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";
import { formatDateTime } from "@/shared/lib/format";

const locale = "zh-CN";
const markerTestId = "account-quota-model-block-marker";
const itemTestIdPrefix = "account-quota-model-block-item-";

// 组件依赖 radix Tooltip 上下文与 react-i18next 实例，测试里显式提供。
function renderWithProviders(node: ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={0}>{node}</TooltipProvider>
    </I18nextProvider>,
  );
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

function block(overrides: Partial<ModelQuotaBlockDTO> = {}): ModelQuotaBlockDTO {
  return { model: "grok-4", reason: "model_quota_depleted", ...overrides };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ModelQuotaBlockMarker（经 AccountQuota 渲染）", () => {
  it("本轮新增的 i18n 键均已定义（避免断言退化为比较原始 key）", () => {
    for (const key of [
      "accounts.modelQuotaBlockedTitle",
      "accounts.modelQuotaBlockedUntil",
      "accounts.modelQuotaReasonDepleted",
      "accounts.modelQuotaReasonAccessDenied",
      "accounts.quotaResetUnknown",
    ]) {
      expect(i18n.exists(key)).toBe(true);
    }
  });

  it("无模型级封锁时不渲染 marker", () => {
    const free = renderWithProviders(<AccountQuota quota={quota()} locale={locale} />);
    expect(screen.queryByTestId(markerTestId)).not.toBeInTheDocument();

    free.unmount();
    renderWithProviders(<AccountQuota quota={quota({ type: "unknown" })} locale={locale} />);
    expect(screen.queryByTestId(markerTestId)).not.toBeInTheDocument();
  });

  it("有封锁时渲染 marker，并携带封锁数量", () => {
    const blocks = [
      block(),
      block({ model: "grok-3", reason: "model_access_denied", cooldownUntil: "2026-02-01T00:00:00Z" }),
    ];
    renderWithProviders(<AccountQuota quota={quota({ modelQuotaBlocks: blocks })} locale={locale} />);

    const marker = screen.getByTestId(markerTestId);
    expect(marker).toHaveAccessibleName(i18n.t("accounts.modelQuotaBlockedTitle", { count: 2 }));
  });

  it("付费额度（无周限/月限）分支同样渲染 marker", () => {
    renderWithProviders(
      <AccountQuota
        quota={quota({ type: "paid", limit: 0, remaining: 0, used: 0, modelQuotaBlocks: [block()] })}
        locale={locale}
      />,
    );

    expect(screen.getByTestId(markerTestId)).toBeInTheDocument();
  });
});

describe("ModelQuotaBlockTooltip", () => {
  it("渲染标题、列表容器，以及每行的模型名、reason 文案与恢复时间", () => {
    const until = "2026-03-04T05:06:00Z";
    const blocks = [block({ cooldownUntil: until }), block({ model: "grok-3", reason: "model_access_denied" })];
    renderWithProviders(<ModelQuotaBlockTooltip blocks={blocks} locale={locale} />);

    expect(screen.getByTestId("account-quota-model-block-title")).toHaveTextContent(
      i18n.t("accounts.modelQuotaBlockedTitle", { count: 2 }),
    );

    const list = screen.getByTestId("account-quota-model-block-list");
    expect(list.querySelectorAll(`[data-testid^="${itemTestIdPrefix}"]`)).toHaveLength(blocks.length);

    const depleted = screen.getByTestId(`${itemTestIdPrefix}grok-4`);
    expect(depleted).toHaveTextContent("grok-4");
    expect(depleted).toHaveTextContent(i18n.t("accounts.modelQuotaReasonDepleted"));
    expect(depleted).toHaveTextContent(
      i18n.t("accounts.modelQuotaBlockedUntil", { time: formatDateTime(until, locale) }),
    );

    // cooldownUntil 缺失分支：回退为“重置时间未知”，且不影响其他字段渲染。
    const denied = screen.getByTestId(`${itemTestIdPrefix}grok-3`);
    expect(denied).toHaveTextContent(i18n.t("accounts.modelQuotaReasonAccessDenied"));
    expect(denied).toHaveTextContent(i18n.t("accounts.quotaResetUnknown"));
  });

  it("未知 reason 回退为原始字符串", () => {
    renderWithProviders(
      <ModelQuotaBlockTooltip blocks={[block({ model: "grok-5", reason: "upstream_budget_guard" })]} locale={locale} />,
    );

    expect(screen.getByTestId(`${itemTestIdPrefix}grok-5`)).toHaveTextContent("upstream_budget_guard");
  });

  it("cooldownUntil 非法时不抛出，回退为占位符", () => {
    renderWithProviders(<ModelQuotaBlockTooltip blocks={[block({ cooldownUntil: "not-a-date" })]} locale={locale} />);

    expect(screen.getByTestId(`${itemTestIdPrefix}grok-4`)).toHaveTextContent(
      i18n.t("accounts.modelQuotaBlockedUntil", { time: "-" }),
    );
  });

  it("blocks 为空时不渲染任何内容", () => {
    const { container } = renderWithProviders(<ModelQuotaBlockTooltip blocks={[]} locale={locale} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("account-quota-model-block-list")).not.toBeInTheDocument();
  });
});

describe("modelQuotaBlockValidator（经 listAccounts 解码边界验证）", () => {
  function accountPayload(quotaOverrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "acc-1",
      provider: "grok_web",
      authType: "oauth",
      name: "acc-1",
      enabled: true,
      authStatus: "active",
      refreshable: true,
      cloudflareCookieConfigured: false,
      buildSuperEntitled: false,
      buildRouteMode: "auto",
      buildBotFlagged: false,
      refreshFailureCount: 0,
      priority: 1,
      maxConcurrent: 1,
      minimumRemaining: 0,
      failureCount: 0,
      createdAt: "2026-01-01T00:00:00Z",
      quota: { ...quota(), ...quotaOverrides },
    };
  }

  function stubAccountPage(account: Record<string, unknown>): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { items: [account], page: 1, pageSize: 20, total: 1 } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
  }

  it("合法 modelQuotaBlocks 数组通过校验并原样返回", async () => {
    const blocks = [
      block({ cooldownUntil: "2026-03-04T05:06:00Z" }),
      block({ model: "grok-3", reason: "model_access_denied" }),
    ];
    stubAccountPage(accountPayload({ modelQuotaBlocks: blocks }));

    const page = await listAccounts({ page: 1, pageSize: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].quota.modelQuotaBlocks).toEqual(blocks);
  });

  it("modelQuotaBlocks 缺失时通过（可选字段）", async () => {
    stubAccountPage(accountPayload());

    const page = await listAccounts({ page: 1, pageSize: 20 });

    expect(page.items[0].quota.modelQuotaBlocks).toBeUndefined();
  });

  it("条目缺少 model 时被拒绝为 invalidResponse", async () => {
    stubAccountPage(accountPayload({ modelQuotaBlocks: [{ reason: "model_access_denied" }] }));

    const error = await listAccounts({ page: 1, pageSize: 20 }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "invalidResponse" });
  });
});

type WebQuotaWindow = NonNullable<AccountDTO["quotaWindows"]>[number];

function quotaWindow(overrides: Partial<WebQuotaWindow> & Pick<WebQuotaWindow, "mode">): WebQuotaWindow {
  return { remaining: 10, total: 20, usagePercent: 50, windowSeconds: 3_600, source: "upstream", ...overrides };
}

// 以下用例覆盖 account-quota.tsx 中额度单元格的其余分支：既然覆盖率门槛按文件粒度收窄到该文件，
// 就需要让整个文件达标，而不是只覆盖本轮新增的模型级封锁片段。
describe("AccountQuota 付费额度分支", () => {
  it("unit=percent 时按周限百分比展示", () => {
    const { container } = renderWithProviders(
      <AccountQuota
        quota={quota({ type: "paid", unit: "percent", used: 0, limit: 0, remaining: 0, usagePercent: 30 })}
        locale={locale}
      />,
    );

    expect(container).toHaveTextContent(i18n.t("accounts.weeklyQuota"));
    expect(container).toHaveTextContent("30%");
  });

  it("周限与月限同时存在时并排展示两列", () => {
    const { container } = renderWithProviders(
      <AccountQuota
        quota={quota({ type: "paid", used: 250, limit: 1_000, remaining: 750, usagePercent: 25 })}
        billing={{
          monthlyLimit: 1_000,
          used: 250,
          remaining: 750,
          onDemandCap: 0,
          onDemandUsed: 0,
          prepaidBalance: 0,
          creditUsagePercent: 40,
          isUnifiedBillingUser: false,
          usagePeriodType: "USAGE_PERIOD_TYPE_WEEKLY",
          syncedAt: "2026-01-01T00:00:00Z",
        }}
        locale={locale}
      />,
    );

    expect(container).toHaveTextContent(i18n.t("accounts.weeklyQuota"));
    expect(container).toHaveTextContent("40%");
    expect(container).toHaveTextContent(i18n.t("accounts.monthlyQuota"));
    expect(container).toHaveTextContent("250/1,000");
  });
});

describe("ConsoleQuota", () => {
  it("无窗口时显示未同步文案", () => {
    renderWithProviders(<ConsoleQuota windows={[]} locale={locale} />);

    expect(screen.getByText(i18n.t("accounts.quotaNotSynced"))).toBeInTheDocument();
  });

  it("已同步的模式显示用量，缺失的模式显示占位", () => {
    const { container } = renderWithProviders(
      <ConsoleQuota windows={[quotaWindow({ mode: "console", remaining: 5, total: 10 })]} locale={locale} />,
    );

    expect(container).toHaveTextContent("Chat");
    expect(container).toHaveTextContent("5/10");
    expect(screen.getByText("Image").parentElement).toHaveTextContent("-");
    expect(screen.getByText("Video").parentElement).toHaveTextContent("-");
  });
});

describe("WebQuota", () => {
  it("无窗口时显示未同步文案", () => {
    renderWithProviders(<WebQuota windows={[]} locale={locale} />);

    expect(screen.getByText(i18n.t("accounts.quotaNotSynced"))).toBeInTheDocument();
  });

  it("weekly 窗口展示周限百分比与最多三项产品构成", () => {
    const windows = [
      quotaWindow({
        mode: "weekly",
        usagePercent: 42,
        breakdown: [
          { productCode: 9, usagePercent: 1 },
          { productCode: 1, usagePercent: 10 },
          { productCode: 2, usagePercent: 5 },
          { productCode: 4, usagePercent: 3 },
        ],
      }),
    ];
    const { container } = renderWithProviders(<WebQuota windows={windows} locale={locale} />);

    expect(container).toHaveTextContent("42%");
    expect(container).toHaveTextContent(i18n.t("quotaProducts.unknown", { code: 9 }));
    expect(container).toHaveTextContent(i18n.t("quotaProducts.api"));
    expect(container).toHaveTextContent(i18n.t("quotaProducts.build"));
    // 第 4 项被折叠为 "+1"。
    expect(container).toHaveTextContent("+1");
  });

  it("weekly 窗口无产品构成时回退为周限标签与整体进度", () => {
    const { container } = renderWithProviders(
      <WebQuota windows={[quotaWindow({ mode: "weekly", usagePercent: 10 })]} locale={locale} />,
    );

    expect(container).toHaveTextContent(i18n.t("accounts.weeklyQuota"));
    expect(container).toHaveTextContent("10%");
  });

  it("basic tier 且存在 fast 窗口时只展示 Fast 模式", () => {
    const { container } = renderWithProviders(
      <WebQuota windows={[quotaWindow({ mode: "fast", remaining: 2, total: 10 })]} locale={locale} tier="basic" />,
    );

    expect(container).toHaveTextContent("Fast");
    expect(container).toHaveTextContent("8/10");
    expect(container).not.toHaveTextContent("Auto");
  });

  it("无 weekly 时展示四个 Web 模式，缺失模式显示占位", () => {
    const { container } = renderWithProviders(
      <WebQuota windows={[quotaWindow({ mode: "auto", remaining: 3, total: 10 })]} locale={locale} tier="super" />,
    );

    expect(container).toHaveTextContent("Auto");
    expect(container).toHaveTextContent("7/10");
    for (const mode of ["fast", "expert", "heavy"]) {
      expect(screen.getByText(mode).parentElement).toHaveTextContent("-");
    }
  });

  it("imagine 窗口按耗尽 / 有总量 / 无总量三种形态展示", () => {
    const windows = [
      quotaWindow({ mode: "image_pro", remaining: 0, total: 10, usagePercent: 100 }),
      quotaWindow({ mode: "image_edit", remaining: 5, total: 20, usagePercent: 25 }),
      quotaWindow({ mode: "video", remaining: 3, total: 0, usagePercent: 0 }),
    ];
    const { container } = renderWithProviders(<WebQuota windows={windows} locale={locale} />);

    expect(container).toHaveTextContent(i18n.t("accounts.imagineModeImagePro"));
    expect(container).toHaveTextContent(i18n.t("accounts.imagineQuotaExhausted"));
    expect(container).toHaveTextContent(i18n.t("accounts.imagineModeImageEdit"));
    expect(container).toHaveTextContent("5/20");
    expect(container).toHaveTextContent(i18n.t("accounts.imagineModeVideo"));
    expect(container).toHaveTextContent("3/-");
  });
});
