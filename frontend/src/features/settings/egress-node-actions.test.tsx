import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEgressFakeApi,
  egressNodeListWire,
  egressNodeWire,
  egressOperationsWire,
  egressProxyProfileListWire,
  egressProxyProfileWire,
  egressSourceListWire,
  matchEgressRoute,
  renderEgressNodes,
  ResizeObserverStub,
  type EgressFakeRoutes,
  type FakeApiCall,
} from "@/features/settings/egress-test-support";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 出口节点对话框与自动化操作的关键路径集成测试：只替换 apiRequest 这一网络边界，
// 表单状态、mutation、失效语义与 decoder 全部使用真实实现。

const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

type RecordedCall = [path: string, options: { method?: string; body?: unknown }];

function recordedCalls(): RecordedCall[] {
  return apiMock.request.mock.calls as RecordedCall[];
}

function callsOf(method: string, pathPrefix: string): RecordedCall[] {
  return recordedCalls().filter(
    ([path, options]) => path.startsWith(pathPrefix) && (options.method ?? "GET") === method,
  );
}

/** 只取分页节点列表请求（排除兜底选项用的 pageSize=2000 请求）。 */
function nodeListQueries(): URLSearchParams[] {
  return callsOf("GET", "/api/admin/v1/egress-nodes?")
    .map(([path]) => new URLSearchParams(path.slice(path.indexOf("?") + 1)))
    .filter((query) => query.get("pageSize") !== "2000");
}

function lastNodeListQuery(): URLSearchParams {
  const queries = nodeListQueries();
  expect(queries.length).toBeGreaterThan(0);
  return queries[queries.length - 1];
}

function installRoutes(routes: EgressFakeRoutes): void {
  apiMock.request.mockImplementation(
    createEgressFakeApi((call: FakeApiCall) => {
      const handler = matchEgressRoute(call, routes);
      if (!handler) throw new ApiError(500, "unexpectedRequest", `未注册的请求：${call.method} ${call.path}`);
      return handler(call);
    }),
  );
}

/** 出口节点分区总是同时挂载订阅源与自动化分区，未关注的分区返回空数据。 */
function baseRoutes(routes: EgressFakeRoutes): EgressFakeRoutes {
  return {
    sources: () => egressSourceListWire([]),
    operations: () => egressOperationsWire(),
    profiles: () => egressProxyProfileListWire([]),
    ...routes,
  };
}

/**
 * Radix Select 的触发器是 button[role=combobox]：jsdom 下用键盘打开弹层，
 * 再用 click 命中选项（Radix 的 pointerTypeRef 初始为 touch，无真实指针事件）。
 */
async function chooseRadixOption(trigger: HTMLElement, optionLabel: string): Promise<void> {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: optionLabel }));
}

/** 出口节点分区的作用域下拉：触发器由 Label 的 htmlFor 关联，用标签文本定位。 */
function scopeTrigger(container: HTMLElement): HTMLElement {
  return within(container).getByLabelText(i18n.t("settings.egress.scope"));
}

/**
 * 节点表格工具栏的筛选入口：订阅源分区也渲染同名「筛选」按钮，
 * 用节点搜索框所属的 DataTableShell 收窄到唯一一个。
 */
function nodeFiltersTrigger(): HTMLElement {
  const section = screen.getByTestId("egress-nodes-search").closest("section");
  if (!section) throw new Error("缺少出口节点工具栏容器");
  return within(section).getByRole("button", { name: new RegExp(`^${i18n.t("common.filter")}`) });
}

const user = async () => (await import("@testing-library/user-event")).default.setup({ delay: null });

