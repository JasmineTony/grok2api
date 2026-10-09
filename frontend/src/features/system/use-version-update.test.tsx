import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VersionInfoDTO } from "@/entities/system/system-api";
import { useCheckForUpdates, useVersionInfo } from "@/features/system/use-version-update";

// 只替换网络边界（entities/system 的 API 函数），被测 hook 保持真实实现。
const mocks = vi.hoisted(() => ({ getVersionInfo: vi.fn(), checkForUpdates: vi.fn() }));

vi.mock("@/entities/system/system-api", () => ({
  getVersionInfo: mocks.getVersionInfo,
  checkForUpdates: mocks.checkForUpdates,
}));

const versionQueryKey = ["system-version"] as const;

function versionInfo(overrides: Partial<VersionInfoDTO> = {}): VersionInfoDTO {
  return {
    currentVersion: "v1.0.0",
    latestVersion: "v1.1.0",
    updateAvailable: true,
    status: "update_available",
    checkedAt: "2026-01-01T00:00:00Z",
    releaseUrl: "https://example.com/releases/v1.1.0",
    releaseNotes: "- 修复若干问题",
    error: "",
    ...overrides,
  };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
});

afterEach(() => {
  queryClient.clear();
});

describe("useVersionInfo", () => {
  it("查询成功后把版本信息写入 system-version 查询键", async () => {
    const info = versionInfo();
    mocks.getVersionInfo.mockResolvedValue(info);

    const { result } = renderHook(() => useVersionInfo(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(info);
    expect(mocks.getVersionInfo).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(versionQueryKey)).toEqual(info);
  });

  it("查询失败时暴露错误，并按 retry: 1 重试一次", async () => {
    mocks.getVersionInfo.mockRejectedValue(new Error("version check failed"));

    const { result } = renderHook(() => useVersionInfo(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5_000 });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("version check failed");
    // retry: 1 → 首次失败后再试一次；该断言同时固定住重试策略这一对外行为。
    expect(mocks.getVersionInfo).toHaveBeenCalledTimes(2);
  });
});

describe("useCheckForUpdates", () => {
  it("触发检查成功后把结果写入 useVersionInfo 使用的同一查询键", async () => {
    const checked = versionInfo({ status: "up_to_date", updateAvailable: false, latestVersion: "v1.0.0" });
    mocks.checkForUpdates.mockResolvedValue(checked);

    const { result } = renderHook(() => useCheckForUpdates(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(versionQueryKey)).toEqual(checked);
  });

  it("检查失败时抛出错误且不写入查询缓存", async () => {
    mocks.checkForUpdates.mockRejectedValue(new Error("check failed"));

    const { result } = renderHook(() => useCheckForUpdates(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow("check failed");
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData(versionQueryKey)).toBeUndefined();
  });
});
