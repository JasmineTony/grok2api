import type { Page } from "@playwright/test";

import { apiLogin, expect, signIn, test, type E2EServer } from "./fixtures";

// 界面文案默认语言为 zh-CN，英文仅作为语言切换后的兜底匹配；断言对象始终是用户可见结果。
const keysNavName = /^(密钥|Client keys)$/;
const createButtonName = /^(创建密钥|Create key)$/;
const nameLabelName = /^(名称|Name)$/;
const requiredErrorText = /此项不能为空|This field is required/;
const activeStatusText = /^(可用|Active)$/;
const disabledStatusText = /^(已停用|Disabled)$/;
const createdToast = /密钥已创建|Client key created/;
const updatedToast = /密钥已更新|Client key updated/;
const deletedToast = /密钥已删除|Client key deleted/;
const deleteDialogTitleText = /删除密钥|Delete client key/;
const noDataText = /^(暂无数据|No data)$/;
const actionsButtonName = /^(操作|Actions)$/;
const editItemName = /^(编辑|Edit)$/;
const deleteItemName = /^(删除|Delete)$/;
const filterButtonName = /筛选|Filters/;
// 状态子菜单的可访问名会带上当前已选状态（例如「状态 已停用」），故只锚定前缀。
const statusFilterItemName = /^(状态|Status)( |$)/;

/** 通过工具栏筛选菜单选择密钥状态：菜单为「筛选 → 状态 → 选项」两级结构。 */
async function selectStatusFilter(page: Page, optionName: RegExp): Promise<void> {
  await page.getByRole("button", { name: filterButtonName }).click();
  await page.getByRole("menuitem", { name: statusFilterItemName }).click();
  await page.getByRole("menuitemradio", { name: optionName }).click();
}

/** 断言存在匹配文案的用户可见提示；sonner 会同时保留多条提示，故按文案过滤而不是整体断言。 */
async function expectToast(page: Page, text: RegExp): Promise<void> {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}

/** 从创建响应的明文密钥 g2a_<prefix>_<secret> 解析出前缀，用于核对列表掩码。 */
function parseSecretPrefix(secret: string): string {
  const match = /^g2a_([0-9a-f]+)_/.exec(secret);
  if (!match) throw new Error(`无法从明文密钥解析前缀：${secret}`);
  return match[1];
}

