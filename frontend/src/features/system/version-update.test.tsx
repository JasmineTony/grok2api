import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VersionInfoDTO } from "@/entities/system/system-api";
import { CurrentVersionLabel, VersionUpdateBanner, VersionUpdateSection } from "@/features/system/version-update";
import { i18n } from "@/shared/i18n";
import { formatDateTime } from "@/shared/lib/format";

// 版本更新展示层测试（AGENTS.md TEST-1/TEST-3）：只替换网络边界（entities/system 的 API 函数），
// 版本查询 hook、缓存与展示组件保持真实，断言加载 / 有更新 / 无更新 / 检查失败四条用户可见路径。

const mocks = vi.hoisted(() => ({ getVersionInfo: vi.fn(), checkForUpdates: vi.fn() }));

vi.mock("@/entities/system/system-api", () => ({
  getVersionInfo: mocks.getVersionInfo,
  checkForUpdates: mocks.checkForUpdates,
}));

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

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

function renderPanel(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const user = userEvent.setup();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </I18nextProvider>,
  );
  return { ...view, user, client };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("zh-CN");
});

describe("CurrentVersionLabel", () => {
  it("版本未知时不渲染任何内容", async () => {
    mocks.getVersionInfo.mockRejectedValue(new Error("offline"));
    const { container } = renderPanel(<CurrentVersionLabel />);

    await waitFor(() => expect(mocks.getVersionInfo).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("版本已知时展示当前版本号", async () => {
    mocks.getVersionInfo.mockResolvedValue(versionInfo({ currentVersion: "v9.9.9" }));
    renderPanel(<CurrentVersionLabel />);

    expect(await screen.findByText("v9.9.9")).toBeInTheDocument();
  });
});

describe("VersionUpdateBanner", () => {
  it("无可用更新时不渲染横幅", async () => {
    mocks.getVersionInfo.mockResolvedValue(versionInfo({ updateAvailable: false, status: "up_to_date" }));
    const { container } = renderPanel(<VersionUpdateBanner />);

    await waitFor(() => expect(mocks.getVersionInfo).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("有可用更新时展示新版本、发布链接与检查入口", async () => {
    mocks.getVersionInfo.mockResolvedValue(versionInfo());
    renderPanel(<VersionUpdateBanner />);

    expect(await screen.findByText(t("updates.available", { version: "v1.1.0" }))).toBeInTheDocument();
    expect(screen.getByText(t("updates.currentSummary", { version: "v1.0.0" }))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(t("updates.viewRelease")) })).toHaveAttribute(
      "href",
      "https://example.com/releases/v1.1.0",
    );
    expect(screen.getByRole("button", { name: t("updates.checkNow") })).toBeEnabled();
  });

  it("缺少发布链接时不渲染链接与分隔线", async () => {
    mocks.getVersionInfo.mockResolvedValue(versionInfo({ releaseUrl: "" }));
    const { container } = renderPanel(<VersionUpdateBanner />);

    await screen.findByText(t("updates.available", { version: "v1.1.0" }));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector(".bg-border\\/70")).toBeNull();
  });

  it("检查进行中禁用按钮并显示加载指示", async () => {
    mocks.getVersionInfo.mockResolvedValue(versionInfo());
    mocks.checkForUpdates.mockImplementation(() => new Promise(() => undefined));
    const { user } = renderPanel(<VersionUpdateBanner />);

    const button = await screen.findByRole("button", { name: t("updates.checkNow") });
    await user.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(within(button).getByRole("status")).toBeInTheDocument();
  });
});

describe("VersionUpdateSection", () => {
  it("加载中展示占位文案", () => {
    mocks.getVersionInfo.mockImplementation(() => new Promise(() => undefined));
    renderPanel(<VersionUpdateSection />);

    expect(screen.getByText(t("updates.title"))).toBeInTheDocument();
    expect(screen.getByText(t("common.loading"))).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.getByText(t("updates.notChecked"))).toBeInTheDocument();
    expect(screen.getByText(t("updates.neverChecked"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(t("updates.checkNow")) })).toBeDisabled();
  });

  it("已检查到可用更新时展示状态点与发布说明", async () => {
    mocks.getVersionInfo.mockResolvedValue(versionInfo());
    const { container } = renderPanel(<VersionUpdateSection />);

    expect(await screen.findByText("v1.1.0")).toBeInTheDocument();
    expect(screen.getByText(t("updates.status.update_available"))).toBeInTheDocument();
    expect(container.querySelector(".bg-amber-500")).not.toBeNull();
    expect(screen.getByText(t("updates.releaseNotes"))).toBeInTheDocument();
    expect(screen.getByText("- 修复若干问题")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(t("updates.openRelease")) })).toHaveAttribute(
      "href",
      "https://example.com/releases/v1.1.0",
    );
    expect(screen.getByText(formatDateTime("2026-01-01T00:00:00Z", i18n.language))).toBeInTheDocument();
  });

  it("已是最新版本时状态点为绿色", async () => {
    mocks.getVersionInfo.mockResolvedValue(
      versionInfo({ updateAvailable: false, status: "up_to_date", latestVersion: "v1.0.0" }),
    );
    const { container } = renderPanel(<VersionUpdateSection />);

    expect(await screen.findByText(t("updates.status.up_to_date"))).toBeInTheDocument();
    expect(container.querySelector(".bg-emerald-500")).not.toBeNull();
    expect(container.querySelector(".bg-amber-500")).toBeNull();
  });

  it("检查失败时状态点为错误色并展示服务端错误", async () => {
    mocks.getVersionInfo.mockResolvedValue(
      versionInfo({ status: "check_failed", updateAvailable: false, error: "上游不可达" }),
    );
    const { container } = renderPanel(<VersionUpdateSection />);

    expect(await screen.findByText("上游不可达")).toBeInTheDocument();
    expect(container.querySelector(".bg-destructive")).not.toBeNull();
    expect(screen.getByText(t("updates.status.check_failed"))).toBeInTheDocument();
  });

  it("只有链接没有说明时回退为占位说明", async () => {
    mocks.getVersionInfo.mockResolvedValue(versionInfo({ releaseNotes: "" }));
    renderPanel(<VersionUpdateSection />);

    expect(await screen.findByText(t("updates.noReleaseNotes"))).toBeInTheDocument();
  });

  it("既无说明也无链接时不渲染发布说明区", async () => {
    mocks.getVersionInfo.mockResolvedValue(versionInfo({ releaseNotes: "", releaseUrl: "" }));
    renderPanel(<VersionUpdateSection />);

    await screen.findByText("v1.1.0");
    expect(screen.queryByText(t("updates.releaseNotesHelp"))).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("查询失败时把请求错误暴露给用户", async () => {
    mocks.getVersionInfo.mockRejectedValue(new Error("请求版本信息失败"));
    renderPanel(<VersionUpdateSection />);

    // retry: 1 由 useVersionInfo 固定，失败后需要重试一次才暴露错误。
    expect(await screen.findByText("请求版本信息失败", {}, { timeout: 5_000 })).toBeInTheDocument();
  });

  it("手动检查成功后把结果写回同一份版本信息", async () => {
    mocks.getVersionInfo.mockResolvedValue(
      versionInfo({ updateAvailable: false, status: "up_to_date", latestVersion: "v1.0.0" }),
    );
    mocks.checkForUpdates.mockResolvedValue(
      versionInfo({ updateAvailable: true, status: "update_available", latestVersion: "v2.0.0" }),
    );
    const { user } = renderPanel(<VersionUpdateSection />);

    await user.click(await screen.findByRole("button", { name: t("updates.checkNow") }));
    await waitFor(() => expect(mocks.checkForUpdates).toHaveBeenCalledTimes(1));

    expect(await screen.findByText("v2.0.0")).toBeInTheDocument();
    expect(screen.getByText(t("updates.status.update_available"))).toBeInTheDocument();
  });

  it("检查失败时优先展示检查错误而不是请求错误", async () => {
    mocks.getVersionInfo.mockResolvedValue(versionInfo({ status: "up_to_date", updateAvailable: false, error: "" }));
    mocks.checkForUpdates.mockRejectedValue(new Error("手动检查失败"));
    const { user } = renderPanel(<VersionUpdateSection />);

    await user.click(await screen.findByRole("button", { name: t("updates.checkNow") }));

    expect(await screen.findByText("手动检查失败")).toBeInTheDocument();
  });
});
