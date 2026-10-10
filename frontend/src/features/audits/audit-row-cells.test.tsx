import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { EgressValue, ResponsePerformance } from "@/features/audits/audit-performance-cell";
import { ModelRouteValue } from "@/features/audits/audit-route-cell";
import { AuditStatus } from "@/features/audits/audit-status-cell";
import { AuditRow } from "@/features/audits/audit-table-row";
import { UsageDetails } from "@/features/audits/audit-usage-cell";
import { auditDTO } from "@/features/audits/audit-test-support";
import { i18n } from "@/shared/i18n";

// 审计表格单元格测试：只渲染组件本身，断言用户可见文本与提示内容，不依赖页面与网络。

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

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("ResponsePerformance", () => {
  it("缺少首字与速度时展示占位符", () => {
    renderCell(<ResponsePerformance audit={auditDTO({ durationMs: 250 })} locale={i18n.language} />);

    expect(cell()).toHaveTextContent(i18n.t("audits.durationMetric"));
    expect(cell()).toHaveTextContent("250 ms");
    expect(cell().textContent?.split("—").length).toBe(3);
  });

  it("有首字与速度时按数值与单位展示", () => {
    renderCell(
      <ResponsePerformance
        audit={auditDTO({ durationMs: 1500, firstTokenMs: 250, outputTokensPerSecond: 12.53 })}
        locale={i18n.language}
      />,
    );

    expect(cell()).toHaveTextContent("1.50 s");
    expect(cell()).toHaveTextContent("250 ms");
    expect(cell()).toHaveTextContent("12.5");
    expect(cell()).toHaveTextContent(i18n.t("audits.tokensPerSecondUnit"));
  });
});

