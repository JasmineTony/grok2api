import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { ModelAccountOptionDTO } from "@/entities/model/model-api";
import type { ModelRouteDTO, ModelRouteGroupDTO } from "@/entities/model/types";
import { ModelsPage } from "@/features/models/models-page";
import { i18n } from "@/shared/i18n";

// 模型页测试共用的网络边界替身与渲染脚手架（仅测试引用，不进入生产依赖图）。
// 只替换全局 fetch，被测页面、hooks、解码器与 React Query 状态流保持真实实现。

// Radix 弹层（Dialog / AlertDialog / DropdownMenu）在定位时会使用 ResizeObserver，
// jsdom 未实现该 API；这里补一个最小替身，避免把测试环境缺口误判成组件缺陷。
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

export type RecordedRequest = { url: string; method: string; body: unknown };

export type ApiFailure = "list" | "accounts" | "save" | "delete" | "batch" | "sync";

export type ApiStubOptions = {
  groups?: ModelRouteGroupDTO[];
  total?: number;
  accountOptions?: ModelAccountOptionDTO[];
  failure?: ApiFailure;
  syncEvents?: string;
  /** 非 Error 抛出的网络失败，用于验证兜底分支。 */
  throwOnSync?: string;
};

export const baseRoute: ModelRouteDTO = {
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

export function modelRoute(overrides: Partial<ModelRouteDTO> = {}): ModelRouteDTO {
  return { ...baseRoute, ...overrides };
}

export function modelGroup(overrides: Partial<ModelRouteGroupDTO> = {}): ModelRouteGroupDTO {
  const routes = overrides.routes ?? [modelRoute()];
  return { key: routes[0].publicId, endpointCapabilities: ["responses"], ...overrides, routes };
}

export const defaultSyncEvents =
  'event: progress\ndata: {"completed":1,"total":2}\n\nevent: complete\ndata: {"synced":3}\n\n';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });
}

function errorResponse(code: string, status = 500): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

export function queryParam(url: string, name: string): string | null {
  return new URL(url, "http://localhost").searchParams.get(name);
}

function createResponder(options: ApiStubOptions, groups: ModelRouteGroupDTO[], total: number) {
  return (url: string, method: string): Response => {
    if (url.startsWith("/api/admin/v1/models/groups")) {
      if (options.failure === "list") return errorResponse("modelListFailed");
      return jsonResponse({
        items: groups,
        page: Number(queryParam(url, "page") ?? 1),
        pageSize: Number(queryParam(url, "pageSize") ?? 20),
        total,
      });
    }
    if (url.startsWith("/api/admin/v1/models/accounts")) {
      if (options.failure === "accounts") return errorResponse("modelAccountListFailed");
      return jsonResponse({ items: options.accountOptions ?? [] });
    }
    if (url === "/api/admin/v1/models/sync") {
      if (options.throwOnSync !== undefined) throw options.throwOnSync;
      if (options.failure === "sync") return errorResponse("modelSyncFailed");
      return sseResponse(options.syncEvents ?? defaultSyncEvents);
    }
    if (url === "/api/admin/v1/models/batch") {
      if (options.failure === "batch") return errorResponse("modelBatchUpdateFailed");
      return jsonResponse({ updated: 1 });
    }
    if (url === "/api/admin/v1/models" && method === "POST") {
      if (options.failure === "save") return errorResponse("modelCreateFailed");
      return jsonResponse(modelRoute());
    }
    if (url === "/api/admin/v1/models" && method === "DELETE") {
      if (options.failure === "delete") return errorResponse("modelBatchDeleteFailed");
      return jsonResponse({ deleted: 1 });
    }
    if (method === "PATCH") {
      if (options.failure === "save") return errorResponse("modelUpdateFailed");
      return jsonResponse(modelRoute());
    }
    if (method === "DELETE") {
      if (options.failure === "delete") return errorResponse("modelDeleteFailed");
      return jsonResponse({ deleted: true });
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  };
}

export function installModelApi(options: ApiStubOptions = {}) {
  const requests: RecordedRequest[] = [];
  const groups = options.groups ?? [modelGroup()];
  const respond = createResponder(options, groups, options.total ?? groups.length);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return respond(url, method);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

export function listUrls(requests: RecordedRequest[]): string[] {
  return requests.filter((request) => request.url.startsWith("/api/admin/v1/models/groups")).map((r) => r.url);
}

export function lastListUrl(requests: RecordedRequest[]): string {
  return listUrls(requests).at(-1) ?? "";
}

export function requestsBy(requests: RecordedRequest[], method: string, url?: string): RecordedRequest[] {
  return requests.filter((request) => request.method === method && (url === undefined || request.url === url));
}

export function renderModelsPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>
          <ModelsPage />
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

export async function openRowMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId("models-row-actions-grok-4"));
}

// Radix 子菜单在 jsdom 中没有真实布局：user.click 的指针移动会触发 SubTrigger 的
// pointerleave 从而在 click 之前卸载子菜单，因此这里只派发一次指针按下/抬起。
export async function clickRadioItem(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  const item = await screen.findByRole("menuitemradio", { name });
  await user.pointer({ target: item, keys: "[MouseLeft]" });
}

export function openListFilters(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  return user.click(screen.getByRole("button", { name: new RegExp(`^${i18n.t("common.filter")}`) }));
}
