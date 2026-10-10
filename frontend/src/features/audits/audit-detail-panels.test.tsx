import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AttemptDetail } from "@/features/audits/audit-attempt-detail";
import { UpstreamAttemptsPanel } from "@/features/audits/audit-attempts-panel";
import { CodePanel, EmptyPanel, HeadersPanel, OverviewField, StatusBadge } from "@/features/audits/audit-detail-common";
import { auditAttemptDTO, auditDTO } from "@/features/audits/audit-test-support";
import { i18n } from "@/shared/i18n";

// 审计详情面板测试：直接渲染导出的面板组件，断言用户可见文本与标签页可见性。

function renderPanel(ui: ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={0}>
        <div data-testid="panel">{ui}</div>
      </TooltipProvider>
    </I18nextProvider>,
  );
}

function panel(): HTMLElement {
  return screen.getByTestId("panel");
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("audit-detail-common 组合件", () => {
  it("CodePanel 无内容时展示空态，裁剪时展示裁剪标记与编码", () => {
    const { unmount } = renderPanel(
      <CodePanel value="" displayValue="" emptyMessage="没有响应 Body" encoding="utf8" truncated={false} />,
    );
    expect(panel()).toHaveTextContent("没有响应 Body");
    expect(screen.queryByText(i18n.t("audits.bodyTruncated"))).not.toBeInTheDocument();
    unmount();

    renderPanel(
      <CodePanel value='{"a":1}' displayValue='{"a": 1}' emptyMessage="没有响应 Body" encoding="utf8" truncated />,
    );
    expect(panel()).toHaveTextContent('{"a": 1}');
    expect(panel()).toHaveTextContent(i18n.t("audits.bodyEncoding", { encoding: "utf8" }));
    expect(panel()).toHaveTextContent(i18n.t("audits.bodyTruncated"));
    expect(within(panel()).getByRole("button", { name: i18n.t("common.copy") })).toBeInTheDocument();
  });

  it("HeadersPanel 无 Headers 时按传入或默认文案展示空态，有 Headers 时按名称排序计数", () => {
    const { unmount } = renderPanel(<HeadersPanel headers={{}} emptyMessage={i18n.t("audits.noRequestHeaders")} />);
    expect(panel()).toHaveTextContent(i18n.t("audits.noRequestHeaders"));
    unmount();

    const { unmount: unmountDefault } = renderPanel(<HeadersPanel headers={{}} />);
    expect(panel()).toHaveTextContent(i18n.t("audits.emptyResponseHeaders"));
    unmountDefault();

    const { unmount: unmountTitled } = renderPanel(
      <HeadersPanel
        title={i18n.t("audits.responseHeaders")}
        headers={{ "x-request-id": ["abc"], accept: ["application/json"] }}
      />,
    );
    expect(panel()).toHaveTextContent(i18n.t("audits.headerItemCount", { count: 2 }));
    expect(panel()).toHaveTextContent(i18n.t("audits.responseHeaders"));
    const names = screen.getAllByText(/^(accept|x-request-id)$/).map((node) => node.textContent);
    expect(names).toEqual(["accept", "x-request-id"]);
    unmountTitled();

    // 标题可选：省略时不渲染标题，仍展示条目计数。
    renderPanel(<HeadersPanel headers={{ "x-trace": ["1"] }} />);
    expect(panel()).toHaveTextContent(i18n.t("audits.headerItemCount", { count: 1 }));
    expect(panel()).not.toHaveTextContent(i18n.t("audits.responseHeaders"));
  });

  it("OverviewField 仅在需要复制时渲染复制按钮，StatusBadge 展示状态码", () => {
    const { unmount } = renderPanel(<OverviewField label="请求 ID" value="req-1" />);
    expect(panel()).toHaveTextContent("req-1");
    expect(within(panel()).queryByRole("button")).not.toBeInTheDocument();
    unmount();

    renderPanel(
      <>
        <OverviewField label="上游 URL" value="https://upstream.example/v1" copy />
        <StatusBadge statusCode={502} failed />
        <EmptyPanel icon={null} message="无错误链" />
      </>,
    );
    expect(within(panel()).getByRole("button", { name: i18n.t("common.copy") })).toBeInTheDocument();
    expect(panel()).toHaveTextContent("502");
    expect(panel()).toHaveTextContent("无错误链");
  });
});

describe("AttemptDetail 概览回退", () => {
  it("凭据错误且缺少可选字段时展示占位符且不渲染正文/Headers/错误链标签页", () => {
    renderPanel(
      <AttemptDetail
        attempt={auditAttemptDTO({
          source: "credential",
          stage: "credential_load",
          accountName: undefined,
          accountId: undefined,
          method: undefined,
          requestPath: undefined,
          upstreamUrl: undefined,
          upstreamStatus: undefined,
          upstreamStatusCode: undefined,
          responseHeaders: {},
          responseBody: "",
          errorChain: [],
          transportError: "凭据解析失败",
        })}
      />,
    );

    expect(panel()).toHaveTextContent(i18n.t("audits.credentialFailure"));
    expect(panel()).toHaveTextContent(i18n.t("audits.upstreamUrlUnavailable"));
    expect(panel()).toHaveTextContent(i18n.t("audits.attemptError"));
    expect(panel()).toHaveTextContent("凭据解析失败");
    expect(panel().textContent?.match(/-/g)?.length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByRole("tab", { name: i18n.t("audits.responseBody") })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: i18n.t("audits.responseHeaders") })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: i18n.t("audits.errorChain") })).not.toBeInTheDocument();
  });

  it("流式失败缺少状态码时标题与上游状态回退为短横线", async () => {
    renderPanel(
      <AttemptDetail
        attempt={auditAttemptDTO({
          stage: "response_stream",
          upstreamStatusCode: undefined,
          upstreamStatus: "",
          errorChain: [{ type: "stream_reset", message: "流被重置" }],
        })}
      />,
    );

    expect(panel()).toHaveTextContent(i18n.t("audits.upstreamStreamFailure", { status: "-" }));
    expect(await screen.findByRole("tab", { name: i18n.t("audits.errorChain") })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: i18n.t("audits.errorChain") }));
    expect(await screen.findByText("流被重置")).toBeInTheDocument();
    expect(panel()).toHaveTextContent(i18n.t("audits.errorFrameCount", { count: 1 }));
  });

  it("上游 HTTP 失败使用状态码回退并展示 Headers", async () => {
    renderPanel(
      <AttemptDetail
        attempt={auditAttemptDTO({
          stage: "connect",
          upstreamStatus: "",
          upstreamStatusCode: 500,
          responseBody: "",
          responseHeaders: { "x-request-id": ["abc"] },
          errorChain: [],
        })}
      />,
    );

    expect(panel()).toHaveTextContent(i18n.t("audits.upstreamHttpFailure", { status: "500" }));
    expect(panel()).toHaveTextContent("500");
    expect(screen.queryByRole("tab", { name: i18n.t("audits.responseBody") })).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: i18n.t("audits.responseHeaders") }));
    expect(await screen.findByText("x-request-id")).toBeInTheDocument();
  });

  it("非流式上游失败缺少状态码与账号名时回退为短横线与账号 ID", () => {
    renderPanel(
      <AttemptDetail
        attempt={auditAttemptDTO({
          source: "upstream_http",
          stage: "connect",
          upstreamStatusCode: undefined,
          upstreamStatus: "connection reset",
          accountName: undefined,
          accountId: "account-5",
        })}
      />,
    );

    expect(panel()).toHaveTextContent(i18n.t("audits.upstreamHttpFailure", { status: "-" }));
    expect(panel()).toHaveTextContent("connection reset");
    expect(panel()).toHaveTextContent("#account-5");
    expect(panel()).toHaveTextContent(i18n.t("audits.requestPath"));
  });
});

