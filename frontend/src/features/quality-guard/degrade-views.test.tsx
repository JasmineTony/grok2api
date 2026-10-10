import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DegradeEventsList } from "@/features/quality-guard/degrade-events-list";
import { SeriesChart } from "@/features/quality-guard/degrade-series-chart";
import type { DegradeClass, DegradeEventDTO } from "@/features/quality-guard/quality-guard-api";
import {
  degradeSummary,
  installQualityGuardApi,
  lastUrlOf,
  queryParam,
  renderDegradeAccountsPanel,
  setupUser,
} from "@/features/quality-guard/quality-guard-test-support";
import { i18n } from "@/shared/i18n";
import { formatCompactDateTime } from "@/shared/lib/format";

// 降级展示层分支补全测试：
// - 事件列表的分类徽标与字段回退；
// - 时间线的空数据 / 单点 / 零计数 / 抽稀标签；
// - 账号表格的筛选写入、无匹配空态、行状态变体、选择与分页边界。
// 展示组件直接 render（沿用全局 i18n），账号表格走既有 test-support 脚手架，不重建第二套网络替身。

const DEGRADE_PATH = "/api/admin/v1/request-audits/degrade-accounts";

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

function accountOf(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "acc-1",
    name: "a@example.com",
    email: "a@example.com",
    hits: 3,
    maxTPS: 1200,
    classes: { hard_tps: 2, missing_thinking: 1 },
    nodes: ["东京出口"],
    last: "2026-01-02T03:04:05Z",
    enabled: true,
    found: true,
    bfs: 0,
    ...overrides,
  };
}

