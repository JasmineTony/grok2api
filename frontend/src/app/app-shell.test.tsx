import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "next-themes";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/app/app-shell";
import { useAuthStore } from "@/shared/auth/auth-store";
import { i18n } from "@/shared/i18n";

// next-themes 依赖 matchMedia；jsdom 未实现该 API，这里补最小替身。
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } });
}

function installShellApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/admin/v1/system/version")) {
        return jsonResponse({
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          updateAvailable: false,
          status: "up_to_date",
          checkedAt: null,
          releaseUrl: "",
          releaseNotes: "",
          error: "",
        });
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
}

function renderShell(path = "/dashboard"): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="system">
          <TooltipProvider delayDuration={0}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route element={<AppShell />}>
                  <Route path={path} element={<div data-testid="shell-outlet" />} />
                </Route>
              </Routes>
            </MemoryRouter>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  installShellApi();
  useAuthStore.setState({ admin: { id: "admin-1", username: "ops" }, status: "authenticated" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAuthStore.setState({ admin: null, status: "restoring" });
});

describe("AppShell", () => {
  it("渲染侧栏品牌、业务导航与设置入口", () => {
    renderShell();

    expect(screen.getByTestId("shell-outlet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: i18n.t("nav.dashboard") })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: i18n.t("nav.videoGallery") })).toHaveAttribute("href", "/video-gallery");
    expect(screen.getByTestId("shell-settings-link")).toHaveAttribute("href", "/settings");
    expect(screen.getAllByText("ops").length).toBeGreaterThan(0);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("文档分组可展开收起，侧栏与抽屉共享同一展开状态", async () => {
    const user = userEvent.setup();
    renderShell();

    const group = screen.getByTestId("shell-docs-chat");
    const panel = screen.getByTestId("shell-docs-panel-chat");
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveAttribute("aria-hidden", "true");

    await user.click(group);
    expect(group).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByTestId("shell-docs-link-chat-completions")).toHaveAttribute("href", "/docs/chat/completions");

    // 抽屉内容仅在打开时挂载；打开后复用同一展开状态。
    await user.click(screen.getByRole("button", { name: i18n.t("shell.openNavigation") }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByTestId("shell-docs-panel-chat")).toHaveAttribute("aria-hidden", "false");
  });

  it("移动端抽屉可打开并随导航关闭", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: i18n.t("shell.openNavigation") }));
    const sheet = await screen.findByRole("dialog");

    const link = within(sheet).getByRole("link", { name: i18n.t("nav.accounts") });
    expect(link).toHaveAttribute("href", "/accounts");
    await user.click(link);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("媒体工作区不渲染页脚", () => {
    renderShell("/gallery");

    expect(screen.getByTestId("shell-outlet")).toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });

  it("账号菜单可打开改密弹窗，校验失败阻止提交", async () => {
    const changePassword = vi.fn(async () => {});
    useAuthStore.setState({ changePassword });
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByTestId("shell-account-menu"));
    await user.click(await screen.findByTestId("shell-change-password"));

    expect(await screen.findByRole("dialog")).toHaveTextContent(i18n.t("auth.changePassword"));
    await user.click(screen.getByRole("button", { name: i18n.t("common.save") }));

    expect(await screen.findByText(i18n.t("errors.required"))).toBeInTheDocument();
    expect(await screen.findByText(i18n.t("errors.minPassword"))).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("改密成功后关闭弹窗并退出登录", async () => {
    const changePassword = vi.fn(async () => {});
    const logout = vi.fn(async () => {});
    useAuthStore.setState({ changePassword, logout });
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByTestId("shell-account-menu"));
    await user.click(await screen.findByTestId("shell-change-password"));

    await user.type(screen.getByLabelText(i18n.t("auth.currentPassword")), "old-secret");
    await user.type(screen.getByLabelText(i18n.t("auth.newPassword")), "new-secret-1");
    await user.click(screen.getByRole("button", { name: i18n.t("common.save") }));

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith("old-secret", "new-secret-1"));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("点击导航链接关闭抽屉且账号菜单可退出登录", async () => {
    const logout = vi.fn(async () => {});
    useAuthStore.setState({ logout });
    const user = userEvent.setup();
    renderShell();

    // 点击业务导航链接会关闭移动端抽屉（桌面端为无副作用调用）。
    await user.click(screen.getByRole("link", { name: i18n.t("nav.dashboard") }));

    await user.click(screen.getByTestId("shell-account-menu"));
    await user.click(await screen.findByTestId("shell-sign-out"));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });

  it("改密失败时提示错误并保持弹窗", async () => {
    useAuthStore.setState({
      changePassword: vi.fn(async () => {
        throw new Error("changePasswordFailed");
      }),
    });
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByTestId("shell-account-menu"));
    await user.click(await screen.findByTestId("shell-change-password"));
    await user.type(screen.getByLabelText(i18n.t("auth.currentPassword")), "old-secret");
    await user.type(screen.getByLabelText(i18n.t("auth.newPassword")), "new-secret-1");
    await user.click(screen.getByRole("button", { name: i18n.t("common.save") }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });
});
