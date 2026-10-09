import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  degradeSummary,
  installQualityGuardApi,
  lastUrlOf,
  queryParam,
  renderDegradeAccountsPanel,
  setupUser,
  type RecordedRequest,
} from "@/features/quality-guard/quality-guard-test-support";
import { i18n } from "@/shared/i18n";

// 降级账号面板关键路径集成测试：只替换网络边界，查询、筛选状态与批量停用 mutation 使用真实实现。
// 覆盖：加载 / 空态 / 失败、请求路径扣住分类展示、批量停用只作用于所选账号、筛选写入查询参数。

const DEGRADE_PATH = "/api/admin/v1/request-audits/degrade-accounts";
const ACCOUNTS_BATCH_PATH = "/api/admin/v1/accounts/batch";

function requestsTo(requests: RecordedRequest[], path: string): RecordedRequest[] {
  return requests.filter((request) => request.url.startsWith(path));
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

describe("DegradeAccountsPanel", () => {
  it("加载后展示总览指标、时间线、节点分布、账号表与事件", async () => {
    installQualityGuardApi();
    renderDegradeAccountsPanel();

    expect(await screen.findByTestId("degrade-metric-hits")).toHaveTextContent("5");
    expect(screen.getByTestId("degrade-metric-accounts")).toHaveTextContent("2");
    expect(screen.getByTestId("degrade-metric-still-enabled")).toHaveTextContent("1");
    expect(screen.getByTestId("degrade-metric-max-tps")).toHaveTextContent("1200");
    expect(screen.getByTestId("degrade-series")).toBeInTheDocument();
    expect(screen.getByTestId("degrade-nodes")).toHaveTextContent("东京出口");

    const row = screen.getByTestId("degrade-account-row-acc-1");
    expect(row).toHaveTextContent("a@example.com");
    expect(row).toHaveTextContent(i18n.t("qualityGuard.degrade.scheduling"));
    // 请求路径扣住（思考换号）与 burst/soft/hard 分类分别展示
    expect(row).toHaveTextContent("thinking 1 · hard 2");

    expect(screen.getByTestId("degrade-events")).toHaveTextContent("thinking");
  });

  it("没有降级请求时展示各区块空态", async () => {
    installQualityGuardApi({
      degrade: degradeSummary({
        totals: {
          hits: 0,
          accounts: 0,
          stillEnabled: 0,
          disabled: 0,
          deleted: 0,
          hard: 0,
          soft: 0,
          burst: 0,
          thinking: 0,
          maxTPS: 0,
        },
        series: [],
        nodes: [],
        accounts: [],
        accountPage: { page: 1, pageSize: 50, total: 0, hasMore: false },
        events: [],
      }),
    });
    renderDegradeAccountsPanel();

    expect(await screen.findByTestId("degrade-metric-hits")).toHaveTextContent("0");
    expect(screen.getByText(i18n.t("qualityGuard.degrade.noHits"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("qualityGuard.degrade.noNodes"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("qualityGuard.degrade.noAccounts"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("qualityGuard.degrade.noEvents"))).toBeInTheDocument();
    expect(screen.queryByTestId("degrade-account-row-acc-1")).not.toBeInTheDocument();
  });

  it("读取失败时展示错误与重试，重试会重新请求", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({ failure: "degrade" });
    renderDegradeAccountsPanel();

    expect(await screen.findByText("降智账号读取失败")).toBeInTheDocument();
    const before = requestsTo(requests, DEGRADE_PATH).length;

    await user.click(screen.getByRole("button", { name: i18n.t("common.retry") }));

    await waitFor(() => expect(requestsTo(requests, DEGRADE_PATH).length).toBeGreaterThan(before));
  });

  it("批量停用只提交所选账号，并确认提示数量", async () => {
    const user = setupUser();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { requests } = installQualityGuardApi();
    renderDegradeAccountsPanel();
    await screen.findByTestId("degrade-account-row-acc-1");

    const mute = screen.getByTestId("degrade-mute-selected");
    expect(mute).toBeDisabled();

    await user.click(screen.getByTestId("degrade-account-select-acc-1"));
    expect(mute).toBeEnabled();

    await user.click(mute);

    await waitFor(() => {
      const batch = requests.filter((request) => request.url === ACCOUNTS_BATCH_PATH);
      expect(batch).toHaveLength(1);
      expect(batch[0].method).toBe("PATCH");
      expect(batch[0].body).toEqual({ ids: ["acc-1"], enabled: false, provider: "grok_build" });
    });
    expect(confirm).toHaveBeenCalledWith(i18n.t("qualityGuard.degrade.muteConfirm", { count: 1 }));
  });

  it("取消确认时不发出停用请求", async () => {
    const user = setupUser();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { requests } = installQualityGuardApi();
    renderDegradeAccountsPanel();
    await screen.findByTestId("degrade-account-row-acc-1");

    await user.click(screen.getByTestId("degrade-account-select-acc-1"));
    await user.click(screen.getByTestId("degrade-mute-selected"));

    expect(requests.filter((request) => request.url === ACCOUNTS_BATCH_PATH)).toHaveLength(0);
  });

  it("搜索筛选写入查询参数并回到第 1 页", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi();
    renderDegradeAccountsPanel();
    await screen.findByTestId("degrade-account-row-acc-1");

    await user.type(screen.getByTestId("degrade-search"), "a@example.com");

    await waitFor(
      () => {
        const url = lastUrlOf(requests, DEGRADE_PATH);
        expect(queryParam(url, "search")).toBe("a@example.com");
        expect(queryParam(url, "page")).toBe("1");
      },
      { timeout: 3_000 },
    );
  }, 15_000);
});
