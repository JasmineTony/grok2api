import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsPage } from "@/features/settings/settings-page";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 设置关键路径组件集成测试（AGENTS.md TEST-3）：只替换 apiRequest 这一网络边界；
// 页面组件、react-query 状态流、DTO decoder、zod 校验与 revision 乐观并发全部保持真实实现。
const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

// 出口节点面板属于并行维护范围且有独立测试；这里只替换该面板组件，
// 设置表单、use-settings、decoder 与 zod 校验仍为真实实现。
vi.mock("@/features/settings/egress-nodes", () => ({
  EgressNodes: ({ title, clearanceMode }: { title: string; clearanceMode: string }) => (
    <div data-testid="settings-egress-nodes-stub" data-clearance-mode={clearanceMode}>
      {title}
    </div>
  ),
}));

// 页面按 forceMount 同时挂载 8 个分页、约 60 个 Radix 字段，单次渲染较重；
// 放宽单测超时只覆盖渲染成本，不用来掩盖失败断言。
vi.setConfig({ testTimeout: 20_000 });

type RecordedCall = { path: string; method: string; body: unknown };
type SettingsApiHandler = (call: RecordedCall) => unknown;

const calls: RecordedCall[] = [];

/** 只路由 /settings；其余常驻挂载的面板保持 pending，避免真实网络请求。 */
function installSettingsApi(handler: SettingsApiHandler): void {
  calls.length = 0;
  apiMock.request.mockImplementation(
    async (path: string, options: { method?: string; body?: unknown }, decode: (value: unknown) => unknown) => {
      const [target] = path.split("?");
      if (target !== "/api/admin/v1/settings") return new Promise(() => {});
      const call: RecordedCall = { path: target, method: options.method ?? "GET", body: options.body };
      calls.push(call);
      return decode(await handler(call));
    },
  );
}

