import type { Page } from "@playwright/test";

import {
  accountControlScope,
  closeMobileNavigation,
  expect,
  openMobileNavigation,
  openNavigation,
  signIn,
  test,
} from "./fixtures";

const dashboardHeadingName = /^(仪表盘|Dashboard)$/;
const accountsHeadingName = /^(上游账号|Upstream accounts)$/;
const settingsHeadingName = /^(运行设置|Runtime settings)$/;
const navigationName = /^(导航|Navigation)$/;
const openNavigationName = /^(打开导航|Open navigation)$/;
const actionsName = /^(操作|Actions)$/;
const appearanceName = /^(外观|Appearance)$/;
const languageName = /^(语言|Language)$/;
const portrait = { width: 375, height: 812 };
const landscape = { width: 812, height: 375 };

/**
 * 使用真实菜单的键盘事件选择偏好，不直接注入 localStorage 或应用状态。
 * 菜单入口按当前布局取：桌面常驻侧栏，移动端在抽屉内（作用域由 accountControlScope 决定）。
 */
async function chooseAccountOption(page: Page, submenuName: RegExp, optionName: string | RegExp): Promise<void> {
  const scope = await accountControlScope(page);
  const trigger = scope.getByRole("button", { name: actionsName });
  await expect(trigger).toHaveAttribute("data-testid", "shell-account-menu");
  await trigger.press("Enter");
  await page.getByRole("menuitem", { name: submenuName }).press("ArrowRight");
  const option = page.getByRole("menuitem", { name: optionName, exact: true });
  await expect(option).toBeVisible();
  await option.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}

