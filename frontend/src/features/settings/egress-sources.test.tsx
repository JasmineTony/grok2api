import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { EgressSources } from "@/features/settings/egress-operations";
import {
  createEgressFakeApi,
  egressSourceListWire,
  egressSourceWire,
  matchEgressRoute,
  ResizeObserverStub,
  type EgressFakeRoutes,
  type FakeApiCall,
} from "@/features/settings/egress-test-support";
import { validSubscriptionProxyURL } from "@/features/settings/settings-model";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 关键路径组件集成测试（AGENTS.md TEST-3）：只替换 apiRequest 这一网络边界，
// 订阅源分区、settings-api decoder、react-query 状态流与表单校验保持真实实现。
const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

type RecordedCall = [path: string, options: { method?: string; body?: unknown }];

function callsOf(method: string, pathPrefix: string): RecordedCall[] {
  return (apiMock.request.mock.calls as RecordedCall[]).filter(
    ([path, options]) => path.startsWith(pathPrefix) && (options.method ?? "GET") === method,
  );
}

function installRoutes(routes: EgressFakeRoutes): void {
  apiMock.request.mockImplementation(
    createEgressFakeApi((call: FakeApiCall) => {
      const handler = matchEgressRoute(call, routes);
      if (!handler) throw new ApiError(500, "unexpectedRequest", `未注册的请求：${call.method} ${call.path}`);
      return handler(call);
    }),
  );
}

const scopeLabel = (scope: string) => scope;

function renderSources() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={0}>
          <EgressSources scopeLabel={scopeLabel} />
          <Toaster />
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
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

describe("EgressSources 订阅源列表", () => {
  it("加载成功后展示名称、作用域、路由、最后同步与容量", async () => {
    installRoutes({
      sources: () =>
        egressSourceListWire([
          egressSourceWire({
            id: "src-1",
            name: "主力订阅",
            scope: "grok_web",
            proxyConfigured: true,
            lastSyncedAt: "2026-01-02T03:04:05Z",
            defaultAccountCapacity: 12,
          }),
          egressSourceWire({ id: "src-2", name: "直连订阅", enabled: false, defaultAccountCapacity: 0 }),
        ]),
    });

    renderSources();

    expect(await screen.findByTestId("egress-source-row-src-1")).toBeInTheDocument();
    expect(screen.getByTestId("egress-source-name-src-1")).toHaveTextContent("主力订阅");
    expect(screen.getByTestId("egress-source-scope-src-1")).toHaveTextContent("grok_web");
    expect(screen.getByTestId("egress-source-route-src-1")).toHaveTextContent(
      i18n.t("settings.egress.subscriptionProxyShort"),
    );
    expect(screen.getByTestId("egress-source-last-sync-src-1")).not.toHaveTextContent(i18n.t("settings.egress.never"));
    expect(screen.getByTestId("egress-source-capacity-src-1")).toHaveTextContent("12");
    expect(screen.getByTestId("egress-source-route-src-2")).toHaveTextContent(i18n.t("settings.egress.direct"));
    expect(screen.getByTestId("egress-source-last-sync-src-2")).toHaveTextContent(i18n.t("settings.egress.never"));
    expect(screen.getByTestId("egress-source-capacity-src-2")).toHaveTextContent(i18n.t("settings.egress.unlimited"));
  });

  it("空列表展示无订阅源文案", async () => {
    installRoutes({ sources: () => egressSourceListWire([]) });

    renderSources();

    expect(await screen.findByTestId("egress-sources-empty")).toHaveTextContent(i18n.t("settings.egress.noSources"));
  });

  it("加载失败展示错误信息，重试后恢复列表", async () => {
    let failed = false;
    installRoutes({
      sources: () => {
        if (!failed) {
          failed = true;
          throw new ApiError(503, "unavailable", "订阅服务暂不可用");
        }
        return egressSourceListWire([egressSourceWire({ id: "src-1" })]);
      },
    });

    renderSources();

    expect(await screen.findByText("订阅服务暂不可用")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: i18n.t("common.retry") }));

    expect(await screen.findByTestId("egress-source-row-src-1")).toBeInTheDocument();
  });

  it("搜索按名称过滤并展示无匹配文案", async () => {
    installRoutes({
      sources: () => egressSourceListWire([egressSourceWire({ id: "src-1", name: "主力订阅" })]),
    });
    renderSources();
    await screen.findByTestId("egress-source-row-src-1");

    await user().type(screen.getByTestId("egress-sources-search"), "不存在");

    expect(await screen.findByTestId("egress-sources-empty")).toHaveTextContent(
      i18n.t("settings.egress.noSubscriptionMatches"),
    );
    expect(screen.queryByTestId("egress-source-row-src-1")).not.toBeInTheDocument();
  });

  it("翻页展示下一页订阅源", async () => {
    const sources = Array.from({ length: 25 }, (_, index) =>
      egressSourceWire({ id: `src-${index + 1}`, name: `订阅源 ${index + 1}` }),
    );
    installRoutes({ sources: () => egressSourceListWire(sources) });
    renderSources();
    await screen.findByTestId("egress-source-row-src-1");

    expect(screen.queryByTestId("egress-source-row-src-21")).not.toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));

    expect(await screen.findByTestId("egress-source-row-src-21")).toBeInTheDocument();
  });
});

