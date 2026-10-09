import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 关键路径集成测试（AGENTS.md TEST-3）：只替换 fetch 这一网络边界，
// client.ts 的刷新重试、并发锁、SSE 解析与错误语义全部保持真实实现。
// 每个用例重新导入模块，避免 accessToken / refreshPromise / 订阅集合在用例间泄漏。

type ClientModule = typeof import("@/shared/api/client");

const fetchMock = vi.fn();
let client: ClientModule;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function errorResponse(status: number, error: unknown): Response {
  return jsonResponse({ error }, { status });
}

function sseResponse(chunks: readonly string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "Content-Type": "text/event-stream" } });
}

/** 永不产出数据、也不结束的 SSE 响应，用于验证不活动超时。 */
function stalledSseResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start() {
      /* 故意不 enqueue / 不 close */
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function requestInitAt(index: number): RequestInit {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`fetch 第 ${index} 次调用不存在`);
  return (call[1] ?? {}) as RequestInit;
}

function requestUrlAt(index: number): string {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`fetch 第 ${index} 次调用不存在`);
  return String(call[0]);
}

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  client = await import("@/shared/api/client");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("apiRequest 响应与错误语义", () => {
  it("成功时解包 data 并携带凭据", async () => {
    client.setAccessToken("token-1");
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: "a1" } }));

    const result = await client.apiRequest("/api/admin/v1/x", {}, (value) => value as { id: string });

    expect(result).toEqual({ id: "a1" });
    expect(requestUrlAt(0)).toBe("/api/admin/v1/x");
    expect(requestInitAt(0).credentials).toBe("include");
    expect(new Headers(requestInitAt(0).headers).get("Authorization")).toBe("Bearer token-1");
  });

  it("未登录时不写入 Authorization 头", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: 1 }));

    await client.apiRequest("/api/admin/v1/x", {}, () => 1);

    expect(new Headers(requestInitAt(0).headers).get("Authorization")).toBeNull();
  });

  it("对象 body 序列化为 JSON 并设置 Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: true }));

    await client.apiRequest("/api/admin/v1/x", { method: "POST", body: { name: "n" } }, () => true);

    expect(requestInitAt(0).body).toBe(JSON.stringify({ name: "n" }));
    expect(new Headers(requestInitAt(0).headers).get("Content-Type")).toBe("application/json");
  });

  it("FormData body 不手动设置 Content-Type（保留浏览器边界）", async () => {
    const form = new FormData();
    form.append("file", new Blob(["x"]), "x.txt");
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: true }));

    await client.apiRequest("/api/admin/v1/x", { method: "POST", body: form }, () => true);

    expect(requestInitAt(0).body).toBe(form);
    expect(new Headers(requestInitAt(0).headers).get("Content-Type")).toBeNull();
  });

  it("错误信封映射为 ApiError 并保留 code/status/requestId", async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(422, { code: "invalidFilter", message: "bad filter", requestId: "req-1" }),
    );

    const failure = await client
      .apiRequest("/api/admin/v1/x", {}, () => 1)
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(client.ApiError);
    const apiError = failure as InstanceType<ClientModule["ApiError"]>;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe("invalidFilter");
    expect(apiError.requestId).toBe("req-1");
    expect(apiError.message.length).toBeGreaterThan(0);
  });

  it("成功响应缺少 data 字段时判定为 invalidResponse", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));

    const failure = await client
      .apiRequest("/api/admin/v1/x", {}, () => 1)
      .then(() => null)
      .catch((error: unknown) => error);

    expect((failure as InstanceType<ClientModule["ApiError"]>).code).toBe("invalidResponse");
  });

  it("解码失败时判定为 invalidResponse 而不是抛出原始异常", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { wrong: true } }));

    const failure = await client
      .apiRequest("/api/admin/v1/x", {}, () => {
        throw new Error("decode boom");
      })
      .then(() => null)
      .catch((error: unknown) => error);

    expect((failure as InstanceType<ClientModule["ApiError"]>).code).toBe("invalidResponse");
  });
});

