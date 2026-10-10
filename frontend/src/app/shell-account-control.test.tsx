import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "next-themes";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShellAccountControl } from "@/app/shell-account-control";
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

type ShellOptions = {
  path?: string;
  username?: string;
  onNavigate?: () => void;
  onOpenPasswordDialog?: () => void;
};

function renderShell(options: ShellOptions = {}): void {
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider attribute="class" defaultTheme="system">
        <MemoryRouter initialEntries={[options.path ?? "/dashboard"]}>
          <Routes>
            <Route
              path="*"
              element={
                <ShellAccountControl
                  username={options.username ?? "ops"}
                  onNavigate={options.onNavigate ?? (() => {})}
                  onOpenPasswordDialog={options.onOpenPasswordDialog ?? (() => {})}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

/** 打开账号菜单并进入「外观」子菜单。 */
async function openAppearanceMenu(): Promise<void> {
  const u = userEvent.setup();
  await u.click(screen.getByTestId("shell-account-menu"));
  await u.click(screen.getByRole("menuitem", { name: i18n.t("shell.appearance") }));
}

/**
 * 子菜单项用 click 事件驱动：userEvent 的指针序列会先关闭 Radix 子菜单，
 * 导致项在 click 事件派发前被卸载（与审计筛选三级菜单一致）。
 */
async function pickSubmenuItem(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole("menuitem", { name }));
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ShellAccountControl 账号菜单", () => {
  it("用户名与设置入口可见，设置入口在当前路由高亮并触发导航回调", async () => {
    const onNavigate = vi.fn();
    renderShell({ path: "/settings", username: "ops-admin", onNavigate });

    expect(screen.getByText("ops-admin")).toBeInTheDocument();
    const link = screen.getByTestId("shell-settings-link");
    expect(link).toHaveAttribute("href", "/settings");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveAccessibleName(i18n.t("nav.settings"));

    await userEvent.setup().click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("改密菜单项回调与退出登录", async () => {
    const onOpenPasswordDialog = vi.fn();
    const logout = vi.fn(async () => {});
    renderShell({ onOpenPasswordDialog });
    useAuthStore.setState({ logout });

    const u = userEvent.setup();
    await u.click(screen.getByTestId("shell-account-menu"));
    await u.click(await screen.findByTestId("shell-change-password"));
    expect(onOpenPasswordDialog).toHaveBeenCalledTimes(1);

    await u.click(screen.getByTestId("shell-account-menu"));
    await u.click(await screen.findByTestId("shell-sign-out"));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });

  it("外观子菜单切换深色、浅色与跟随系统主题", async () => {
    renderShell();

    await openAppearanceMenu();
    await pickSubmenuItem(i18n.t("shell.dark"));
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(window.localStorage.getItem("theme")).toBe("dark");

    await openAppearanceMenu();
    await pickSubmenuItem(i18n.t("shell.light"));
    await waitFor(() => expect(document.documentElement).not.toHaveClass("dark"));
    expect(window.localStorage.getItem("theme")).toBe("light");

    await openAppearanceMenu();
    await pickSubmenuItem(i18n.t("shell.system"));
    await waitFor(() => expect(window.localStorage.getItem("theme")).toBe("system"));
  });

  it("语言子菜单切换英文与简体中文", async () => {
    renderShell();

    const u = userEvent.setup();
    await u.click(screen.getByTestId("shell-account-menu"));
    await u.click(screen.getByRole("menuitem", { name: i18n.t("shell.language") }));
    await pickSubmenuItem("English");

    await waitFor(() => expect(i18n.language).toBe("en"));
    expect(screen.getByTestId("shell-account-menu")).toHaveAccessibleName(i18n.t("common.actions"));

    await u.click(screen.getByTestId("shell-account-menu"));
    await u.click(screen.getByRole("menuitem", { name: i18n.t("shell.language") }));
    await pickSubmenuItem("简体中文");

    await waitFor(() => expect(i18n.language).toBe("zh-CN"));
    expect(screen.getByTestId("shell-account-menu")).toHaveAccessibleName(i18n.t("common.actions"));
  });
});
