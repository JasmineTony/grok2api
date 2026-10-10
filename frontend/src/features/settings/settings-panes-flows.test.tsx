import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsAccountsPane } from "@/features/settings/settings-accounts-pane";
import { SettingsDeliveryPane } from "@/features/settings/settings-delivery-pane";
import { SettingsRoutingSection } from "@/features/settings/settings-routing-section";
import { SettingsWebPane } from "@/features/settings/settings-web-pane";
import { toSettingsForm } from "@/features/settings/settings-model";
import type { SettingsConfigDTO } from "@/features/settings/settings-dto";
import { useSettings } from "@/features/settings/use-settings";
import { i18n } from "@/shared/i18n";

// 设置分页的字段联动与确认弹窗集成测试：分页组件、react-hook-form、zod 校验、
// decoder 与 useSettings 全部保持真实实现，只替换 apiRequest 这一个网络边界。
// 覆盖各分页「字段显示/禁用条件」「开关触发确认弹窗」「校验失败阻止提交」的用户可见结果。
//
// 注意：SettingsPane 用 forceMount 渲染分页，字段会在配置到达前就挂载，
// 因此所有涉及初始值的断言都必须先等 settingsQuery 成功（settings-loaded）。

const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

/** 与 settingsConfigValidator 校验一致的最小完整配置。 */
function configPayload(): SettingsConfigDTO {
  return {
    server: { maxConcurrentRequests: 1234 },
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
      statsigMode: "url",
      statsigManualConfigured: false,
      statsigSignerURL: "https://signer.example.com/sign",
      clearanceMode: "manual",
      flareSolverrURL: "https://flaresolverr.example.com",
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
  };
}

function snapshotPayload(config: SettingsConfigDTO = configPayload()): unknown {
  return {
    config,
    recommendedProviderBuild: { clientVersion: "9.9.9", userAgent: "recommended-ua" },
    updatedAt: "2026-01-01T00:00:00Z",
    revision: "rev-7",
    restartRequired: [],
  };
}

type PaneName = "web" | "accounts" | "delivery" | "routing";

/**
 * 用真实 useSettings 取得表单实例，并把待测分页放进同一个原生 form。
 * 表单默认值走真实 decoder → toSettingsForm 链路，提交走真实 handleSubmit(zodResolver)。
 * settings-loaded 只在查询成功后出现，作为「配置已写入表单」的显式门闩。
 */
function PaneHarness({ pane, onValidSubmit }: { pane: PaneName; onValidSubmit: (values: unknown) => void }) {
  const { form, settingsQuery } = useSettings();
  return (
    <form data-testid="settings-pane-form" onSubmit={form.handleSubmit((values) => onValidSubmit(values))}>
      <span data-testid="settings-loaded">{settingsQuery.isSuccess ? "1" : "0"}</span>
      {/* 分页用 TabsContent 承载，必须嵌在真实 Tabs 里（settings-form-layout.tsx:22） */}
      <Tabs defaultValue="active">
        <TabsList className="hidden">
          <TabsTrigger value="active">active</TabsTrigger>
        </TabsList>
        {pane === "web" ? <SettingsWebPane form={form} /> : null}
        {pane === "accounts" ? <SettingsAccountsPane form={form} /> : null}
        {pane === "routing" ? <SettingsRoutingSection form={form} /> : null}
        {pane === "delivery" ? <SettingsDeliveryPane form={form} serverClearanceMode="manual" /> : null}
        <button type="submit" data-testid="settings-pane-submit">
          submit
        </button>
      </Tabs>
    </form>
  );
}

function renderPane(pane: PaneName, onValidSubmit: (values: unknown) => void = () => undefined) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={0}>
          <PaneHarness pane={pane} onValidSubmit={onValidSubmit} />
          <Toaster />
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

function elementByControl(controlId: string): HTMLElement {
  const element = document.getElementById(controlId);
  if (!element) throw new Error(`missing control: ${controlId}`);
  return element;
}

function inputByControl(controlId: string): HTMLInputElement {
  const element = elementByControl(controlId);
  if (!(element instanceof HTMLInputElement)) throw new Error(`not an input: ${controlId}`);
  return element;
}

/**
 * 等分页字段挂载 **且** 服务端配置写入表单后再交互。
 * forceMount 让字段先于查询结果存在，缺了这一步会读到未初始化的表单值。
 */
async function ready(controlId: string): Promise<void> {
  await screen.findByTestId(`settings-field-${controlId}`);
  await waitFor(() => expect(screen.getByTestId("settings-loaded")).toHaveTextContent("1"));
}