describe("401 刷新与并发", () => {
  it("刷新成功后重试一次并返回成功结果", async () => {
    client.setAccessToken("stale");
    fetchMock
      .mockResolvedValueOnce(errorResponse(401, { code: "unauthorized" }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { accessToken: "fresh", accessTokenExpiresAt: "a", refreshTokenExpiresAt: "b" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));

    const result = await client.apiRequest("/api/admin/v1/x", {}, (value) => value as { ok: boolean });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestUrlAt(1)).toBe("/api/admin/v1/auth/refresh");
    expect(new Headers(requestInitAt(2).headers).get("Authorization")).toBe("Bearer fresh");
  });

  it("刷新返回 401 时清空会话并通知订阅者，原请求不重试", async () => {
    const listener = vi.fn();
    const unsubscribe = client.subscribeSessionInvalidated(listener);
    client.setAccessToken("stale");
    fetchMock
      .mockResolvedValueOnce(errorResponse(401, { code: "unauthorized" }))
      .mockResolvedValueOnce(errorResponse(401, { code: "unauthorized" }));

    const failure = await client
      .apiRequest("/api/admin/v1/x", {}, () => 1)
      .then(() => null)
      .catch((error: unknown) => error);

    expect((failure as InstanceType<ClientModule["ApiError"]>).status).toBe(401);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("刷新请求网络异常时返回 sessionRefreshUnavailable(503)", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(401, { code: "unauthorized" }))
      .mockRejectedValueOnce(new Error("network down"));

    const failure = await client
      .apiRequest("/api/admin/v1/x", {}, () => 1)
      .then(() => null)
      .catch((error: unknown) => error);

    expect((failure as InstanceType<ClientModule["ApiError"]>).code).toBe("sessionRefreshUnavailable");
    expect((failure as InstanceType<ClientModule["ApiError"]>).status).toBe(503);
  });

  it("authenticated:false 的请求不触发刷新", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, { code: "unauthorized" }));

    await client.apiRequest("/api/admin/v1/auth/login", { authenticated: false }, () => 1).catch(() => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("并发 401 只发起一次刷新（refreshPromise 去重）", async () => {
    client.setAccessToken("stale");
    fetchMock
      .mockResolvedValueOnce(errorResponse(401, { code: "unauthorized" }))
      .mockResolvedValueOnce(errorResponse(401, { code: "unauthorized" }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { accessToken: "fresh", accessTokenExpiresAt: "a", refreshTokenExpiresAt: "b" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: 1 }))
      .mockResolvedValueOnce(jsonResponse({ data: 2 }));

    const [first, second] = await Promise.all([
      client.apiRequest("/api/admin/v1/a", {}, () => 1),
      client.apiRequest("/api/admin/v1/b", {}, () => 2),
    ]);

    expect([first, second]).toEqual([1, 2]);
    const refreshCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });

  it("浏览器不支持 locks 时直接刷新，仍能成功", async () => {
    client.setAccessToken("stale");
    fetchMock
      .mockResolvedValueOnce(errorResponse(401, { code: "unauthorized" }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { accessToken: "fresh", accessTokenExpiresAt: "a", refreshTokenExpiresAt: "b" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: "ok" }));

    await expect(client.apiRequest("/api/admin/v1/x", {}, (value) => value as string)).resolves.toBe("ok");
  });
});

describe("apiEventStream", () => {
  it("非 SSE 内容类型判定为 invalidResponse", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: 1 }));

    const failure = await client
      .apiEventStream(
        "/api/admin/v1/stream",
        { method: "POST" },
        () => 1,
        () => undefined,
      )
      .then(() => null)
      .catch((error: unknown) => error);

    expect((failure as InstanceType<ClientModule["ApiError"]>).code).toBe("invalidResponse");
  });

  it("跨分块的 \\r\\n\\r\\n 边界与多行 data 都能正确派发", async () => {
    const events: Array<{ event: string; data: unknown }> = [];
    fetchMock.mockResolvedValueOnce(
      sseResponse(['event: progress\ndata: {"completed":1,\n', 'data: "total":2}\r\n\r\n', 'data: {"done":true}\n\n']),
    );

    await client.apiEventStream(
      "/api/admin/v1/stream",
      { method: "POST" },
      (value) => value,
      (value) => events.push({ event: value.event, data: value.data }),
    );

    expect(events).toEqual([
      { event: "progress", data: { completed: 1, total: 2 } },
      { event: "message", data: { done: true } },
    ]);
  });

  it("结尾无空行分隔的残余缓冲也会被派发", async () => {
    const events: unknown[] = [];
    fetchMock.mockResolvedValueOnce(sseResponse(['data: {"final":1}']));

    await client.apiEventStream(
      "/api/admin/v1/stream",
      { method: "POST" },
      (value) => value,
      (value) => events.push(value.data),
    );

    expect(events).toEqual([{ final: 1 }]);
  });

  it("data 不是合法 JSON 时判定为 invalidResponse 并取消读取", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(["data: not-json\n\n"]));

    const failure = await client
      .apiEventStream(
        "/api/admin/v1/stream",
        { method: "POST" },
        () => 1,
        () => undefined,
      )
      .then(() => null)
      .catch((error: unknown) => error);

    expect((failure as InstanceType<ClientModule["ApiError"]>).code).toBe("invalidResponse");
  });

  it("流无响应超过不活动阈值时报 streamTimeout", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(stalledSseResponse());

    const pending = client
      .apiEventStream(
        "/api/admin/v1/stream",
        { method: "POST" },
        () => 1,
        () => undefined,
      )
      .then(() => null)
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(60_000);
    const failure = await pending;

    expect((failure as InstanceType<ClientModule["ApiError"]>).code).toBe("streamTimeout");
  });
});

