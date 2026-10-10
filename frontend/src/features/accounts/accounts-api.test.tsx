import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptWebAccountTerms,
  clearAccountCooldown,
  deleteAccount,
  enableWebAccountNSFW,
  getAccountSummary,
  listAccounts,
  pollDeviceAuthorization,
  previewAccountDeletion,
  refreshAccountBilling,
  refreshAccountQuota,
  refreshAccountToken,
  setWebAccountBirthDate,
  startDeviceAuthorization,
  updateAccount,
  type AccountUpdateInput,
} from "@/features/accounts/accounts-api";
import {
  cleanupAccounts,
  deleteAccounts,
  previewCleanup,
  refreshAccountsQuota,
  refreshAccountsTokens,
  resetAccountsQuota,
  resetAllAccountQuota,
  updateAccountsEnabled,
  updateAccountsMaxConcurrent,
} from "@/features/accounts/account-batch-api";
import { exportAccountBatch, exportSelectedAccounts } from "@/features/accounts/account-export-api";
import { createAccountTaskProgressController } from "@/features/accounts/account-task-progress";
import { detectBuildAccounts, refreshAllAccountBilling } from "@/features/accounts/account-task-stream";
import {
  decodeAccount,
  decodeAccountPage,
  decodeAccountSummary,
  decodeBilling,
  decodeDevicePoll,
  decodeDeviceSession,
} from "@/features/accounts/accounts-dto";
import { ApiError } from "@/shared/api/client";

// 账号 API 层请求契约测试（AGENTS.md TEST-3）：只替换网络边界，解码器与请求参数保持真实。
const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  apiDownload: vi.fn(),
  apiDownloadResponse: vi.fn(),
  apiEventStream: vi.fn(),
}));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return {
    ...actual,
    apiRequest: mocks.apiRequest,
    apiDownload: mocks.apiDownload,
    apiDownloadResponse: mocks.apiDownloadResponse,
    apiEventStream: mocks.apiEventStream,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiRequest.mockResolvedValue({ sentinel: true });
  mocks.apiDownload.mockResolvedValue(new Blob(["x"]));
});

function requestCall(index = 0): [string, { method?: string; body?: unknown }, unknown] {
  return mocks.apiRequest.mock.calls[index] as [string, { method?: string; body?: unknown }, unknown];
}

describe("账号 API 请求契约", () => {
  it("列表请求带分页与筛选参数，并使用账号分页解码器", async () => {
    await listAccounts({
      provider: "grok_web",
      page: 2,
      pageSize: 50,
      search: "alpha",
      type: "super",
      status: "active",
      egress: "node:1",
      renewal: "refreshable",
      risk: "flagged",
      agreement: "nsfwEnabled",
      association: "buildLinked",
      sortBy: "name",
      sortOrder: "asc",
    });
    const [path, options, decode] = requestCall();
    expect(path).toContain("page=2");
    expect(path).toContain("pageSize=50");
    expect(path).toContain("search=alpha");
    expect(path).toContain("provider=grok_web");
    expect(path).toContain("sortBy=name");
    expect(options).toEqual({});
    expect(decode).toBe(decodeAccountPage);

    await getAccountSummary();
    expect(requestCall(1)[0]).toBe("/api/admin/v1/accounts/summary");
    expect(requestCall(1)[2]).toBe(decodeAccountSummary);
  });

  it("单账号写入与刷新接口按各自路径与解码器发起请求", async () => {
    // 单账号 PATCH 的请求体即调用方传入的完整 AccountUpdateInput（含调度字段）。
    const rename: AccountUpdateInput = { name: "renamed", priority: 1, maxConcurrent: 8, minimumRemaining: 0 };
    await updateAccount("acct-1", rename);
    expect(requestCall(0)[0]).toBe("/api/admin/v1/accounts/acct-1");
    expect(requestCall(0)[1]).toEqual({ method: "PATCH", body: rename });
    expect(requestCall(0)[2]).toBe(decodeAccount);

    await deleteAccount("acct-1");
    expect(requestCall(1)[1]).toEqual({ method: "DELETE" });
    await deleteAccount("acct-1", { provider: "grok_build", linkedDeleteTargets: ["grok_web"] });
    expect(requestCall(2)[1]).toEqual({
      method: "DELETE",
      body: { provider: "grok_build", linkedDeleteTargets: ["grok_web"] },
    });

    await previewAccountDeletion(["acct-1"], "grok_build", ["grok_web"]);
    expect(requestCall(3)[0]).toBe("/api/admin/v1/accounts/deletion-preview");
    expect(requestCall(3)[1]).toEqual({
      method: "POST",
      body: { ids: ["acct-1"], provider: "grok_build", linkedDeleteTargets: ["grok_web"] },
    });

    await refreshAccountBilling("acct-1");
    expect(requestCall(4)[2]).toBe(decodeBilling);
    await refreshAccountToken("acct-1");
    expect(requestCall(5)[0]).toBe("/api/admin/v1/accounts/acct-1/refresh-token");
    await clearAccountCooldown("acct-1");
    expect(requestCall(6)[0]).toBe("/api/admin/v1/accounts/acct-1/clear-cooldown");
    await refreshAccountQuota("acct-1");
    expect(requestCall(7)[0]).toBe("/api/admin/v1/accounts/acct-1/refresh-quota");
  });

  it("Web 协议动作与设备授权使用各自端点", async () => {
    await acceptWebAccountTerms("acct-1");
    expect(requestCall(0)[0]).toBe("/api/admin/v1/accounts/web/acct-1/accept-terms");
    await setWebAccountBirthDate("acct-1");
    expect(requestCall(1)[0]).toBe("/api/admin/v1/accounts/web/acct-1/birth-date");
    await enableWebAccountNSFW("acct-1");
    expect(requestCall(2)[0]).toBe("/api/admin/v1/accounts/web/acct-1/nsfw");

    await startDeviceAuthorization();
    expect(requestCall(3)[0]).toBe("/api/admin/v1/accounts/device/start");
    expect(requestCall(3)[2]).toBe(decodeDeviceSession);

    const controller = new AbortController();
    await pollDeviceAuthorization("session-1", controller.signal);
    expect(requestCall(4)[0]).toBe("/api/admin/v1/accounts/device/session-1/poll");
    expect(requestCall(4)[1]).toEqual({ method: "POST", signal: controller.signal });
    expect(requestCall(4)[2]).toBe(decodeDevicePoll);
  });
});