describe("EgressValue", () => {
  it("未记录出口方式时展示短横线", () => {
    renderCell(<EgressValue audit={auditDTO()} />);

    expect(cell()).toHaveTextContent("-");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("直连且无出口细节时提示只展示直连标签", async () => {
    renderCell(<EgressValue audit={auditDTO({ egressMode: "direct" })} />);

    const trigger = screen.getByRole("button", {
      name: `${i18n.t("audits.egressDirect")}: ${i18n.t("audits.egressDirect")}`,
    });
    fireEvent.focus(trigger);

    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getByText(i18n.t("audits.egressDirect"))).toBeInTheDocument();
    expect(tooltip.textContent).not.toContain("·");
  });

  it("代理无节点名时提示展示未命名节点，有节点与范围时展示可复制的细节", async () => {
    const { unmount } = renderCell(<EgressValue audit={auditDTO({ egressMode: "proxy" })} />);
    fireEvent.focus(screen.getByRole("button", { name: new RegExp(i18n.t("audits.egressProxy")) }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(i18n.t("audits.egressUnknown"));
    unmount();

    renderCell(
      <EgressValue
        audit={auditDTO({
          egressMode: "proxy",
          egressNodeName: "出口 A",
          egressScope: "grok_web",
          egressNodeId: "5",
        })}
      />,
    );
    fireEvent.focus(screen.getByRole("button", { name: new RegExp(i18n.t("audits.egressProxy")) }));

    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getByText("出口 A")).toBeInTheDocument();
    expect(within(tooltip).getByText("grok_web · #5")).toBeInTheDocument();
  });
});

describe("AuditStatus", () => {
  it("状态码 0 且无错误码时展示短横线并标记非流式", () => {
    renderCell(<AuditStatus audit={auditDTO({ statusCode: 0, streaming: false })} onOpen={() => {}} />);

    expect(screen.getByTestId("audit-status-audit-1")).toHaveTextContent("-");
    expect(cell()).toHaveTextContent(i18n.t("audits.nonStream"));
  });

  it("状态码 0 且有错误码时展示错误标签（无状态前缀）", () => {
    renderCell(<AuditStatus audit={auditDTO({ statusCode: 0, errorCode: "stream_interrupted" })} onOpen={() => {}} />);

    const status = screen.getByTestId("audit-status-audit-1");
    expect(status).toHaveTextContent(i18n.t("audits.errorLabel"));
    expect(status.textContent).not.toContain("·");
  });

  it("上下文压缩请求展示压缩模式并以错误码作为提示", async () => {
    renderCell(
      <AuditStatus audit={auditDTO({ operation: "compaction", errorCode: "upstream_timeout" })} onOpen={() => {}} />,
    );

    const status = screen.getByTestId("audit-status-audit-1");
    expect(cell()).toHaveTextContent(i18n.t("audits.operations.compaction"));

    fireEvent.focus(status);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("upstream_timeout");
  });

  it("无错误码时提示回退为查看详情，点击触发打开详情", async () => {
    const onOpen = vi.fn();
    renderCell(<AuditStatus audit={auditDTO({ statusCode: 429 })} onOpen={onOpen} />);

    const status = screen.getByTestId("audit-status-audit-1");
    expect(status).toHaveTextContent("429");

    fireEvent.focus(status);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(i18n.t("audits.viewDetails"));

    fireEvent.click(status);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("ModelRouteValue", () => {
  it("悬浮展示渠道、请求与来源明细", async () => {
    renderCell(
      <ModelRouteValue
        model="grok-4"
        upstreamModel="grok-4-0801"
        account="账号 A"
        clientKey="生产密钥"
        clientIp="10.0.0.9"
        requestId="req-42"
        provider="grok_build"
        operation="responses"
        sources={3}
      />,
    );

    fireEvent.focus(screen.getByRole("button", { name: i18n.t("audits.routeDetails") }));

    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getByText("req-42")).toBeInTheDocument();
    expect(within(tooltip).getByText("10.0.0.9")).toBeInTheDocument();
    expect(within(tooltip).getByText("账号 A")).toBeInTheDocument();
    expect(within(tooltip).getByText("生产密钥")).toBeInTheDocument();
    expect(within(tooltip).getByText("3")).toBeInTheDocument();
  });

  it("缺少客户端 IP 与来源时提示不展示对应行", async () => {
    renderCell(
      <ModelRouteValue
        model="grok-4"
        upstreamModel="grok-4-0801"
        account="账号 A"
        clientKey="生产密钥"
        requestId="req-42"
        provider="grok_web"
        operation="chat"
        sources={0}
      />,
    );

    const trigger = screen.getByRole("button", { name: i18n.t("audits.routeDetails") });
    expect(trigger).toHaveTextContent("grok-4");
    fireEvent.focus(trigger);

    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).queryByText(i18n.t("audits.clientIp"))).not.toBeInTheDocument();
    expect(within(tooltip).queryByText(i18n.t("audits.sourcesLabel"))).not.toBeInTheDocument();
  });
});

describe("UsageDetails", () => {
  it("压缩请求展示上游未返回用量", () => {
    renderCell(<UsageDetails audit={auditDTO({ operation: "compaction", totalTokens: 0 })} locale={i18n.language} />);

    expect(cell()).toHaveTextContent(i18n.t("audits.operations.compaction"));
    expect(cell()).toHaveTextContent(i18n.t("audits.compactionUsageUnavailable"));
  });

  it("语音类请求按秒展示耗时", () => {
    renderCell(<UsageDetails audit={auditDTO({ operation: "tts", durationMs: 2500 })} locale={i18n.language} />);

    expect(cell()).toHaveTextContent(i18n.t("audits.operations.tts"));
    expect(cell()).toHaveTextContent("2.50s");
  });

  it("视频请求展示媒体张数与秒数且不展示 Token 明细", () => {
    renderCell(
      <UsageDetails
        audit={auditDTO({
          operation: "video",
          usageSource: "none",
          mediaInputImages: 2,
          mediaOutputSeconds: 8,
        })}
        locale={i18n.language}
      />,
    );

    expect(cell()).toHaveTextContent(i18n.t("audits.mediaInput"));
    expect(cell()).toHaveTextContent(i18n.t("audits.imageCount", { count: 2 }));
    expect(cell()).toHaveTextContent(i18n.t("audits.secondsCount", { count: 8 }));
    expect(cell()).not.toHaveTextContent(i18n.t("audits.cached"));
  });

  it("推理强度进入推理项标签", () => {
    renderCell(
      <UsageDetails audit={auditDTO({ reasoningEffort: "high", reasoningTokens: 12 })} locale={i18n.language} />,
    );

    expect(
      screen.getByTitle(`${i18n.t("audits.reasoning")} · ${i18n.t("audits.reasoningEfforts.high")}`),
    ).toBeInTheDocument();
    expect(cell()).toHaveTextContent("12");
  });
});

describe("AuditRow", () => {
  it("模型、账号与密钥缺失时回退为 ID 或短横线", async () => {
    renderCell(
      <AuditRow
        audit={auditDTO({
          modelPublicId: undefined,
          modelUpstreamModel: undefined,
          clientKeyName: undefined,
          accountName: undefined,
          accountId: undefined,
          egressMode: "direct",
        })}
        locale={i18n.language}
        onOpen={() => {}}
      />,
    );

    const row = screen.getByTestId("audit-row-audit-1");
    expect(within(row).getByText("#route-1")).toBeInTheDocument();
    expect(within(row).getByText("-")).toBeInTheDocument();
    expect(within(row).getByRole("time")).toHaveAttribute("datetime", "2026-10-01T10:00:00.000Z");

    fireEvent.focus(within(row).getByRole("button", { name: i18n.t("audits.routeDetails") }));
    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getAllByText("-").length).toBeGreaterThan(0);
    expect(within(tooltip).getByText("#key-1")).toBeInTheDocument();
  });

  it("仅有账号 ID 时提示展示带井号的账号，点击状态列回传该请求", async () => {
    const onOpen = vi.fn();
    renderCell(
      <AuditRow
        audit={auditDTO({
          accountName: undefined,
          accountId: "account-7",
          egressMode: "proxy",
          egressNodeName: "出口 A",
        })}
        locale={i18n.language}
        onOpen={onOpen}
      />,
    );

    fireEvent.focus(screen.getByRole("button", { name: i18n.t("audits.routeDetails") }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("#account-7");

    fireEvent.click(screen.getByTestId("audit-status-audit-1"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "audit-1", accountId: "account-7" }));
  });
});