describe("apiDownload", () => {
  it("成功时返回 blob 与响应头", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("payload", {
        status: 200,
        headers: { "X-Batch-Count": "7", "Content-Type": "application/octet-stream" },
      }),
    );

    const result = await client.apiDownloadResponse("/api/admin/v1/accounts/export", { method: "POST" });

    expect(result.headers.get("X-Batch-Count")).toBe("7");
    expect(await result.blob.text()).toBe("payload");
  });

  it("失败响应抛出 ApiError 而不是返回空 blob", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(403, { code: "forbidden", message: "no" }));

    const failure = await client
      .apiDownload("/api/admin/v1/accounts/export", { method: "POST" })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(client.ApiError);
    expect((failure as InstanceType<ClientModule["ApiError"]>).status).toBe(403);
  });
});

describe("并发锁与流式边界的补充覆盖", () => {
  type LockRequest = (name: string, callback: () => Promise<unknown>) => Promise<unknown>;

  function stubLocks(request: LockRequest): void {
    Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
  }

  // 只在本 describe 内注入 navigator.locks，避免影响前面「浏览器不支持 locks」的用例。
  afterEach(() => {
    Reflect.deleteProperty(navigator, "locks");
  });

  it("navigator.locks 可用时通过锁执行刷新", async () => {
    const request = vi.fn<LockRequest>(async (_name, callback) => callback());
    stubLocks(request);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { accessToken: "fresh", accessTokenExpiresAt: "a", refreshTokenExpiresAt: "b" } }),
    );

    await expect(client.refreshAccessToken()).resolves.toBe("refreshed");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("grok2api:admin-session-refresh");
  });

  it("锁请求被拒绝时判定为 sessionRefreshUnavailable", async () => {
    stubLocks(async () => {
      throw new Error("lock denied");
    });
    // 先让业务请求返回 401，才会进入刷新分支；刷新本身因锁被拒而失败。
    fetchMock.mockResolvedValueOnce(errorResponse(401, { code: "unauthorized" }));

    const failure = await client
      .apiRequest("/api/admin/v1/x", {}, () => 1)
      .then(() => null)
      .catch((error: unknown) => error);

    expect((failure as InstanceType<ClientModule["ApiError"]>).code).toBe("sessionRefreshUnavailable");
  });

  it("SSE 请求 401 后刷新并重试一次", async () => {
    client.setAccessToken("stale");
    const events: unknown[] = [];
    fetchMock
      .mockResolvedValueOnce(errorResponse(401, { code: "unauthorized" }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { accessToken: "fresh", accessTokenExpiresAt: "a", refreshTokenExpiresAt: "b" } }),
      )
      .mockResolvedValueOnce(sseResponse(['data: {"after":"refresh"}\n\n']));

    await client.apiEventStream(
      "/api/admin/v1/stream",
      { method: "POST" },
      (value) => value,
      (value) => events.push(value.data),
    );

    expect(events).toEqual([{ after: "refresh" }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("单个分块已出现边界但越过缓冲上限时判定为 invalidResponse", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([`data: ${"x".repeat(1_048_600)}\n\n`]));

    const failure = await client
      .apiEventStream(
        "/api/admin/v1/stream",
        { method: "POST" },
        () => 1,
        () => undefined,
      )
      .then(() => null)
      .catch((error: unknown) => error);

    expect((failure as InstanceType<ClientModule["ApiError"]>).code).toBe("invalidResponse");
  });

  it("无事件边界且缓冲超过上限时判定为 invalidResponse", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(["y".repeat(1_048_600)]));

    const failure = await client
      .apiEventStream(
        "/api/admin/v1/stream",
        { method: "POST" },
        () => 1,
        () => undefined,
      )
      .then(() => null)
      .catch((error: unknown) => error);

    expect((failure as InstanceType<ClientModule["ApiError"]>).code).toBe("invalidResponse");
  });

  it("取消订阅后不再收到会话失效通知", async () => {
    const listener = vi.fn();
    client.subscribeSessionInvalidated(listener)();
    fetchMock
      .mockResolvedValueOnce(errorResponse(401, { code: "unauthorized" }))
      .mockResolvedValueOnce(errorResponse(401, { code: "unauthorized" }));

    await client.apiRequest("/api/admin/v1/x", {}, () => 1).catch(() => undefined);

    expect(listener).not.toHaveBeenCalled();
  });
});
