import { apiLogin, expect, signIn, test } from "./fixtures";

// 界面文案默认语言为 zh-CN，英文仅作为语言切换后的兜底匹配；断言对象始终是用户可见结果。
const loginHeadingName = /管理员登录|Admin sign in/;
const dashboardHeadingName = /^仪表盘$|^Dashboard$/;
const submitButtonName = /^(登录|Sign in)$/;
const actionsButtonName = /^(操作|Actions)$/;
const signOutItemName = /^(退出登录|Sign out)$/;
const usernameLabelName = /^(用户名|Username)$/;
const passwordLabelName = /^(密码|Password)$/;
const invalidCredentialsMessage = /用户名或密码错误|Invalid username or password|Invalid credentials/;
const protectedPath = /\/dashboard$/;
const loginPath = /\/login$/;

test("未登录访问受保护路由会被重定向到登录页", async ({ page, server }) => {
  await page.goto(`${server.baseURL}/dashboard`);

  await expect(page).toHaveURL(loginPath);
  await expect(page.getByRole("heading", { name: loginHeadingName })).toBeVisible();
});

test("错误密码登录失败并显示用户可见错误提示", async ({ page, server }) => {
  await page.goto(`${server.baseURL}/login`);
  await page.locator("#username").fill(server.username);
  await page.locator("#password").fill(`${server.password}-invalid`);
  await page.getByRole("button", { name: submitButtonName }).click();

  await expect(page.locator("[data-sonner-toast]")).toContainText(invalidCredentialsMessage);
  await expect(page).toHaveURL(loginPath);
  await expect(page.getByRole("button", { name: submitButtonName })).toBeEnabled();
});

test("正确凭据登录成功、进入受保护页面并在刷新后保持登录", async ({ page, server }) => {
  await signIn(page, server);

  await expect(page.getByRole("heading", { name: dashboardHeadingName })).toBeVisible();
  await expect(page.getByText(server.username, { exact: true })).toBeVisible();

  await page.reload();

  await expect(page).toHaveURL(protectedPath);
  await expect(page.getByRole("heading", { name: dashboardHeadingName })).toBeVisible();
  await expect(page.getByText(server.username, { exact: true })).toBeVisible();
});

test("注销后再次访问受保护路由会被重定向到登录页", async ({ page, server }) => {
  await signIn(page, server);
  await expect(page.getByRole("heading", { name: dashboardHeadingName })).toBeVisible();

  await page.getByRole("button", { name: actionsButtonName }).click();
  await page.getByRole("menuitem", { name: signOutItemName }).click();
  await expect(page).toHaveURL(loginPath);

  await page.goto(`${server.baseURL}/dashboard`);
  await expect(page).toHaveURL(loginPath);
  await expect(page.getByRole("heading", { name: loginHeadingName })).toBeVisible();
});

test("登录表单控件具备可访问名称并支持键盘提交", async ({ page, server }) => {
  await page.goto(`${server.baseURL}/login`);

  const usernameInput = page.getByLabel(usernameLabelName);
  const passwordInput = page.getByLabel(passwordLabelName);
  await expect(usernameInput).toBeEditable();
  await expect(passwordInput).toBeEditable();
  await expect(page.getByRole("button", { name: submitButtonName })).toBeEnabled();

  await usernameInput.fill(server.username);
  await usernameInput.press("Tab");
  await expect(passwordInput).toBeFocused();
  await passwordInput.fill(server.password);
  await passwordInput.press("Enter");

  await expect(page).toHaveURL(protectedPath);
  await expect(page.getByRole("heading", { name: dashboardHeadingName })).toBeVisible();
});

test("空账号池下推理未就绪，但健康检查与管理 API 可用", async ({ request, server }) => {
  const health = await request.get(`${server.baseURL}/healthz`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ ok: true });

  // 空账号池导致没有启用的模型路由：这是生产语义，断言而不放宽。
  const readiness = await request.get(`${server.baseURL}/readyz`);
  expect(readiness.status()).toBe(503);
  expect(await readiness.json()).toMatchObject({ ready: false, state: "not_ready" });

  const accessToken = await apiLogin(request, server);
  const me = await request.get(`${server.baseURL}/api/admin/v1/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ data: { username: server.username } });
});
