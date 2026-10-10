import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  convertWebAccountsToBuild,
  detectBuildAccounts,
  importAccounts,
  importConsoleAccounts,
  importWebAccounts,
  refreshAllAccountBilling,
  refreshAllAccountTokens,
  refreshAllConsoleAccountQuotas,
  refreshAllWebAccountQuotas,
  runWebAccountScripts,
  syncWebAccountsToConsole,
} from "@/features/accounts/account-task-stream";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 账号任务流请求契约测试（AGENTS.md TEST-3）：只替换 SSE 网络边界，
// 解码器、事件分派、结果校验与 i18n 错误映射保持真实。

const mocks = vi.hoisted(() => ({ apiEventStream: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiEventStream: mocks.apiEventStream };
});

type StreamEvent = { event: string; data: Record<string, unknown> };
type StreamCall = [
  string,
  { method: string; body?: unknown; signal?: AbortSignal },
  unknown,
  (value: StreamEvent) => void,
];

function callOf(index = 0): StreamCall {
  return mocks.apiEventStream.mock.calls[index] as StreamCall;
}

/** 用给定事件序列驱动一次任务流请求。 */
function respondWith(events: StreamEvent[]): void {
  mocks.apiEventStream.mockImplementation(
    async (_path: string, _options: unknown, _decode: unknown, onEvent: (value: StreamEvent) => void) => {
      for (const event of events) onEvent(event);
    },
  );
}

/** 任务流失败路径：先断言 reject 值是 ApiError，再按 ApiError 契约读取 code / message。 */
function apiErrorOf(value: unknown): ApiError {
  expect(value).toBeInstanceOf(ApiError);
  return value as ApiError;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("zh-CN");
});

describe("任务流请求契约", () => {
  it("各任务使用各自端点、结果字段与阶段声明", async () => {
    respondWith([{ event: "complete", data: { succeeded: 1, failed: 0 } }]);
    await refreshAllAccountBilling(undefined, undefined);
    expect(callOf(0)[0]).toBe("/api/admin/v1/accounts/refresh-billing");
    expect(callOf(0)[1]).toMatchObject({ method: "POST", headers: { Accept: "text/event-stream" } });

    respondWith([{ event: "complete", data: { succeeded: 1, failed: 0, skipped: 0 } }]);
    await refreshAllAccountTokens();
    expect(callOf(1)[0]).toBe("/api/admin/v1/accounts/refresh-tokens");

    respondWith([{ event: "complete", data: { succeeded: 2, failed: 0 } }]);
    await refreshAllWebAccountQuotas();
    expect(callOf(2)[0]).toBe("/api/admin/v1/accounts/web/refresh-quotas");

    respondWith([{ event: "complete", data: { succeeded: 2, failed: 0 } }]);
    await refreshAllConsoleAccountQuotas();
    expect(callOf(3)[0]).toBe("/api/admin/v1/accounts/console/refresh-quotas");

    const conversion = { all: true as const, strategy: "all" as const };
    respondWith([
      {
        event: "complete",
        data: { created: 1, linked: 0, skipped: 0, failed: 0, synced: 1, syncFailed: 0 },
      },
    ]);
    await convertWebAccountsToBuild(conversion);
    expect(callOf(4)[0]).toBe("/api/admin/v1/accounts/web/convert-to-build");
    expect(callOf(4)[1].body).toBe(conversion);

    respondWith([
      {
        event: "complete",
        data: { created: 0, updated: 1, skipped: 0, failed: 0, synced: 1, syncFailed: 0 },
      },
    ]);
    await syncWebAccountsToConsole({ ids: ["a"], strategy: "missing" });
    expect(callOf(5)[0]).toBe("/api/admin/v1/accounts/web/sync-to-console");

    respondWith([{ event: "complete", data: { succeeded: 1, failed: 0 } }]);
    await runWebAccountScripts({ all: true, actions: { acceptTerms: true, setBirthDate: true, enableNSFW: true } });
    expect(callOf(6)[0]).toBe("/api/admin/v1/accounts/web/run-scripts");
    expect(mocks.apiEventStream).toHaveBeenCalledTimes(7);
  });

  it("导入任务按账号池上传多份文件", async () => {
    const files = [new File(["a"], "a.txt"), new File(["b"], "b.txt")];

    respondWith([
      {
        event: "complete",
        data: { created: 1, updated: 0, skipped: 0, failed: 0, synced: 0, syncFailed: 0 },
      },
    ]);
    await importAccounts(files);
    expect(callOf(0)[0]).toBe("/api/admin/v1/accounts/import");
    const buildBody = callOf(0)[1].body as FormData;
    expect(buildBody.getAll("files").map((item) => (item as File).name)).toEqual(["a.txt", "b.txt"]);

    respondWith([
      {
        event: "complete",
        data: { created: 1, updated: 0, skipped: 0, failed: 0, synced: 0, syncFailed: 0 },
      },
    ]);
    await importWebAccounts([files[0]]);
    expect(callOf(1)[0]).toBe("/api/admin/v1/accounts/web/import");
    expect((callOf(1)[1].body as FormData).getAll("files")).toHaveLength(1);

    respondWith([
      {
        event: "complete",
        data: { created: 1, updated: 0, skipped: 0, failed: 0, synced: 0, syncFailed: 0 },
      },
    ]);
    await importConsoleAccounts([]);
    expect(callOf(2)[0]).toBe("/api/admin/v1/accounts/console/import");
    expect((callOf(2)[1].body as FormData).getAll("files")).toEqual([]);
  });
});

