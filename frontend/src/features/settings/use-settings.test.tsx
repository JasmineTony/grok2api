import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsSnapshotDTO } from "@/features/settings/settings-api";
import { toSettingsForm } from "@/features/settings/settings-model";
import { useSettings } from "@/features/settings/use-settings";
import { i18n } from "@/shared/i18n";

// 只替换网络边界（settings-api）与 toast 展示层；settings-model 的
// toSettingsForm/toSettingsDTO 与 useSettings 本体保持真实实现。
const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/features/settings/settings-api", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

const settingsQueryKey = ["settings"] as const;

function snapshot({ revision = "rev-7", maxConcurrentRequests = 1234 } = {}): SettingsSnapshotDTO {
  return {
    config: {
      server: { maxConcurrentRequests },
      providerBuild: {
        baseURL: "https://build.example.com",
        fallbackBaseURL: "https://fallback.example.com",
        clientVersion: "1.0.0",
        clientIdentifier: "grok2api",
        tokenAuth: "token-auth",
        tokenAuthConfigured: true,
        userAgent: "grok2api/1.0.0",
        responseHeaderTimeout: "30s",
        streamIdleTimeout: "1m",
      },
      providerWeb: {
        baseURL: "https://web.example.com",
        quotaTimeout: "30s",
        chatTimeout: "2m",
        streamIdleTimeout: "1m30s",
        imageTimeout: "5m",
        videoTimeout: "10m",
        statsigMode: "manual",
        statsigManualConfigured: true,
        statsigSignerURL: "",
        clearanceMode: "manual",
        flareSolverrURL: "",
        clearanceTimeout: "1m",
        clearanceRefresh: "1h",
        mediaConcurrency: 2,
        allowNSFW: false,
        recoveryBackoffBase: "1s",
        recoveryBackoffMax: "10s",
      },
      providerConsole: { baseURL: "https://console.example.com", chatTimeout: "5m", streamIdleTimeout: "2m" },
      batch: {
        importConcurrency: 2,
        conversionConcurrency: 2,
        syncConcurrency: 2,
        refreshConcurrency: 2,
        randomDelay: "100ms",
      },
      media: {
        maxImageBytes: 1_048_576,
        maxTotalBytes: 1_073_741_824,
        cleanupThresholdPercent: 90,
        cleanupInterval: "1h",
      },
      frontend: { publicApiBaseURL: "https://api.example.com" },
      routing: {
        stickyTTL: "5m",
        cooldownBase: "1m",
        cooldownMax: "10m",
        capacityWait: "5s",
        maxAttempts: 3,
        videoMaxAttempts: 3,
        preferFreeBuild: true,
        markBuildChatDeniedAsReauth: false,
        accountIsolatedConnections: false,
        segmentedSelector: { enabled: true, minCandidates: 3000, windowSize: 64 },
      },
      audit: { bufferSize: 100, batchSize: 10, flushInterval: "1s", commitDelayMS: 5 },
      clientKeyDefaults: { rpmLimit: 60, maxConcurrent: 5 },
      accounts: {
        markBuildForbiddenReauth: false,
        buildForbiddenReauthCodes: ["permission-denied"],
        excludeBuildBotFlaggedFromScheduling: false,
        autoCleanReauthEnabled: false,
        autoCleanReauthInterval: "10m",
        autoCleanReauthMinAge: "1h",
        autoCleanIncludeDisabled: false,
      },
    },
    recommendedProviderBuild: { clientVersion: "1.0.0", userAgent: "grok2api/1.0.0" },
    updatedAt: "2026-01-01T00:00:00Z",
    revision,
    restartRequired: [],
  };
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  expect(i18n.exists("settings.saved")).toBe(true);
  expect(i18n.exists("errors.generic")).toBe(true);
});

