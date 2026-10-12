import type { APIRequestContext, Page } from "@playwright/test";

import { apiLogin, expect, openNavigation, signIn, test, type E2EServer } from "./fixtures";

// 界面文案默认语言为 zh-CN，英文仅作为语言切换后的兜底匹配；断言对象始终是用户可见结果。
const accountsNavName = /^(账号|Accounts)$/;
const accountsHeadingName = /^(上游账号|Upstream accounts)$/;
const connectAccountName = /^(账号接入|Connect account)$/;
const importBuildMenuItemName = /^(导入账号或 RT 文件|Import accounts or RTs)$/;
const searchLabelName = /^(搜索账号|Search accounts)$/;
const importFailedToast = /导入授权文件失败|Failed to import the authorization file/;
const importedToast = /导入完成|Import complete/;
const noDataText = /^(暂无数据|No data)$/;

type AccountListItem = { id: string; name: string };
type AccountPage = { items: AccountListItem[]; total: number };

/** 通过真实管理 API 查询账号列表，提供与 UI 断言相互独立的服务端事实。 */
async function apiAccounts(request: APIRequestContext, server: E2EServer, search: string): Promise<AccountPage> {
  const accessToken = await apiLogin(request, server);
  const response = await request.get(
    `${server.baseURL}/api/admin/v1/accounts?page=1&pageSize=50&provider=grok_build&search=${encodeURIComponent(search)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok()) {
    throw new Error(`读取账号列表失败：HTTP ${response.status()} ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    data?: { items?: Array<{ id?: unknown; name?: unknown }>; total?: unknown };
  };
  const items = (payload.data?.items ?? []).map((item) => ({
    id: String(item.id ?? ""),
    name: String(item.name ?? ""),
  }));
  return { items, total: typeof payload.data?.total === "number" ? payload.data.total : items.length };
}

/** 走真实入口上传账号文件：账号接入菜单 → 导入项 → 隐藏 file input 的 filechooser。 */
async function uploadAccountsFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: connectAccountName }).click();
  await page.getByRole("menuitem", { name: importBuildMenuItemName }).click();
  await (await chooser).setFiles(file);
}

/** 进入账号页：入口按当前布局选择（桌面侧栏 / 移动抽屉），断言与 project 无关。 */
async function openAccountsPage(page: Page): Promise<void> {
  const navigation = await openNavigation(page);
  await navigation.getByRole("link", { name: accountsNavName }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole("heading", { name: accountsHeadingName })).toBeVisible();
}

test("导入非法账号文件：提示导入失败且真实服务端账号数不变", async ({ page, request, server }) => {
  await signIn(page, server);
  await openAccountsPage(page);

  const marker = `e2e-invalid-${Date.now().toString(36)}`;
  // 缺少必需字段的账号条目：后端解析阶段即拒绝（access_token 与 refresh_token 至少提供一个）。
  const invalidDocument = JSON.stringify({ accounts: [{ name: marker, email: `${marker}@example.com` }] });
  const before = await apiAccounts(request, server, "");

  await uploadAccountsFile(page, {
    name: `${marker}.json`,
    mimeType: "application/json",
    buffer: Buffer.from(invalidDocument, "utf8"),
  });

  // 失败提示来自真实导入接口的 error 事件（apiErrors.authImportFailed）。
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: importFailedToast }).first()).toBeVisible();

  // 真实 API 交叉核对：服务端账号数不变，且该标记没有落库。
  const after = await apiAccounts(request, server, "");
  expect(after.total).toBe(before.total);
  expect((await apiAccounts(request, server, marker)).items).toEqual([]);

  // UI 与服务端一致：按标记搜索后没有匹配行，列表显示空态。
  await page.getByLabel(searchLabelName).fill(marker);
  await expect(page.getByRole("row").filter({ hasText: marker })).toHaveCount(0);
  await expect(page.getByText(noDataText).first()).toBeVisible();
});

test("导入合法账号文件：列表出现新账号且服务端可读回，随后清理恢复空号池", async ({ page, request, server }) => {
  await signIn(page, server);
  await openAccountsPage(page);

  const marker = `e2e-import-${Date.now().toString(36)}`;
  // 带 access_token 的合法条目：不会触发 refresh token 的网络准备阶段，测试不依赖真实 Provider。
  const document = JSON.stringify({
    accounts: [
      {
        provider: "grok_build",
        name: marker,
        email: `${marker}@example.com`,
        user_id: `${marker}-user`,
        access_token: `${marker}-access`,
      },
    ],
  });

  await page.getByLabel(searchLabelName).fill(marker);
  await expect(page.getByText(noDataText).first()).toBeVisible();

  await uploadAccountsFile(page, {
    name: `${marker}.json`,
    mimeType: "application/json",
    buffer: Buffer.from(document, "utf8"),
  });

  await expect(page.locator("[data-sonner-toast]").filter({ hasText: importedToast }).first()).toBeVisible();

  // UI：按标记搜索后出现该账号行。
  const row = page.getByRole("row").filter({ hasText: marker });
  await expect(row).toHaveCount(1);

  // 服务端：真实账号记录可读回，且与 UI 名称一致。
  const created = await apiAccounts(request, server, marker);
  expect(created.items.map((item) => item.name)).toEqual([marker]);
  const accountId = created.items[0]?.id ?? "";
  expect(accountId.length).toBeGreaterThan(0);

  // 清理：删除本次导入的账号，恢复空号池（auth.e2e 依赖空号池的 /readyz 断言）。
  const accessToken = await apiLogin(request, server);
  const removed = await request.delete(`${server.baseURL}/api/admin/v1/accounts/${accountId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(removed.ok()).toBe(true);
  expect((await apiAccounts(request, server, marker)).items).toEqual([]);
});