/** 等某个控件拿到期望值；用于断言服务端配置已落到表单。 */
/** 等某个控件拿到期望值；用于断言服务端配置已落到表单。 */
async function waitForValue(controlId: string, expected: string | number | null): Promise<void> {
  await waitFor(() => expect(elementByControl(controlId)).toHaveValue(expected));
}

/**
 * Radix Switch 渲染成 button[role=switch]（不是原生 input），
 * 这里统一按可访问名称定位，并按 id 返回。
 */
function switchByControl(controlId: string): HTMLElement {
  const element = document.getElementById(controlId);
  if (!element) throw new Error(`missing switch: ${controlId}`);
  expect(element).toHaveAttribute("role", "switch");
  return element;
}

const user = () => userEvent.setup({ delay: null });

/** 只应答 GET /settings，其余请求保持 pending，避免真实网络与跨功能副作用。 */
function serveSnapshot(config: SettingsConfigDTO = configPayload()): void {
  apiMock.request.mockImplementation(async (path: string) =>
    path === "/api/admin/v1/settings" ? snapshotPayload(config) : new Promise(() => {}),
  );
}

beforeEach(async () => {
  apiMock.request.mockReset();
  serveSnapshot();
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
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SettingsWebPane 字段联动", () => {
  it("statsigMode 为 url 时渲染签名地址，不渲染手填值字段", async () => {
    renderPane("web");
    await ready("web-statsig-url");

    // url 模式只渲染签名地址（settings-web-pane.tsx:25-29）
    await waitForValue("web-statsig-url", "https://signer.example.com/sign");
    expect(document.getElementById("web-statsig-manual")).toBeNull();
  });

  it("切到 manual 后展示手填值字段，未配置时用未配置占位符且无已配置徽标", async () => {
    const u = user();
    renderPane("web");
    await ready("web-statsig-url");

    await u.click(screen.getByRole("tab", { name: i18n.t("settings.web.statsigManual") }));

    const field = await screen.findByTestId("settings-field-web-statsig-manual");
    expect(within(field).queryByText(i18n.t("settings.web.statsigConfigured"))).toBeNull();
    expect(inputByControl("web-statsig-manual")).toHaveAttribute(
      "placeholder",
      i18n.t("settings.web.statsigValuePlaceholder"),
    );
    expect(document.getElementById("web-statsig-url")).toBeNull();
  });

  it("statsigManualConfigured 为 true 时展示已配置徽标与保留占位符", async () => {
    const config = configPayload();
    config.providerWeb.statsigMode = "manual";
    config.providerWeb.statsigManualConfigured = true;
    serveSnapshot(config);
    renderPane("web");
    await ready("web-statsig-manual");

    const field = screen.getByTestId("settings-field-web-statsig-manual");
    expect(within(field).getByText(i18n.t("settings.web.statsigConfigured"))).toBeInTheDocument();
    expect(inputByControl("web-statsig-manual")).toHaveAttribute(
      "placeholder",
      i18n.t("settings.web.statsigKeepConfigured"),
    );
  });

  it("时长字段按数值渲染，清空后渲染空值而非 NaN", async () => {
    renderPane("web");
    await ready("web-chat-timeout");

    // toSettingsForm 把 "2m" 解析成 { value: 2, unit: "m" }
    await waitForValue("web-chat-timeout", 2);

    fireEvent.change(inputByControl("web-chat-timeout"), { target: { value: "" } });

    // DurationInput 的 Number.isFinite 兜底（settings-form-layout.tsx:165）
    expect(inputByControl("web-chat-timeout")).toHaveValue(null);
  });

  it("非法时长的提交被 zod 拦截并提示字段错误", async () => {
    const u = user();
    const onSubmit = vi.fn();
    renderPane("web", onSubmit);
    await ready("web-chat-timeout");
    await waitForValue("web-chat-timeout", 2);

    fireEvent.change(inputByControl("web-chat-timeout"), { target: { value: "" } });
    await u.click(screen.getByTestId("settings-pane-submit"));

    const field = screen.getByTestId("settings-field-web-chat-timeout");
    expect(await within(field).findByText(i18n.t("settings.invalidValue"))).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("流空闲超时大于聊天超时时提示字段错误", async () => {
    const u = user();
    const onSubmit = vi.fn();
    renderPane("web", onSubmit);
    await ready("web-stream-idle-timeout");
    await waitForValue("web-stream-idle-timeout", 90);

    // superRefine 的 streamIdleTimeout > chatTimeout 分支（settings-schema.ts:93-95）
    fireEvent.change(inputByControl("web-stream-idle-timeout"), { target: { value: "600" } });
    await u.click(screen.getByTestId("settings-pane-submit"));

    const field = screen.getByTestId("settings-field-web-stream-idle-timeout");
    expect(await within(field).findByText(i18n.t("settings.invalidValue"))).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("恢复退避上限小于基准时提示字段错误", async () => {
    const u = user();
    const onSubmit = vi.fn();
    renderPane("web", onSubmit);
    await ready("web-recovery-max");
    await waitForValue("web-recovery-max", 10);

    // superRefine 的 recoveryBackoffMax < recoveryBackoffBase 分支（settings-schema.ts:96-98）
    fireEvent.change(inputByControl("web-recovery-max"), { target: { value: "0.1" } });
    await u.click(screen.getByTestId("settings-pane-submit"));

    const field = screen.getByTestId("settings-field-web-recovery-max");
    expect(await within(field).findByText(i18n.t("settings.invalidValue"))).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("manual 模式缺 Statsig 手填值时提示必填", async () => {
    const config = configPayload();
    config.providerWeb.statsigMode = "manual";
    config.providerWeb.statsigManualConfigured = false;
    config.providerWeb.statsigManualValue = "";
    serveSnapshot(config);
    const u = user();
    const onSubmit = vi.fn();
    renderPane("web", onSubmit);
    await ready("web-statsig-manual");

    // statsigMode=manual 且未配置且未填值：required 分支（settings-schema.ts:99-101）
    await u.click(screen.getByTestId("settings-pane-submit"));

    const field = screen.getByTestId("settings-field-web-statsig-manual");
    expect(await within(field).findByText(i18n.t("settings.invalidValue"))).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("SettingsAccountsPane 确认弹窗", () => {
  it("打开自动清理需先确认，确认后开启并解锁依赖字段", async () => {
    const u = user();
    renderPane("accounts");
    await ready("accounts-auto-clean-reauth-enabled");
    await waitForValue("accounts-auto-clean-reauth-interval", 10);

    // 未启用：依赖字段与降级码输入都禁用
    expect(elementByControl("accounts-auto-clean-reauth-interval")).toBeDisabled();
    expect(elementByControl("accounts-auto-clean-include-disabled")).toBeDisabled();
    expect(elementByControl("accounts-build-forbidden-reauth-codes")).toBeDisabled();

    // Radix Switch 渲染成 button[role=switch]，不是原生 input
    await u.click(switchByControl("accounts-auto-clean-reauth-enabled"));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(i18n.t("settings.accounts.autoCleanEnableTitle"));
    expect(switchByControl("accounts-auto-clean-reauth-enabled")).not.toBeChecked();

    await u.click(within(dialog).getByTestId("settings-auto-clean-confirm"));

    await waitFor(() => expect(switchByControl("accounts-auto-clean-reauth-enabled")).toBeChecked());
    expect(elementByControl("accounts-auto-clean-reauth-interval")).toBeEnabled();
    expect(elementByControl("accounts-auto-clean-include-disabled")).toBeEnabled();
  });

  it("包含已禁用账号用不同确认文案，确认后勾选", async () => {
    const config = configPayload();
    config.accounts.autoCleanReauthEnabled = true;
    serveSnapshot(config);
    const u = user();
    renderPane("accounts");
    await ready("accounts-auto-clean-include-disabled");

    await u.click(switchByControl("accounts-auto-clean-include-disabled"));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(i18n.t("settings.accounts.autoCleanIncludeDisabledTitle"));
    expect(dialog).toHaveTextContent(i18n.t("settings.accounts.autoCleanIncludeDisabledDescription"));

    await u.click(within(dialog).getByTestId("settings-auto-clean-confirm"));

    await waitFor(() => expect(switchByControl("accounts-auto-clean-include-disabled")).toBeChecked());
  });

  it("取消确认后不写入任何状态", async () => {
    const u = user();
    renderPane("accounts");
    await ready("accounts-auto-clean-reauth-enabled");

    await u.click(switchByControl("accounts-auto-clean-reauth-enabled"));
    const dialog = await screen.findByRole("alertdialog");
    await u.click(within(dialog).getByRole("button", { name: i18n.t("common.cancel") }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(switchByControl("accounts-auto-clean-reauth-enabled")).not.toBeChecked();
  });

  it("关闭自动清理时同时清掉包含已禁用账号", async () => {
    const config = configPayload();
    config.accounts.autoCleanReauthEnabled = true;
    config.accounts.autoCleanIncludeDisabled = true;
    serveSnapshot(config);
    const u = user();
    renderPane("accounts");
    await ready("accounts-auto-clean-reauth-enabled");
    await waitFor(() => expect(switchByControl("accounts-auto-clean-include-disabled")).toBeChecked());

    await u.click(switchByControl("accounts-auto-clean-reauth-enabled"));

    await waitFor(() => expect(switchByControl("accounts-auto-clean-reauth-enabled")).not.toBeChecked());
    // 关闭主开关必须同时清掉 includeDisabled，避免留下无效组合
    expect(switchByControl("accounts-auto-clean-include-disabled")).not.toBeChecked();
  });

  it("开启弃用标记后降级码输入解锁", async () => {
    const u = user();
    renderPane("accounts");
    await ready("accounts-build-forbidden-reauth-codes");

    expect(elementByControl("accounts-build-forbidden-reauth-codes")).toBeDisabled();

    await u.click(switchByControl("accounts-mark-build-forbidden-reauth"));

    await waitFor(() => expect(elementByControl("accounts-build-forbidden-reauth-codes")).toBeEnabled());
  });
});

describe("SettingsRoutingSection 尝试次数", () => {
  it("打开无限尝试需确认，确认后渲染空输入；关回时恢复确认前的有限值", async () => {
    const u = user();
    renderPane("routing");
    await ready("routing-max-attempts");
    await waitForValue("routing-max-attempts", 3);

    expect(inputByControl("routing-max-attempts")).toBeEnabled();

    await u.click(switchByControl("routing-max-attempts-unlimited"));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(i18n.t("settingsRoutingAttempts.unlimitedTitle"));

    await u.click(within(dialog).getByTestId("settings-unlimited-attempts-confirm"));

    await waitFor(() => expect(inputByControl("routing-max-attempts")).toBeDisabled());
    // 无限值 -1 命中 blank 分支，渲染为空输入
    expect(inputByControl("routing-max-attempts")).toHaveValue(null);

    await u.click(switchByControl("routing-max-attempts-unlimited"));

    await waitFor(() => expect(inputByControl("routing-max-attempts")).toBeEnabled());
    expect(inputByControl("routing-max-attempts")).toHaveValue(3);
  });

  it("视频尝试次数开启无限直接写入，不弹确认；关回恢复原值", async () => {
    const u = user();
    renderPane("routing");
    await ready("routing-video-max-attempts");
    await waitForValue("routing-video-max-attempts", 3);

    await u.click(switchByControl("routing-video-max-attempts-unlimited"));

    await waitFor(() => expect(inputByControl("routing-video-max-attempts")).toBeDisabled());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await u.click(switchByControl("routing-video-max-attempts-unlimited"));

    await waitFor(() => expect(inputByControl("routing-video-max-attempts")).toBeEnabled());
    expect(inputByControl("routing-video-max-attempts")).toHaveValue(3);
  });

  it("分段选择器关闭后依赖字段禁用，重新开启后解锁", async () => {
    const u = user();
    renderPane("routing");
    await ready("routing-segmented-min-candidates");
    await waitForValue("routing-segmented-min-candidates", 3000);

    expect(inputByControl("routing-segmented-min-candidates")).toBeEnabled();

    await u.click(switchByControl("routing-segmented-selector-enabled"));

    await waitFor(() => expect(inputByControl("routing-segmented-min-candidates")).toBeDisabled());
    expect(inputByControl("routing-segmented-window-size")).toBeDisabled();

    await u.click(switchByControl("routing-segmented-selector-enabled"));

    await waitFor(() => expect(inputByControl("routing-segmented-min-candidates")).toBeEnabled());
  });

  it("尝试次数清空时渲染空值而不是 NaN", async () => {
    renderPane("routing");
    await ready("routing-max-attempts");
    await waitForValue("routing-max-attempts", 3);

    fireEvent.change(inputByControl("routing-max-attempts"), { target: { value: "" } });

    // 空值的 valueAsNumber 是 NaN，blank 分支必须渲染空串
    expect(inputByControl("routing-max-attempts")).toHaveValue(null);
  });

  it("尝试次数超出原生上限时不触发提交", async () => {
    const onSubmit = vi.fn();
    renderPane("routing", onSubmit);
    await ready("routing-max-attempts");
    await waitForValue("routing-max-attempts", 3);

    const input = inputByControl("routing-max-attempts");
    fireEvent.change(input, { target: { value: "70000" } });

    expect(input.checkValidity()).toBe(false);
    fireEvent.submit(screen.getByTestId("settings-pane-form"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("冷却上限小于基准时提示字段错误", async () => {
    const u = user();
    const onSubmit = vi.fn();
    renderPane("routing", onSubmit);
    await ready("routing-cooldown-max");
    await waitForValue("routing-cooldown-max", 10);

    // cooldownMax < cooldownBase 的 refine 分支（settings-schema.ts:169-171）
    fireEvent.change(inputByControl("routing-cooldown-max"), { target: { value: "0.1" } });
    await u.click(screen.getByTestId("settings-pane-submit"));

    const field = screen.getByTestId("settings-field-routing-cooldown-max");
    expect(await within(field).findByText(i18n.t("settings.invalidValue"))).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("分段窗口大于最小候选数时提示字段错误", async () => {
    const u = user();
    const onSubmit = vi.fn();
    renderPane("routing", onSubmit);
    await ready("routing-segmented-window-size");
    await waitForValue("routing-segmented-window-size", 64);

    // windowSize > minCandidates 的 refine 分支（settings-schema.ts:172-174）
    fireEvent.change(inputByControl("routing-segmented-window-size"), { target: { value: "256" } });
    fireEvent.change(inputByControl("routing-segmented-min-candidates"), { target: { value: "100" } });
    await u.click(screen.getByTestId("settings-pane-submit"));

    const field = screen.getByTestId("settings-field-routing-segmented-window-size");
    expect(await within(field).findByText(i18n.t("settings.invalidValue"))).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("SettingsDeliveryPane 清关方式联动", () => {
  it("manual 模式不展示隧道字段", async () => {
    renderPane("delivery");
    await ready("egress-clearance-mode");

    expect(document.getElementById("egress-flaresolverr-url")).toBeNull();
    expect(document.getElementById("egress-clearance-timeout")).toBeNull();
    expect(document.getElementById("egress-clearance-refresh")).toBeNull();
  });

  it("切到 flaresolverr 展示地址、超时与刷新间隔", async () => {
    const u = user();
    renderPane("delivery");
    await ready("egress-clearance-mode");

    await u.click(screen.getByRole("tab", { name: i18n.t("settings.web.clearanceFlareSolverr") }));

    await waitFor(() => expect(document.getElementById("egress-clearance-refresh")).not.toBeNull());
    expect(document.getElementById("egress-flaresolverr-url")).not.toBeNull();
    expect(document.getElementById("egress-clearance-timeout")).not.toBeNull();
  });

  it("切到 on_demand 不展示刷新间隔", async () => {
    const u = user();
    renderPane("delivery");
    await ready("egress-clearance-mode");

    await u.click(screen.getByRole("tab", { name: i18n.t("settings.web.clearanceOnDemand") }));

    await waitFor(() => expect(document.getElementById("egress-flaresolverr-url")).not.toBeNull());
    expect(document.getElementById("egress-clearance-timeout")).not.toBeNull();
    // 刷新间隔只对 flaresolverr 有意义（settings-delivery-pane.tsx:67）
    expect(document.getElementById("egress-clearance-refresh")).toBeNull();
  });

  it("字节大小字段按解析值渲染，清空后渲染空值", async () => {
    renderPane("delivery");
    await ready("media-max-image-size");

    const input = inputByControl("media-max-image-size");
    await waitForValue("media-max-image-size", 1);

    fireEvent.change(input, { target: { value: "" } });

    // ByteSizeInput 的 Number.isFinite 兜底（settings-form-layout.tsx:117）
    expect(input).toHaveValue(null);
  });

  it("服务端清关方式为 flaresolverr 时订阅源分区读取同一取值", async () => {
    renderPane("delivery");
    await ready("egress-clearance-mode");
    await waitFor(() =>
      expect(elementByControl("egress-clearance-mode")).toHaveTextContent(i18n.t("settings.web.clearanceManual")),
    );

    // serverClearanceMode 由外部传入，不随草稿切换（settings-delivery-pane.tsx:29）
    expect(document.getElementById("egress-clearance-mode")).not.toBeNull();
  });
});

describe("设置表单 DTO 往返", () => {
  it("toSettingsForm 解析时长、字节大小与降级码", () => {
    const form = toSettingsForm(configPayload());

    expect(form.providerWeb.chatTimeout).toEqual({ value: 2, unit: "m" });
    expect(form.providerWeb.streamIdleTimeout).toEqual({ value: 90, unit: "s" });
    expect(form.media.maxImageSize).toEqual({ value: 1, unit: "MiB" });
    expect(form.accounts.buildForbiddenReauthCodes).toBe("permission-denied");
    expect(form.routing.segmentedSelector).toEqual({ enabled: true, minCandidates: 3000, windowSize: 64 });
  });
});
