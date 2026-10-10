import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DegradeEventsList } from "@/features/quality-guard/degrade-events-list";
import { SeriesChart } from "@/features/quality-guard/degrade-series-chart";
import { Policy } from "@/features/quality-guard/guard-policy-panel";
import type { DegradeClass, DegradeEventDTO, QualityGuardStatus } from "@/features/quality-guard/quality-guard-api";
import {
  guardNode,
  guardStatus,
  installQualityGuardApi,
  renderQualityGuardPage,
  setupUser,
} from "@/features/quality-guard/quality-guard-test-support";
import { i18n } from "@/shared/i18n";
import { formatCompactDateTime } from "@/shared/lib/format";

// 质量守护展示层的独立补测（不与既有 degrade-views / quality-guard-* 测试文件重叠）：
// - 降级事件列表的时间格式化与字段拼接；
// - 时间线的多柱几何（相对高度）与抽稀标签首尾规则；
// - 策略摘要的缺 config 短路；
// - 节点 tab 在「统计缺失 / 事件为空」数据形态下的渲染，以及弹窗关闭守卫（保存中 / 删除中不放行）。
// 只替换网络边界；控制器、弹窗、事件面板全部使用真实实现，弹窗守卫断言用户可见结果（弹窗是否关闭）。

const NODES_PATH = "/api/admin/v1/egress-nodes";

/** 让命中条件的请求保持挂起，用于稳定观察「进行中」的守卫（与 use-guard-hooks.test.tsx 的 holdRequest 语义一致）。 */
function holdRequests(
  fetchMock: ReturnType<typeof installQualityGuardApi>["fetchMock"],
  predicate: (url: string, method: string) => boolean,
): void {
  const respond = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    if (predicate(String(input), (init?.method ?? "GET").toUpperCase())) return new Promise(() => {});
    return respond(input, init);
  });
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
// jsdom 下整页渲染 + Radix 弹层 + 真实轮询查询比默认 5s 慢，统一放宽单测超时（不掩盖断言失败）。
vi.setConfig({ testTimeout: 15_000 });

describe("DegradeEventsList 行内容与空态", () => {
  function eventOf(overrides: Partial<DegradeEventDTO>): DegradeEventDTO {
    return {
      id: "ev-1",
      requestId: "req-1",
      accountId: "acc-1",
      accountName: "a@example.com",
      nodeName: "东京出口",
      outputTokens: 40,
      tps: 1200,
      class: "missing_thinking",
      createdAt: "2026-01-02T03:04:05Z",
      model: "grok-4",
      ...overrides,
    };
  }

  it("每行按当前语言格式化时间，并拼接账号、节点、token 与请求 ID", () => {
    const classes: DegradeClass[] = ["missing_thinking", "hard_tps", "buffered_burst", "soft_tps"];
    render(
      <DegradeEventsList
        events={classes.map((cls, index) =>
          eventOf({ id: `ev-${index}`, class: cls, accountId: index === 1 ? undefined : "acc-7" }),
        )}
      />,
    );

    const first = screen.getByTestId("degrade-event-ev-0");
    expect(first).toHaveTextContent(formatCompactDateTime("2026-01-02T03:04:05Z", "zh-CN"));
    expect(first).toHaveTextContent("#acc-7 a@example.com · 东京出口 · out 40 · req-1");
    expect(first).toHaveTextContent("thinking");

    // accountId 缺失时使用占位符，不渲染 "undefined"
    expect(screen.getByTestId("degrade-event-ev-1")).toHaveTextContent("#-");
    expect(screen.getByTestId("degrade-event-ev-1")).toHaveTextContent("hard");
    expect(screen.getByTestId("degrade-event-ev-2")).toHaveTextContent("burst");
    expect(screen.getByTestId("degrade-event-ev-3")).toHaveTextContent("soft");
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it("事件列表为空时只渲染空态，不渲染任何事件行", () => {
    render(<DegradeEventsList events={[]} />);

    expect(screen.getByTestId("degrade-events")).toHaveTextContent(i18n.t("qualityGuard.degrade.noEvents"));
    expect(screen.queryByTestId("degrade-event-ev-0")).not.toBeInTheDocument();
  });
});

describe("SeriesChart 多柱几何与标签抽稀", () => {
  it("柱高按最大计数等比缩放，四个点不抽稀标签且依次渲染", () => {
    render(
      <SeriesChart
        series={[
          { label: "01:00", count: 9, severe: 0 },
          { label: "02:00", count: 3, severe: 0 },
          { label: "03:00", count: 12, severe: 0 },
          { label: "04:00", count: 1, severe: 0 },
        ]}
        empty={i18n.t("qualityGuard.degrade.noHits")}
        title="降智时序"
      />,
    );

    const titles = screen.getAllByTitle(/:/);
    expect(titles).toHaveLength(4);
    const heights = titles.map((item) => (item.querySelector("div[style]") as HTMLElement).style.height);
    // degrade-series-chart.tsx:32 的真实规则：count <= 0 为 0%，否则 max(6, round(count / max * 100))。
    // 最大值 12 时：9/12 = 75%、3/12 = 25%、12/12 = 100%、1/12 = 8.33% → 8%（未触及 6% 下限）。
    expect(heights).toEqual(["75%", "25%", "100%", "8%"]);
    // 4 个点少于阈值 12，所有标签都展示
    expect(titles.map((item) => (item.textContent ?? "").trim())).toEqual(["01", "02", "03", "04"]);
  });

  it("13 个点触发抽稀并始终保留最后一个标签", () => {
    render(
      <SeriesChart
        series={Array.from({ length: 13 }, (_, index) => ({
          label: `${String(index).padStart(2, "0")}:00`,
          count: index + 1,
          severe: 0,
        }))}
        empty={i18n.t("qualityGuard.degrade.noHits")}
        title="降智时序"
      />,
    );

    // 13 个点 → labelStep = ceil(13 / 8) = 2：保留 0/2/4/6/8/10/12
    const labels = screen
      .getAllByTitle(/:/)
      .map((node) => (node.textContent ?? "").trim())
      .filter((text) => text.length > 0);
    expect(labels).toEqual(["00", "02", "04", "06", "08", "10", "12"]);
  });
});

describe("Policy 策略摘要", () => {
  it("缺少 config 时整块不渲染，不产生空的策略标题", () => {
    const { unmount } = render(
      <Policy status={guardStatus({ config: undefined }) as unknown as QualityGuardStatus} onEdit={() => {}} />,
    );

    expect(screen.queryByTestId("guard-policy")).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t("qualityGuard.policy"))).not.toBeInTheDocument();
    unmount();
  });
});