function settingsPayload(overrides: { revision?: string; maxConcurrentRequests?: number } = {}) {
  return {
    config: {
      server: { maxConcurrentRequests: overrides.maxConcurrentRequests ?? 1234 },
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
    revision: overrides.revision ?? "rev-7",
    restartRequired: [],
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={0}>
          <SettingsPage />
          <Toaster />
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

function saveButton(): HTMLElement {
  return screen.getByTestId("settings-save");
}

function putCalls(): RecordedCall[] {
  return calls.filter((call) => call.method === "PUT");
}

function inputByControl(controlId: string): HTMLInputElement {
  const element = document.getElementById(controlId);
  if (!(element instanceof HTMLInputElement)) throw new Error(`missing input: ${controlId}`);
  return element;
}

/** 等待对应字段挂载（配置加载完成后才渲染分页）并返回其输入框。 */
async function findInput(controlId: string): Promise<HTMLInputElement> {
  await screen.findByTestId(`settings-field-${controlId}`);
  return inputByControl(controlId);
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("设置页加载状态", () => {
  it("加载成功后渲染服务端配置，未修改时禁用保存", async () => {
    installSettingsApi(() => settingsPayload());
    renderPage();

    expect(await screen.findByRole("heading", { name: i18n.t("settings.title") })).toBeInTheDocument();
    const baseURLField = await screen.findByTestId("settings-field-provider-base-url");
    expect(within(baseURLField).getByRole("textbox")).toHaveValue("https://build.example.com");
    expect(inputByControl("server-max-concurrent-requests")).toHaveValue(1234);
    expect(saveButton()).toBeDisabled();
    expect(screen.getByTestId("settings-reset")).toBeDisabled();
    expect(screen.getByTestId("settings-egress-nodes-stub")).toHaveAttribute("data-clearance-mode", "manual");
  });

  it("加载失败时展示错误信息与重试入口", async () => {
    installSettingsApi(() => {
      throw new ApiError(500, "requestFailed", "settings unavailable");
    });
    renderPage();

    expect(await screen.findByText("settings unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("common.retry") })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: i18n.t("settings.title") })).not.toBeInTheDocument();
  });

  it("点击重试会重新拉取配置并渲染表单", async () => {
    let attempt = 0;
    installSettingsApi(() => {
      attempt += 1;
      if (attempt === 1) throw new ApiError(500, "requestFailed", "settings unavailable");
      return settingsPayload();
    });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("settings unavailable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: i18n.t("common.retry") }));

    expect(await screen.findByRole("heading", { name: i18n.t("settings.title") })).toBeInTheDocument();
    expect(screen.queryByText("settings unavailable")).not.toBeInTheDocument();
    expect(attempt).toBe(2);
  });

  it("旧后端缺失 accounts/segmentedSelector 时用默认值补齐表单", async () => {
    installSettingsApi(() => {
      const payload = settingsPayload();
      const config = payload.config as Record<string, unknown>;
      delete config.accounts;
      const routing = config.routing as Record<string, unknown>;
      delete routing.segmentedSelector;
      const providerWeb = config.providerWeb as Record<string, unknown>;
      providerWeb.streamIdleTimeout = "";
      return payload;
    });
    renderPage();

    await screen.findByTestId("settings-field-routing-segmented-min-candidates");
    expect(inputByControl("routing-segmented-min-candidates")).toHaveValue(3000);
    expect(inputByControl("routing-segmented-window-size")).toHaveValue(64);
    expect(inputByControl("web-stream-idle-timeout")).toHaveValue(90);
    expect(inputByControl("accounts-auto-clean-reauth-interval")).toHaveValue(10);
    expect(saveButton()).toBeDisabled();
  });
});

describe("设置页保存与乐观并发", () => {
  it("保存成功时携带当前 revision 并提示已保存", async () => {
    installSettingsApi((call) =>
      call.method === "PUT" ? settingsPayload({ revision: "rev-8", maxConcurrentRequests: 4321 }) : settingsPayload(),
    );
    const user = userEvent.setup();
    renderPage();

    const input = await findInput("server-max-concurrent-requests");
    fireEvent.change(input, { target: { value: "4321" } });
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(putCalls()[0].body).toMatchObject({
      revision: "rev-7",
      config: { server: { maxConcurrentRequests: 4321 } },
    });
    expect(await screen.findByText(i18n.t("settings.saved"))).toBeInTheDocument();
    await waitFor(() => expect(input).toHaveValue(4321));
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  it("版本冲突（revision 不匹配）时提示后端错误并保留草稿", async () => {
    installSettingsApi((call) => {
      if (call.method === "PUT") throw new ApiError(409, "revisionConflict", "settings revision conflict");
      return settingsPayload();
    });
    const user = userEvent.setup();
    renderPage();

    const input = await findInput("server-max-concurrent-requests");
    fireEvent.change(input, { target: { value: "9999" } });
    await user.click(saveButton());

    expect(await screen.findByText("settings revision conflict")).toBeInTheDocument();
    expect(input).toHaveValue(9999);
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByText(i18n.t("settings.saved"))).not.toBeInTheDocument();
  });

  it("必填字段被清空时阻止提交并提示字段错误", async () => {
    installSettingsApi(() => settingsPayload());
    const user = userEvent.setup();
    renderPage();

    const input = await findInput("provider-base-url");
    fireEvent.change(input, { target: { value: "" } });
    await user.click(saveButton());

    const field = screen.getByTestId("settings-field-provider-base-url");
    expect(await within(field).findByText(i18n.t("settings.invalidValue"))).toBeInTheDocument();
    expect(putCalls()).toHaveLength(0);
  });

  it("非法数值（必填数值被清空）时阻止提交并提示字段错误", async () => {
    installSettingsApi(() => settingsPayload());
    const user = userEvent.setup();
    renderPage();

    const input = await findInput("web-free-video-duration-cap");
    fireEvent.change(input, { target: { value: "" } });
    await user.click(saveButton());

    const field = screen.getByTestId("settings-field-web-free-video-duration-cap");
    expect(await within(field).findByText(i18n.t("settings.invalidValue"))).toBeInTheDocument();
    expect(putCalls()).toHaveLength(0);
  });

  it("超出原生上限的数值被浏览器校验拦截，不触发提交", async () => {
    installSettingsApi(() => settingsPayload());
    const user = userEvent.setup();
    renderPage();

    const input = await findInput("server-max-concurrent-requests");
    fireEvent.change(input, { target: { value: "100001" } });

    expect(input.checkValidity()).toBe(false);
    await user.click(saveButton());
    expect(putCalls()).toHaveLength(0);
  });

  it("敏感字段留空不回显，保存时也不回填", async () => {
    installSettingsApi((call) => (call.method === "PUT" ? settingsPayload({ revision: "rev-8" }) : settingsPayload()));
    const user = userEvent.setup();
    renderPage();

    const secret = await findInput("web-statsig-manual");
    expect(secret).toHaveValue("");
    expect(secret).toHaveAttribute("placeholder", i18n.t("settings.web.statsigKeepConfigured"));

    const input = inputByControl("server-max-concurrent-requests");
    fireEvent.change(input, { target: { value: "2048" } });
    await user.click(saveButton());

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    const body = putCalls()[0].body as { config: { providerWeb: { statsigManualValue: string } } };
    expect(body.config.providerWeb.statsigManualValue).toBe("");
  });

  it("重置按钮恢复服务端配置并禁用保存", async () => {
    installSettingsApi(() => settingsPayload());
    const user = userEvent.setup();
    renderPage();

    const input = await findInput("provider-base-url");
    fireEvent.change(input, { target: { value: "https://changed.example.com" } });
    expect(input).toHaveValue("https://changed.example.com");
    expect(saveButton()).toBeEnabled();

    await user.click(screen.getByTestId("settings-reset"));

    await waitFor(() => expect(input).toHaveValue("https://build.example.com"));
    expect(saveButton()).toBeDisabled();
  });
});

describe("设置页分页导航", () => {
  it("切换分页后对应触发器成为当前项", async () => {
    installSettingsApi(() => settingsPayload());
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByTestId("settings-tab-build")).toHaveAttribute("data-state", "active");

    const webTab = screen.getByTestId("settings-tab-web");
    await user.click(webTab);

    await waitFor(() => expect(webTab).toHaveAttribute("data-state", "active"));
    expect(screen.getByTestId("settings-pane-web")).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("settings-pane-build")).toHaveAttribute("data-state", "inactive");
  });
});