describe("批量接口请求契约", () => {
  it("批量状态与并发上限走同一端点但参数不同", async () => {
    await updateAccountsEnabled(["a"], true, "grok_build");
    expect(requestCall(0)[0]).toBe("/api/admin/v1/accounts/batch");
    expect(requestCall(0)[1]).toEqual({ method: "PATCH", body: { ids: ["a"], enabled: true, provider: "grok_build" } });

    await updateAccountsMaxConcurrent(["a"], 4, "grok_web");
    expect(requestCall(1)[1]).toEqual({
      method: "PATCH",
      body: { ids: ["a"], maxConcurrent: 4, provider: "grok_web" },
    });
  });

  it("批量额度、凭据与清理接口路径与载荷正确", async () => {
    await refreshAccountsQuota(["a"], "grok_build");
    expect(requestCall(0)[0]).toBe("/api/admin/v1/accounts/batch/refresh-quotas");
    await resetAccountsQuota(["a"], "grok_build");
    expect(requestCall(1)[0]).toBe("/api/admin/v1/accounts/batch/reset-quota");
    await resetAllAccountQuota();
    expect(requestCall(2)[0]).toBe("/api/admin/v1/accounts/reset-quota");
    await refreshAccountsTokens(["a"], "grok_build");
    expect(requestCall(3)[0]).toBe("/api/admin/v1/accounts/batch/refresh-tokens");

    await cleanupAccounts("grok_build", ["cooldown"]);
    expect(requestCall(4)[1]).toEqual({ method: "POST", body: { provider: "grok_build", statuses: ["cooldown"] } });
    await cleanupAccounts("grok_build", ["cooldown"], ["grok_web"]);
    expect(requestCall(5)[1]).toEqual({
      method: "POST",
      body: { provider: "grok_build", statuses: ["cooldown"], linkedDeleteTargets: ["grok_web"] },
    });
    await previewCleanup("grok_build", ["disabled"]);
    expect(requestCall(6)[0]).toBe("/api/admin/v1/accounts/cleanup-preview");
    await deleteAccounts(["a"], "grok_build", ["grok_web"]);
    expect(requestCall(7)[1]).toEqual({
      method: "DELETE",
      body: { ids: ["a"], provider: "grok_build", linkedDeleteTargets: ["grok_web"] },
    });
  });
});

describe("导出接口请求契约", () => {
  it("按批次导出时解析分页响应头", async () => {
    mocks.apiDownloadResponse.mockResolvedValue({
      blob: new Blob(["{}"]),
      headers: new Headers({
        "X-Exported-Accounts": "2",
        "X-Export-Next-ID": "12",
        "X-Export-Snapshot-Max-ID": "20",
        "X-Export-Has-More": "true",
      }),
    });
    const batch = await exportAccountBatch("grok_build", 1000, "0", "0");
    expect(batch).toEqual({ blob: expect.any(Blob), count: 2, nextId: "12", snapshotMaxId: "20", hasMore: true });
  });

  it("缺少响应头或游标非法时按无效响应处理", async () => {
    mocks.apiDownloadResponse.mockResolvedValue({ blob: new Blob([]), headers: new Headers({}) });
    await expect(exportAccountBatch("grok_build", 10, "0", "0")).rejects.toBeInstanceOf(ApiError);

    mocks.apiDownloadResponse.mockResolvedValue({
      blob: new Blob([]),
      headers: new Headers({
        "X-Exported-Accounts": "1",
        "X-Export-Next-ID": "0",
        "X-Export-Snapshot-Max-ID": "0",
        "X-Export-Has-More": "false",
      }),
    });
    await expect(exportAccountBatch("grok_build", 10, "0", "0")).resolves.toMatchObject({ count: 1, hasMore: false });
  });

  it("按选中集合导出走下载接口", async () => {
    await exportSelectedAccounts("grok_web", ["a", "b"]);
    expect(mocks.apiDownload).toHaveBeenCalledWith("/api/admin/v1/accounts/export", {
      method: "POST",
      body: { provider: "grok_web", ids: ["a", "b"] },
    });
  });
});

