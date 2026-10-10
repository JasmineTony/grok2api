import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { RequestAuditDetailDialog } from "@/features/audits/request-audit-detail-dialog";
import { auditAttemptDTO, auditDTO, createFakeApi, ResizeObserverStub } from "@/features/audits/audit-test-support";
import type { AuditAttemptDTO, AuditDTO } from "@/features/audits/request-audits-api";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";
import { formatDateTime } from "@/shared/lib/format";

// 详情弹窗集成测试（AGENTS.md TEST-3）：只替换 apiRequest，面板/标签页/状态流保持真实实现。
const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

function installDetail(audit: AuditDTO, attempts: AuditAttemptDTO[]): void {
  apiMock.request.mockImplementation(
    createFakeApi((call) => {
      if (/^\/api\/admin\/v1\/request-audits\/[^/]+$/.test(call.path)) return { audit, attempts };
      throw new ApiError(500, "unexpectedRequest", `未注册的请求：${call.method} ${call.path}`);
    }),
  );
}

function renderDialog(audit: AuditDTO) {
  const onOpenChange = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={0}>
          <RequestAuditDetailDialog audit={audit} open onOpenChange={onOpenChange} />
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

const user = () => userEvent.setup();

beforeEach(async () => {
  apiMock.request.mockReset();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RequestAuditDetailDialog 概览", () => {
  it("加载详情后展示请求概览、用量与费用字段", async () => {
    installDetail(
      auditDTO({
        accountName: "账号 A",
        modelPublicId: "grok-4",
        modelUpstreamModel: "grok-4-0801",
        requestId: "req-42",
        clientIp: "10.0.0.9",
        operation: "chat",
        errorCode: "upstream_unavailable",
        mediaInputImages: 2,
      }),
      [],
    );

    renderDialog(auditDTO({ id: "audit-1" }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("账号 A")).toBeInTheDocument();
    expect(within(dialog).getByText("req-42")).toBeInTheDocument();
    expect(within(dialog).getByText("grok-4-0801")).toBeInTheDocument();
    expect(within(dialog).getByText("upstream_unavailable")).toBeInTheDocument();
    expect(
      within(dialog).getByText(i18n.t("audits.mediaInput") + ": " + i18n.t("audits.imageCount", { count: 2 })),
    ).toBeInTheDocument();
  });

  it("详情失败时展示可重试的错误信息", async () => {
    apiMock.request.mockImplementation(
      createFakeApi(() => {
        throw new ApiError(503, "unavailable", "审计详情暂不可用");
      }),
    );

    renderDialog(auditDTO({ id: "audit-1" }));

    expect(await screen.findByText("审计详情暂不可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("common.retry") })).toBeInTheDocument();
  });
});

describe("RequestAuditDetailDialog 请求元数据与上游尝试", () => {
  it("请求元数据标签页展示路径、方法并支持无元数据空态", async () => {
    installDetail(
      auditDTO({
        requestMethod: "POST",
        requestPath: "/v1/responses",
        requestHeaders: { accept: ["application/json"] },
      }),
      [],
    );

    renderDialog(auditDTO({ id: "audit-1" }));

    const dialog = await screen.findByRole("dialog");
    await user().click(within(dialog).getByRole("tab", { name: i18n.t("audits.requestMetadata") }));

    expect(await within(dialog).findByText("/v1/responses")).toBeInTheDocument();
    expect(within(dialog).getByText("POST")).toBeInTheDocument();
    expect(within(dialog).getByText(i18n.t("audits.requestHeaders"))).toBeInTheDocument();
    expect(within(dialog).getByText("accept")).toBeInTheDocument();
  });

  it("无请求元数据时展示空态文案", async () => {
    installDetail(auditDTO({ requestMethod: undefined, requestPath: undefined, requestHeaders: undefined }), []);

    renderDialog(auditDTO({ id: "audit-1" }));

    const dialog = await screen.findByRole("dialog");
    await user().click(within(dialog).getByRole("tab", { name: i18n.t("audits.requestMetadata") }));

    expect(await within(dialog).findByText(i18n.t("audits.noRequestMetadata"))).toBeInTheDocument();
  });

  it("成功且无尝试时展示成功空态", async () => {
    installDetail(auditDTO({ statusCode: 200, errorCode: undefined }), []);

    renderDialog(auditDTO({ id: "audit-1" }));

    const dialog = await screen.findByRole("dialog");
    await user().click(within(dialog).getByRole("tab", { name: new RegExp(i18n.t("audits.upstreamDiagnostics")) }));

    expect(await within(dialog).findByText(i18n.t("audits.successNoAttempts"))).toBeInTheDocument();
  });

  it("失败且为上游不可用错误码时展示未发起上游请求文案与错误码", async () => {
    installDetail(auditDTO({ statusCode: 503, errorCode: "upstream_unavailable" }), []);

    renderDialog(auditDTO({ id: "audit-1" }));

    const dialog = await screen.findByRole("dialog");
    await user().click(within(dialog).getByRole("tab", { name: new RegExp(i18n.t("audits.upstreamDiagnostics")) }));

    expect(await within(dialog).findByText(i18n.t("audits.noUpstreamAttempt"))).toBeInTheDocument();
    expect(within(dialog).getByText("upstream_unavailable")).toBeInTheDocument();
  });
});

describe("RequestAuditDetailDialog 尝试明细", () => {
  it("尝试时间线可切换并展示响应体、响应头与错误链", async () => {
    installDetail(auditDTO({ statusCode: 502, errorCode: "upstream_stream_failure" }), [
      auditAttemptDTO({ id: "a-1", number: 1, stage: "response_stream" }),
      auditAttemptDTO({
        id: "a-2",
        number: 2,
        upstreamStatusCode: 502,
        responseHeaders: { "content-type": ["application/json"], "x-request-id": ["[REDACTED]"] },
        errorChain: [{ type: "upstream_error", message: "连接被上游重置" }],
      }),
    ]);

    renderDialog(auditDTO({ id: "audit-1" }));

    const dialog = await screen.findByRole("dialog");
    await user().click(within(dialog).getByRole("tab", { name: new RegExp(i18n.t("audits.upstreamDiagnostics")) }));

    const u = user();
    await u.click(
      await within(dialog).findByRole("button", {
        name: new RegExp(i18n.t("audits.attemptNumber", { number: 2 })),
      }),
    );

    await u.click(within(dialog).getByRole("tab", { name: i18n.t("audits.responseBody") }));
    expect(await within(dialog).findByText(/"error": "boom"/)).toBeInTheDocument();

    await u.click(within(dialog).getByRole("tab", { name: i18n.t("audits.responseHeaders") }));
    expect(await within(dialog).findByText("x-request-id")).toBeInTheDocument();
    expect(within(dialog).getByText("[REDACTED]")).toBeInTheDocument();

    await u.click(within(dialog).getByRole("tab", { name: i18n.t("audits.errorChain") }));
    expect(await within(dialog).findByText("连接被上游重置")).toBeInTheDocument();
  });

  it("概览标签页展示尝试的 URL、耗时与传输错误", async () => {
    installDetail(auditDTO({ statusCode: 502 }), [
      auditAttemptDTO({
        source: "gateway_transport",
        stage: "connect",
        upstreamUrl: undefined,
        transportError: "dial tcp: connection refused",
        durationMs: 250,
      }),
    ]);

    renderDialog(auditDTO({ id: "audit-1" }));

    const dialog = await screen.findByRole("dialog");
    await user().click(within(dialog).getByRole("tab", { name: new RegExp(i18n.t("audits.upstreamDiagnostics")) }));

    expect(await within(dialog).findByText(i18n.t("audits.upstreamUrlUnavailable"))).toBeInTheDocument();
    expect(within(dialog).getByText("dial tcp: connection refused")).toBeInTheDocument();
    expect(within(dialog).getByText("250 ms")).toBeInTheDocument();
    expect(within(dialog).getByText(i18n.t("audits.gatewayTransportFailure"))).toBeInTheDocument();
  });

  it("关闭弹窗时回传 false", async () => {
    installDetail(auditDTO({ id: "audit-1" }), []);
    const { onOpenChange } = renderDialog(auditDTO({ id: "audit-1" }));

    const dialog = await screen.findByRole("dialog");
    await user().keyboard("{Escape}");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(dialog).toBeInTheDocument();
  });
});

describe("RequestAuditDetailDialog 元数据与重试", () => {
  it("缺少请求 ID 时元数据只展示操作、时间与单个分隔符", async () => {
    installDetail(auditDTO({ requestId: "", clientIp: undefined, operation: "chat" }), []);

    renderDialog(auditDTO({ id: "audit-1" }));

    const dialog = await screen.findByRole("dialog");
    const meta = within(dialog).getByText(formatDateTime("2026-10-01T10:00:00.000Z", i18n.language));
    expect(meta).toBeInTheDocument();
    expect(await within(dialog).findByText("chat")).toBeInTheDocument();
    expect(within(dialog).queryByText("10.0.0.9")).not.toBeInTheDocument();
    expect(within(dialog).getAllByText("·")).toHaveLength(1);
  });

  it("有客户端 IP 但无请求 ID 时 IP 前不出现额外分隔符", async () => {
    installDetail(auditDTO({ requestId: "", clientIp: "10.0.0.9", operation: "chat" }), []);

    renderDialog(auditDTO({ id: "audit-1" }));

    const dialog = await screen.findByRole("dialog");
    expect((await within(dialog).findAllByText("10.0.0.9")).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("·")).toHaveLength(2);
  });

  it("详情失败后可点击重试加载成功", async () => {
    let failed = false;
    apiMock.request.mockImplementation(
      createFakeApi(() => {
        if (!failed) {
          failed = true;
          throw new ApiError(503, "unavailable", "审计详情暂不可用");
        }
        return { audit: auditDTO({ id: "audit-1", accountName: "账号 A" }), attempts: [] };
      }),
    );

    renderDialog(auditDTO({ id: "audit-1" }));

    expect(await screen.findByText("审计详情暂不可用")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: i18n.t("common.retry") }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("账号 A")).toBeInTheDocument();
    expect(screen.queryByText("审计详情暂不可用")).not.toBeInTheDocument();
  });
});
