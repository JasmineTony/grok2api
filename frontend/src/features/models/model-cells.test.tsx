import type { TFunction } from "i18next";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { ModelRouteDTO } from "@/entities/model/types";
import {
  ModelAccountSupportCell,
  ModelCapabilities,
  ModelEnabledStateBadge,
  ModelProvider,
} from "@/features/models/model-cells";
import { newModelRouteGroup, type ModelRouteGroup } from "@/features/models/model-display";
import { modelGroup, modelRoute } from "@/features/models/models-test-support";
import { i18n } from "@/shared/i18n";

// model-cells 是 props 驱动的展示组件：用真实 modelRouteGroupDTO 生成展示模型，
// 逐项断言 EnabledBadge 三态、Provider 三来源、账号支持单元格三种绑定状态与能力图标。

// 与被测函数声明的 TFunction 契约一致（同 dashboard-*-format.test.ts 的既有做法）。
const t = ((key: string, options?: Record<string, unknown>) => i18n.t(key, options)) as unknown as TFunction;

function renderCell(node: React.ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={0}>{node}</TooltipProvider>
    </I18nextProvider>,
  );
}

function groupOf(routes: ModelRouteDTO[]): ModelRouteGroup {
  return newModelRouteGroup(modelGroup({ routes }), t);
}

describe("ModelEnabledStateBadge", () => {
  it("enabled 展示已启用样式", () => {
    renderCell(<ModelEnabledStateBadge state="enabled" />);

    const badge = screen.getByText(t("common.enabled"));
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("bg-emerald-500/10");
  });

  it("disabled 展示已停用样式", () => {
    renderCell(<ModelEnabledStateBadge state="disabled" />);

    const badge = screen.getByText(t("common.disabled"));
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("text-muted-foreground");
  });

  it("mixed 展示部分启用样式", () => {
    renderCell(<ModelEnabledStateBadge state="mixed" />);

    const badge = screen.getByText(t("models.partiallyEnabled"));
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("text-amber-700");
  });
});

describe("ModelProvider", () => {
  it("三个来源分别展示文案与色点", () => {
    const { unmount } = renderCell(<ModelProvider provider="grok_web" />);
    expect(screen.getByText(t("models.providerGrokWeb"))).toBeInTheDocument();
    expect(document.querySelector(".bg-quota-product-2")).not.toBeNull();
    unmount();

    renderCell(<ModelProvider provider="grok_console" />);
    expect(screen.getByText(t("console.name"))).toBeInTheDocument();
    expect(document.querySelector(".bg-quota-product-4")).not.toBeNull();
  });

  it("grok_build 使用默认色点", () => {
    renderCell(<ModelProvider provider="grok_build" />);

    expect(screen.getByText(t("models.providerGrokBuild"))).toBeInTheDocument();
    expect(document.querySelector(".bg-quota-product-1")).not.toBeNull();
  });
});

describe("ModelCapabilities", () => {
  it("按能力渲染可聚焦图标，并通过 aria-label 暴露能力名", () => {
    renderCell(<ModelCapabilities capabilities={["responses", "tts"]} />);

    const conversation = screen.getByRole("img", { name: t("models.capabilityResponses") });
    expect(conversation).toHaveAttribute("tabindex", "0");
    expect(conversation).toHaveClass("cursor-help");
    expect(screen.getByRole("img", { name: t("models.capabilityTTS") })).toBeInTheDocument();
  });

  it("空能力列表不渲染任何图标", () => {
    renderCell(<ModelCapabilities capabilities={[]} />);

    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});

describe("ModelAccountSupportCell", () => {
  it("有可用账号时数字用高亮色并展示绑定状态", () => {
    renderCell(<ModelAccountSupportCell model={groupOf([modelRoute({ bindingMode: true })])} />);

    const supported = screen.getByText("3");
    expect(supported).toHaveClass("text-emerald-600");
    expect(screen.getByText(t("models.boundAccounts"))).toBeInTheDocument();
  });

  it("自动绑定且账号数为 0 时使用弱化色并展示自动绑定文案", () => {
    renderCell(
      <ModelAccountSupportCell
        model={groupOf([modelRoute({ supportedAccounts: 0, totalAccounts: 0, bindingMode: false })])}
      />,
    );

    const supported = screen.getByText("0");
    expect(supported).toHaveClass("text-muted-foreground");
    expect(screen.getByText(t("models.automaticAccounts"))).toBeInTheDocument();
  });

  it("混合绑定状态展示混合文案，并把支持说明写入 title", () => {
    const model = groupOf([modelRoute({ bindingMode: true }), modelRoute({ id: "route-2", bindingMode: false })]);
    const { container } = renderCell(<ModelAccountSupportCell model={model} />);

    expect(screen.getByText(t("models.mixedAccounts"))).toBeInTheDocument();
    // Radix/TL 的 getByTitle 会归一化空白，而支持说明是多行文本，这里直接比对原始属性。
    expect(container.querySelector("[title]")?.getAttribute("title")).toBe(model.supportTitle);
  });
});
