import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { EgressErrorTooltip } from "@/features/settings/egress-error-tooltip";
import { ClearanceBadge, HealthMeter, ProbeSummary } from "@/features/settings/egress-node-indicators";
import { egressNodeWire } from "@/features/settings/egress-test-support";
import type { EgressNodeDTO } from "@/features/settings/settings-api";
import { i18n } from "@/shared/i18n";

// 出口状态指示器与悬浮错误说明的渲染测试：只断言真实 DOM 输出，
// 覆盖清关方式、健康度与 IPv4/IPv6 探测的各状态分支。
function egressNodeDto(overrides: Record<string, unknown> = {}): EgressNodeDTO {
  return egressNodeWire({ scope: "grok_web", ...overrides }) as unknown as EgressNodeDTO;
}

function renderIndicator(node: ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={0}>{node}</TooltipProvider>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EgressErrorTooltip", () => {
  it("默认只渲染图标，聚焦后展示错误文案", async () => {
    renderIndicator(<EgressErrorTooltip message="连接被拒绝" />);

    const trigger = screen.getByLabelText("连接被拒绝");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.focus(trigger);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("连接被拒绝");
  });
});

describe("ClearanceBadge 清关方式", () => {
  it("build 作用域展示占位符，不展示清关徽标", () => {
    renderIndicator(<ClearanceBadge node={egressNodeDto({ scope: "grok_build" })} clearanceMode="flaresolverr" />);

    expect(screen.getByTestId("egress-node-clearance-node-1")).toHaveTextContent("—");
  });

  it("账号绑定代理在 flaresolverr 下追加 Resin 标记", () => {
    renderIndicator(<ClearanceBadge node={egressNodeDto({ accountBoundProxy: true })} clearanceMode="flaresolverr" />);

    expect(screen.getByTestId("egress-node-clearance-node-1")).toHaveTextContent(
      `${i18n.t("settings.web.clearanceFlareSolverr")} · Resin`,
    );
  });

  it("on_demand 未绑定代理时只展示清关文案", () => {
    renderIndicator(<ClearanceBadge node={egressNodeDto()} clearanceMode="on_demand" />);

    expect(screen.getByTestId("egress-node-clearance-node-1")).toHaveTextContent(
      i18n.t("settings.web.clearanceOnDemand"),
    );
  });

  it("manual 清关方式按 Cookie 是否配置区分文案与徽标样式", () => {
    const configured = renderIndicator(
      <ClearanceBadge node={egressNodeDto({ cookieConfigured: true })} clearanceMode="manual" />,
    );
    expect(screen.getByTestId("egress-node-clearance-node-1")).toHaveTextContent(i18n.t("settings.egress.configured"));
    expect(screen.getByTestId("egress-node-clearance-node-1").className).toContain("bg-secondary/70");
    configured.unmount();

    renderIndicator(<ClearanceBadge node={egressNodeDto({ cookieConfigured: false })} clearanceMode="manual" />);
    expect(screen.getByTestId("egress-node-clearance-node-1")).toHaveTextContent(i18n.t("settings.egress.none"));
    expect(screen.getByTestId("egress-node-clearance-node-1").className).toContain("border-border");
  });
});

describe("HealthMeter 健康度", () => {
  it.each([
    [0.82, "82%"],
    [0.2, "20%"],
    [1.4, "100%"],
    [-1, "0%"],
  ])("取值 %s 渲染为 %s", (value, expected) => {
    const view = renderIndicator(<HealthMeter nodeId="node-1" value={value} />);
    expect(screen.getByTestId("egress-node-health-node-1")).toHaveTextContent(expected);
    view.unmount();
  });
});

describe("ProbeSummary 探测结果", () => {
  it("健康探测展示出口 IP，未探测展示未测试文案", () => {
    renderIndicator(
      <ProbeSummary
        node={egressNodeDto({
          ipv4Probe: { status: "healthy", latencyMs: 12, exitIp: "203.0.113.9" },
          ipv6Probe: { status: "unknown", latencyMs: 0 },
        })}
      />,
    );

    const ipv4 = screen.getByTestId("egress-node-probe-node-1-ipv4");
    expect(ipv4).toHaveTextContent("203.0.113.9");
    expect(within(ipv4).getByTitle("203.0.113.9")).toBeInTheDocument();
    expect(screen.getByTestId("egress-node-probe-node-1-ipv6")).toHaveTextContent(i18n.t("settings.egress.notTested"));
  });

  it("健康但缺少出口 IP 时回落到健康文案", () => {
    renderIndicator(
      <ProbeSummary
        node={egressNodeDto({
          ipv4Probe: { status: "healthy", latencyMs: 5 },
          ipv6Probe: { status: "unknown", latencyMs: 0 },
        })}
      />,
    );

    expect(screen.getByTestId("egress-node-probe-node-1-ipv4")).toHaveTextContent(i18n.t("settings.egress.healthy"));
  });

  it("探测失败展示失败文案与悬浮错误说明", async () => {
    renderIndicator(
      <ProbeSummary
        node={egressNodeDto({
          ipv4Probe: { status: "unknown", latencyMs: 0 },
          ipv6Probe: { status: "unhealthy", latencyMs: 0, error: "IPv6 不可达" },
        })}
      />,
    );

    const ipv6 = screen.getByTestId("egress-node-probe-node-1-ipv6");
    expect(ipv6).toHaveTextContent(i18n.t("settings.egress.unhealthy"));

    // 悬浮说明触发元素与探测状态元素是同级节点（egress-node-indicators.tsx:94-107），需按探测块作用域查询
    fireEvent.focus(within(screen.getByTestId("egress-node-probe-node-1")).getByLabelText("IPv6 不可达"));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("IPv6 不可达");
  });

  it("探测成功时悬浮展示延迟", async () => {
    renderIndicator(
      <ProbeSummary
        node={egressNodeDto({
          ipv4Probe: { status: "healthy", latencyMs: 33, exitIp: "198.51.100.1" },
          ipv6Probe: { status: "unknown", latencyMs: 0 },
        })}
      />,
    );

    fireEvent.focus(within(screen.getByTestId("egress-node-probe-node-1-ipv4")).getByText("198.51.100.1"));

    await waitFor(() =>
      expect(screen.getByRole("tooltip")).toHaveTextContent(i18n.t("settings.egress.probeLatency", { latency: 33 })),
    );
  });
});
