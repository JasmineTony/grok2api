import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { BillingValue } from "@/features/audits/audit-billing-cell";
import { auditDTO } from "@/features/audits/audit-test-support";
import type { AuditBillingBreakdownDTO } from "@/features/audits/request-audits-api";
import { i18n } from "@/shared/i18n";
import { USD_TICKS_PER_DOLLAR } from "@/shared/lib/usd";

function renderBilling(billing?: AuditBillingBreakdownDTO) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={0}>
        <BillingValue audit={auditDTO({ billing })} />
      </TooltipProvider>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("BillingValue", () => {
  it("无计费明细且无已存定价时展示未计费文案", () => {
    renderBilling(undefined);

    expect(screen.getByText(i18n.t("audits.unbilled"))).toBeInTheDocument();
  });

  it("展示金额并在聚焦时展开计费来源、公式与结论", async () => {
    renderBilling({
      source: "official",
      method: "official_rates",
      model: "grok-4",
      version: "2026-01",
      tier: "long_context",
      components: [
        {
          kind: "uncached_input",
          unit: "token",
          quantity: 1200,
          unitPriceInUsdTicks: 1,
          subtotalInUsdTicks: 12,
        },
        {
          kind: "output_image",
          unit: "image",
          quantity: 3,
          unitPriceInUsdTicks: 4 * USD_TICKS_PER_DOLLAR,
          subtotalInUsdTicks: 12 * USD_TICKS_PER_DOLLAR,
        },
      ],
      totalInUsdTicks: 12 * USD_TICKS_PER_DOLLAR,
    });

    expect(screen.getByText("$12.00")).toBeInTheDocument();
    fireEvent.focus(screen.getByText("$12.00"));

    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getByText(i18n.t("audits.billingSourceOfficial"))).toBeInTheDocument();
    expect(within(tooltip).getByText("grok-4")).toBeInTheDocument();
    expect(within(tooltip).getByText(i18n.t("audits.billingLongContextTier"))).toBeInTheDocument();
    expect(within(tooltip).getByText(i18n.t("audits.billingComponents.uncached_input"))).toBeInTheDocument();
    expect(within(tooltip).getByText(/1,200 \/ 1M × \$0\.0001 = \$0\.0000000012/)).toBeInTheDocument();
    expect(within(tooltip).getByText(/3 × \$4 \/ image = \$12\.0000000000/)).toBeInTheDocument();
    expect(within(tooltip).getByText("$12.0000000000")).toBeInTheDocument();
  });

  it("上游回报成本展示上游公式并追加服务端工具计数", async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={0}>
          <BillingValue
            audit={auditDTO({
              numServerSideToolsUsed: 2,
              billing: {
                source: "upstream",
                method: "upstream_reported",
                components: [],
                totalInUsdTicks: USD_TICKS_PER_DOLLAR,
              },
            })}
          />
        </TooltipProvider>
      </I18nextProvider>,
    );

    expect(screen.getByText(i18n.t("audits.serverTools", { count: 2 }))).toBeInTheDocument();
    fireEvent.focus(screen.getByText("$1.00"));

    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getByText(i18n.t("audits.billingSourceUpstream"))).toBeInTheDocument();
    expect(within(tooltip).getByText(i18n.t("audits.billingUpstreamFormula"))).toBeInTheDocument();
  });

  it("已存估算明细展示不可用公式说明", async () => {
    renderBilling({
      source: "official",
      method: "stored_estimate",
      model: "grok-4",
      components: [],
      totalInUsdTicks: 0,
    });

    fireEvent.focus(screen.getByText("$0.00"));

    const tooltip = await screen.findByRole("tooltip");
    await waitFor(() =>
      expect(within(tooltip).getByText(i18n.t("audits.billingStoredFormulaUnavailable"))).toBeInTheDocument(),
    );
  });

  it("按上游成本字段回退生成计费金额", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={0}>
          <BillingValue audit={auditDTO({ costInUsdTicks: 2 * USD_TICKS_PER_DOLLAR })} />
        </TooltipProvider>
      </I18nextProvider>,
    );

    expect(screen.getByText("$2.00")).toBeInTheDocument();
  });
});