describe("EgressSources 同步订阅源", () => {
  it("同步成功后提示导入结果", async () => {
    installRoutes({
      sources: () => egressSourceListWire([egressSourceWire({ id: "src-1" })]),
      sourceSync: () => ({ imported: 7, skipped: 2 }),
    });
    renderSources();
    await screen.findByTestId("egress-source-row-src-1");

    await user().click(screen.getByTestId("egress-source-actions-src-1"));
    fireEvent.click(await screen.findByTestId("egress-source-sync-src-1"));

    await waitFor(() => expect(callsOf("POST", "/api/admin/v1/egress-sources/src-1/sync")).toHaveLength(1));
    expect(
      await screen.findByText(i18n.t("settings.egress.sourceSynced", { imported: 7, skipped: 2 })),
    ).toBeInTheDocument();
  });

  it("同步失败时提示服务端错误", async () => {
    installRoutes({
      sources: () => egressSourceListWire([egressSourceWire({ id: "src-1" })]),
      sourceSync: () => {
        throw new ApiError(502, "upstream", "订阅源不可达");
      },
    });
    renderSources();
    await screen.findByTestId("egress-source-row-src-1");

    await user().click(screen.getByTestId("egress-source-actions-src-1"));
    fireEvent.click(await screen.findByTestId("egress-source-sync-src-1"));

    expect(await screen.findByText("订阅源不可达")).toBeInTheDocument();
  });
});

describe("EgressSources 表单校验与保存", () => {
  it("新建订阅源未填名称或 URL 时保存按钮禁用", async () => {
    installRoutes({ sources: () => egressSourceListWire([]) });
    renderSources();
    await screen.findByTestId("egress-sources-empty");

    await user().click(screen.getByTestId("egress-sources-add"));
    const dialog = await screen.findByTestId("egress-source-dialog");
    expect(within(dialog).getByTestId("egress-source-dialog-save")).toBeDisabled();

    await user().type(within(dialog).getByTestId("egress-source-name"), "新订阅");
    expect(within(dialog).getByTestId("egress-source-dialog-save")).toBeDisabled();

    await user().type(within(dialog).getByTestId("egress-source-url"), "https://example.com/sub");
    expect(within(dialog).getByTestId("egress-source-dialog-save")).toBeEnabled();
    expect(callsOf("POST", "/api/admin/v1/egress-sources")).toHaveLength(0);
  });

  it("订阅源代理地址非法时提示并阻止提交", async () => {
    expect(validSubscriptionProxyURL("not-a-proxy")).toBe(false);
    installRoutes({ sources: () => egressSourceListWire([]) });
    renderSources();
    await screen.findByTestId("egress-sources-empty");

    await user().click(screen.getByTestId("egress-sources-add"));
    const dialog = await screen.findByTestId("egress-source-dialog");
    await user().type(within(dialog).getByTestId("egress-source-name"), "新订阅");
    await user().type(within(dialog).getByTestId("egress-source-url"), "https://example.com/sub");
    await user().click(within(dialog).getAllByRole("switch")[1]);
    await user().type(within(dialog).getByTestId("egress-source-proxy-url"), "not-a-proxy");

    expect(within(dialog).getByTestId("egress-source-proxy-invalid")).toHaveTextContent(
      i18n.t("settings.egress.invalidSubscriptionProxy"),
    );
    expect(within(dialog).getByTestId("egress-source-dialog-save")).toBeDisabled();
  });

  it("保存失败时展示服务端错误并保留弹窗", async () => {
    installRoutes({
      sources: () => egressSourceListWire([]),
      sourceCreate: () => {
        throw new ApiError(400, "invalid", "订阅地址格式不正确");
      },
    });
    renderSources();
    await screen.findByTestId("egress-sources-empty");

    await user().click(screen.getByTestId("egress-sources-add"));
    const dialog = await screen.findByTestId("egress-source-dialog");
    await user().type(within(dialog).getByTestId("egress-source-name"), "新订阅");
    await user().type(within(dialog).getByTestId("egress-source-url"), "https://example.com/sub");
    await user().click(within(dialog).getByTestId("egress-source-dialog-save"));

    expect(await screen.findByText("订阅地址格式不正确")).toBeInTheDocument();
    const created = callsOf("POST", "/api/admin/v1/egress-sources");
    expect(created).toHaveLength(1);
    expect(created[0][1].body).toMatchObject({
      name: "新订阅",
      url: "https://example.com/sub",
      scope: "grok_build",
      enabled: true,
    });
    expect(screen.getByTestId("egress-source-dialog")).toBeInTheDocument();
  });
});