beforeEach(async () => {
  apiMock.request.mockReset();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("出口节点文本导入", () => {
  it("名称或代理列表为空时不可提交，提交成功后关闭弹窗并提示导入数量", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([]),
        importText: () => ({ imported: 3, skipped: 1 }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-nodes-empty");

    await u.click(screen.getByTestId("egress-nodes-add"));
    await u.click(await screen.findByTestId("egress-nodes-add-import"));

    const dialog = await screen.findByTestId("egress-import-dialog");
    const submit = within(dialog).getByTestId("egress-import-dialog-submit");
    expect(submit).toBeDisabled();

    await u.type(within(dialog).getByTestId("egress-import-name"), "批量导入");
    await u.type(within(dialog).getByTestId("egress-import-content"), "socks5h://host:1080");
    expect(submit).toBeEnabled();

    await u.click(submit);

    await waitFor(() => {
      const posts = callsOf("POST", "/api/admin/v1/egress-imports");
      expect(posts).toHaveLength(1);
      expect(posts[0][1].body).toMatchObject({ name: "批量导入", content: "socks5h://host:1080" });
    });
    expect(
      await screen.findByText(i18n.t("settings.egress.imported", { imported: 3, skipped: 1 })),
    ).toBeInTheDocument();
  });

  it("取消导入不发出请求", async () => {
    const u = await user();
    installRoutes(baseRoutes({ nodes: () => egressNodeListWire([]) }));
    renderEgressNodes();
    await screen.findByTestId("egress-nodes-empty");

    await u.click(screen.getByTestId("egress-nodes-add"));
    await u.click(await screen.findByTestId("egress-nodes-add-import"));
    const dialog = await screen.findByTestId("egress-import-dialog");

    await u.click(within(dialog).getByTestId("egress-import-dialog-cancel"));

    await waitFor(() => expect(screen.queryByTestId("egress-import-dialog")).not.toBeInTheDocument());
    expect(callsOf("POST", "/api/admin/v1/egress-imports")).toHaveLength(0);
  });
});

describe("出口节点编辑弹窗字段", () => {
  it("切换到 Web 作用域后展示清关方式与默认 User-Agent，保存时提交 UA 与 Cookie", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () =>
          egressNodeListWire([egressNodeWire({ id: "node-1", scope: "grok_build", proxyConfigured: false })]),
        nodeUpdate: () => egressNodeWire({ id: "node-1", scope: "grok_web" }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-edit-node-1"));
    const dialog = await screen.findByTestId("egress-node-dialog");

    // Build 作用域不展示清关方式与 UA/Cookie 字段
    expect(within(dialog).queryByTestId("egress-node-clearance-mode")).toBeNull();
    expect(within(dialog).queryByTestId("egress-node-user-agent")).toBeNull();
    await chooseRadixOption(scopeTrigger(dialog), i18n.t("settings.egress.scopeWeb"));

    const clearance = await within(dialog).findByTestId("egress-node-clearance-mode");
    expect(clearance).toHaveTextContent(i18n.t("settings.web.clearanceManual"));
    // 切换作用域时注入该作用域的默认 User-Agent
    expect(within(dialog).getByTestId("egress-node-user-agent")).toHaveValue("grok-web-ua");

    await u.type(within(dialog).getByTestId("egress-node-user-agent"), "-custom");
    await u.type(within(dialog).getByTestId("egress-node-cookie"), "cf_clearance=abc");
    await u.click(within(dialog).getByTestId("egress-node-dialog-save"));

    await waitFor(() => {
      const updated = callsOf("PUT", "/api/admin/v1/egress-nodes/node-1");
      expect(updated).toHaveLength(1);
      expect(updated[0][1].body).toMatchObject({
        scope: "grok_web",
        userAgent: "grok-web-ua-custom",
        cloudflareCookies: "cf_clearance=abc",
      });
    });
  });

  it("非 manual 清关模式隐藏 UA 与 Cookie，控制台资源作用域只保留 UA", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", scope: "grok_web", proxyConfigured: false })]),
      }),
    );
    renderEgressNodes("flaresolverr");
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-edit-node-1"));
    const dialog = await screen.findByTestId("egress-node-dialog");

    // flaresolverr 下 grok_web 由 Clearance 托管：不展示 UA 与 Cookie（egress-node-dialogs.tsx:302-304）
    expect(within(dialog).getByTestId("egress-node-clearance-mode")).toHaveTextContent(
      i18n.t("settings.web.clearanceFlareSolverr"),
    );
    expect(within(dialog).queryByTestId("egress-node-user-agent")).toBeNull();
    expect(within(dialog).queryByTestId("egress-node-cookie")).toBeNull();

    // 控制台资源作用域始终保留 UA 输入（showUserAgent 的 scope === "grok_console_asset" 分支）
    await chooseRadixOption(scopeTrigger(dialog), i18n.t("settings.egress.scopeConsoleAsset"));
    await waitFor(() => expect(within(dialog).queryByTestId("egress-node-clearance-mode")).toBeNull());
    expect(within(dialog).getByTestId("egress-node-user-agent")).toBeInTheDocument();
    expect(within(dialog).queryByTestId("egress-node-cookie")).toBeNull();
  });

  it("揭示已保存的代理地址并支持再次隐藏", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", proxyConfigured: true })]),
        nodeReveal: () => ({ proxyURL: "socks5h://user:pass@host:1080" }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-edit-node-1"));
    const dialog = await screen.findByTestId("egress-node-dialog");
    const proxyURL = within(dialog).getByTestId("egress-node-proxy-url");
    expect(proxyURL).toHaveAttribute("type", "password");

    await u.click(within(dialog).getByTestId("egress-node-reveal-proxy"));

    await waitFor(() => {
      expect(callsOf("POST", "/api/admin/v1/egress-nodes/node-1/proxy-url/reveal")).toHaveLength(1);
      expect(within(dialog).getByTestId("egress-node-proxy-url")).toHaveAttribute("type", "text");
      expect(within(dialog).getByTestId("egress-node-proxy-url")).toHaveValue("socks5h://user:pass@host:1080");
    });

    // 已揭示过地址后再点按钮只切换可见性，不再请求
    await u.click(within(dialog).getByTestId("egress-node-reveal-proxy"));
    expect(within(dialog).getByTestId("egress-node-proxy-url")).toHaveAttribute("type", "password");
    expect(callsOf("POST", "/api/admin/v1/egress-nodes/node-1/proxy-url/reveal")).toHaveLength(1);
  });

  it("绑定代理配置后禁用独立代理地址输入，选择手动可恢复", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", proxyConfigured: true })]),
        profiles: () => egressProxyProfileListWire([egressProxyProfileWire({ id: "prof-1", name: "机房代理" })]),
        profileSelected: () => egressProxyProfileWire({ id: "prof-1", name: "机房代理" }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-edit-node-1"));
    const dialog = await screen.findByTestId("egress-node-dialog");

    await u.click(within(dialog).getByTestId("egress-proxy-profile-picker"));
    fireEvent.click(await screen.findByTestId("egress-proxy-profile-option-prof-1"));

    await waitFor(() => expect(within(dialog).getByTestId("egress-node-proxy-url")).toBeDisabled());
    expect(within(dialog).getByTestId("egress-node-proxy-url")).toHaveAttribute(
      "placeholder",
      i18n.t("egressProxyProfiles.managedByProfile"),
    );

    await u.click(within(dialog).getByTestId("egress-proxy-profile-picker"));
    fireEvent.click(await screen.findByTestId("egress-proxy-profile-option-manual"));

    await waitFor(() => expect(within(dialog).getByTestId("egress-node-proxy-url")).toBeEnabled());
  });

  it("取消编辑关闭弹窗且不提交", async () => {
    const u = await user();
    installRoutes(baseRoutes({ nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1" })]) }));
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-edit-node-1"));
    const dialog = await screen.findByTestId("egress-node-dialog");

    await u.click(within(dialog).getByTestId("egress-node-dialog-cancel"));

    await waitFor(() => expect(screen.queryByTestId("egress-node-dialog")).not.toBeInTheDocument());
    expect(callsOf("PUT", "/api/admin/v1/egress-nodes/node-1")).toHaveLength(0);
  });
});

describe("出口节点行内操作", () => {
  it("探测健康节点提示成功，探测失败提示服务端错误", async () => {
    const u = await user();
    let healthy = true;
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1" })]),
        nodeTestOne: () =>
          healthy
            ? { status: "healthy", testedAt: "2026-01-01T00:00:00Z", latencyMs: 12 }
            : { status: "unhealthy", testedAt: "2026-01-01T00:00:00Z", latencyMs: 0, error: "连接被拒绝" },
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-test-node-1"));
    expect(await screen.findByText(i18n.t("settings.egress.testedOne"))).toBeInTheDocument();

    healthy = false;
    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-test-node-1"));
    // 服务端把探针失败原因放在 result.error（字符串）；showEgressError 只解包 Error，
    // 因此这里展示的是操作失败兜底文案（egress-nodes.tsx:216 与 egress-feedback.ts:5）。
    expect(await screen.findByText(i18n.t("settings.egress.operationFailed"))).toBeInTheDocument();
  });

  it("刷新清关方式提示成功", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", scope: "grok_web" })]),
        nodeRefreshClearance: () => ({ refreshed: true }),
      }),
    );
    // 刷新清关项仅在非 manual 清关模式下渲染（egress-nodes-table.tsx:472）
    renderEgressNodes("flaresolverr");
    await screen.findByTestId("egress-node-row-node-1");

    // 行内菜单里的刷新清关项只对可刷新作用域渲染，testid 为 egress-node-refresh-clearance-<id>
    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-refresh-clearance-node-1"));

    await waitFor(() => expect(callsOf("POST", "/api/admin/v1/egress-nodes/node-1/refresh-clearance")).toHaveLength(1));
    expect(await screen.findByText(i18n.t("settings.egress.clearanceRefreshed"))).toBeInTheDocument();
  });

  it("单行删除直接提交并提示已删除", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1" })]),
        nodeRemove: () => ({ deleted: true }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-delete-node-1"));

    await waitFor(() => expect(callsOf("DELETE", "/api/admin/v1/egress-nodes/node-1")).toHaveLength(1));
    expect(await screen.findByText(i18n.t("settings.egress.deleted"))).toBeInTheDocument();
  });

  it("翻到最后一页删除唯一节点后回到上一页", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: (call) =>
          egressNodeListWire(
            call.query.get("page") === "2" ? [egressNodeWire({ id: "node-21" })] : [egressNodeWire({ id: "node-1" })],
            { page: Number(call.query.get("page")), total: 21 },
          ),
        nodeRemove: () => ({ deleted: true }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));
    await screen.findByTestId("egress-node-row-node-21");

    await u.click(screen.getByTestId("egress-node-actions-node-21"));
    fireEvent.click(await screen.findByTestId("egress-node-delete-node-21"));

    await waitFor(() => expect(lastNodeListQuery().get("page")).toBe("1"));
  });
});

