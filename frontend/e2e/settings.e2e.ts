import type { APIRequestContext, Page } from "@playwright/test";

import { accountControlScope, apiLogin, expect, signIn, test, type E2EServer } from "./fixtures";

// 界面文案默认语言为 zh-CN，英文仅作为语言切换后的兜底匹配；断言对象始终是用户可见结果。
const settingsName = /^(运行设置|Runtime settings)$/;
const settingsNavName = /^(设置|Settings)$/;
const clientVersionLabel = /^(客户端版本|Client version)$/;
const buildTabName = /Grok Build/;
const webTabName = /^(Grok Web)$/;

/** 直连真实路由进入设置页：该入口在桌面与移动布局下都可达，不依赖侧栏链接。 */
async function openSettingsPage(page: Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/settings`);
  await expect(page.getByRole("heading", { name: settingsName })).toBeVisible();
}

test("未登录访问设置页会被重定向到登录页", async ({ page, server }) => {
  await page.goto(`${server.baseURL}/settings`);

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: /管理员登录|Admin sign in/ })).toBeVisible();
});

test("设置页未修改时保存与重置禁用，字段修改后保存启用、重置后恢复禁用", async ({ page, server }) => {
  await signIn(page, server);
  await openSettingsPage(page, server.baseURL);

  const save = page.getByTestId("settings-save");
  const reset = page.getByTestId("settings-reset");
  const clientVersion = page.getByLabel(clientVersionLabel);

  // 初态：没有本地修改，保存与重置都必须是禁用态（防止无意义写入）。
  await expect(save).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(reset).toBeDisabled();
  await expect(clientVersion).toBeEditable();
  const original = await clientVersion.inputValue();
  expect(original.length).toBeGreaterThan(0);

  // 真实字段态变化：修改后表单变脏，保存与重置同时启用。
  const edited = `${original}-e2e`;
  await clientVersion.fill(edited);
  await expect(clientVersion).toHaveValue(edited);
  await expect(save).toBeEnabled();
  await expect(reset).toBeEnabled();

  // 重置回到服务端快照并重新变为非脏态。
  await reset.click();
  await expect(clientVersion).toHaveValue(original);
  await expect(save).toBeDisabled();
  await expect(reset).toBeDisabled();
});

// 末段断言改用当前布局的账号控制区（桌面常驻侧栏 / 移动抽屉），设置入口可见性不做放宽。
test("设置页分页可切换：Grok Build 与 Grok Web 面板按标签显隐", async ({ page, server }) => {
  await signIn(page, server);
  await openSettingsPage(page, server.baseURL);

  const buildPane = page.getByTestId("settings-pane-build");
  const webPane = page.getByTestId("settings-pane-web");

  // 默认激活 Grok Build 分页，其字段可见。
  await expect(page.getByTestId("settings-tab-build")).toBeVisible();
  await expect(buildPane).toBeVisible();
  await expect(page.getByTestId("settings-field-provider-base-url")).toBeVisible();
  await expect(webPane).toBeHidden();

  // 切到 Grok Web 后该面板可见、原面板隐藏。
  await page.getByTestId("settings-tab-web").click();
  await expect(webPane).toBeVisible();
  await expect(buildPane).toBeHidden();
  await expect(page.getByRole("tab", { name: webTabName })).toHaveAttribute("data-state", "active");
  await expect(page.getByRole("tab", { name: buildTabName }).first()).toHaveAttribute("data-state", "inactive");

  // 切回后回到初态；保存/重置仍禁用（切换分页不产生表单修改）。
  await page.getByTestId("settings-tab-build").click();
  await expect(buildPane).toBeVisible();
  await expect(webPane).toBeHidden();
  await expect(page.getByTestId("settings-save")).toBeDisabled();
  await expect(page.getByTestId("settings-reset")).toBeDisabled();
  const account = await accountControlScope(page);
  await expect(account.getByRole("link", { name: settingsNavName }).first()).toBeVisible();
});

const savedToastText = /设置已保存并应用|Settings saved and applied/;
// 409 settingsConflict 在前端没有对应 i18n 键，直接展示服务端消息「设置已被其他会话更新，请刷新后重试」。
const conflictToastText = /设置已被其他会话更新/;

/** 断言存在匹配文案的用户可见提示；sonner 会同时保留多条提示，故按文案过滤而不是整体断言。 */
async function expectToast(page: Page, text: RegExp): Promise<void> {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}

type SettingsSnapshot = {
  revision: string;
  clientVersion: string;
  config: Record<string, unknown>;
};

/** 通过真实管理 API 读取设置快照，提供与 UI 断言相互独立的服务端事实。 */
async function readSettings(
  request: APIRequestContext,
  server: E2EServer,
  headers: Record<string, string>,
): Promise<SettingsSnapshot> {
  const response = await request.get(`${server.baseURL}/api/admin/v1/settings`, { headers });
  if (!response.ok()) {
    throw new Error(`读取运行设置失败：HTTP ${response.status()} ${await response.text()}`);
  }
  const payload = (await response.json()) as { data?: { revision?: unknown; config?: Record<string, unknown> } };
  const revision = payload.data?.revision;
  if (typeof revision !== "string" || revision.length === 0) {
    throw new Error("运行设置响应缺少 revision 字段");
  }
  const config = payload.data?.config ?? {};
  const providerBuild = config.providerBuild as { clientVersion?: unknown } | undefined;
  return { revision, clientVersion: String(providerBuild?.clientVersion ?? ""), config };
}

/** 只替换 providerBuild.clientVersion 的整份设置提交体（PUT 要求提交完整 config）。 */
function withClientVersion(config: Record<string, unknown>, clientVersion: string): Record<string, unknown> {
  return { ...config, providerBuild: { ...(config.providerBuild as Record<string, unknown>), clientVersion } };
}

test("设置页保存真实写入服务端：成功提示后刷新页面仍读到新值", async ({ page, server }) => {
  await signIn(page, server);
  await openSettingsPage(page, server.baseURL);

  const save = page.getByTestId("settings-save");
  const clientVersion = page.getByLabel(clientVersionLabel);
  const original = await clientVersion.inputValue();
  expect(original.length).toBeGreaterThan(0);
  const saved = `${original}-e2e-save`;

  await clientVersion.fill(saved);
  await expect(save).toBeEnabled();
  await save.click();

  // 成功反馈来自真实 PUT /api/admin/v1/settings 的 onSuccess（toast.success(settings.saved)）。
  await expectToast(page, savedToastText);
  // 成功回写服务端快照后表单回到非脏态。
  await expect(save).toBeDisabled();

  // 交叉核对：刷新页面重新 GET 设置，字段仍是保存值（不是前端内存态）。
  await page.reload();
  await expect(page.getByRole("heading", { name: settingsName })).toBeVisible();
  await expect(page.getByLabel(clientVersionLabel)).toHaveValue(saved);

  // 还原原始值，避免同一 worker 内其它用例读到被改动的运行设置。
  await page.getByLabel(clientVersionLabel).fill(original);
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-save")).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel(clientVersionLabel)).toHaveValue(original);
});

test("设置保存遇到 409 版本冲突时提示冲突并保留用户草稿", async ({ page, request, server }) => {
  await signIn(page, server);
  await openSettingsPage(page, server.baseURL);

  const save = page.getByTestId("settings-save");
  const clientVersion = page.getByLabel(clientVersionLabel);
  const original = await clientVersion.inputValue();
  const draft = `${original}-e2e-draft`;
  await clientVersion.fill(draft);
  await expect(save).toBeEnabled();

  // 用真实管理 API 先提交一次设置：服务端 revision 前进，UI 持有的 revision 因此过期。
  const accessToken = await apiLogin(request, server);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const before = await readSettings(request, server, headers);
  const otherSession = `${original}-e2e-other-session`;
  const write = await request.put(`${server.baseURL}/api/admin/v1/settings`, {
    headers,
    data: { revision: before.revision, config: withClientVersion(before.config, otherSession) },
  });
  expect(write.status()).toBe(200);

  await save.click();

  // 冲突提示来自真实 409 settingsConflict，而不是前端本地校验。
  await expectToast(page, conflictToastText);
  // 草稿没有被丢弃：冲突后表单仍是用户输入，而不是回写服务端快照。
  await expect(clientVersion).toHaveValue(draft);
  await expect(save).toBeEnabled();

  // 服务端事实：当前值是另一个会话写入的值，说明冲突确实由 revision 校验产生。
  const after = await readSettings(request, server, headers);
  expect(after.clientVersion).toBe(otherSession);

  // 还原原始值（使用最新 revision），避免同一 worker 内其它用例读到被改动的运行设置。
  const restore = await request.put(`${server.baseURL}/api/admin/v1/settings`, {
    headers,
    data: { revision: after.revision, config: withClientVersion(after.config, original) },
  });
  expect(restore.status()).toBe(200);
});