describe("任务流事件处理", () => {
  it("进度事件按阶段过滤并节流上报，完成事件返回批量结果", async () => {
    const onProgress = vi.fn();
    const controller = new AbortController();
    respondWith([
      { event: "progress", data: { completed: 1, total: 3, phase: "importing" } },
      { event: "progress", data: { completed: 2, total: 3, phase: "unknown" } },
      // 缺少 total 的进度事件被忽略，不会污染进度状态
      { event: "progress", data: { completed: 2 } },
      { event: "unknown-event", data: { completed: 3, total: 3 } },
      { event: "complete", data: { succeeded: 3, failed: 0 } },
    ]);

    await expect(refreshAllAccountBilling(onProgress, controller.signal)).resolves.toEqual({
      succeeded: 3,
      failed: 0,
    });
    expect(callOf(0)[1].signal).toBe(controller.signal);
    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({ completed: 2, total: 3 });
  });

  it("结果字段缺失、非整数或负数时视为无效响应", async () => {
    const invalidPayloads: Record<string, unknown>[] = [
      { succeeded: 1 },
      { succeeded: 1.5, failed: 0 },
      { succeeded: -1, failed: 0 },
      { succeeded: "1", failed: 0 },
    ];

    for (const data of invalidPayloads) {
      respondWith([{ event: "complete", data }]);
      await expect(refreshAllAccountBilling()).rejects.toMatchObject({ code: "invalidResponse" });
    }
  });

  it("错误事件使用服务端错误码与文案", async () => {
    respondWith([{ event: "error", data: { code: "accountConversionFailed", message: "原始信息" } }]);
    const error = apiErrorOf(await refreshAllAccountBilling().catch((value: unknown) => value));
    expect(error).toMatchObject({ status: 502, code: "accountConversionFailed" });
    expect(error.message).toBe(i18n.t("apiErrors.accountConversionFailed"));
  });

  it("未知错误码回退为服务端 message，缺少 message 时回退为通用文案", async () => {
    respondWith([{ event: "error", data: { code: "brand_new_error", message: "服务端新错误" } }]);
    const withMessage = apiErrorOf(await refreshAllAccountBilling().catch((value: unknown) => value));
    expect(withMessage.code).toBe("brand_new_error");
    expect(withMessage.message).toBe("服务端新错误");

    respondWith([{ event: "error", data: { code: "brand_new_error" } }]);
    const fallback = apiErrorOf(await refreshAllAccountBilling().catch((value: unknown) => value));
    expect(fallback).toMatchObject({ code: "brand_new_error" });
    expect(fallback.message).toBe(i18n.t("apiErrors.requestFailed"));

    // 兜底错误码本身有 i18n 文案时优先使用文案而不是服务端原始信息。
    respondWith([{ event: "error", data: { message: "原始信息" } }]);
    const localized = apiErrorOf(await refreshAllAccountBilling().catch((value: unknown) => value));
    expect(localized.message).toBe(i18n.t("apiErrors.accountConversionFailed"));
  });

  it("完全没有完成事件时按无效响应处理", async () => {
    respondWith([{ event: "progress", data: { completed: 1, total: 2 } }]);
    await expect(refreshAllAccountTokens()).rejects.toMatchObject({ code: "invalidResponse" });
  });
});

