import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { ModelRouteDTO } from "@/entities/model/types";
import type { AccountDTO } from "@/features/accounts/accounts-dto";
import { RequestAuditsPage } from "@/features/audits/request-audits-page";
import {
  auditAttemptDTO,
  auditDTO,
  auditFilterAccount,
  auditFilterKey,
  auditFilterModel,
  auditPage,
  auditSummary,
  createFakeApi,
  ResizeObserverStub,
  type FakeApiCall,
} from "@/features/audits/audit-test-support";
import type { ClientKeyDTO } from "@/features/client-keys/client-keys-api";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";
import { USD_TICKS_PER_DOLLAR } from "@/shared/lib/usd";

// 关键路径组件集成测试（AGENTS.md TEST-3）：只替换 apiRequest 这一网络边界，
// 页面组件、react-query 状态流、审计 DTO decoder 与筛选/分页交互保持真实实现。
const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

type RecordedCall = [path: string, options: { method?: string }];

function recordedCalls(): RecordedCall[] {
  return apiMock.request.mock.calls as RecordedCall[];
}

function listQueries(path: string): URLSearchParams[] {
  return recordedCalls()
    .filter(([called]) => called.startsWith(path))
    .map(([called]) => new URLSearchParams(called.slice(called.indexOf("?") + 1)));
}

function lastQuery(path: string): URLSearchParams {
  const queries = listQueries(path);
  expect(queries.length).toBeGreaterThan(0);
  return queries[queries.length - 1];
}

type Routes = {
  list: (call: FakeApiCall) => unknown;
  summary?: (call: FakeApiCall) => unknown;
  detail?: (call: FakeApiCall) => unknown;
  /** 三级筛选菜单的密钥名单；省略时返回空名单。keysGate 用于断言加载中状态。 */
  keys?: ClientKeyDTO[];
  keysTotal?: number;
  keysFailure?: boolean;
  keysGate?: Promise<void>;
  accounts?: AccountDTO[];
  accountsTotal?: number;
  models?: ModelRouteDTO[];
};

/** 只 mock 网络边界：未注册的请求直接失败，避免测试静默通过。 */
function installRoutes(routes: Routes): void {
  apiMock.request.mockImplementation(
    createFakeApi(async (call) => {
      if (call.path === "/api/admin/v1/request-audits" && call.method === "GET") return routes.list(call);
      if (call.path === "/api/admin/v1/request-audits/summary") {
        return routes.summary ? routes.summary(call) : auditSummary();
      }
      if (/^\/api\/admin\/v1\/request-audits\/[^/]+$/.test(call.path) && call.method === "GET") {
        if (!routes.detail) throw new ApiError(500, "unexpected", "未注册详情请求");
        return routes.detail(call);
      }
      if (call.path === "/api/admin/v1/models") {
        const models = routes.models ?? [];
        return { items: models, page: 1, pageSize: 100, total: models.length };
      }
      if (call.path === "/api/admin/v1/client-keys") {
        if (routes.keysGate) await routes.keysGate;
        if (routes.keysFailure) throw new ApiError(503, "keyListFailed", "密钥名单加载失败");
        const keys = routes.keys ?? [];
        return { items: keys, page: 1, pageSize: 50, total: routes.keysTotal ?? keys.length };
      }
      if (call.path === "/api/admin/v1/accounts") {
        const accounts = routes.accounts ?? [];
        return { items: accounts, page: 1, pageSize: 50, total: routes.accountsTotal ?? accounts.length };
      }
      throw new ApiError(500, "unexpectedRequest", `未注册的请求：${call.method} ${call.path}`);
    }),
  );
}

/**
 * 三级筛选菜单：展开筛选 → 「密钥/账号」 → 名单级（进入名单级时才懒加载名单）。
 * 二、三级触发器文案相同，用同一角色的第二个节点定位第三级；
 * jsdom 下鼠标点击会关闭嵌套子菜单，因此按 Radix 的 SUB_OPEN_KEYS 用 ArrowRight 打开，
 * 名单项则按 Radix 的指针选中路径用 pointer 点击（与视频页现有用例一致）。
 */
