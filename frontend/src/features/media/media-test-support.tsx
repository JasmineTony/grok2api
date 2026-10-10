import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { MediaAssetDTO, MediaJobDTO, VideoStatsDTO } from "@/features/media/types";
import { i18n } from "@/shared/i18n";

// Radix 弹层在定位时使用 ResizeObserver；jsdom 未实现该 API，这里补最小替身。
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

export type RecordedRequest = { url: string; method: string; body: unknown };

export function mediaImage(overrides: Partial<MediaAssetDTO> = {}): MediaAssetDTO {
  return {
    id: "image-1",
    kind: "image",
    mimeType: "image/png",
    sizeBytes: 2048,
    sha256: "hash",
    createdAt: "2026-01-02T03:04:05Z",
    url: "/v1/media/images/image-1",
    ...overrides,
  };
}

export function mediaJob(overrides: Partial<MediaJobDTO> = {}): MediaJobDTO {
  return {
    id: "job-1",
    model: "grok-imagine-video",
    prompt: "A paper airplane over a city",
    status: "completed",
    progress: 100,
    seconds: 8,
    size: "1280x720",
    quality: "720p",
    accountName: "account-1",
    clientKeyName: "key-1",
    createdAt: "2026-01-02T03:04:05Z",
    completedAt: "2026-01-02T03:05:05Z",
    errorMessage: "",
    assetId: "asset-1",
    ...overrides,
  };
}

export type MediaApiFailure = "images" | "imageStats" | "videos" | "videoStats" | "delete";

export type MediaApiStubOptions = {
  images?: MediaAssetDTO[];
  imagesTotal?: number;
  imageStats?: { totalImages: number; totalBytes: number };
  videos?: MediaJobDTO[];
  videosTotal?: number;
  videoStats?: VideoStatsDTO;
  failure?: MediaApiFailure;
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });
}

function errorResponse(code: string, status = 500): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function queryParam(url: string, name: string): string | null {
  return new URL(url, "http://localhost").searchParams.get(name);
}

function paginated<T>(
  items: T[],
  url: string,
  total?: number,
): { items: T[]; page: number; pageSize: number; total: number } {
  return {
    items,
    page: Number(queryParam(url, "page") ?? 1),
    pageSize: Number(queryParam(url, "pageSize") ?? 20),
    total: total ?? items.length,
  };
}

function respond(url: string, method: string, options: MediaApiStubOptions, body: unknown): Response {
  if (method === "DELETE") {
    if (options.failure === "delete") return errorResponse("mediaDeleteFailed");
    const ids = (body as { ids?: string[] } | undefined)?.ids ?? [];
    return jsonResponse({ deleted: ids.length });
  }
  if (url.startsWith("/api/admin/v1/media/images/stats")) {
    if (options.failure === "imageStats") return errorResponse("imageStatsFailed");
    return jsonResponse(options.imageStats ?? { totalImages: 0, totalBytes: 0 });
  }
  if (url.startsWith("/api/admin/v1/media/images")) {
    if (options.failure === "images") return errorResponse("imageListFailed");
    return jsonResponse(paginated(options.images ?? [], url, options.imagesTotal));
  }
  if (url.startsWith("/api/admin/v1/media/videos/stats")) {
    if (options.failure === "videoStats") return errorResponse("videoStatsFailed");
    return jsonResponse(options.videoStats ?? { totalJobs: 0, completed: 0, failed: 0, inProgress: 0, queued: 0 });
  }
  if (url.startsWith("/api/admin/v1/media/videos")) {
    if (options.failure === "videos") return errorResponse("videoListFailed");
    return jsonResponse(paginated(options.videos ?? [], url, options.videosTotal));
  }
  throw new Error(`unexpected request: ${method} ${url}`);
}

export function installMediaApi(options: MediaApiStubOptions = {}): { requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ url, method, body });
    return respond(url, method, options, body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests };
}

export function requestsMatching(requests: RecordedRequest[], method: string, prefix: string): RecordedRequest[] {
  return requests.filter((request) => request.method === method && request.url.startsWith(prefix));
}

export function lastRequestURL(requests: RecordedRequest[], prefix: string): string {
  return requestsMatching(requests, "GET", prefix).at(-1)?.url ?? "";
}

export function renderWithProviders(ui: ReactElement): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}
