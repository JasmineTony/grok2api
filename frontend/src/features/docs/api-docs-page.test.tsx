import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { ModelRouteDTO } from "@/entities/model/types";
import { ApiDocsPage } from "@/features/docs/api-docs-page";
import { ApiDocsNotesSection } from "@/features/docs/api-docs-sections";
import { endpoints } from "@/features/docs/endpoint-definitions";
import { copyToClipboard } from "@/shared/clipboard";
import { i18n } from "@/shared/i18n";

// jsdom 没有真实剪贴板；只替换这一段浏览器边界，页面与示例生成保持真实实现。
vi.mock("@/shared/clipboard", () => ({ copyToClipboard: vi.fn(async () => true) }));

const modelRoute: ModelRouteDTO = {
  id: "route-1",
  publicId: "grok-4",
  provider: "grok_build",
  upstreamModel: "Build/grok-4",
  capability: "responses",
  origin: "catalog",
  enabled: true,
  accountIds: [],
  bindingMode: false,
  supportedAccounts: 3,
  syncedAccounts: 3,
  totalAccounts: 4,
  capabilityKnown: true,
  available: true,
  lastSyncedAt: "2026-01-02T03:04:05Z",
};

type DocsApiOptions = { publicApiBaseURL?: string; models?: ModelRouteDTO[]; modelsFailed?: boolean };

function installDocsApi(options: DocsApiOptions = {}): { urls: string[] } {
  const urls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("/api/admin/v1/system")) {
      return new Response(JSON.stringify({ data: { publicApiBaseURL: options.publicApiBaseURL ?? "" } }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (options.modelsFailed) {
      return new Response(JSON.stringify({ error: { code: "modelListFailed", message: "modelListFailed" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ data: { items: options.models ?? [modelRoute], page: 1, pageSize: 100, total: 1 } }),
      { headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { urls };
}

function renderDocs(path: string): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/docs/:category/:endpoint" element={<ApiDocsPage />} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

function exampleCode(): string {
  return screen.getByTestId("docs-example-code").textContent ?? "";
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ApiDocsPage", () => {
  it("渲染端点标题、签名、连接信息与请求示例", async () => {
    installDocsApi({ publicApiBaseURL: "https://api.example.com/" });
    renderDocs("/docs/chat/completions");

    expect(await screen.findByRole("heading", { name: "Chat completions" })).toBeInTheDocument();
    expect(screen.getByTestId("docs-endpoint-signature")).toHaveTextContent("/v1/chat/completions");
    await waitFor(() => expect(screen.getByTestId("docs-connection")).toHaveTextContent("https://api.example.com/v1"));
    expect(screen.getByTestId("docs-parameter-table")).toHaveTextContent("messages");
    expect(exampleCode()).toContain('curl -X POST "https://api.example.com/v1/chat/completions"');
    expect(exampleCode()).toContain("Authorization: Bearer $GROK2API_API_KEY");
  });

  it("未知端点重定向到默认端点", async () => {
    installDocsApi();
    renderDocs("/docs/unknown/endpoint");

    expect(await screen.findByRole("heading", { name: "Chat completions" })).toBeInTheDocument();
  });

  it("模型列表可用时展示模型选择并用于响应示例", async () => {
    const user = userEvent.setup();
    installDocsApi({ publicApiBaseURL: "https://api.example.com" });
    renderDocs("/docs/chat/completions");

    await waitFor(() => expect(screen.getByTestId("docs-example-model")).toHaveTextContent("grok-4"));
    expect(screen.getByTestId("docs-example-language")).toHaveTextContent("cURL");

    await user.click(screen.getByRole("tab", { name: i18n.t("docs.reference.response") }));
    expect(exampleCode()).toContain("chatcmpl_example");
    expect(exampleCode()).toContain('"model": "grok-4"');
  });

  it("模型接口失败时回退到端点默认模型且不渲染模型选择", async () => {
    installDocsApi({ publicApiBaseURL: "https://api.example.com", modelsFailed: true });
    renderDocs("/docs/chat/completions");

    await waitFor(() => expect(screen.getByTestId("docs-example-code")).toBeInTheDocument());
    expect(screen.queryByTestId("docs-example-model")).not.toBeInTheDocument();
    expect(exampleCode()).toContain("your-enabled-model");
  });

  it("系统信息缺少公开地址时回退到运行时默认地址", async () => {
    installDocsApi({ publicApiBaseURL: "" });
    renderDocs("/docs/chat/completions");

    await waitFor(() =>
      expect(screen.getByTestId("docs-connection")).toHaveTextContent(`${window.location.origin}/v1`),
    );
  });

  it("GET 端点使用路径参数标题且示例不含请求体", async () => {
    installDocsApi({ publicApiBaseURL: "https://api.example.com", models: [] });
    renderDocs("/docs/video/get");

    expect(await screen.findByRole("heading", { name: "Get video" })).toBeInTheDocument();
    expect(screen.getByText(i18n.t("docs.reference.pathParameters"))).toBeInTheDocument();
    expect(exampleCode()).toContain("/v1/videos/video_example");
    expect(exampleCode()).not.toContain("-d '");
    expect(screen.getByTestId("docs-notes")).toHaveTextContent(i18n.t("docs.reference.noteVideoPolling"));
  });

  it("复制按钮把示例代码交给剪贴板", async () => {
    const user = userEvent.setup();
    installDocsApi({ publicApiBaseURL: "https://api.example.com", models: [] });
    renderDocs("/docs/chat/completions");

    await waitFor(() => expect(screen.getByTestId("docs-example-code")).toBeInTheDocument());
    const panel = screen.getByTestId("docs-example-panel");
    await user.click(within(panel).getByRole("button", { name: i18n.t("common.copy") }));

    await waitFor(() =>
      expect(vi.mocked(copyToClipboard)).toHaveBeenCalledWith(expect.stringContaining("curl -X POST")),
    );
  });
});

describe("ApiDocsPage 端点差异与重定向", () => {
  it("Messages 端点使用 x-api-key 鉴权并展示 anthropic-version", async () => {
    installDocsApi({ publicApiBaseURL: "https://api.example.com" });
    renderDocs("/docs/chat/messages");

    expect(await screen.findByRole("heading", { name: "Messages" })).toBeInTheDocument();
    const connection = screen.getByTestId("docs-connection");
    expect(connection).toHaveTextContent("x-api-key: g2a_...");
    expect(connection).toHaveTextContent("anthropic-version");
    expect(connection).toHaveTextContent("2023-06-01");
    expect(connection).not.toHaveTextContent("Authorization: Bearer");
  });

  it("缺少路由参数时重定向到默认端点", async () => {
    installDocsApi({ publicApiBaseURL: "https://api.example.com" });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={0}>
            <MemoryRouter initialEntries={["/docs"]}>
              <Routes>
                <Route path="/docs" element={<ApiDocsPage />} />
                <Route path="/docs/:category/:endpoint" element={<ApiDocsPage />} />
              </Routes>
            </MemoryRouter>
          </TooltipProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Chat completions" })).toBeInTheDocument();
    expect(screen.getByTestId("docs-endpoint-signature")).toHaveTextContent("/v1/chat/completions");
  });

  it("端点无备注时不渲染备注分区", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ApiDocsNotesSection definition={{ ...endpoints["chat/completions"], noteKeys: [] }} />
      </I18nextProvider>,
    );

    expect(screen.queryByTestId("docs-notes")).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t("docs.reference.notes"))).not.toBeInTheDocument();
  });
});
