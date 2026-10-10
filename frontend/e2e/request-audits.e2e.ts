import type { Page } from "@playwright/test";

import { apiLogin, expect, signIn, test, type E2EServer } from "./fixtures";

// 界面文案默认语言为 zh-CN，英文仅作为语言切换后的兜底匹配；断言对象始终是用户可见结果。
const auditsName = /^(请求审计|Request audits)$/;
const usageSummaryName = /^(用量统计|Usage summary)$/;
const totalRequestsText = /^(总请求|Total requests)$/;
const totalTokensText = /^(总 Tokens|Total tokens)$/;
const noDataText = /^(暂无数据|No data)$/;
const filterButtonName = /筛选|Filters/;
const allOptionName = /^(全部|All)$/;
const searchInputName = /搜索请求 ID、模型、客户端 IP 或出口节点|Search request ID, model, client IP, or egress node/;
// 状态子菜单的可访问名会带上当前已选状态（例如「状态 4xx · 客户端错误」），故只锚定前缀。
const statusFilterItemName = /^(状态|Status)( |$)/;
const statusOption4xxName = /^4xx · (客户端错误|Client error)$/;
const clearFiltersName = /^(清除筛选|Clear filters)$/;
const retryButtonName = /^(重试|Retry)$/;
const inactiveFilterButtonName = /^(筛选|Filters)$/;

type AuditPageFact = { ids: string[]; hasMore: boolean };

/**
 * 真实服务端事实：用管理 API 读取审计游标页，参数与前端 getRequestAudits 一致。
 * 这提供与 UI 断言相互独立的来源，避免前端自身错误同时骗过两边。
 */
async function apiAuditPage(
  request: Parameters<typeof apiLogin>[0],
  server: E2EServer,
  filters: { search?: string; status?: string },
): Promise<AuditPageFact> {
  const accessToken = await apiLogin(request, server);
  const query = new URLSearchParams({ pagination: "cursor", pageSize: "20", period: "24h" });
  if (filters.search) query.set("search", filters.search);
  if (filters.status) query.set("status", filters.status);
  const response = await request.get(`${server.baseURL}/api/admin/v1/request-audits?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok()) {
    throw new Error(`读取审计游标页失败：HTTP ${response.status()} ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    data?: { items?: Array<{ id?: unknown }>; hasMore?: unknown };
  };
  return {
    ids: (payload.data?.items ?? []).map((item) => String(item.id)),
    hasMore: Boolean(payload.data?.hasMore),
  };
}

/** 通过工具栏筛选菜单选择状态：菜单为「筛选 → 状态 → 选项」两级结构。 */
async function selectStatusFilter(page: Page, optionName: RegExp): Promise<void> {
  await page.getByRole("button", { name: filterButtonName }).click();
  await page.getByRole("menuitem", { name: statusFilterItemName }).click();
  await page.getByRole("menuitemradio", { name: optionName }).click();
}

test("未登录访问审计页会被重定向到登录页", async ({ page, server }) => {
  await page.goto(`${server.baseURL}/request-audits`);

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: /管理员登录|Admin sign in/ })).toBeVisible();
});

test("空池下审计页渲染真实零值与空态，筛选和周期控件保持可用", async ({ page, request, server }) => {
  // 本 worker 的临时数据库刚启动：审计表必然为空，这是真实可达的状态而非 mock。
  const empty = await apiAuditPage(request, server, {});
  expect(empty.ids).toEqual([]);
  expect(empty.hasMore).toBe(false);

  await signIn(page, server);
  await page.getByRole("link", { name: auditsName }).click();
  await expect(page).toHaveURL(/\/request-audits$/);
  await expect(page.getByRole("heading", { name: auditsName })).toBeVisible();
  await expect(page.getByRole("region", { name: usageSummaryName })).toBeVisible();

  // 汇总卡片展示真实零值（不是加载占位）。
  await expect(page.getByText(totalRequestsText)).toBeVisible();
  await expect(page.getByText(totalTokensText)).toBeVisible();
  await expect(page.getByText(/^0$/).first()).toBeVisible();

  // 列表空态可见且没有任何数据行。
  await expect(page.getByText(noDataText)).toBeVisible();
  await expect(page.getByTestId(/^audit-row-/)).toHaveCount(0);

  // 搜索框可编辑并有可访问名称；周期选择器默认 24h 且处于选中态。
  await expect(page.getByRole("textbox", { name: searchInputName })).toBeEditable();
  const periodTab = page.getByRole("tab", { name: /^24h$/ });
  await expect(periodTab).toBeVisible();
  await expect(periodTab).toHaveAttribute("data-state", "active");

  // 筛选菜单可展开，状态子菜单提供真实选项。
  await page.getByRole("button", { name: filterButtonName }).click();
  await page.getByRole("menuitem", { name: statusFilterItemName }).click();
  await expect(page.getByRole("menuitemradio", { name: statusOption4xxName })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: allOptionName }).first()).toBeVisible();
});

test("状态筛选改变真实查询范围并显示激活计数，清除后恢复空态", async ({ page, request, server }) => {
  await signIn(page, server);
  await page.goto(`${server.baseURL}/request-audits`);
  await expect(page.getByRole("heading", { name: auditsName })).toBeVisible();
  await expect(page.getByText(noDataText)).toBeVisible();

  // 服务端在同样范围（24h，无筛选）下也是空页，因此 UI 空态不是渲染缺陷掩盖。
  expect((await apiAuditPage(request, server, {})).ids).toEqual([]);

  await selectStatusFilter(page, statusOption4xxName);

  // 筛选生效的用户可见证据：按钮带出激活计数，且状态子菜单回显当前所选标签。
  const filterButton = page.getByRole("button", { name: filterButtonName });
  await expect(filterButton).toContainText("1");
  await filterButton.click();
  await expect(page.getByRole("menuitem", { name: /^(状态|Status)\s+4xx/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // 列表仍是真实空态：服务端以相同状态范围查询同样为空，说明结果不来自本地伪造。
  await expect(page.getByText(noDataText)).toBeVisible();
  await expect(page.getByTestId(/^audit-row-/)).toHaveCount(0);
  expect((await apiAuditPage(request, server, { status: "4xx" })).ids).toEqual([]);

  // 清除筛选后激活计数消失，按钮回到无筛选文案，空态保持。
  // 空池下表格整体不渲染（AuditTableContent 只在有数据或加载中才输出表头），
  // 因此此处断言真实可达状态：筛选按钮可用、空态可见、无错误面板。
  await filterButton.click();
  await page.getByRole("menuitem", { name: clearFiltersName }).click();
  await expect(page.getByRole("button", { name: inactiveFilterButtonName })).toBeVisible();
  await expect(page.getByText(noDataText)).toBeVisible();
  await expect(page.getByRole("button", { name: retryButtonName })).toHaveCount(0);
});