describe("detectBuildAccounts", () => {
  it("全量检测的 item 事件回传完整条目并丢弃非法载荷", async () => {
    const onItem = vi.fn();
    const onProgress = vi.fn();
    respondWith([
      { event: "item", data: { id: "acct-1", name: "alpha", email: "a@example.com", outcome: "ok" } },
      { event: "item", data: { id: "acct-2", name: "beta", outcome: "failed", reason: "超时", httpStatus: 502 } },
      { event: "item", data: { id: "acct-3", name: "gamma", outcome: "unknown-outcome" } },
      { event: "item", data: { name: "缺少 id", outcome: "ok" } },
      { event: "progress", data: { completed: 2, total: 3 } },
      { event: "complete", data: { succeeded: 2, failed: 1 } },
    ]);

    await expect(detectBuildAccounts({ all: true }, { onItem, onProgress })).resolves.toEqual({
      succeeded: 2,
      failed: 1,
    });
    expect(callOf(0)[0]).toBe("/api/admin/v1/accounts/detect");
    expect(callOf(0)[1].body).toEqual({ provider: "grok_build", all: true });
    expect(onItem).toHaveBeenCalledTimes(2);
    expect(onItem.mock.calls[0][0]).toEqual({
      id: "acct-1",
      name: "alpha",
      email: "a@example.com",
      outcome: "ok",
      reason: undefined,
      httpStatus: undefined,
    });
    expect(onProgress).toHaveBeenCalledWith({ completed: 2, total: 3 });
  });

  it("按选中集合提交时携带 ids，且允许只传进度回调或完全不传处理函数", async () => {
    const onProgress = vi.fn();
    respondWith([{ event: "complete", data: { succeeded: 1, failed: 0 } }]);
    await detectBuildAccounts({ ids: ["a", "b"] }, onProgress);
    expect(callOf(0)[1].body).toEqual({ provider: "grok_build", ids: ["a", "b"] });

    respondWith([
      { event: "item", data: { id: "acct-9", name: "delta", outcome: "ok" } },
      { event: "complete", data: { succeeded: 1, failed: 0 } },
    ]);
    await expect(detectBuildAccounts({ all: true })).resolves.toEqual({ succeeded: 1, failed: 0 });

    const controller = new AbortController();
    respondWith([{ event: "complete", data: { succeeded: 1, failed: 0 } }]);
    await detectBuildAccounts({ all: true }, undefined, controller.signal);
    expect(callOf(2)[1].signal).toBe(controller.signal);
  });

  it("检测结果缺失时抛出无效响应", async () => {
    respondWith([{ event: "complete", data: { succeeded: 1 } }]);
    await expect(detectBuildAccounts({ all: true })).rejects.toMatchObject({ code: "invalidResponse" });
  });

  it("检测过程中的错误事件使用检测专属兜底错误码", async () => {
    respondWith([{ event: "error", data: {} }]);
    const error = apiErrorOf(await detectBuildAccounts({ all: true }).catch((value: unknown) => value));
    expect(error).toMatchObject({ code: "accountDetectFailed" });
    expect(error.message).toBe(i18n.t("apiErrors.requestFailed"));
  });
});
