import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  guardNode,
  guardStatus,
  installQualityGuardApi,
  lastUrlOf,
  openNodeFilters,
  openTab,
  queryParam,
  renderQualityGuardPage,
  setupUser,
  type RecordedRequest,
} from "@/features/quality-guard/quality-guard-test-support";
import { i18n } from "@/shared/i18n";

// 质量守护页关键路径集成测试：只替换网络边界（全局 fetch），页面、hooks、解码器与
// React Query 状态流全部使用真实实现，断言以用户可见结果为准。
// 覆盖：守护状态加载 / 失败 / 未启用、节点表格分页与筛选、策略展示、
// 以及 sidecar 开关与请求路径扣住开关互不混同。

const STATUS_PATH = "/api/admin/v1/egress-quality-guard";
const NODES_PATH = "/api/admin/v1/egress-nodes";
const DEGRADE_PATH = "/api/admin/v1/request-audits/degrade-accounts";

function requestsTo(requests: RecordedRequest[], path: string): RecordedRequest[] {
  return requests.filter((request) => request.url.startsWith(path));
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
});
// jsdom 下整页渲染 + Radix 弹层 + 真实轮询查询比默认 5s 慢，统一放宽单测超时（不掩盖断言失败）。
vi.setConfig({ testTimeout: 15_000 });

describe("QualityGuardPage 守护状态", () => {
  it("加载完成后展示服务状态、检测模式、节点计数与隔离对象", async () => {
    installQualityGuardApi({ enabledTotal: 1 });
    renderQualityGuardPage();

    expect(await screen.findByTestId("guard-metric-service-status")).toHaveTextContent(i18n.t("qualityGuard.running"));
    expect(screen.getByTestId("guard-metric-mode")).toHaveTextContent(i18n.t("qualityGuard.modes.hybrid"));
    await waitFor(() => expect(screen.getByTestId("guard-metric-nodes")).toHaveTextContent("1 / 2"));
    // 隔离对象 = nodeSummary.quarantined(1) + quarantinedLeases(1)
    expect(screen.getByTestId("guard-metric-quarantined")).toHaveTextContent("2");
    expect(screen.getByTestId("guard-statistics")).toHaveTextContent("20");
  });

  it("状态过期时显示「状态滞后」而不是运行正常", async () => {
    installQualityGuardApi({
      status: guardStatus({ updatedAt: Math.floor(Date.now() / 1000) - 86_400, statistics: undefined }),
    });
    renderQualityGuardPage();

    expect(await screen.findByTestId("guard-metric-service-status")).toHaveTextContent(i18n.t("qualityGuard.stale"));
  });

  it("守护状态读取失败时展示错误与重试，重试会重新请求", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({ failure: "status" });
    renderQualityGuardPage();

    expect(await screen.findByText("守护状态读取失败")).toBeInTheDocument();
    const before = requestsTo(requests, STATUS_PATH).length;

    await user.click(screen.getByRole("button", { name: i18n.t("common.retry") }));

    await waitFor(() => expect(requestsTo(requests, STATUS_PATH).length).toBeGreaterThan(before));
  });

  it("sidecar 未连接时显示明确的未启用状态，不伪装成正常", async () => {
    installQualityGuardApi({ status: { available: false } });
    renderQualityGuardPage();

    expect(await screen.findByTestId("guard-unavailable")).toHaveTextContent(i18n.t("qualityGuard.unavailable"));
    expect(screen.queryByTestId("guard-overview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("guard-nodes-card")).not.toBeInTheDocument();
  });
});

describe("QualityGuardPage 节点质量", () => {
  it("渲染节点行、状态徽标与分页，翻页写入查询参数", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({
      nodes: [guardNode(), guardNode({ id: "node-2", name: "新加坡出口" })],
      nodesTotal: 45,
    });
    renderQualityGuardPage();

    expect(await screen.findByTestId("guard-node-row-node-1")).toHaveTextContent("东京出口");
    expect(screen.getByTestId("guard-node-state-node-1")).toHaveTextContent(i18n.t("qualityGuard.quarantined"));
    // protectedNodeIds 命中时显示固定回退而不是普通状态
    expect(screen.getByTestId("guard-node-state-node-2")).toHaveTextContent(i18n.t("qualityGuard.fixedFallback"));
    expect(screen.getByText(i18n.t("common.pageOf", { page: 1, pages: 3 }))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));

    await waitFor(() => expect(queryParam(lastUrlOf(requests, NODES_PATH), "page")).toBe("2"));
  });

  it("搜索词经防抖写入查询参数，探测筛选写入 probe 参数", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi();
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.type(screen.getByTestId("guard-nodes-search"), "东京");
    await waitFor(() => expect(queryParam(lastUrlOf(requests, NODES_PATH), "search")).toBe("东京"), { timeout: 3_000 });

    await openNodeFilters(user);
    // Radix 子菜单在 jsdom 中靠指针移动打开，click 不会展开
    await user.pointer({
      target: await screen.findByRole("menuitem", { name: new RegExp(`^${i18n.t("settings.egress.probe")}`) }),
    });
    await user.pointer({
      target: await screen.findByRole("menuitemradio", { name: i18n.t("settings.egress.unhealthy") }),
      keys: "[MouseLeft]",
    });

    await waitFor(() => expect(queryParam(lastUrlOf(requests, NODES_PATH), "probe")).toBe("unhealthy"));
  });

  it("展示当前策略摘要与最近事件", async () => {
    installQualityGuardApi();
    renderQualityGuardPage();

    const policy = await screen.findByTestId("guard-policy");
    expect(policy).toHaveTextContent(i18n.t("qualityGuard.softThreshold"));
    expect(policy).toHaveTextContent("500 Token/s × 2");
    expect(screen.getByTestId("guard-events")).toHaveTextContent("东京出口");
    expect(screen.getByTestId("guard-events")).toHaveTextContent(i18n.t("qualityGuard.eventTypes.node_quarantined"));
  });

  it("节点启停只写出口节点开关，不改写请求路径扣住分类", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi();
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByTestId("guard-node-toggle-node-1"));

    await waitFor(() => {
      const batch = requests.filter((request) => request.url === `${NODES_PATH}/batch`);
      expect(batch).toHaveLength(1);
      expect(batch[0].method).toBe("PATCH");
      expect(batch[0].body).toEqual({ ids: ["node-1"], enabled: false });
    });

    // 请求路径扣住（思考换号）统计属于另一个开关，节点启停不应触发或改写它
    expect(requestsTo(requests, DEGRADE_PATH)).toHaveLength(0);

    await openTab(user, i18n.t("qualityGuard.degrade.tab"));
    const row = await screen.findByTestId("degrade-account-row-acc-1");
    expect(row).toHaveTextContent("thinking 1 · hard 2");
  });

  it("sidecar 未连接时请求路径扣住统计照常独立展示", async () => {
    const user = setupUser();
    installQualityGuardApi({ status: { available: false } });
    renderQualityGuardPage();
    await screen.findByTestId("guard-unavailable");

    await openTab(user, i18n.t("qualityGuard.degrade.tab"));

    expect(await screen.findByTestId("degrade-metric-hits")).toHaveTextContent("5");
    expect(screen.getByTestId("degrade-events")).toHaveTextContent("thinking");
    expect(screen.getByTestId("degrade-account-row-acc-1")).toHaveTextContent(
      i18n.t("qualityGuard.degrade.scheduling"),
    );
  });
});