describe("出口节点批量操作", () => {
  it("批量启用/停用提交所选 id 并清空选择", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () =>
          egressNodeListWire([
            egressNodeWire({ id: "node-1", enabled: true }),
            egressNodeWire({ id: "node-2", enabled: false }),
          ]),
        nodeBatchUpdate: () => ({ updated: 2 }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-nodes-select-page"));
    await u.click(await screen.findByTestId("egress-nodes-batch-disable"));

    await waitFor(() => {
      const patches = callsOf("PATCH", "/api/admin/v1/egress-nodes/batch");
      expect(patches).toHaveLength(1);
      expect(patches[0][1].body).toEqual({ ids: ["node-1", "node-2"], enabled: false });
    });
    expect(await screen.findByText(i18n.t("settings.egress.batchDisabled", { updated: 2 }))).toBeInTheDocument();

    await u.click(screen.getByTestId("egress-nodes-select-page"));
    await u.click(await screen.findByTestId("egress-nodes-batch-enable"));
    await waitFor(() => expect(callsOf("PATCH", "/api/admin/v1/egress-nodes/batch")).toHaveLength(2));
  });
});

describe("出口节点筛选与排序", () => {
  it("作用域筛选与列排序写入查询参数", async () => {
    const u = await user();
    installRoutes(baseRoutes({ nodes: () => egressNodeListWire([]) }));
    renderEgressNodes();
    await screen.findByTestId("egress-nodes-empty");

    await u.click(nodeFiltersTrigger());
    await u.pointer({
      target: await screen.findByRole("menuitem", { name: new RegExp(`^${i18n.t("settings.egress.scope")}`) }),
    });
    await u.pointer({
      target: await screen.findByRole("menuitemradio", { name: i18n.t("settings.egress.scopeWeb") }),
      keys: "[MouseLeft]",
    });
    await waitFor(() => expect(lastNodeListQuery().get("scope")).toBe("grok_web"));

    // 列头按钮的可访问名称是排序提示（按{{column}}升序/降序排列），不是列标题本身
    await u.click(
      screen.getByRole("button", { name: i18n.t("common.sortAscending", { column: i18n.t("settings.egress.name") }) }),
    );
    await waitFor(() => {
      expect(lastNodeListQuery().get("sortBy")).toBe("name");
      expect(lastNodeListQuery().get("sortOrder")).toBe("asc");
    });

    await u.click(
      screen.getByRole("button", { name: i18n.t("common.sortDescending", { column: i18n.t("settings.egress.name") }) }),
    );
    await waitFor(() => expect(lastNodeListQuery().get("sortOrder")).toBe("desc"));
  });

  it("切换每页条数写入 pageSize 并回到第 1 页", async () => {
    installRoutes(baseRoutes({ nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1" })], { total: 40 }) }));
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    // 分页可选项为 PAGE_SIZE_OPTIONS（20/100/500/1000/2000），没有 50
    await chooseRadixOption(screen.getByRole("combobox", { name: i18n.t("common.perPage") }), "100");

    await waitFor(() => {
      expect(lastNodeListQuery().get("pageSize")).toBe("100");
      expect(lastNodeListQuery().get("page")).toBe("1");
    });
  });
});

describe("出口节点清理不可用节点", () => {
  it("展示预览统计并在确认后清理，成功回到第 1 页", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1" })], { total: 40 }),
        nodeCleanupPreview: () => ({ nodes: 3, boundAccounts: 5, subscriptionManaged: 1 }),
        nodeCleanup: () => ({ deleted: 3 }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-nodes-cleanup"));
    const dialog = await screen.findByTestId("egress-nodes-cleanup-dialog");

    await waitFor(() => expect(dialog).toHaveTextContent("3"));
    expect(dialog).toHaveTextContent(i18n.t("settings.egress.cleanupSubscriptionHint"));

    await u.click(within(dialog).getByTestId("egress-nodes-cleanup-confirm"));

    await waitFor(() => expect(callsOf("POST", "/api/admin/v1/egress-nodes/cleanup")).toHaveLength(1));
    expect(
      await screen.findByText(i18n.t("settings.egress.cleanupUnavailableComplete", { deleted: 3 })),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("egress-nodes-cleanup-dialog")).not.toBeInTheDocument());
  });

  it("预览失败时展示失败文案且确认按钮禁用", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([]),
        nodeCleanupPreview: () => {
          throw new ApiError(500, "previewFailed", "预览失败");
        },
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-nodes-empty");

    await u.click(screen.getByTestId("egress-nodes-cleanup"));
    const dialog = await screen.findByTestId("egress-nodes-cleanup-dialog");

    await waitFor(() => expect(dialog).toHaveTextContent(i18n.t("settings.egress.cleanupPreviewFailed")));
    expect(within(dialog).getByTestId("egress-nodes-cleanup-confirm")).toBeDisabled();

    await u.click(within(dialog).getByTestId("egress-nodes-cleanup-cancel"));
    await waitFor(() => expect(screen.queryByTestId("egress-nodes-cleanup-dialog")).not.toBeInTheDocument());
    expect(callsOf("POST", "/api/admin/v1/egress-nodes/cleanup")).toHaveLength(0);
  });
});

describe("出口自动化操作", () => {
  it("全量探测只提交启用且配置了代理的节点", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () =>
          egressNodeListWire([
            egressNodeWire({ id: "node-1", enabled: true, proxyConfigured: true }),
            egressNodeWire({ id: "node-2", enabled: false, proxyConfigured: true }),
            egressNodeWire({ id: "node-3", enabled: true, proxyConfigured: false }),
          ]),
        nodeTest: () => ({ requested: 1, healthy: 1, unhealthy: 0 }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-automation");

    await u.click(screen.getByTestId("egress-automation-test-all"));

    await waitFor(() => {
      const posts = callsOf("POST", "/api/admin/v1/egress-nodes/test");
      expect(posts).toHaveLength(1);
      expect(posts[0][1].body).toEqual({ ids: ["node-1"] });
    });
    expect(
      await screen.findByText(i18n.t("settings.egress.tested", { requested: 1, healthy: 1, unhealthy: 0 })),
    ).toBeInTheDocument();
  });

  it("全量探测全部失败时展示错误提示", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", enabled: true, proxyConfigured: true })]),
        nodeTest: () => {
          throw new ApiError(503, "probeUnavailable", "探测服务不可用");
        },
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-automation");

    await u.click(screen.getByTestId("egress-automation-test-all"));

    expect(await screen.findByText("探测服务不可用")).toBeInTheDocument();
  });

  it("重平衡账号提示结果并在失败时展示错误", async () => {
    const u = await user();
    let failing = false;
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([]),
        rebalance: () => {
          if (failing) throw new ApiError(500, "rebalanceFailed", "重平衡失败");
          return { assigned: 4, rebalanced: 2, unplaced: 1 };
        },
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-automation");

    await u.click(screen.getByTestId("egress-automation-rebalance"));
    expect(
      await screen.findByText(i18n.t("settings.egress.rebalanced", { assigned: 4, rebalanced: 2, unplaced: 1 })),
    ).toBeInTheDocument();

    failing = true;
    await u.click(screen.getByTestId("egress-automation-rebalance"));
    expect(await screen.findByText("重平衡失败")).toBeInTheDocument();
  });

  it("自动化配置读取失败展示错误与重试", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([]),
        operations: () => {
          throw new ApiError(500, "operationsFailed", "自动化配置读取失败");
        },
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-automation");

    expect(await screen.findByText("自动化配置读取失败")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: i18n.t("common.retry") }));

    await waitFor(() => expect(callsOf("GET", "/api/admin/v1/egress-operations").length).toBeGreaterThan(1));
  });

  it("兜底策略切到固定节点后展示节点选择器", async () => {
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", scope: "grok_web", name: "东京出口" })]),
      }),
    );
    renderEgressNodes();
    // 兜底行与节点选择器都要先等到节点查询（fallback-options）返回候选
    const row = await screen.findByTestId("egress-fallback-row-grok_web");
    const modeTrigger = await within(row).findByRole("combobox", {
      name: i18n.t("settings.egress.fallbackMode", { scope: i18n.t("settings.egress.scopeWeb") }),
    });

    await chooseRadixOption(modeTrigger, i18n.t("settings.egress.fallbackFixed"));

    const nodeTrigger = await screen.findByRole("combobox", {
      name: i18n.t("settings.egress.fallbackNode", { scope: i18n.t("settings.egress.scopeWeb") }),
    });
    expect(nodeTrigger).toBeEnabled();
    // 切换后草稿被标记为待保存
    expect(screen.getByTestId("egress-automation-save")).toBeEnabled();
  });
});