async function openFilterOptionGroup(level: "key" | "account") {
  const u = userEvent.setup();
  const placeholder = i18n.t(level === "key" ? "audits.keyFilterPlaceholder" : "audits.accountFilterPlaceholder");
  await u.click(screen.getByRole("button", { name: new RegExp(i18n.t("common.filter")) }));
  const levelTwo = await screen.findByRole("menuitem", { name: i18n.t(`audits.${level}`) });
  await u.click(levelTwo);
  const levelThree = (await screen.findAllByRole("menuitem", { name: i18n.t(`audits.${level}`) })).find(
    (item) => item !== levelTwo,
  );
  if (!levelThree) throw new Error("未找到三级筛选触发器");
  levelThree.focus();
  await u.keyboard("{ArrowRight}");

  const menu = (await screen.findByLabelText(placeholder)).closest('[role="menu"]');
  if (!(menu instanceof HTMLElement)) throw new Error("未找到三级筛选菜单");
  return { u, menu, placeholder };
}

/** 名单项在 Radix 中由指针抬起选中，click 事件不足以触发。 */
async function pickFilterOption(
  u: ReturnType<typeof userEvent.setup>,
  menu: HTMLElement,
  name: RegExp | string,
): Promise<void> {
  await u.pointer({ target: within(menu).getByRole("menuitemradio", { name }), keys: "[MouseLeft]" });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={0}>
          <RequestAuditsPage />
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const user = () => userEvent.setup();

beforeEach(async () => {
  apiMock.request.mockReset();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  // jsdom 未实现指针捕获与滚动，Radix Select 打开每页条数弹层时会调用。
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RequestAuditsPage 列表加载", () => {
  it("加载成功后展示请求行、汇总卡与分页信息", async () => {
    installRoutes({
      list: () => auditPage([auditDTO({ id: "audit-1", modelPublicId: "grok-4" })]),
      summary: () => auditSummary(),
    });

    renderPage();

    const row = await screen.findByTestId("audit-row-audit-1");
    expect(within(row).getByText("grok-4")).toBeInTheDocument();
    expect(within(row).getByText("grok-4-0801")).toBeInTheDocument();
    expect(screen.getByTestId("audit-status-audit-1")).toHaveTextContent("200");
    expect(screen.getByText(i18n.t("audits.requestBreakdown", { success: "10", failed: "2" }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("audits.cursorPage", { page: 1 }))).toBeInTheDocument();
  });

  it("空结果显示空态且不渲染表格行", async () => {
    installRoutes({ list: () => auditPage([]) });

    renderPage();

    expect(await screen.findByText(i18n.t("common.noData"))).toBeInTheDocument();
    expect(screen.queryByTestId("audit-row-audit-1")).not.toBeInTheDocument();
  });

  it("加载失败展示错误信息，重试后恢复列表", async () => {
    let failed = false;
    installRoutes({
      list: () => {
        if (!failed) {
          failed = true;
          throw new ApiError(503, "unavailable", "审计服务暂不可用");
        }
        return auditPage([auditDTO({ id: "audit-2" })]);
      },
    });

    renderPage();

    expect(await screen.findByText("审计服务暂不可用")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: i18n.t("common.retry") }));

    expect(await screen.findByTestId("audit-row-audit-2")).toBeInTheDocument();
    expect(screen.queryByText("审计服务暂不可用")).not.toBeInTheDocument();
  });
});