async function expectTheme(
  page: Page,
  preference: "light" | "dark" | "system",
  resolved: "light" | "dark",
): Promise<void> {
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${resolved}\\b`));
  await expect(page.locator("html")).toHaveCSS("color-scheme", resolved);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe(preference);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
            document.documentElement.clientWidth,
        ),
      { message: "页面不应横向溢出视口" },
    )
    .toBeLessThanOrEqual(0);
}

/** 分别验证菜单与抽屉的 Escape 层级、焦点归还和关闭按钮键盘操作。 */
async function expectMobileNavigationKeyboard(page: Page): Promise<void> {
  const dialog = await openMobileNavigation(page);
  const accountMenu = dialog.getByRole("button", { name: actionsName });
  await expect(accountMenu).toBeInViewport();
  await expect(accountMenu).toHaveAttribute("data-testid", "shell-account-menu");
  await accountMenu.press("Enter");
  for (const name of [appearanceName, languageName, /^(修改密码|Change password)$/, /^(退出登录|Sign out)$/]) {
    await expect(page.getByRole("menuitem", { name })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(accountMenu).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const trigger = page.getByRole("button", { name: openNavigationName });
  await expect(trigger).toBeFocused();

  const reopened = await openMobileNavigation(page);
  const close = reopened.getByRole("button", { name: /^(关闭|Close)$/ });
  await expect(close).toBeInViewport();
  await close.press("Enter");
  await expect(reopened).toBeHidden();
  await expect(trigger).toBeFocused();
}

// 本组断言依赖桌面布局本身：常驻侧栏可见、移动端抽屉触发按钮隐藏（display:none），
// 移动 project（Pixel 5）由 playwright.config.ts 的 grepInvert 明确排除，两条断言不做任何放宽。
// 其余导航与偏好用例改用与 project 无关的入口（openNavigation / accountControlScope），两个 project 都运行。
test.describe("桌面导航布局", { tag: "@desktop" }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("侧栏导航到账号和设置，深链接刷新后保持页面与当前导航状态", async ({ page, server }) => {
    await signIn(page, server);
    const navigation = page.getByRole("navigation", { name: navigationName });
    await expect(navigation).toBeVisible();
    await expect(page.getByRole("button", { name: openNavigationName })).toBeHidden();
    const accounts = navigation.getByTestId("shell-nav-accounts");
    await expect(accounts).toHaveAccessibleName(/^(账号|Accounts)$/);
    await accounts.click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByRole("heading", { name: accountsHeadingName })).toBeVisible();
    await expect(accounts).toHaveAttribute("aria-current", "page");

    await page.reload();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByRole("heading", { name: accountsHeadingName })).toBeVisible();
    await expect(accounts).toHaveAttribute("aria-current", "page");
    await expect(navigation.getByTestId("shell-nav-dashboard")).not.toHaveAttribute("aria-current", "page");

    const settings = page.getByRole("link", { name: /^(设置|Settings)$/ });
    await expect(settings).toHaveAttribute("data-testid", "shell-settings-link");
    await settings.click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: settingsHeadingName })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: settingsHeadingName })).toBeVisible();
    await expect(settings).toHaveAttribute("aria-current", "page");
    await navigation.getByTestId("shell-nav-dashboard").click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: dashboardHeadingName })).toBeVisible();
  });
});

// 偏好持久化语义与 project 无关：入口按当前布局取（桌面侧栏 / 移动抽屉），断言不放宽。
test.describe("导航与偏好持久化", () => {
  test("账号菜单切换英文和中文，导航与刷新后仍使用所选语言", async ({ page, server }) => {
    await signIn(page, server);
    const languages = [
      {
        option: "English",
        language: "en",
        dashboard: "Dashboard",
        navigation: "Navigation",
        actions: "Actions",
        settings: "Settings",
        heading: "Runtime settings",
      },
      {
        option: "简体中文",
        language: "zh-CN",
        dashboard: "仪表盘",
        navigation: "导航",
        actions: "操作",
        settings: "设置",
        heading: "运行设置",
      },
    ];
    for (const language of languages) {
      await chooseAccountOption(page, languageName, language.option);
      // 抽屉只在移动布局存在：收起后页面内容不再被 aria-hidden，页面级 role 断言才有效。
      await closeMobileNavigation(page);
      await expect(page.locator("html")).toHaveAttribute("lang", language.language);
      await expect(page.getByRole("heading", { name: language.dashboard, exact: true })).toBeVisible();
      // 设置入口在账号控制区内：桌面侧栏常驻，移动端重新打开抽屉。
      const account = await accountControlScope(page);
      await account.getByRole("link", { name: language.settings, exact: true }).click();
      await expect(page.getByRole("heading", { name: language.heading, exact: true })).toBeVisible();
      await page.reload();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByRole("heading", { name: language.heading, exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", language.language);
      const restored = await accountControlScope(page);
      await expect(restored.getByTestId("shell-account-menu")).toHaveAccessibleName(language.actions);
      await expect.poll(() => page.evaluate(() => localStorage.getItem("grok2api:language"))).toBe(language.language);
      // 抽屉已打开时 openNavigation 直接复用，不重复触发抽屉按钮。
      const navigation = await openNavigation(page);
      await expect(navigation).toHaveAccessibleName(language.navigation);
      await navigation.getByRole("link", { name: language.dashboard, exact: true }).click();
      await expect(page.getByRole("heading", { name: language.dashboard, exact: true })).toBeVisible();
    }
  });

  test("深色、浅色和跟随系统主题在刷新后保持，显式选择不被系统主题覆盖", async ({ page, server }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signIn(page, server);
    await chooseAccountOption(page, appearanceName, /^(深色|Dark)$/);
    await expectTheme(page, "dark", "dark");
    await page.reload();
    await expect(page.getByRole("heading", { name: dashboardHeadingName })).toBeVisible();
    await expectTheme(page, "dark", "dark");

    await page.emulateMedia({ colorScheme: "dark" });
    await chooseAccountOption(page, appearanceName, /^(浅色|Light)$/);
    await expectTheme(page, "light", "light");
    await page.reload();
    await expect(page.getByRole("heading", { name: dashboardHeadingName })).toBeVisible();
    await expectTheme(page, "light", "light");

    await chooseAccountOption(page, appearanceName, /^(跟随系统|System)$/);
    await expectTheme(page, "system", "dark");
    await page.reload();
    await expect(page.getByRole("heading", { name: dashboardHeadingName })).toBeVisible();
    await expectTheme(page, "system", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expectTheme(page, "system", "light");
  });
});

test.describe("移动端导航与登录", () => {
  test.use({ viewport: portrait });

  test("375px 登录页与横屏无横向溢出，Tab 和 Enter 可完成真实登录", async ({ page, server }) => {
    await page.goto(`${server.baseURL}/login`);
    await expect(page.getByRole("heading", { name: /^(管理员登录|Admin sign in)$/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const username = page.getByRole("textbox", { name: /^(用户名|Username)$/ });
    const password = page.getByLabel(/^(密码|Password)$/);
    const submit = page.getByRole("button", { name: /^(登录|Sign in)$/ });
    await expect(username).toBeFocused();
    await username.fill(server.username);
    await username.press("Tab");
    await expect(password).toBeFocused();
    await password.fill(server.password);

    await page.setViewportSize(landscape);
    await expectNoHorizontalOverflow(page);
    await expect(username).toHaveValue(server.username);
    await expect(password).toHaveValue(server.password);
    await expect(password).toBeFocused();
    await password.press("Tab");
    await expect(submit).toBeFocused();
    await submit.press("Enter");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: dashboardHeadingName })).toBeVisible();
    await expect(page.getByRole("button", { name: openNavigationName })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("375px 与横屏抽屉菜单有可访问名称，键盘开闭和导航刷新保持正确状态", async ({ page, server }) => {
    await signIn(page, server);
    const destinations = [
      {
        viewport: portrait,
        path: /\/accounts$/,
        testId: "shell-nav-accounts",
        name: /^(账号|Accounts)$/,
        heading: accountsHeadingName,
      },
      {
        viewport: landscape,
        path: /\/dashboard$/,
        testId: "shell-nav-dashboard",
        name: dashboardHeadingName,
        heading: dashboardHeadingName,
      },
    ];
    for (const destination of destinations) {
      await page.setViewportSize(destination.viewport);
      await expectMobileNavigationKeyboard(page);
      const dialog = await openMobileNavigation(page);
      const link = dialog.getByRole("navigation", { name: navigationName }).getByTestId(destination.testId);
      await expect(link).toHaveAccessibleName(destination.name);
      await link.press("Enter");
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(destination.path);
      await expect(page.getByRole("heading", { name: destination.heading })).toBeVisible();
      await page.reload();
      await expect(page).toHaveURL(destination.path);
      await expect(page.getByRole("heading", { name: destination.heading })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const restored = await openMobileNavigation(page);
      await expect(restored.getByTestId(destination.testId)).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
      await expect(restored).toBeHidden();
      await expect(page.getByRole("button", { name: openNavigationName })).toBeFocused();
    }
  });
});
