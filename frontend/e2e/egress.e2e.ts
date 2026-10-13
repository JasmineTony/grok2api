import type { APIRequestContext, Page } from "@playwright/test";

import { apiLogin, expect, signIn, test, type E2EServer } from "./fixtures";

// 界面文案默认语言为 zh-CN，英文仅作为语言切换后的兜底匹配；断言对象始终是用户可见结果。
const settingsHeadingName = /^(运行设置|Runtime settings)$/;
const nodeSavedToast = /代理节点已保存|Proxy node saved/;
const nodeDeletedToast = /代理节点已删除|Proxy node deleted/;
const batchDisabledToast = /已禁用 \d+ 个代理节点|Disabled \d+ proxy nodes/;
const batchEnabledToast = /已启用 \d+ 个代理节点|Enabled \d+ proxy nodes/;

type EgressNodeSnapshot = { id: string; name: string; enabled: boolean };
type EgressNodePage = { items: EgressNodeSnapshot[]; total: number };

/**
 * 通过真实管理 API 按唯一名查询出口节点，提供与 UI 断言相互独立的服务端事实。
 * 服务端没有单条读取路由，因此按唯一名搜索后取唯一命中。
 */
async function apiEgressNodes(request: APIRequestContext, server: E2EServer, search: string): Promise<EgressNodePage> {
  const accessToken = await apiLogin(request, server);
  const parameters = new URLSearchParams({ page: "1", pageSize: "20", search });
  const response = await request.get(`${server.baseURL}/api/admin/v1/egress-nodes?${parameters.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok()) {
    throw new Error(`读取出口节点失败：HTTP ${response.status()} ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    data?: { items?: Array<{ id?: unknown; name?: unknown; enabled?: unknown }>; total?: unknown };
  };
  const items = (payload.data?.items ?? []).map((item) => ({
    id: String(item.id ?? ""),
    name: String(item.name ?? ""),
    enabled: item.enabled === true,
  }));
  return { items, total: typeof payload.data?.total === "number" ? payload.data.total : items.length };
}

/** 读回唯一名对应的单条节点；读不到或命中多于一条时显式失败，不静默跳过后续断言。 */
async function readEgressNode(
  request: APIRequestContext,
  server: E2EServer,
  marker: string,
): Promise<EgressNodeSnapshot> {
  const page = await apiEgressNodes(request, server, marker);
  const node = page.items.find((item) => item.name === marker);
  if (!node || page.total !== 1) {
    throw new Error(`出口节点 ${marker} 未唯一出现在服务端：${JSON.stringify(page)}`);
  }
  return node;
}

/** 经真实管理 API 创建节点：只提交唯一名与作用域，不依赖任何外部代理。 */
async function createEgressNodeViaApi(
  request: APIRequestContext,
  server: E2EServer,
  name: string,
): Promise<EgressNodeSnapshot> {
  const accessToken = await apiLogin(request, server);
  const response = await request.post(`${server.baseURL}/api/admin/v1/egress-nodes`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { name, scope: "grok_build", enabled: true, proxyPool: false, accountCapacity: 0, userAgent: "" },
  });
  if (response.status() !== 201) {
    throw new Error(`创建出口节点失败：HTTP ${response.status()} ${await response.text()}`);
  }
  return readEgressNode(request, server, name);
}

/**
 * 按标记清理真实出口节点：先从服务端查回记录，再逐个删除。
 * 清理不依赖调用点是否拿到过 id，也不吞掉失败——删除未成功时直接抛出，使清理失败显式失败。
 */