/** Radix Select 在 jsdom 下指针路径不可靠：聚焦触发器 + 键盘展开后点击选项。 */
async function chooseSelectOption(trigger: HTMLElement, optionName: string): Promise<void> {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  await screen.findByRole("listbox");
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
// jsdom 下真实查询 + Radix 弹层比默认 5s 慢，统一放宽单测超时（不掩盖断言失败）。
vi.setConfig({ testTimeout: 15_000 });

describe("DegradeEventsList 分类徽标与行字段", () => {
  it("四种分类各自渲染对应徽标，缺少账号 ID 时回退为占位符", () => {
    const classes: DegradeClass[] = ["missing_thinking", "hard_tps", "buffered_burst", "soft_tps"];
    const events = classes.map((cls, index) =>
      eventOf({ id: `ev-${index}`, class: cls, accountId: index === 3 ? undefined : "acc-1" }),
    );
    render(<DegradeEventsList events={events} />);

    expect(screen.getByTestId("degrade-event-ev-0")).toHaveTextContent("thinking");
    expect(screen.getByTestId("degrade-event-ev-1")).toHaveTextContent("hard");
    expect(screen.getByTestId("degrade-event-ev-2")).toHaveTextContent("burst");
    expect(screen.getByTestId("degrade-event-ev-3")).toHaveTextContent("soft");

    // accountId 缺失时行内显示 "#-" 而不是 undefined
    expect(screen.getByTestId("degrade-event-ev-3")).toHaveTextContent("#-");
    expect(screen.getByTestId("degrade-event-ev-0")).toHaveTextContent("#acc-1");
    expect(screen.getByTestId("degrade-event-ev-0")).toHaveTextContent("out 40");
    expect(screen.getByTestId("degrade-event-ev-0")).toHaveTextContent("req-1");
  });

  it("没有事件时展示空态且不渲染任何事件行", () => {
    render(<DegradeEventsList events={[]} />);

    expect(screen.getByTestId("degrade-events")).toHaveTextContent(i18n.t("qualityGuard.degrade.noEvents"));
    expect(screen.queryByTestId("degrade-event-ev-0")).not.toBeInTheDocument();
  });
});

describe("SeriesChart 时间线柱状图", () => {
  function renderSeries(series: { label: string; count: number; severe: number }[]): void {
    render(<SeriesChart series={series} empty={i18n.t("qualityGuard.degrade.noHits")} title="降智时序" />);
  }

  it("空数据时展示空态文案且不渲染柱子", () => {
    renderSeries([]);

    expect(screen.getByTestId("degrade-series")).toHaveTextContent(i18n.t("qualityGuard.degrade.noHits"));
    expect(screen.queryAllByTitle(/:/)).toHaveLength(0);
  });

  it("单点数据：柱高占满、标签取小时两位数字且非严重柱用黄色", () => {
    renderSeries([{ label: "2026-01-02 07:00", count: 4, severe: 0 }]);

    const item = screen.getByTitle("2026-01-02 07:00: 4");
    // 柱体是行内唯一带 style 的节点
    const bar = item.querySelector("div[style]");
    expect(bar).toHaveStyle({ height: "100%" });
    expect(bar?.className).toContain("bg-amber-500");
    expect(item).toHaveTextContent("07");
  });

  it("零计数柱高为 0、严重过半用红色柱，无冒号的文本标签原样展示", () => {
    renderSeries([
      { label: "无时间标签", count: 0, severe: 3 },
      { label: "08:00", count: 10, severe: 6 },
    ]);

    const zeroBar = screen.getByTitle("无时间标签: 0").querySelector("div[style]");
    expect(zeroBar).toHaveStyle({ height: "0%" });
    expect(zeroBar?.className).toContain("bg-destructive");
    // 文本标签不含数字时保持原样（不会被补成 00）
    expect(screen.getByTitle("无时间标签: 0")).toHaveTextContent("无时间标签");

    const severeBar = screen.getByTitle("08:00: 10").querySelector("div[style]");
    expect(severeBar).toHaveStyle({ height: "100%" });
    expect(severeBar?.className).toContain("bg-destructive");
  });

  it("超过 12 个点时按 labelStep 抽稀标签，并始终保留最后一个标签", () => {
    const series = Array.from({ length: 20 }, (_, index) => ({
      label: `${String(index).padStart(2, "0")}:00`,
      count: index + 1,
      severe: 0,
    }));
    renderSeries(series);

    // 20 个点 → labelStep = ceil(20 / 8) = 3：保留 0/3/6/9/12/15/18 与最后一点
    const labels = screen
      .getAllByTitle(/:/)
      .map((node) => (node.textContent ?? "").trim())
      .filter((text) => text.length > 0);
    expect(labels).toEqual(["00", "03", "06", "09", "12", "15", "18", "19"]);
  });
});

describe("DegradeAccountsCard 筛选与分页边界", () => {
  // 筛选变化会切换查询 key：新 key 尚未取到数据时面板整体不渲染，
  // 因此每次选择后都要重新等待面板回到 DOM 再断言。
  async function chooseFilter(testId: string, optionName: string): Promise<void> {
    await chooseSelectOption(await screen.findByTestId(testId), optionName);
    await screen.findByTestId("degrade-account-row-acc-1");
  }

  it("周期 / 状态 / 类型三个筛选各自写回查询参数", async () => {
    const { requests } = installQualityGuardApi();
    renderDegradeAccountsPanel();
    await screen.findByTestId("degrade-account-row-acc-1");

    await chooseFilter("degrade-filter-window", i18n.t("qualityGuard.degrade.windows.7d"));
    await waitFor(() => expect(queryParam(lastUrlOf(requests, DEGRADE_PATH), "window")).toBe("7d"));

    await chooseFilter("degrade-filter-status", i18n.t("qualityGuard.degrade.statusOff"));
    await waitFor(() => expect(queryParam(lastUrlOf(requests, DEGRADE_PATH), "status")).toBe("disabled"));

    await chooseFilter("degrade-filter-class", "hard");
    await waitFor(() => expect(queryParam(lastUrlOf(requests, DEGRADE_PATH), "class")).toBe("hard_tps"));
  });

  it("按命中次数过滤后提示文案切换为带下限的版本", async () => {
    const { requests } = installQualityGuardApi();
    renderDegradeAccountsPanel();
    await screen.findByTestId("degrade-account-row-acc-1");

    await chooseSelectOption(
      screen.getByTestId("degrade-filter-hits"),
      i18n.t("qualityGuard.degrade.hitsMin", { count: 3 }),
    );

    await waitFor(() => expect(queryParam(lastUrlOf(requests, DEGRADE_PATH), "minHits")).toBe("3"));
    expect(
      await screen.findByText(i18n.t("qualityGuard.degrade.accountsHintFiltered", { shown: 1, total: 1, min: 3 })),
    ).toBeInTheDocument();
  });

  it("无匹配账号时展示无匹配空态、禁用全选且不渲染分页", async () => {
    installQualityGuardApi({
      degrade: degradeSummary({
        accounts: [],
        accountPage: { page: 1, pageSize: 50, total: 0, hasMore: false },
      }),
    });
    renderDegradeAccountsPanel();

    expect(await screen.findByText(i18n.t("qualityGuard.degrade.noAccounts"))).toBeInTheDocument();
    expect(screen.getByTestId("degrade-select-page")).toBeDisabled();
    expect(screen.queryByRole("combobox", { name: i18n.t("common.perPage") })).not.toBeInTheDocument();
  });

  it("行按状态、峰值 TPS 阈值与缺失字段切换展示，不可停用的行点击不改变选择", async () => {
    const user = setupUser();
    installQualityGuardApi({
      degrade: degradeSummary({
        accounts: [
          accountOf({
            id: "acc-deleted",
            name: "gone@example.com",
            email: "gone@example.com",
            hits: 1,
            maxTPS: 100,
            classes: {},
            nodes: [],
            last: "",
            enabled: false,
            found: false,
            bfs: 2,
          }),
          accountOf({
            id: "acc-lease",
            name: "lease@example.com",
            email: "lease@example.com",
            hits: 2,
            maxTPS: 600,
            classes: { buffered_burst: 1, soft_tps: 1 },
            enabled: false,
            leaseQuarantinedUntil: "2026-01-02T04:04:05Z",
          }),
          accountOf({
            id: "acc-off",
            name: "off@example.com",
            email: "",
            hits: 3,
            maxTPS: 1200,
            classes: { hard_tps: 1 },
            nodes: [],
            enabled: false,
          }),
          accountOf({ id: "acc-anon", name: "", email: "", hits: 4, maxTPS: 100, classes: {}, nodes: [] }),
        ],
        accountPage: { page: 1, pageSize: 50, total: 4, hasMore: false },
      }),
    });
    renderDegradeAccountsPanel();

    const deleted = await screen.findByTestId("degrade-account-row-acc-deleted");
    expect(deleted).toHaveTextContent(i18n.t("qualityGuard.degrade.deletedStatus"));
    expect(deleted).toHaveTextContent("bfs 2");
    // 未找到的账号不能勾选，行也不可点击；分类与节点为空时显示占位符，last 为空显示占位符
    expect(screen.getByTestId("degrade-account-select-acc-deleted")).toBeDisabled();
    expect(deleted).not.toHaveClass("cursor-pointer");
    expect(within(deleted).getAllByText("-").length).toBeGreaterThanOrEqual(2);

    const lease = screen.getByTestId("degrade-account-row-acc-lease");
    expect(lease).toHaveTextContent(
      i18n.t("qualityGuard.leaseUntil", { time: formatCompactDateTime("2026-01-02T04:04:05Z", "zh-CN") }),
    );
    expect(lease).toHaveTextContent("burst 1 · soft 1");

    const off = screen.getByTestId("degrade-account-row-acc-off");
    expect(off).toHaveTextContent(i18n.t("qualityGuard.degrade.disabledStatus"));
    // email 为空时回退为 name
    expect(off).toHaveTextContent("off@example.com");
    // maxTPS >= hardTPS 使用破坏性配色
    expect(off.querySelector("td.text-destructive")).not.toBeNull();
    // 已禁用但存在（found=true, enabled=false）的行不可停用，因此没有可点击样式
    expect(off).not.toHaveClass("cursor-pointer");

    const anon = screen.getByTestId("degrade-account-row-acc-anon");
    // email 与 name 都为空时回退为占位符；该行仍可停用，带可点击样式
    expect(anon).toHaveTextContent("#acc-anon");
    expect(within(anon).getAllByText("-").length).toBeGreaterThanOrEqual(1);
    expect(anon).toHaveClass("cursor-pointer");

    // 点击不可停用的行不改变选择
    await user.click(deleted);
    await user.click(off);
    expect(screen.getByTestId("degrade-account-select-acc-deleted")).not.toBeChecked();
    expect(screen.getByTestId("degrade-account-select-acc-off")).not.toBeChecked();
    expect(screen.getByTestId("degrade-mute-selected")).toBeDisabled();
  });

  it("点击行与全选框切换选择，全选框在部分选择时为 indeterminate", async () => {
    const user = setupUser();
    installQualityGuardApi({
      degrade: degradeSummary({
        accounts: [accountOf({ id: "acc-1" }), accountOf({ id: "acc-2", name: "b@example.com" })],
        accountPage: { page: 1, pageSize: 50, total: 2, hasMore: false },
      }),
    });
    renderDegradeAccountsPanel();
    const row = await screen.findByTestId("degrade-account-row-acc-1");

    const selectPage = screen.getByTestId("degrade-select-page");
    expect(selectPage).toBeEnabled();

    await user.click(within(row).getByText("a@example.com"));
    await waitFor(() => expect(screen.getByTestId("degrade-account-select-acc-1")).toBeChecked());
    expect(screen.getByTestId("degrade-select-page")).toHaveAttribute("aria-checked", "mixed");

    await user.click(selectPage);
    await waitFor(() => expect(screen.getByTestId("degrade-select-page")).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByTestId("degrade-account-select-acc-2")).toBeChecked();

    await user.click(screen.getByTestId("degrade-select-page"));
    await waitFor(() => expect(screen.getByTestId("degrade-account-select-acc-1")).not.toBeChecked());
    expect(screen.getByTestId("degrade-select-page")).toHaveAttribute("aria-checked", "false");
  });

  it("多页数据时翻页、跳末页与切换页大小都写回查询参数", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({
      degrade: degradeSummary({ accountPage: { page: 1, pageSize: 50, total: 120, hasMore: true } }),
    });
    renderDegradeAccountsPanel();
    await screen.findByTestId("degrade-account-row-acc-1");

    await user.click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));
    await waitFor(() => expect(queryParam(lastUrlOf(requests, DEGRADE_PATH), "page")).toBe("2"));

    await user.click(screen.getByRole("button", { name: i18n.t("common.lastPage") }));
    await waitFor(() => expect(queryParam(lastUrlOf(requests, DEGRADE_PATH), "page")).toBe("3"));

    await chooseSelectOption(screen.getByRole("combobox", { name: i18n.t("common.perPage") }), "100");
    await waitFor(() => {
      const url = lastUrlOf(requests, DEGRADE_PATH);
      expect(queryParam(url, "pageSize")).toBe("100");
      expect(queryParam(url, "page")).toBe("1");
    });
  });

  it("刷新进行中时按钮禁用并展示旋转图标", async () => {
    const user = setupUser();
    const { fetchMock } = installQualityGuardApi();
    const respond = fetchMock.getMockImplementation()!;
    let reloadStarted = false;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      // 首次加载正常返回；刷新触发的第二次请求保持挂起，用于断言进行中状态
      if (String(input).startsWith(DEGRADE_PATH) && (init?.method ?? "GET") === "GET" && reloadStarted) {
        return new Promise(() => {});
      }
      return respond(input, init);
    });
    renderDegradeAccountsPanel();
    await screen.findByTestId("degrade-account-row-acc-1");

    reloadStarted = true;
    await user.click(screen.getByRole("button", { name: i18n.t("common.refresh") }));

    const refresh = await screen.findByRole("button", { name: i18n.t("common.refresh") });
    await waitFor(() => expect(refresh).toBeDisabled());
    expect(refresh.querySelector("svg")?.getAttribute("class")).toContain("animate-spin");
  });
});