/** 通过真实管理 API 查询列表，提供与 UI 断言相互独立的服务端事实。 */
async function apiKeyNames(
  request: Parameters<typeof apiLogin>[0],
  server: E2EServer,
  search: string,
): Promise<string[]> {
  const accessToken = await apiLogin(request, server);
  const response = await request.get(
    `${server.baseURL}/api/admin/v1/client-keys?page=1&pageSize=50&search=${encodeURIComponent(search)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok()) {
    throw new Error(`读取密钥列表失败：HTTP ${response.status()} ${await response.text()}`);
  }
  const payload = (await response.json()) as { data?: { items?: Array<{ name?: unknown }> } };
  return (payload.data?.items ?? []).map((item) => String(item.name));
}

test("未登录访问密钥页会被重定向到登录页", async ({ page, server }) => {
  await page.goto(`${server.baseURL}/client-keys`);

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: /管理员登录|Admin sign in/ })).toBeVisible();
});

test("创建密钥：表单校验失败后成功创建并展示一次性明文", async ({ page, request, server }) => {
  await signIn(page, server);
  await page.getByRole("link", { name: keysNavName }).click();
  await expect(page.getByRole("heading", { name: keysNavName })).toBeVisible();
  await expect(page.getByTestId("client-keys-empty")).toContainText(noDataText);

  // 校验失败路径：空名称提交，弹窗保留且不入库。
  await page.getByRole("button", { name: createButtonName }).click();
  await expect(page.getByTestId("client-keys-form-dialog")).toBeVisible();
  await page.getByTestId("client-keys-form-submit").click();
  await expect(page.getByTestId("client-keys-form-name-error")).toContainText(requiredErrorText);
  await expect(page.getByTestId("client-keys-form-dialog")).toBeVisible();
  expect(await apiKeyNames(request, server, "")).toEqual([]);

  // 正常创建路径。
  const name = `e2e-创建-${Date.now().toString(36)}`;
  await page.getByTestId("client-keys-form-name").fill(name);
  await page.getByTestId("client-keys-form-submit").click();

  await expectToast(page, createdToast);
  const secretDialog = page.getByTestId("client-keys-secret-dialog");
  await expect(secretDialog).toBeVisible();
  const secret = (await page.getByTestId("client-keys-secret-value").textContent())?.trim() ?? "";
  expect(secret).toMatch(/^g2a_/);
  await page.getByTestId("client-keys-secret-close").click();
  await expect(secretDialog).toBeHidden();

  // UI 与真实服务端状态同时可见：列表掩码前缀必须等于刚创建密钥的真实前缀。
  const prefix = parseSecretPrefix(secret);
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row.getByText(`g2a_${prefix}_********`, { exact: true })).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  expect(await apiKeyNames(request, server, name)).toEqual([name]);
});

test("编辑密钥：停用后状态徽标与筛选结果同步变化", async ({ page, server }) => {
  await signIn(page, server);
  await page.goto(`${server.baseURL}/client-keys`);
  await expect(page.getByRole("heading", { name: keysNavName })).toBeVisible();

  const name = `e2e-编辑-${Date.now().toString(36)}`;
  await page.getByRole("button", { name: createButtonName }).click();
  await page.getByTestId("client-keys-form-name").fill(name);
  await page.getByTestId("client-keys-form-submit").click();
  await expectToast(page, createdToast);
  await page.getByTestId("client-keys-secret-close").click();

  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText(activeStatusText)).toBeVisible();

  // 编辑并停用。
  await row.getByRole("button", { name: actionsButtonName }).click();
  await page.getByRole("menuitem", { name: editItemName }).click();
  await expect(page.getByTestId("client-keys-form-dialog")).toBeVisible();
  await expect(page.getByLabel(nameLabelName)).toHaveValue(name);
  await page.getByTestId("key-enabled").click();
  await page.getByTestId("client-keys-form-submit").click();

  await expectToast(page, updatedToast);
  const disabledRow = page.getByRole("row").filter({ hasText: name });
  await expect(disabledRow.getByText(disabledStatusText)).toBeVisible();
  await expect(disabledRow.getByText(activeStatusText)).toHaveCount(0);

  // 状态筛选「已停用」后该行仍可见，切回「可用」后消失。
  await selectStatusFilter(page, disabledStatusText);
  await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();

  await selectStatusFilter(page, activeStatusText);
  await expect(page.getByTestId("client-keys-empty")).toContainText(noDataText);
  await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
});

test("删除密钥：确认后行与真实服务端记录同时消失", async ({ page, request, server }) => {
  await signIn(page, server);
  await page.goto(`${server.baseURL}/client-keys`);
  await expect(page.getByRole("heading", { name: keysNavName })).toBeVisible();

  const name = `e2e-删除-${Date.now().toString(36)}`;
  await page.getByRole("button", { name: createButtonName }).click();
  await page.getByTestId("client-keys-form-name").fill(name);
  await page.getByTestId("client-keys-form-submit").click();
  await expectToast(page, createdToast);
  await page.getByTestId("client-keys-secret-close").click();
  await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();

  // 取消不产生副作用。
  const row = page.getByRole("row").filter({ hasText: name });
  await row.getByRole("button", { name: actionsButtonName }).click();
  await page.getByRole("menuitem", { name: deleteItemName }).click();
  await expect(page.getByRole("alertdialog")).toContainText(deleteDialogTitleText);
  await page.getByTestId("client-keys-delete-dialog-cancel").click();
  await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();
  expect(await apiKeyNames(request, server, name)).toEqual([name]);

  // 确认删除。
  await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: actionsButtonName }).click();
  await page.getByRole("menuitem", { name: deleteItemName }).click();
  await page.getByTestId("client-keys-delete-dialog-confirm").click();

  await expectToast(page, deletedToast);
  await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
  await expect(page.getByTestId("client-keys-empty")).toContainText(noDataText);
  expect(await apiKeyNames(request, server, name)).toEqual([]);
});