describe("GuardNodesTab 数据形态与弹窗守卫", () => {
  it("statistics 缺失、recentEvents 为空时仍渲染节点表格，事件与策略区块不崩溃", async () => {
    installQualityGuardApi({
      nodes: [guardNode({ id: "node-1", name: "东京出口" })],
      // statistics 可缺省；recentEvents 由解码器强制校验为数组（quality-guard-api.ts:238），
      // 因此「缺失事件」能从网络边界到达的最接近取值是空数组。
      status: guardStatus({ statistics: undefined, recentEvents: [] }),
    });
    renderQualityGuardPage();

    await screen.findByTestId("guard-overview");
    expect(await screen.findByTestId("guard-nodes-card")).toBeInTheDocument();
    expect(screen.getByTestId("guard-node-row-node-1")).toBeInTheDocument();
    // statistics 缺失时统计面板整块不渲染，而不是渲染半截空面板
    expect(screen.queryByTestId("guard-statistics")).not.toBeInTheDocument();
    // 事件为空时事件面板给出空态文案
    expect(screen.getByTestId("guard-events")).toHaveTextContent(i18n.t("qualityGuard.noEvents"));
    // 策略摘要仍然按 config 渲染（config 存在）
    expect(screen.getByTestId("guard-policy")).toBeInTheDocument();
  });

  it("保存中按 Esc 不关闭节点弹窗，空闲时按 Esc 正常关闭", async () => {
    const user = setupUser();
    const { fetchMock } = installQualityGuardApi({ nodes: [] });
    holdRequests(fetchMock, (url, method) => url === NODES_PATH && method === "POST");
    const { unmount } = renderQualityGuardPage();
    await screen.findByTestId("guard-nodes-empty");

    await user.click(screen.getByTestId("guard-node-create"));
    const dialog = await screen.findByTestId("guard-node-editor");
    await user.type(within(dialog).getByTestId("guard-node-name"), "进行中");
    await user.click(within(dialog).getByTestId("guard-node-save"));
    await waitFor(() => expect(within(dialog).getByTestId("guard-node-save")).toBeDisabled());

    await user.keyboard("{Escape}");

    // 保存中守卫不放行：弹窗保持打开，保存结果不会丢失
    expect(screen.getByTestId("guard-node-editor")).toBeInTheDocument();
    unmount();

    // 空闲时同一守卫放行，Esc 关闭弹窗
    renderQualityGuardPage();
    await screen.findByTestId("guard-nodes-empty");
    await user.click(screen.getByTestId("guard-node-create"));
    await screen.findByTestId("guard-node-editor");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByTestId("guard-node-editor")).not.toBeInTheDocument());
  });

  it("删除中按 Esc 不关闭确认弹窗，未删除时按 Esc 正常关闭", async () => {
    const user = setupUser();
    const { fetchMock } = installQualityGuardApi({ nodes: [guardNode({ id: "node-1", name: "东京出口" })] });
    holdRequests(fetchMock, (url, method) => url === NODES_PATH && method === "DELETE");
    const { unmount } = renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByTestId("guard-node-menu-node-1"));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("common.delete") }));
    const dialog = await screen.findByTestId("guard-node-delete-dialog");
    await user.click(within(dialog).getByTestId("guard-node-delete-confirm"));
    await waitFor(() => expect(within(dialog).getByTestId("guard-node-delete-confirm")).toBeDisabled());

    await user.keyboard("{Escape}");

    // 删除中守卫不放行：确认弹窗保持打开且确认按钮维持禁用；弹窗守卫不影响策略面板
    expect(screen.getByTestId("guard-node-delete-dialog")).toBeInTheDocument();
    expect(within(dialog).getByTestId("guard-node-delete-confirm")).toBeDisabled();
    expect(within(screen.getByTestId("guard-policy")).getByTestId("guard-policy-edit")).toBeInTheDocument();
    unmount();

    // 未进行删除时同一守卫放行，Esc 关闭确认弹窗
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");
    await user.click(screen.getByTestId("guard-node-menu-node-1"));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("common.delete") }));
    await screen.findByTestId("guard-node-delete-dialog");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByTestId("guard-node-delete-dialog")).not.toBeInTheDocument());
  });
});