describe("账号任务进度控制器", () => {
  function createScheduler() {
    let now = 0;
    const pending: Array<() => void> = [];
    return {
      scheduler: {
        now: () => now,
        setTimeout: (callback: () => void) => {
          pending.push(callback);
          return pending.length;
        },
        clearTimeout: () => undefined,
      },
      advance(ms: number) {
        now += ms;
        const callbacks = pending.splice(0, pending.length);
        for (const callback of callbacks) callback();
      },
    };
  }

  it("进度按间隔节流并保证完成度单调不减", () => {
    const onProgress = vi.fn();
    const clock = createScheduler();
    const controller = createAccountTaskProgressController({
      onProgress,
      intervalMs: 100,
      scheduler: clock.scheduler,
    });

    controller.report({ completed: 3, total: 10 });
    controller.report({ completed: 1, total: 10 });
    expect(onProgress).toHaveBeenCalledWith({ completed: 3, total: 10 });

    clock.advance(100);
    controller.report({ completed: 5, total: 10 });
    controller.flush();
    expect(onProgress).toHaveBeenLastCalledWith({ completed: 5, total: 10 });
    controller.dispose();
  });

  it("阶段按声明顺序推进，未声明的阶段被忽略", () => {
    const onProgress = vi.fn();
    const clock = createScheduler();
    const controller = createAccountTaskProgressController({
      onProgress,
      intervalMs: 0,
      phases: ["importing", "converting", "syncing"],
      scheduler: clock.scheduler,
    });

    controller.report({ completed: 1, total: 3, phase: "syncing" });
    controller.report({ completed: 1, total: 3, phase: "unknown" as never });
    clock.advance(1);
    controller.report({ completed: 2, total: 3, phase: "importing" });
    controller.flush();
    controller.dispose();

    expect(onProgress.mock.calls.length).toBeGreaterThan(0);
    expect(onProgress).toHaveBeenCalled();
  });
});

describe("账号任务流事件处理", () => {
  it("进度与完成事件解析出批量结果", async () => {
    const onProgress = vi.fn();
    mocks.apiEventStream.mockImplementation(
      async (
        _path: string,
        _options: unknown,
        _decode: unknown,
        onEvent: (value: { event: string; data: unknown }) => void,
      ) => {
        onEvent({ event: "progress", data: { completed: 1, total: 2, phase: "syncing" } });
        onEvent({ event: "complete", data: { succeeded: 2, failed: 0 } });
      },
    );

    await expect(refreshAllAccountBilling(onProgress)).resolves.toEqual({ succeeded: 2, failed: 0 });
    expect(onProgress).toHaveBeenCalled();
  });

  it("错误事件按服务端信息抛出，缺少完成事件时视为无效响应", async () => {
    mocks.apiEventStream.mockImplementation(
      async (
        _path: string,
        _options: unknown,
        _decode: unknown,
        onEvent: (value: { event: string; data: unknown }) => void,
      ) => {
        onEvent({ event: "error", data: { code: "accountConversionFailed", message: "转换失败", httpStatus: 502 } });
      },
    );
    await expect(refreshAllAccountBilling()).rejects.toBeInstanceOf(ApiError);

    mocks.apiEventStream.mockImplementation(
      async (
        _path: string,
        _options: unknown,
        _decode: unknown,
        onEvent: (value: { event: string; data: unknown }) => void,
      ) => {
        onEvent({ event: "progress", data: { completed: 1, total: 2 } });
      },
    );
    await expect(refreshAllAccountBilling()).rejects.toMatchObject({ code: "invalidResponse" });
  });

  it("检测任务按 item 事件回调，非法条目被丢弃", async () => {
    const onItem = vi.fn();
    const onProgress = vi.fn();
    mocks.apiEventStream.mockImplementation(
      async (
        _path: string,
        _options: unknown,
        _decode: unknown,
        onEvent: (value: { event: string; data: unknown }) => void,
      ) => {
        onEvent({ event: "item", data: { id: "acct-2", name: "beta", outcome: "invalid", reason: "失效" } });
        onEvent({ event: "item", data: { id: 5 } });
        onEvent({ event: "progress", data: { completed: 1, total: 2 } });
        onEvent({ event: "complete", data: { succeeded: 1, failed: 1 } });
      },
    );

    await expect(detectBuildAccounts({ all: true }, { onProgress, onItem })).resolves.toEqual({
      succeeded: 1,
      failed: 1,
    });
    expect(onItem).toHaveBeenCalledTimes(1);
    expect(onItem).toHaveBeenCalledWith({ id: "acct-2", name: "beta", outcome: "invalid", reason: "失效" });
  });
});
