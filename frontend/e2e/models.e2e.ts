import type { APIRequestContext, Page } from "@playwright/test";

import { apiLogin, expect, signIn, test, type E2EServer } from "./fixtures";

// 界面文案默认语言为 zh-CN，英文仅作为语言切换后的兜底匹配；断言对象始终是用户可见结果。
const modelsHeadingName = /^(模型路由|Model routes)$/;
const enabledBadgeName = /^(已启用|Enabled)$/;
const disabledBadgeName = /^(已停用|Disabled)$/;
const editMenuItemName = /^(编辑|Edit)$/;
const createdToast = /模型路由已创建|Model route created/;
const updatedToast = /模型路由已更新|Model route updated/;
const batchUpdatedToast = /所选模型已更新|Selected models updated/;

type ModelRouteSnapshot = { id: string; publicId: string; enabled: boolean };
type ModelGroupSnapshot = { key: string; routes: ModelRouteSnapshot[] };
type ModelGroupPayload = {
  key?: unknown;
  routes?: Array<{ id?: unknown; publicId?: unknown; enabled?: unknown }>;
};

/**
 * 通过真实管理 API 读取模型分组，提供与 UI 断言相互独立的服务端事实，
 * 同时给出表格行 `data-testid="models-row-<key>"` 使用的分组 key。
 */
async function apiModelGroups(
  request: APIRequestContext,
  server: E2EServer,
  query: { search?: string; status?: string },
): Promise<{ items: ModelGroupSnapshot[]; total: number }> {
  const accessToken = await apiLogin(request, server);
  const parameters = new URLSearchParams({ page: "1", pageSize: "20" });
  if (query.search) parameters.set("search", query.search);
  if (query.status) parameters.set("status", query.status);
  const response = await request.get(`${server.baseURL}/api/admin/v1/models/groups?${parameters.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok()) {
    throw new Error(`读取模型分组失败：HTTP ${response.status()} ${await response.text()}`);
  }
  const payload = (await response.json()) as { data?: { items?: ModelGroupPayload[]; total?: unknown } };
  const items = (payload.data?.items ?? []).map((group) => ({
    key: String(group.key ?? ""),
    routes: (group.routes ?? []).map((route) => ({
      id: String(route.id ?? ""),
      publicId: String(route.publicId ?? ""),
      enabled: route.enabled === true,
    })),
  }));
  return { items, total: typeof payload.data?.total === "number" ? payload.data.total : items.length };
}

/** 读回按标记创建的唯一路由；读不到时显式失败，不静默跳过后续断言。 */
async function readRoute(
  request: APIRequestContext,
  server: E2EServer,
  marker: string,
): Promise<{ id: string; groupKey: string; enabled: boolean }> {
  const groups = await apiModelGroups(request, server, { search: marker });
  const group = groups.items.find((item) => item.routes.some((route) => route.publicId === marker));
  const route = group?.routes.find((item) => item.publicId === marker);
  if (!group || !route) {
    throw new Error(`模型路由 ${marker} 未出现在服务端：${JSON.stringify(groups)}`);
  }
  return { id: route.id, groupKey: group.key, enabled: route.enabled };
}

/** 删除用例自建的路由；删除失败或仍有残留必须显式失败，不静默放过。 */
async function removeRoute(request: APIRequestContext, server: E2EServer, marker: string, id: string): Promise<void> {
  const accessToken = await apiLogin(request, server);
  const response = await request.delete(`${server.baseURL}/api/admin/v1/models/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok()) {
    throw new Error(`清理模型路由 ${id} 失败：HTTP ${response.status()} ${await response.text()}`);
  }
  expect((await apiModelGroups(request, server, { search: marker })).total).toBe(0);
}