async function removeEgressNodesByMarker(request: APIRequestContext, server: E2EServer, marker: string): Promise<void> {
  const created = await apiEgressNodes(request, server, marker);
  if (created.items.length > 0) {
    const accessToken = await apiLogin(request, server);
    for (const item of created.items) {
      const removed = await request.delete(`${server.baseURL}/api/admin/v1/egress-nodes/${item.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!removed.ok()) {
        throw new Error(`清理出口节点 ${item.id} 失败：HTTP ${removed.status()} ${await removed.text()}`);
      }
    }
  }
  // 清理结果同样显式断言：删除失败或仍有残留时本用例必须失败，不得静默放过。
  expect((await apiEgressNodes(request, server, marker)).total).toBe(0);
}

/** 直连真实路由进入设置页并切到「投递」分页：出口节点分区位于该页签，桌面与移动布局都可达。 */
async function openEgressNodesPane(page: Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/settings`);
  await expect(page.getByRole("heading", { name: settingsHeadingName })).toBeVisible();
  await page.getByTestId("settings-tab-delivery").click();
  await expect(page.getByTestId("egress-nodes-add")).toBeVisible();
}

test("出口节点：表单新建后列表与服务端同时出现，删除后同时消失", async ({ page, request, server }) => {
  const marker = `e2e-egress-${Date.now().toString(36)}`;
  await signIn(page, server);
  await openEgressNodesPane(page, server.baseURL);

  // 真实 UI 新建：新增菜单 → 手工添加 → 唯一名 → 保存。
  await page.getByTestId("egress-nodes-add").click();
  await page.getByTestId("egress-nodes-add-manual").click();
  const dialog = page.getByTestId("egress-node-dialog");
  await expect(dialog).toBeVisible();
  const nameInput = dialog.getByTestId("egress-node-name");
  await nameInput.fill(marker);
  await expect(nameInput).toHaveValue(marker);
  await dialog.getByTestId("egress-node-dialog-save").click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: nodeSavedToast }).first()).toBeVisible();
  await expect(dialog).toBeHidden();

  try {
    // UI：列表出现唯一名的节点行。
    await expect(page.getByText(marker, { exact: true })).toBeVisible();
    // 服务端：按唯一名搜索命中 1 条，且名称与 UI 一致。
    const created = await readEgressNode(request, server, marker);
    expect(created.name).toBe(marker);
    expect(created.id.length).toBeGreaterThan(0);
    await expect(page.getByTestId(`egress-node-name-${created.id}`)).toHaveText(marker);

    // 行内删除走真实 DELETE /api/admin/v1/egress-nodes/<id>：UI 行与服务端记录同时消失。
    await page.getByTestId(`egress-node-actions-${created.id}`).click();
    await page.getByTestId(`egress-node-delete-${created.id}`).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: nodeDeletedToast }).first()).toBeVisible();
    await expect(page.getByTestId(`egress-node-row-${created.id}`)).toHaveCount(0);
    expect((await apiEgressNodes(request, server, marker)).total).toBe(0);
  } finally {
    await removeEgressNodesByMarker(request, server, marker);
  }
});

test("出口节点：批量禁用/启用同步服务端 enabled", async ({ page, request, server }) => {
  const marker = `e2e-egress-batch-${Date.now().toString(36)}`;
  // 先用真实管理 API 建立前置数据（页面列表查询在挂载时执行，先建后开页才能读到该节点）。
  const created = await createEgressNodeViaApi(request, server, marker);
  expect(created.enabled).toBe(true);

  try {
    await signIn(page, server);
    await openEgressNodesPane(page, server.baseURL);

    const nameCell = page.getByTestId(`egress-node-name-${created.id}`);
    await expect(nameCell).toHaveText(marker);

    // 勾选该行 → 批量禁用：UI 弱化样式与批量提示可见，服务端 enabled 变为 false。
    await page.getByTestId(`egress-node-select-${created.id}`).click();
    await expect(page.getByTestId("egress-nodes-batch-actions")).toBeVisible();
    await page.getByTestId("egress-nodes-batch-disable").click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: batchDisabledToast }).first()).toBeVisible();
    await expect(nameCell).toHaveClass(/text-muted-foreground/);
    expect((await readEgressNode(request, server, marker)).enabled).toBe(false);

    // 重新勾选 → 批量启用：UI 恢复正常样式，服务端 enabled 回到 true。
    await page.getByTestId(`egress-node-select-${created.id}`).click();
    await page.getByTestId("egress-nodes-batch-enable").click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: batchEnabledToast }).first()).toBeVisible();
    await expect(nameCell).not.toHaveClass(/text-muted-foreground/);
    expect((await readEgressNode(request, server, marker)).enabled).toBe(true);
  } finally {
    await removeEgressNodesByMarker(request, server, marker);
  }
});
