import { expect, signIn, test } from "./fixtures";

// 界面文案默认语言为 zh-CN，英文仅作为语言切换后的兜底匹配；断言对象始终是用户可见结果。
const guardHeadingName = /^(质量守护|Quality guard)$/;
const guardUnavailableText = /质量守护尚未连接|Quality guard is not connected/;
const profilesTabName = /^(探针方案|Probe profiles)$/;
const degradeTabName = /^(降智账号|Degraded accounts)$/;

/**
 * 质量守护页：E2E 配置未设置 QualityGuardStatePath，服务端恒返回 `{available:false}`，
 * 因此节点页签必须显式显示不可用状态，而不是把未连接伪装成正常。
 * 同时覆盖「路由直达刷新」：reload 后 URL 与页面仍可达。
 */
test("质量守护：未配置守护状态时显式不可用，三个页签可达且路由刷新后仍可用", async ({ page, server }) => {
  await signIn(page, server);
  await page.goto(`${server.baseURL}/quality-guard`);
  await expect(page.getByRole("heading", { name: guardHeadingName })).toBeVisible();

  // 节点页签（默认）：守护状态不可用时展示明确的不可用占位，且不是错误页。
  await expect(page.getByTestId("guard-unavailable")).toBeVisible();
  await expect(page.getByTestId("guard-unavailable")).toContainText(guardUnavailableText);
  await expect(page.getByTestId("guard-overview")).toHaveCount(0);

  // 探针方案页签：面板可达（真实 GET /egress-quality-guard/profiles）。
  await page.getByRole("tab", { name: profilesTabName }).click();
  await expect(page.getByTestId("probe-profiles-panel")).toBeVisible();

  // 降智账号页签：面板可达（真实 GET /request-audits/degrade-accounts）。
  await page.getByRole("tab", { name: degradeTabName }).click();
  await expect(page.getByTestId("degrade-accounts-panel")).toBeVisible();

  // 路由直达刷新：URL 与页面在 reload 后仍可达，且回到默认页签的不可用状态。
  await page.reload();
  await expect(page).toHaveURL(/\/quality-guard$/);
  await expect(page.getByRole("heading", { name: guardHeadingName })).toBeVisible();
  await expect(page.getByTestId("guard-unavailable")).toBeVisible();
});