describe("useSettings 查询与表单同步", () => {
  it("查询成功后把服务端配置写入表单", async () => {
    const { wrapper } = setup();
    mocks.getSettings.mockResolvedValue(snapshot());

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => expect(result.current.settingsQuery.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.form.getValues("server.maxConcurrentRequests")).toBe(1234));
  });

  it("reset() 在已有数据时把表单恢复为服务端配置", async () => {
    const { wrapper } = setup();
    mocks.getSettings.mockResolvedValue(snapshot());
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.form.getValues("server.maxConcurrentRequests")).toBe(1234));

    act(() => result.current.form.setValue("server.maxConcurrentRequests", 9999));
    expect(result.current.form.getValues("server.maxConcurrentRequests")).toBe(9999);

    act(() => result.current.reset());

    expect(result.current.form.getValues("server.maxConcurrentRequests")).toBe(1234);
  });

  it("reset() 在查询尚未返回时不修改表单", () => {
    const { wrapper } = setup();
    mocks.getSettings.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.settingsQuery.data).toBeUndefined();

    act(() => result.current.reset());

    expect(result.current.form.getValues("server.maxConcurrentRequests")).toBeUndefined();
  });
});

describe("useSettings 更新流程", () => {
  it("更新成功后写入查询缓存、失效 system-info、重置表单并提示成功", async () => {
    const { wrapper, queryClient } = setup();
    const loaded = snapshot();
    const saved = snapshot({ revision: "rev-8", maxConcurrentRequests: 4321 });
    mocks.getSettings.mockResolvedValue(loaded);
    mocks.updateSettings.mockResolvedValue(saved);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.settingsQuery.data?.revision).toBe("rev-7"));

    await act(async () => {
      await result.current.updateMutation.mutateAsync(toSettingsForm(loaded.config));
    });

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      "rev-7",
      expect.objectContaining({
        server: { maxConcurrentRequests: 1234 },
        clientKeyDefaults: { rpmLimit: 60, maxConcurrent: 5 },
        accounts: expect.objectContaining({ buildForbiddenReauthCodes: ["permission-denied"] }),
      }),
    );
    expect(queryClient.getQueryData(settingsQueryKey)).toEqual(saved);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["system-info"] });
    await waitFor(() => expect(result.current.form.getValues("server.maxConcurrentRequests")).toBe(4321));
    expect(mocks.toastSuccess).toHaveBeenCalledWith(i18n.t("settings.saved"));
  });

  it("查询数据缺失时更新使用 revision 回退值 0", async () => {
    const { wrapper } = setup();
    mocks.getSettings.mockReturnValue(new Promise(() => {}));
    mocks.updateSettings.mockResolvedValue(snapshot({ revision: "rev-1" }));

    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.settingsQuery.data).toBeUndefined();

    await act(async () => {
      await result.current.updateMutation.mutateAsync(toSettingsForm(snapshot().config));
    });

    expect(mocks.updateSettings).toHaveBeenCalledWith("0", expect.any(Object));
  });

  it("更新失败时以错误信息提示", async () => {
    const { wrapper } = setup();
    mocks.getSettings.mockResolvedValue(snapshot());
    mocks.updateSettings.mockRejectedValue(new Error("revision conflict"));

    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.settingsQuery.isSuccess).toBe(true));

    await act(async () => {
      await expect(result.current.updateMutation.mutateAsync(toSettingsForm(snapshot().config))).rejects.toThrow(
        "revision conflict",
      );
    });

    expect(mocks.toastError).toHaveBeenCalledWith("revision conflict");
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("更新失败且错误不是 Error 时回退为通用文案", async () => {
    const { wrapper } = setup();
    mocks.getSettings.mockResolvedValue(snapshot());
    mocks.updateSettings.mockRejectedValue("upstream down");

    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.settingsQuery.isSuccess).toBe(true));

    await act(async () => {
      await expect(result.current.updateMutation.mutateAsync(toSettingsForm(snapshot().config))).rejects.toBe(
        "upstream down",
      );
    });

    expect(mocks.toastError).toHaveBeenCalledWith(i18n.t("errors.generic"));
  });
});