describe("RequestAuditsPage 筛选与排序", () => {
  it("搜索经防抖写入 search 参数并切换列表内容", async () => {
    installRoutes({
      list: (call) =>
        auditPage([call.query.get("search") ? auditDTO({ id: "audit-hit" }) : auditDTO({ id: "audit-base" })]),
    });
    renderPage();
    await screen.findByTestId("audit-row-audit-base");

    await user().type(screen.getByLabelText(i18n.t("audits.search")), "审计");

    await waitFor(() => expect(lastQuery("/api/admin/v1/request-audits?").get("search")).toBe("审计"), {
      timeout: 3_000,
    });
    expect(await screen.findByTestId("audit-row-audit-hit")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-row-audit-base")).not.toBeInTheDocument();
  });

  it("状态筛选写入 status 参数并切换列表内容", async () => {
    installRoutes({
      list: (call) =>
        auditPage([
          call.query.get("status") ? auditDTO({ id: "audit-4xx", statusCode: 429 }) : auditDTO({ id: "audit-2xx" }),
        ]),
    });
    renderPage();
    await screen.findByTestId("audit-row-audit-2xx");

    const u = user();
    await u.click(screen.getByRole("button", { name: new RegExp(i18n.t("common.filter")) }));
    await u.click(await screen.findByRole("menuitem", { name: i18n.t("audits.status") }));
    fireEvent.click(
      await screen.findByRole("menuitemradio", {
        name: `4xx · ${i18n.t("audits.statusClientError")}`,
      }),
    );

    await waitFor(() => expect(lastQuery("/api/admin/v1/request-audits?").get("status")).toBe("4xx"));
    expect(await screen.findByTestId("audit-row-audit-4xx")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-row-audit-2xx")).not.toBeInTheDocument();
  });

  it("排序表头切换 sortBy / sortOrder 并保持列表可见", async () => {
    installRoutes({ list: () => auditPage([auditDTO({ id: "audit-1" })]) });
    renderPage();
    await screen.findByTestId("audit-row-audit-1");

    const u = user();
    await u.click(
      screen.getByRole("button", { name: i18n.t("common.sortAscending", { column: i18n.t("audits.model") }) }),
    );

    await waitFor(() => expect(lastQuery("/api/admin/v1/request-audits?").get("sortBy")).toBe("model"));
    expect(lastQuery("/api/admin/v1/request-audits?").get("sortOrder")).toBe("asc");
    expect(screen.getByTestId("audit-row-audit-1")).toBeInTheDocument();
  });

  it("周期切换写入 period 参数", async () => {
    installRoutes({ list: () => auditPage([auditDTO({ id: "audit-1" })]) });
    renderPage();
    await screen.findByTestId("audit-row-audit-1");

    await user().click(screen.getByRole("tab", { name: "7d" }));

    await waitFor(() => expect(lastQuery("/api/admin/v1/request-audits?").get("period")).toBe("7d"));
  });
});

describe("RequestAuditsPage 游标分页与刷新", () => {
  it("下一页使用服务端游标，第一页回到初始游标", async () => {
    installRoutes({
      list: (call) =>
        call.query.get("cursor")
          ? auditPage([auditDTO({ id: "audit-page2" })])
          : auditPage([auditDTO({ id: "audit-page1" })], { nextCursor: "cursor-2", hasMore: true }),
    });
    renderPage();
    await screen.findByTestId("audit-row-audit-page1");

    const u = user();
    await u.click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));

    await waitFor(() => expect(lastQuery("/api/admin/v1/request-audits?").get("cursor")).toBe("cursor-2"));
    expect(await screen.findByTestId("audit-row-audit-page2")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-row-audit-page1")).not.toBeInTheDocument();
    expect(screen.getByText(i18n.t("audits.cursorPage", { page: 2 }))).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: i18n.t("common.firstPage") }));

    await waitFor(() => expect(lastQuery("/api/admin/v1/request-audits?").get("cursor")).toBeNull());
    expect(await screen.findByTestId("audit-row-audit-page1")).toBeInTheDocument();
  });

  it("手动刷新重新请求列表与汇总，并在结束后恢复可点击", async () => {
    installRoutes({ list: () => auditPage([auditDTO({ id: "audit-1" })]) });
    renderPage();
    await screen.findByTestId("audit-row-audit-1");
    const listCallsBefore = listQueries("/api/admin/v1/request-audits?").length;

    const refresh = screen.getByRole("button", { name: i18n.t("common.refresh") });
    await user().click(refresh);

    await waitFor(() => expect(listQueries("/api/admin/v1/request-audits?").length).toBeGreaterThan(listCallsBefore));
    await waitFor(() => expect(lastQuery("/api/admin/v1/request-audits/summary?").get("refresh")).toBe("1"));
    await waitFor(() => expect(refresh).toBeEnabled());
    expect(screen.getByTestId("audit-row-audit-1")).toBeInTheDocument();
  });
});