describe("QualityGuardPage 探测配置", () => {
  it("展示内置/自定义方案、期望标记与当前启用状态", async () => {
    const user = setupUser();
    installQualityGuardApi();
    renderQualityGuardPage();
    await screen.findByTestId("guard-overview");

    await openTab(user, i18n.t("qualityGuard.profilesTab"));

    const builtin = await screen.findByTestId("probe-profile-row-profile-builtin");
    expect(builtin).toHaveTextContent("内置方案");
    expect(builtin).toHaveTextContent(i18n.t("qualityGuard.profileBuiltin"));
    expect(builtin).toHaveTextContent(i18n.t("qualityGuard.profileActive"));
    expect(builtin).toHaveTextContent(`${i18n.t("qualityGuard.profileExpected")} pong`);
    // 已启用的方案不显示「使用此」
    expect(within(builtin).queryByRole("button", { name: i18n.t("qualityGuard.profileActivate") })).toBeNull();

    const custom = screen.getByTestId("probe-profile-row-profile-custom");
    expect(custom).toHaveTextContent(i18n.t("qualityGuard.profileCustom"));
    expect(custom).toHaveTextContent(i18n.t("qualityGuard.profileNoExpected"));
    expect(within(custom).getByRole("button", { name: i18n.t("qualityGuard.profileActivate") })).toBeInTheDocument();
  });
});
