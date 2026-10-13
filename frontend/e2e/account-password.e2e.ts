import type { Locator, Page } from "@playwright/test";

import { accountControlScope, expect, signIn, test } from "./fixtures";

// 界面文案默认语言为 zh-CN，英文仅作为语言切换后的兜底匹配；断言对象始终是用户可见结果。
const changePasswordItemName = /^(修改密码|Change password)$/;
const passwordUpdatedToast = /密码已更新，请重新登录|Password updated/;
const passwordChangeFailedToast = /修改密码失败|Failed to change the password/;
const invalidCredentialsToast = /用户名或密码错误|Invalid username or password/;
const signInButtonName = /^(登录|Sign in)$/;
const dashboardHeadingName = /^仪表盘$|^Dashboard$/;
const loginHeadingName = /管理员登录|Admin sign in/;
const loginPath = /\/login$/;
const dashboardPath = /\/dashboard$/;

/**
 * 改密表单作用域：以组件固定提供的「当前密码」输入框 id 为锚点。
 * 移动布局下抽屉与改密弹窗会同时存在于 DOM，`getByRole("dialog")` 会命中两个节点，
 * 因此不按 role 取作用域，断言仍是用户可见结果。
 */
function passwordForm(page: Page): Locator {
  return page.locator("form").filter({ has: page.locator("#current-password") });
}

/** 走真实入口打开改密弹窗：账号菜单 → 修改密码（桌面侧栏 / 移动抽屉由 accountControlScope 选择）。 */
async function openChangePasswordDialog(page: Page): Promise<Locator> {
  const scope = await accountControlScope(page);
  await scope.getByTestId("shell-account-menu").click();
  await page.getByRole("menuitem", { name: changePasswordItemName }).click();
  const form = passwordForm(page);
  await expect(form.locator("#current-password")).toBeVisible();
  await expect(form.locator("#new-password")).toBeVisible();
  return form;
}

/** 提交一次真实改密请求；由调用方断言成功（提示 + 退出登录）或失败（提示 + 会话保持）。 */
async function changePassword(page: Page, currentPassword: string, newPassword: string): Promise<void> {
  const form = await openChangePasswordDialog(page);
  await form.locator("#current-password").fill(currentPassword);
  await form.locator("#new-password").fill(newPassword);
  await form.locator('button[type="submit"]').click();
}

/** 在登录页提交一次真实登录（不等待结果），由调用方断言被拒绝还是进入受保护页面。 */
async function submitLogin(page: Page, username: string, password: string): Promise<void> {
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: signInButtonName }).click();
}

/** 断言存在匹配文案的用户可见提示；sonner 会同时保留多条提示，故按文案过滤而不是整体断言。 */
async function expectToast(page: Page, text: RegExp): Promise<void> {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}

test("修改密码后旧密码失效、新密码可登录", async ({ page, server }) => {
  const rotated = `${server.password}-rotated`;
  await signIn(page, server);

  await changePassword(page, server.password, rotated);

  // 成功提示与自动退出登录：改密成功会撤销会话，界面回到登录页。
  await expectToast(page, passwordUpdatedToast);
  await expect(page).toHaveURL(loginPath);
  await expect(page.getByRole("heading", { name: loginHeadingName })).toBeVisible();

  // 旧密码必须失效：真实登录接口拒绝，界面停在登录页。
  await submitLogin(page, server.username, server.password);
  await expectToast(page, invalidCredentialsToast);
  await expect(page).toHaveURL(loginPath);

  // 新密码必须可用：登录后进入受保护页面。
  await submitLogin(page, server.username, rotated);
  await expect(page).toHaveURL(dashboardPath);
  await expect(page.getByRole("heading", { name: dashboardHeadingName })).toBeVisible();

  // 清理：用新密码改回原密码，恢复同一 worker 内其它用例依赖的凭据。
  await changePassword(page, rotated, server.password);
  await expectToast(page, passwordUpdatedToast);
  await expect(page).toHaveURL(loginPath);
  await signIn(page, server);
  await expect(page.getByRole("heading", { name: dashboardHeadingName })).toBeVisible();
});

test("当前密码错误的改密被拒绝：提示失败、会话保持、原密码仍然可用", async ({ page, request, server }) => {
  await signIn(page, server);

  await changePassword(page, `${server.password}-wrong`, `${server.password}-never`);

  // 失败提示来自真实 400 passwordChangeFailed：错误的当前密码必须被服务端拒绝。
  await expectToast(page, passwordChangeFailedToast);
  // 失败不得注销会话：仍在受保护页面，且刷新后仍保持登录。
  await expect(page).toHaveURL(dashboardPath);
  await page.reload();
  await expect(page.getByRole("heading", { name: dashboardHeadingName })).toBeVisible();

  // 服务端事实：原密码仍可登录，说明失败的改密没有改动任何凭据。
  const response = await request.post(`${server.baseURL}/api/admin/v1/auth/login`, {
    data: { username: server.username, password: server.password },
  });
  expect(response.status()).toBe(200);
});