/** 直连真实路由进入模型页：该入口在桌面与移动布局下都可达，不依赖侧栏链接。 */
async function openModelsPage(page: Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/models`);
  await expect(page.getByRole("heading", { name: modelsHeadingName })).toBeVisible();
}

/** 通过真实创建弹窗新建一条 Grok Build 路由（不绑定账号，空账号池下同样可创建）。 */
async function createRoute(page: Page, marker: string): Promise<void> {
  await page.getByTestId("models-create").click();
  const dialog = page.getByTestId("models-edit-dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("#model-public-id").fill(marker);
  await dialog.locator("#model-upstream-id").fill(`Build/${marker}`);
  await dialog.getByTestId("models-submit").click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: createdToast }).first()).toBeVisible();
  await expect(dialog).toBeHidden();
}

/** 行内编辑入口切换启用状态：弹窗内的启用开关即「封锁 / 解除封锁」的真实交互。 */
async function setRouteEnabledViaDialog(page: Page, groupKey: string, enabled: boolean): Promise<void> {
  await page.getByTestId(`models-row-actions-${groupKey}`).click();
  await page.getByRole("menuitem", { name: editMenuItemName }).click();
  const dialog = page.getByTestId("models-edit-dialog");
  await expect(dialog).toBeVisible();
  const toggle = dialog.locator("#model-enabled");
  await expect(toggle).toHaveAttribute("data-state", enabled ? "unchecked" : "checked");
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-state", enabled ? "checked" : "unchecked");
  await dialog.getByTestId("models-submit").click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: updatedToast }).first()).toBeVisible();
}

/** 工具栏批量入口：选中该行后点「禁用 / 启用」，走真实批量接口。 */
async function setRouteEnabledViaBatch(page: Page, groupKey: string, enabled: boolean): Promise<void> {
  await page.getByTestId(`models-row-${groupKey}`).getByRole("checkbox").click();
  await expect(page.getByTestId("models-selected-count")).toBeVisible();
  await page.getByTestId(enabled ? "models-batch-enable" : "models-batch-disable").click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: batchUpdatedToast }).first()).toBeVisible();
}

test("封锁模型路由：状态标记为已禁用且不再属于启用列表", async ({ page, request, server }) => {
  const marker = `e2e-block-${Date.now().toString(36)}`;
  await signIn(page, server);
  await openModelsPage(page, server.baseURL);
  await createRoute(page, marker);

  const created = await readRoute(request, server, marker);
  expect(created.enabled).toBe(true);
  await expect(page.getByTestId(`models-row-${created.groupKey}`)).toBeVisible();
  await expect(page.getByTestId(`models-row-${created.groupKey}`).getByText(enabledBadgeName)).toBeVisible();

  try {
    await setRouteEnabledViaDialog(page, created.groupKey, false);

    // UI：同一行的状态标记变为已禁用（列表已按服务端结果重新拉取）。
    await expect(page.getByTestId(`models-row-${created.groupKey}`).getByText(disabledBadgeName)).toBeVisible();
    // 服务端事实：该路由 enabled=false，且按「启用」查询的可用列表里已经读不到它。
    expect((await readRoute(request, server, marker)).enabled).toBe(false);
    expect((await apiModelGroups(request, server, { search: marker, status: "enabled" })).total).toBe(0);
    expect((await apiModelGroups(request, server, { search: marker, status: "disabled" })).total).toBe(1);
  } finally {
    await removeRoute(request, server, marker, created.id);
  }
});

test("批量封锁与解除封锁：状态标记与服务端启用状态同步变化", async ({ page, request, server }) => {
  const marker = `e2e-unblock-${Date.now().toString(36)}`;
  await signIn(page, server);
  await openModelsPage(page, server.baseURL);
  await createRoute(page, marker);
  const created = await readRoute(request, server, marker);

  try {
    await setRouteEnabledViaBatch(page, created.groupKey, false);
    await expect(page.getByTestId(`models-row-${created.groupKey}`).getByText(disabledBadgeName)).toBeVisible();
    expect((await readRoute(request, server, marker)).enabled).toBe(false);
    expect((await apiModelGroups(request, server, { search: marker, status: "enabled" })).total).toBe(0);

    await setRouteEnabledViaBatch(page, created.groupKey, true);
    await expect(page.getByTestId(`models-row-${created.groupKey}`).getByText(enabledBadgeName)).toBeVisible();
    expect((await readRoute(request, server, marker)).enabled).toBe(true);
    expect((await apiModelGroups(request, server, { search: marker, status: "enabled" })).total).toBe(1);
  } finally {
    await removeRoute(request, server, marker, created.id);
  }
});
