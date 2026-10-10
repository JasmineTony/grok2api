import type { Page } from "@playwright/test";

import { expect, signIn, test } from "./fixtures";

// 界面文案默认语言为 zh-CN，英文仅作为语言切换后的兜底匹配；断言对象始终是用户可见结果。
const settingsName = /^(运行设置|Runtime settings)$/;
const settingsNavName = /^(设置|Settings)$/;
const clientVersionLabel = /^(客户端版本|Client version)$/;
const buildTabName = /Grok Build/;
const webTabName = /^(Grok Web)$/;

/** 通过侧边栏或下拉菜单进入设置页。 */
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
  await expect(page.getByRole("link", { name: settingsNavName }).first()).toBeVisible();
});