describe("UpstreamAttemptsPanel", () => {
  it("失败但没有错误码时展示无失败尝试诊断且不展示错误码徽标", () => {
    renderPanel(<UpstreamAttemptsPanel audit={auditDTO({ statusCode: 500, errorCode: undefined })} attempts={[]} />);

    expect(panel()).toHaveTextContent(i18n.t("audits.noFailureAttempts"));
    expect(panel()).not.toHaveTextContent(i18n.t("audits.noUpstreamAttempt"));
  });

  it("尝试缺少上游状态码时展示占位符，最后一条回退到请求状态码并可切换", async () => {
    renderPanel(
      <UpstreamAttemptsPanel
        audit={auditDTO({ statusCode: 503, errorCode: "upstream_unavailable" })}
        attempts={[
          auditAttemptDTO({
            id: "attempt-1",
            number: 1,
            source: "credential",
            stage: "credential_refresh",
            upstreamStatusCode: undefined,
            responseBody: "",
            responseHeaders: {},
            errorChain: [],
          }),
          auditAttemptDTO({ id: "attempt-2", number: 2, upstreamStatusCode: undefined, errorChain: [] }),
        ]}
      />,
    );

    const first = screen.getByRole("button", { name: new RegExp(i18n.t("audits.attemptNumber", { number: 1 })) });
    const second = screen.getByRole("button", { name: new RegExp(i18n.t("audits.attemptNumber", { number: 2 })) });
    expect(first).toHaveTextContent("—");
    expect(second).toHaveTextContent("503");
    // 默认选中第一条尝试；末尾尝试的上游状态码回退到请求状态码。
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(panel()).toHaveTextContent(i18n.t("audits.upstreamStreamFailure", { status: "-" }));

    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(panel()).toHaveTextContent(i18n.t("audits.credentialFailure"));
  });

  it("成功但无尝试时展示成功空态", () => {
    renderPanel(<UpstreamAttemptsPanel audit={auditDTO({ statusCode: 200 })} attempts={[]} />);

    expect(panel()).toHaveTextContent(i18n.t("audits.successNoAttempts"));
  });
});