describe("RequestAuditsPage 详情弹窗", () => {
  it("点击状态列打开详情并加载详情数据，Esc 关闭后弹窗消失", async () => {
    installRoutes({
      list: () => auditPage([auditDTO({ id: "audit-1", accountName: "账号 A" })]),
      detail: (call) => ({
        audit: auditDTO({ id: call.path.split("/").at(-1) ?? "", accountName: "账号 A" }),
        attempts: [],
      }),
    });
    renderPage();
    await screen.findByTestId("audit-row-audit-1");

    const u = user();
    await u.click(screen.getByTestId("audit-status-audit-1"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(i18n.t("audits.detailTitle"))).toBeInTheDocument();
    expect(await within(dialog).findByText("账号 A")).toBeInTheDocument();
    await waitFor(() =>
      expect(recordedCalls().some(([called]) => called.startsWith("/api/admin/v1/request-audits/audit-1"))).toBe(true),
    );

    await u.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("详情接口失败时展示错误信息且弹窗保留", async () => {
    installRoutes({
      list: () => auditPage([auditDTO({ id: "audit-1" })]),
      detail: () => {
        throw new ApiError(500, "detailFailed", "详情加载失败");
      },
    });
    renderPage();
    await screen.findByTestId("audit-row-audit-1");

    await user().click(screen.getByTestId("audit-status-audit-1"));

    expect(await screen.findByText("详情加载失败")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("详情返回上游尝试时尝试徽标数量可见", async () => {
    installRoutes({
      list: () => auditPage([auditDTO({ id: "audit-1" })]),
      detail: () => ({
        audit: auditDTO({ id: "audit-1" }),
        attempts: [auditAttemptDTO(), auditAttemptDTO({ id: "a-2", number: 2 })],
      }),
    });
    renderPage();
    await screen.findByTestId("audit-row-audit-1");

    await user().click(screen.getByTestId("audit-status-audit-1"));

    const dialog = await screen.findByRole("dialog");
    const attemptsTab = within(dialog).getByRole("tab", { name: new RegExp(i18n.t("audits.upstreamDiagnostics")) });
    expect(await within(attemptsTab).findByText("2")).toBeInTheDocument();
  });
});

describe("RequestAuditsPage 筛选名单懒加载", () => {
  it("密钥名单展开菜单后才请求，选择后写入 key 参数并切换列表", async () => {
    installRoutes({
      list: (call) =>
        auditPage([call.query.get("key") ? auditDTO({ id: "audit-key" }) : auditDTO({ id: "audit-all" })]),
      keys: [
        auditFilterKey({ id: "key-1", name: "生产密钥", prefix: "g2a_abc" }),
        auditFilterKey({ id: "key-2", name: "", prefix: "g2a_def" }),
      ],
      keysTotal: 120,
    });
    renderPage();
    await screen.findByTestId("audit-row-audit-all");
    // 未展开三级菜单不应产生名单请求。
    expect(listQueries("/api/admin/v1/client-keys")).toHaveLength(0);

    const { u, menu } = await openFilterOptionGroup("key");

    expect(within(menu).getByRole("menuitemradio", { name: /生产密钥/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: /g2a_def/ })).toBeInTheDocument();
    expect(within(menu).getByText(i18n.t("audits.filterOptionsTruncated"))).toBeInTheDocument();
    const firstQuery = listQueries("/api/admin/v1/client-keys")[0];
    expect(firstQuery.get("page")).toBe("1");
    expect(firstQuery.get("pageSize")).toBe("50");

    await pickFilterOption(u, menu, /生产密钥/);

    await waitFor(() => expect(lastQuery("/api/admin/v1/request-audits?").get("key")).toBe("key-1"), {
      timeout: 3_000,
    });
    expect(await screen.findByTestId("audit-row-audit-key")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-row-audit-all")).not.toBeInTheDocument();
  });

  it("账号名单展开后请求，搜索防抖后按关键词重新查询并按名称/邮箱/ID 回退展示", async () => {
    installRoutes({
      list: () => auditPage([auditDTO({ id: "audit-all" })]),
      accounts: [
        auditFilterAccount({ id: "acc-1", name: "账号 A", email: "a@example.com" }),
        auditFilterAccount({ id: "acc-2", name: "", email: "b@example.com" }),
        auditFilterAccount({ id: "acc-3", name: "", email: undefined }),
      ],
    });
    renderPage();
    await screen.findByTestId("audit-row-audit-all");

    const { menu, placeholder } = await openFilterOptionGroup("account");
    expect(within(menu).getByRole("menuitemradio", { name: /账号 A/ })).toBeInTheDocument();
    expect(within(menu).getByText("b@example.com")).toBeInTheDocument();
    // 无名称、无邮箱的账号回退为 ID，并保留 provider 徽标。
    expect(within(menu).getByRole("menuitemradio", { name: /#acc-3/ })).toHaveTextContent("Web");
    expect(listQueries("/api/admin/v1/accounts")[0].get("search")).toBeNull();

    // 名单搜索输入按受控 input 的 change 路径驱动，避免指针事件关闭嵌套子菜单。
    fireEvent.change(within(menu).getByLabelText(placeholder), { target: { value: "b@" } });

    await waitFor(() => expect(listQueries("/api/admin/v1/accounts").at(-1)?.get("search")).toBe("b@"), {
      timeout: 3_000,
    });
  });

  it("名单失败展示失败文案与重试项，重试成功后加载名单", async () => {
    installRoutes({ list: () => auditPage([auditDTO({ id: "audit-all" })]), keysFailure: true });
    renderPage();
    await screen.findByTestId("audit-row-audit-all");

    const { u, menu } = await openFilterOptionGroup("key");
    expect(await within(menu).findByText(i18n.t("audits.filterOptionsLoadFailed"))).toBeInTheDocument();

    installRoutes({
      list: () => auditPage([auditDTO({ id: "audit-all" })]),
      keys: [auditFilterKey({ id: "key-9", name: "恢复密钥" })],
    });
    await u.pointer({
      target: within(menu).getByRole("menuitem", { name: i18n.t("common.retry") }),
      keys: "[MouseLeft]",
    });

    expect(await within(menu).findByRole("menuitemradio", { name: /恢复密钥/ })).toBeInTheDocument();
    expect(within(menu).queryByText(i18n.t("audits.filterOptionsLoadFailed"))).not.toBeInTheDocument();
  });

  it("名单请求未返回时展示加载中文案", async () => {
    let releaseKeys: () => void = () => {};
    const keysGate = new Promise<void>((resolve) => {
      releaseKeys = resolve;
    });
    installRoutes({
      list: () => auditPage([auditDTO({ id: "audit-all" })]),
      keys: [auditFilterKey({ id: "key-1", name: "生产密钥" })],
      keysGate,
    });
    renderPage();
    await screen.findByTestId("audit-row-audit-all");

    const { menu } = await openFilterOptionGroup("key");
    expect(await within(menu).findByText(i18n.t("common.loading"))).toBeInTheDocument();

    releaseKeys();
    expect(await within(menu).findByRole("menuitemradio", { name: /生产密钥/ })).toBeInTheDocument();
    expect(within(menu).queryByText(i18n.t("common.loading"))).not.toBeInTheDocument();
  });

  it("名单为空时展示空态文案", async () => {
    installRoutes({ list: () => auditPage([auditDTO({ id: "audit-all" })]), keys: [], keysTotal: 0 });
    renderPage();
    await screen.findByTestId("audit-row-audit-all");

    const { menu } = await openFilterOptionGroup("key");

    expect(await within(menu).findByText(i18n.t("audits.filterOptionsEmpty"))).toBeInTheDocument();
  });

  it("模型筛选使用模型名单并按 publicId 去重", async () => {
    installRoutes({
      list: (call) =>
        auditPage([call.query.get("model") ? auditDTO({ id: "audit-model" }) : auditDTO({ id: "audit-all" })]),
      models: [
        auditFilterModel({ id: "route-1", publicId: "grok-4" }),
        auditFilterModel({ id: "route-2", publicId: "grok-4-fast" }),
        auditFilterModel({ id: "route-3", publicId: "grok-4-fast" }),
      ],
    });
    renderPage();
    await screen.findByTestId("audit-row-audit-all");

    const u = user();
    await u.click(screen.getByRole("button", { name: new RegExp(i18n.t("common.filter")) }));
    await u.click(await screen.findByRole("menuitem", { name: i18n.t("audits.model") }));
    const menu = (await screen.findByRole("menuitemradio", { name: "grok-4" })).closest('[role="menu"]');
    if (!(menu instanceof HTMLElement)) throw new Error("未找到模型筛选菜单");

    expect(within(menu).getByRole("menuitemradio", { name: "grok-4-fast" })).toBeInTheDocument();
    // 三个模型路由只有两个唯一 publicId。
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(3);

    await pickFilterOption(u, menu, "grok-4-fast");

    await waitFor(() => expect(lastQuery("/api/admin/v1/request-audits?").get("model")).toBe("grok-4-fast"));
    expect(await screen.findByTestId("audit-row-audit-model")).toBeInTheDocument();
  });
});

describe("RequestAuditsPage 汇总与分页回退", () => {
  it("存在已计费请求时汇总展示估算费用而不是占位符", async () => {
    const usage = auditSummary().usage;
    installRoutes({
      list: () => auditPage([auditDTO({ id: "audit-1" })]),
      summary: () =>
        auditSummary({
          usage: { ...usage, estimatedCostInUsdTicks: 500 * USD_TICKS_PER_DOLLAR },
          pricing: {
            source: "official",
            asOf: "2026-10-01T00:00:00.000Z",
            pricedRequests: 3,
            unpricedRequests: 0,
            pricedTokens: 1200,
            unpricedTokens: 0,
          },
        }),
    });
    renderPage();
    await screen.findByTestId("audit-row-audit-1");

    expect(await screen.findByText("$500.00")).toBeInTheDocument();
    expect(screen.getByText(i18n.t("audits.pricingCoverage", { priced: "3", unpriced: "0" }))).toBeInTheDocument();
  });

  it("上一页回退到前一页游标，第一页时按钮禁用", async () => {
    installRoutes({
      list: (call) =>
        call.query.get("cursor")
          ? auditPage([auditDTO({ id: "audit-page2" })], { nextCursor: "", hasMore: false })
          : auditPage([auditDTO({ id: "audit-page1" })], { nextCursor: "cursor-2", hasMore: true }),
    });
    renderPage();
    await screen.findByTestId("audit-row-audit-page1");

    const previous = screen.getByRole("button", { name: i18n.t("common.previousPage") });
    expect(previous).toBeDisabled();

    const u = user();
    await u.click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));
    await screen.findByTestId("audit-row-audit-page2");

    await u.click(screen.getByRole("button", { name: i18n.t("common.previousPage") }));

    await waitFor(() => expect(lastQuery("/api/admin/v1/request-audits?").get("cursor")).toBeNull());
    expect(await screen.findByTestId("audit-row-audit-page1")).toBeInTheDocument();
    expect(screen.getByText(i18n.t("audits.cursorPage", { page: 1 }))).toBeInTheDocument();
  });
});
