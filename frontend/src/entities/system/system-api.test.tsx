import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkForUpdates, getSystemInfo, getVersionInfo, type VersionInfoDTO } from "@/entities/system/system-api";
import { ApiError } from "@/shared/api/client";

// 系统信息 API 层直测（AGENTS.md TEST-1/TEST-3）：只替换 apiRequest 网络边界，
// 请求方法/路径与 decoder（含 checkedAt 可空语义）全部走真实实现。

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

type RequestCall = { path: string; method: string | undefined; body: unknown; decode: unknown };

const calls: RequestCall[] = [];

/** 记录请求形状后把 payload 交给被测模块自带的真实 decoder。 */
function respondWith(payload: unknown): void {
  calls.length = 0;
  mocks.apiRequest.mockImplementation(
    async (path: string, options: { method?: string; body?: unknown }, decode: (value: unknown) => unknown) => {
      calls.push({ path, method: options.method, body: options.body, decode });
      return decode(payload);
    },
  );
}

function lastCall(): RequestCall {
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1];
}

function versionInfoWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    currentVersion: "v0.1.2",
    latestVersion: "v0.1.2",
    updateAvailable: false,
    status: "up_to_date",
    checkedAt: "2026-10-11T00:00:00Z",
    releaseUrl: "",
    releaseNotes: "",
    error: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
});

describe("getSystemInfo", () => {
  it("以 GET 请求系统信息并返回解码结果", async () => {
    respondWith({ publicApiBaseURL: "https://api.example.com" });

    const info = await getSystemInfo();

    expect(lastCall().path).toBe("/api/admin/v1/system");
    expect(lastCall().method).toBeUndefined();
    expect(lastCall().body).toBeUndefined();
    expect(typeof lastCall().decode).toBe("function");
    expect(info).toEqual({ publicApiBaseURL: "https://api.example.com" });
  });

  it("拒绝缺少公开地址的响应", async () => {
    respondWith({ publicApiBaseURL: 42 });

    await expect(getSystemInfo()).rejects.toThrow("system info response shape is invalid");
  });
});

describe("getVersionInfo", () => {
  it("以 GET 请求版本信息并保留空 checkedAt", async () => {
    respondWith(versionInfoWire({ checkedAt: null, status: "unchecked", releaseUrl: "", releaseNotes: "" }));

    const info = await getVersionInfo();

    expect(lastCall().path).toBe("/api/admin/v1/system/version");
    expect(lastCall().method).toBeUndefined();
    expect(info).toEqual({
      currentVersion: "v0.1.2",
      latestVersion: "v0.1.2",
      updateAvailable: false,
      status: "unchecked",
      checkedAt: null,
      releaseUrl: "",
      releaseNotes: "",
      error: "",
    });
  });

  it("保留字符串形式的 checkedAt 与可用更新字段", async () => {
    respondWith(
      versionInfoWire({
        latestVersion: "v0.2.0",
        updateAvailable: true,
        status: "update_available",
        checkedAt: "2026-10-11T08:30:00Z",
        releaseUrl: "https://example.com/releases/v0.2.0",
        releaseNotes: "- 新增特性",
      }),
    );

    const info = await getVersionInfo();

    expect(info.checkedAt).toBe("2026-10-11T08:30:00Z");
    expect(info.updateAvailable).toBe(true);
    expect(info.status).toBe("update_available");
    expect(info.releaseUrl).toBe("https://example.com/releases/v0.2.0");
    expect(info.releaseNotes).toBe("- 新增特性");
  });

  it("拒绝既非 null 也非字符串的 checkedAt 与未知状态", async () => {
    respondWith(versionInfoWire({ checkedAt: 1_700_000_000 }));
    await expect(getVersionInfo()).rejects.toThrow("version info response shape is invalid");

    respondWith(versionInfoWire({ status: "unknown_status" }));
    await expect(getVersionInfo()).rejects.toThrow("version info response shape is invalid");
  });

  it("把请求失败原样向上抛出", async () => {
    const failure = new ApiError(503, "requestFailed", "服务不可用");
    mocks.apiRequest.mockRejectedValue(failure);

    await expect(getVersionInfo()).rejects.toBe(failure);
  });
});

describe("checkForUpdates", () => {
  it("以 POST 触发检查并返回解码后的版本信息", async () => {
    respondWith(
      versionInfoWire({
        latestVersion: "v0.2.0",
        updateAvailable: true,
        status: "update_available",
        checkedAt: "2026-10-11T09:00:00Z",
        releaseUrl: "https://example.com/releases/v0.2.0",
      }),
    );

    const info = await checkForUpdates();

    expect(lastCall().path).toBe("/api/admin/v1/system/update/check");
    expect(lastCall().method).toBe("POST");
    expect(lastCall().body).toBeUndefined();
    expect(info.status).toBe("update_available");
    expect(info.latestVersion).toBe("v0.2.0");
    expect(info.checkedAt).toBe("2026-10-11T09:00:00Z");
  });

  it("检查失败时保留 check_failed 状态与服务端错误", async () => {
    respondWith(
      versionInfoWire({
        status: "check_failed",
        checkedAt: null,
        error: "上游不可达",
      }),
    );

    const info: VersionInfoDTO = await checkForUpdates();

    expect(info.status).toBe("check_failed");
    expect(info.error).toBe("上游不可达");
    expect(info.checkedAt).toBeNull();
  });

  it("拒绝形状不合法的检查结果", async () => {
    respondWith(versionInfoWire({ updateAvailable: "true" }));

    await expect(checkForUpdates()).rejects.toThrow("version info response shape is invalid");
  });
});
