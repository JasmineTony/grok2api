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
  egressSourceWire,
  matchEgressRoute,
  renderEgressNodes,
  ResizeObserverStub,
  type EgressFakeRoutes,
  type FakeApiCall,
} from "@/features/settings/egress-test-support";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 出口节点分区错误路径与次要交互的集成测试：网络边界仍然是唯一被替换的部分。
const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

type RecordedCall = [path: string, options: { method?: string; body?: unknown }];

function callsOf(method: string, pathPrefix: string): RecordedCall[] {
  return (apiMock.request.mock.calls as RecordedCall[]).filter(
    ([path, options]) => path.startsWith(pathPrefix) && (options.method ?? "GET") === method,
  );
}

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

function baseRoutes(routes: EgressFakeRoutes): EgressFakeRoutes {
  return {
    sources: () => egressSourceListWire([]),
    operations: () => egressOperationsWire(),
    profiles: () => egressProxyProfileListWire([]),
    ...routes,
  };
}

async function chooseRadixOption(trigger: HTMLElement, optionLabel: string): Promise<void> {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: optionLabel }));
}

function nodeFiltersTrigger(): HTMLElement {
  const section = screen.getByTestId("egress-nodes-search").closest("section");
  if (!section) throw new Error("缺少出口节点工具栏容器");
  return within(section).getByRole("button", { name: new RegExp(`^${i18n.t("common.filter")}`) });
}

async function selectNodeFilter(menuitemLabel: RegExp, optionLabel: string): Promise<void> {
  const user = (await import("@testing-library/user-event")).default.setup({ delay: null });
  await user.click(nodeFiltersTrigger());
  await user.pointer({ target: await screen.findByRole("menuitem", { name: menuitemLabel }) });
  await user.pointer({ target: await screen.findByRole("menuitemradio", { name: optionLabel }), keys: "[MouseLeft]" });
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

describe("出口节点行内操作失败路径", () => {
  it("删除、探测与刷新清关失败时展示服务端错误", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", scope: "grok_web" })]),
        nodeRemove: () => {
          throw new ApiError(409, "boundAccounts", "仍有账号绑定");
        },
        nodeTestOne: () => {
          throw new ApiError(500, "probeFailed", "探测请求失败");
        },
        nodeRefreshClearance: () => {
          throw new ApiError(500, "clearanceFailed", "清关刷新失败");
        },
      }),
    );
    renderEgressNodes("flaresolverr");
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-delete-node-1"));
    expect(await screen.findByText("仍有账号绑定")).toBeInTheDocument();

    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-test-node-1"));
    expect(await screen.findByText("探测请求失败")).toBeInTheDocument();

    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-refresh-clearance-node-1"));
    expect(await screen.findByText("清关刷新失败")).toBeInTheDocument();
  });

  it("揭示代理地址失败时展示错误提示", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", proxyConfigured: true })]),
        nodeReveal: () => {
          throw new ApiError(500, "revealFailed", "无法读取代理地址");
        },
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-edit-node-1"));
    const dialog = await screen.findByTestId("egress-node-dialog");
    await u.click(within(dialog).getByTestId("egress-node-reveal-proxy"));

    expect(await screen.findByText("无法读取代理地址")).toBeInTheDocument();
    expect(within(dialog).getByTestId("egress-node-proxy-url")).toHaveAttribute("type", "password");
  });

  it("文本导入失败时保留弹窗并提示错误", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([]),
        importText: () => {
          throw new ApiError(400, "invalid", "代理列表格式错误");
        },
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-nodes-empty");

    await u.click(screen.getByTestId("egress-nodes-add"));
    await u.click(await screen.findByTestId("egress-nodes-add-import"));
    const dialog = await screen.findByTestId("egress-import-dialog");
    await u.type(within(dialog).getByTestId("egress-import-name"), "批量导入");
    await u.type(within(dialog).getByTestId("egress-import-content"), "socks5h://host:1080");
    await u.click(within(dialog).getByTestId("egress-import-dialog-submit"));

    expect(await screen.findByText("代理列表格式错误")).toBeInTheDocument();
    expect(screen.getByTestId("egress-import-dialog")).toBeInTheDocument();
  });

  it("批量启用与批量删除失败时展示服务端错误", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", enabled: false })]),
        nodeBatchUpdate: () => {
          throw new ApiError(500, "batchFailed", "批量更新失败");
        },
        nodeBatchRemove: () => {
          throw new ApiError(500, "batchDeleteFailed", "批量删除失败");
        },
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-nodes-select-page"));
    // 批量启用按钮仅对已停用节点可用（egress-nodes-toolbar.tsx:203），因此节点先置为停用
    await u.click(await screen.findByTestId("egress-nodes-batch-enable"));
    expect(await screen.findByText("批量更新失败")).toBeInTheDocument();

    await u.click(await screen.findByTestId("egress-nodes-batch-delete"));
    const dialog = await screen.findByTestId("egress-nodes-batch-delete-dialog");
    await u.click(within(dialog).getByTestId("egress-nodes-batch-delete-confirm"));

    expect(await screen.findByText("批量删除失败")).toBeInTheDocument();
    expect(screen.getByTestId("egress-nodes-batch-delete-dialog")).toBeInTheDocument();
  });
  it("清理失败时提示错误，且清理进行中不允许关闭弹窗", async () => {
    const u = await user();
    let cleanupReject: (reason: unknown) => void = () => undefined;
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([]),
        nodeCleanupPreview: () => ({ nodes: 2, boundAccounts: 0, subscriptionManaged: 0 }),
        nodeCleanup: () => new Promise((_, reject) => (cleanupReject = reject)),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-nodes-empty");

    await u.click(screen.getByTestId("egress-nodes-cleanup"));
    const dialog = await screen.findByTestId("egress-nodes-cleanup-dialog");
    await waitFor(() => expect(dialog).toHaveTextContent("2"));

    await u.click(within(dialog).getByTestId("egress-nodes-cleanup-confirm"));
    // 清理请求进行中：Esc 关闭被守卫拦截（egress-nodes.tsx:429）
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByTestId("egress-nodes-cleanup-dialog")).toBeInTheDocument();

    cleanupReject(new ApiError(500, "cleanupFailed", "清理失败"));
    expect(await screen.findByText("清理失败")).toBeInTheDocument();
  });
});

describe("出口节点批量操作与选择", () => {
  it("取消全选后批量操作入口消失", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1" }), egressNodeWire({ id: "node-2" })]),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-nodes-select-page"));
    expect(await screen.findByTestId("egress-nodes-batch-delete")).toBeInTheDocument();

    await u.click(screen.getByTestId("egress-nodes-select-page"));
    await waitFor(() => expect(screen.queryByTestId("egress-nodes-batch-delete")).not.toBeInTheDocument());
  });

  it("逐行勾选与取消勾选维护选择集", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1" }), egressNodeWire({ id: "node-2" })]),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-node-select-node-1"));
    expect(await screen.findByTestId("egress-nodes-batch-delete")).toBeInTheDocument();

    await u.click(screen.getByTestId("egress-node-select-node-2"));
    await u.click(screen.getByTestId("egress-node-select-node-2"));
    expect(await screen.findByTestId("egress-nodes-batch-delete")).toBeInTheDocument();

    await u.click(screen.getByTestId("egress-node-select-node-1"));
    await waitFor(() => expect(screen.queryByTestId("egress-nodes-batch-delete")).not.toBeInTheDocument());
  });

  it("批量删除当前页全部节点后回到上一页", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: (call) =>
          egressNodeListWire(
            call.query.get("page") === "2" ? [egressNodeWire({ id: "node-21" })] : [egressNodeWire({ id: "node-1" })],
            { page: Number(call.query.get("page")), total: 21 },
          ),
        nodeBatchRemove: () => ({ deleted: 1 }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));
    await screen.findByTestId("egress-node-row-node-21");

    await u.click(screen.getByTestId("egress-node-select-node-21"));
    await u.click(await screen.findByTestId("egress-nodes-batch-delete"));
    const dialog = await screen.findByTestId("egress-nodes-batch-delete-dialog");
    await u.click(within(dialog).getByTestId("egress-nodes-batch-delete-confirm"));

    await waitFor(() => expect(lastNodeListQuery().get("page")).toBe("1"));
  });
});

describe("出口节点筛选覆盖", () => {
  it("探测与账号绑定筛选写入查询参数，切换后回到第 1 页", async () => {
    const u = await user();
    installRoutes(baseRoutes({ nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1" })], { total: 40 }) }));
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));
    await waitFor(() => expect(lastNodeListQuery().get("page")).toBe("2"));

    await selectNodeFilter(new RegExp(`^${i18n.t("settings.egress.probe")}`), i18n.t("settings.egress.unhealthy"));
    await waitFor(() => {
      expect(lastNodeListQuery().get("probe")).toBe("unhealthy");
      expect(lastNodeListQuery().get("page")).toBe("1");
    });

    await selectNodeFilter(new RegExp(`^${i18n.t("settings.egress.accounts")}`), i18n.t("settings.egress.unassigned"));
    await waitFor(() => expect(lastNodeListQuery().get("assignment")).toBe("unbound"));
  });
});

describe("代理配置库入口", () => {
  it("节点弹窗内打开配置库创建，创建成功后回填绑定", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", proxyConfigured: false })]),
        profiles: () => egressProxyProfileListWire([egressProxyProfileWire({ id: "prof-1", name: "机房代理" })]),
        profileSelected: () => egressProxyProfileWire({ id: "prof-1", name: "机房代理" }),
        profileCreate: () => egressProxyProfileWire({ id: "prof-9", name: "新建代理" }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-nodes-open-profile-library"));
    expect(await screen.findByTestId("egress-proxy-profiles-dialog")).toBeInTheDocument();
    fireEvent.keyDown(await screen.findByTestId("egress-proxy-profiles-dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("egress-proxy-profiles-dialog")).not.toBeInTheDocument());

    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-edit-node-1"));
    const dialog = await screen.findByTestId("egress-node-dialog");
    // 配置库创建入口在代理配置选择器弹层内部，必须先打开 picker（egress-proxy-profile-picker.tsx:329-345）
    await u.click(within(dialog).getByTestId("egress-proxy-profile-picker"));
    await u.click(await screen.findByTestId("egress-proxy-profile-picker-create"));

    const library = await screen.findByTestId("egress-proxy-profiles-dialog");
    await u.type(within(library).getByTestId("egress-proxy-profile-name"), "新建代理");
    await u.type(within(library).getByTestId("egress-proxy-profile-url"), "socks5h://host:1080");
    await u.click(within(library).getByTestId("egress-proxy-profile-form-save"));

    await waitFor(() => expect(screen.queryByTestId("egress-proxy-profiles-dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(within(dialog).getByTestId("egress-node-proxy-url")).toBeDisabled());
  });

  it("工具栏配置库入口按管理模式打开且可关闭", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([]),
        profiles: () => egressProxyProfileListWire([egressProxyProfileWire({ id: "prof-1" })]),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-nodes-empty");

    await u.click(screen.getByTestId("egress-nodes-open-profile-library"));
    const dialog = await screen.findByTestId("egress-proxy-profiles-dialog");
    expect(within(dialog).getByTestId("egress-proxy-profile-row-prof-1")).toBeInTheDocument();

    await u.click(within(dialog).getByRole("button", { name: i18n.t("common.close") }));
    await waitFor(() => expect(screen.queryByTestId("egress-proxy-profiles-dialog")).not.toBeInTheDocument());
  });
});

describe("出口节点作用域切换", () => {
  it("切到控制台资源作用域清空 Cookie，切回 Web 复用默认 UA", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () =>
          egressNodeListWire([egressNodeWire({ id: "node-1", scope: "grok_build", proxyConfigured: false })]),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await u.click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-edit-node-1"));
    const dialog = await screen.findByTestId("egress-node-dialog");

    await chooseRadixOption(
      within(dialog).getByLabelText(i18n.t("settings.egress.scope")),
      i18n.t("settings.egress.scopeWeb"),
    );
    await u.type(within(dialog).getByTestId("egress-node-cookie"), "cf_clearance=abc");

    await chooseRadixOption(
      within(dialog).getByLabelText(i18n.t("settings.egress.scope")),
      i18n.t("settings.egress.scopeConsoleAsset"),
    );
    // 控制台资源作用域不展示 Cookie 输入，切回 Web 时默认 UA 被重新注入
    expect(within(dialog).queryByTestId("egress-node-cookie")).toBeNull();
    await chooseRadixOption(
      within(dialog).getByLabelText(i18n.t("settings.egress.scope")),
      i18n.t("settings.egress.scopeWeb"),
    );

    expect(await within(dialog).findByTestId("egress-node-user-agent")).toHaveValue("grok-web-ua");
  });
});

describe("出口自动化配置保存", () => {
  it("修改草稿后可保存，保存成功清空草稿并提示", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([]),
        operationsSave: () => egressOperationsWire(),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-automation");

    expect(await screen.findByTestId("egress-automation-save")).toBeDisabled();

    const probeInterval = screen.getByLabelText(i18n.t("settings.egress.probeInterval"));
    fireEvent.change(probeInterval, { target: { value: "1800" } });
    expect(screen.getByTestId("egress-automation-save")).toBeEnabled();

    await u.click(screen.getByTestId("egress-automation-save"));

    await waitFor(() => {
      const puts = callsOf("PUT", "/api/admin/v1/egress-operations");
      expect(puts).toHaveLength(1);
      expect(puts[0][1].body).toMatchObject({ probeIntervalSeconds: 1800 });
    });
    expect(await screen.findByText(i18n.t("settings.egress.automationSaved"))).toBeInTheDocument();
  });

  it("保存失败时展示服务端错误并保留草稿", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([]),
        operationsSave: () => {
          throw new ApiError(500, "saveFailed", "自动化配置保存失败");
        },
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-automation");

    // interval 输入框的可访问名称是 label 文本本身，不含单位文本（egress-automation-settings.tsx:110-121）
    fireEvent.change(await screen.findByLabelText(i18n.t("settings.egress.assignmentInterval")), {
      target: { value: "600" },
    });
    await u.click(await screen.findByTestId("egress-automation-save"));

    expect(await screen.findByText("自动化配置保存失败")).toBeInTheDocument();
    expect(screen.getByTestId("egress-automation-save")).toBeEnabled();
  });

  it("切换自动分配与自动平衡开关写入草稿", async () => {
    installRoutes(baseRoutes({ nodes: () => egressNodeListWire([]) }));
    renderEgressNodes();
    await screen.findByTestId("egress-automation");

    const autoAssign = await screen.findByLabelText(i18n.t("settings.egress.autoAssign"));
    const autoBalance = await screen.findByLabelText(i18n.t("settings.egress.autoBalance"));
    fireEvent.click(autoAssign);
    fireEvent.click(autoBalance);

    expect(screen.getByTestId("egress-automation-save")).toBeEnabled();
  });

  it("全量探测部分失败时展示部分成功提示", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        // 全量探测走 listAllEgressNodes（pageSize=2000），与表格分页查询区分开
        nodes: (call) =>
          call.query.get("pageSize") === "2000"
            ? egressNodeListWire(
                Array.from({ length: 33 }, (_, index) =>
                  egressNodeWire({ id: `probe-${index + 1}`, enabled: true, proxyConfigured: true }),
                ),
              )
            : egressNodeListWire([]),
        // 探测按每批 32 个分批（egress-operations.tsx:42、88-99）：最后一批失败即计入未完成数
        nodeTest: (call) => {
          const ids = (call.body as { ids?: string[] } | undefined)?.ids ?? [];
          if (ids.includes("probe-33")) throw new ApiError(500, "probeFailed", "探测请求失败");
          return { requested: ids.length, healthy: ids.length, unhealthy: 0 };
        },
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-automation");

    await u.click(screen.getByTestId("egress-automation-test-all"));

    // 失败批次的节点计入未完成数：成功批 32 个可用，第二批 1 个未完成（egress-operations.tsx:100-127）
    expect(
      await screen.findByText(
        i18n.t("settings.egress.testedPartial", { requested: 32, healthy: 32, unhealthy: 0, failed: 1 }),
      ),
    ).toBeInTheDocument();
  });

  it("没有可用代理节点时全量探测不发出请求", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", enabled: false, proxyConfigured: false })]),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-automation");

    await u.click(screen.getByTestId("egress-automation-test-all"));

    expect(
      await screen.findByText(i18n.t("settings.egress.tested", { requested: 0, healthy: 0, unhealthy: 0 })),
    ).toBeInTheDocument();
    expect(callsOf("POST", "/api/admin/v1/egress-nodes/test")).toHaveLength(0);
  });
});

describe("订阅源编辑与删除", () => {
  it("编辑订阅源时保留已配置代理并提交 PUT", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        sources: () =>
          egressSourceListWire([egressSourceWire({ id: "src-1", name: "主力订阅", proxyConfigured: true })]),
        sourceUpdate: () => egressSourceWire({ id: "src-1" }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-source-row-src-1");

    await u.click(screen.getByTestId("egress-source-actions-src-1"));
    fireEvent.click(await screen.findByTestId("egress-source-edit-src-1"));
    const dialog = await screen.findByTestId("egress-source-dialog");

    // 已配置的密码型输入不展示当前值，真实可观察契约是 placeholder 提示（egress-source-dialog.tsx:98、123）
    expect(within(dialog).getByTestId("egress-source-url")).toHaveAttribute(
      "placeholder",
      i18n.t("settings.egress.keepConfigured"),
    );
    const proxyURL = within(dialog).getByTestId("egress-source-proxy-url");
    expect(proxyURL).toHaveAttribute("placeholder", i18n.t("settings.egress.keepConfigured"));

    fireEvent.change(within(dialog).getByTestId("egress-source-name"), { target: { value: "主力订阅二" } });
    await u.click(within(dialog).getByTestId("egress-source-dialog-save"));

    await waitFor(() => {
      const puts = callsOf("PUT", "/api/admin/v1/egress-sources/src-1");
      expect(puts).toHaveLength(1);
      expect(puts[0][1].body).toMatchObject({ name: "主力订阅二", proxyURL: undefined, clearProxyURL: false });
    });
    expect(await screen.findByText(i18n.t("settings.egress.sourceSaved"))).toBeInTheDocument();
  });

  it("关闭订阅源代理开关会请求清除已配置代理", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        sources: () => egressSourceListWire([egressSourceWire({ id: "src-1", proxyConfigured: true })]),
        sourceUpdate: () => egressSourceWire({ id: "src-1" }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-source-row-src-1");

    await u.click(screen.getByTestId("egress-source-actions-src-1"));
    fireEvent.click(await screen.findByTestId("egress-source-edit-src-1"));
    const dialog = await screen.findByTestId("egress-source-dialog");

    await u.click(within(dialog).getAllByRole("switch")[1]);
    await u.click(within(dialog).getByTestId("egress-source-dialog-save"));

    await waitFor(() => {
      const puts = callsOf("PUT", "/api/admin/v1/egress-sources/src-1");
      expect(puts).toHaveLength(1);
      expect(puts[0][1].body).toMatchObject({ clearProxyURL: true });
    });
  });

  it("取消编辑关闭弹窗且不提交", async () => {
    const u = await user();
    installRoutes(baseRoutes({ sources: () => egressSourceListWire([egressSourceWire({ id: "src-1" })]) }));
    renderEgressNodes();
    await screen.findByTestId("egress-source-row-src-1");

    await u.click(screen.getByTestId("egress-source-actions-src-1"));
    fireEvent.click(await screen.findByTestId("egress-source-edit-src-1"));
    const dialog = await screen.findByTestId("egress-source-dialog");

    await u.click(within(dialog).getByTestId("egress-source-dialog-cancel"));

    await waitFor(() => expect(screen.queryByTestId("egress-source-dialog")).not.toBeInTheDocument());
    expect(callsOf("PUT", "/api/admin/v1/egress-sources/src-1")).toHaveLength(0);
  });

  it("删除最后一页唯一订阅源后回到上一页", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        sources: () =>
          egressSourceListWire(Array.from({ length: 2 }, (_, index) => egressSourceWire({ id: `src-${index + 1}` }))),
        sourceRemove: () => ({ deleted: true }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-source-row-src-1");

    // 20 条一页：这里只有 2 条，翻页按钮禁用，删除不触发回落分支
    expect(screen.getByRole("button", { name: i18n.t("common.nextPage") })).toBeDisabled();

    await u.click(screen.getByTestId("egress-source-actions-src-1"));
    fireEvent.click(await screen.findByTestId("egress-source-delete-src-1"));

    await waitFor(() => expect(callsOf("DELETE", "/api/admin/v1/egress-sources/src-1")).toHaveLength(1));
    expect(await screen.findByText(i18n.t("settings.egress.sourceDeleted"))).toBeInTheDocument();
  });

  it("删除失败时展示服务端错误", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        sources: () => egressSourceListWire([egressSourceWire({ id: "src-1" })]),
        sourceRemove: () => {
          throw new ApiError(500, "deleteFailed", "订阅源删除失败");
        },
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-source-row-src-1");

    await u.click(screen.getByTestId("egress-source-actions-src-1"));
    fireEvent.click(await screen.findByTestId("egress-source-delete-src-1"));

    expect(await screen.findByText("订阅源删除失败")).toBeInTheDocument();
  });

  it("新增订阅源成功时回到第 1 页", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        sources: () => egressSourceListWire([]),
        sourceCreate: () => egressSourceWire({ id: "src-9" }),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-sources-empty");

    await u.click(screen.getByTestId("egress-sources-add"));
    const dialog = await screen.findByTestId("egress-source-dialog");
    await u.type(within(dialog).getByTestId("egress-source-name"), "新订阅");
    await u.type(within(dialog).getByTestId("egress-source-url"), "https://example.com/sub");
    await u.click(within(dialog).getByTestId("egress-source-dialog-save"));

    await waitFor(() => expect(callsOf("POST", "/api/admin/v1/egress-sources")).toHaveLength(1));
    expect(await screen.findByText(i18n.t("settings.egress.sourceSaved"))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("egress-source-dialog")).not.toBeInTheDocument());
  });

  it("作用域筛选无匹配时展示无匹配文案", async () => {
    const u = await user();
    installRoutes(baseRoutes({ sources: () => egressSourceListWire([egressSourceWire({ id: "src-1" })]) }));
    renderEgressNodes();
    await screen.findByTestId("egress-source-row-src-1");

    const section = screen.getByTestId("egress-sources-search").closest("section");
    if (!section) throw new Error("缺少订阅源工具栏容器");
    await u.click(within(section).getByRole("button", { name: new RegExp(`^${i18n.t("common.filter")}`) }));
    await u.pointer({
      target: await screen.findByRole("menuitem", { name: new RegExp(`^${i18n.t("settings.egress.scope")}`) }),
    });
    await u.pointer({
      target: await screen.findByRole("menuitemradio", { name: i18n.t("settings.egress.scopeWeb") }),
      keys: "[MouseLeft]",
    });

    expect(await screen.findByTestId("egress-sources-empty")).toHaveTextContent(
      i18n.t("settings.egress.noSubscriptionMatches"),
    );
  });

  it("订阅源翻页后搜索重置回第 1 页", async () => {
    const u = await user();
    installRoutes(
      baseRoutes({
        sources: () =>
          egressSourceListWire(
            Array.from({ length: 25 }, (_, index) =>
              egressSourceWire({ id: `src-${index + 1}`, name: `订阅源 ${index + 1}` }),
            ),
          ),
      }),
    );
    renderEgressNodes();
    await screen.findByTestId("egress-source-row-src-1");

    await u.click(screen.getByRole("button", { name: i18n.t("common.lastPage") }));
    await screen.findByTestId("egress-source-row-src-25");

    await u.type(screen.getByTestId("egress-sources-search"), "订阅源 2");

    expect(await screen.findByTestId("egress-source-row-src-2")).toBeInTheDocument();
  });
});

describe("订阅源高级选项", () => {
  it("固定兜底节点不可用时展示不可用选项", async () => {
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", scope: "grok_web", name: "东京出口" })]),
      }),
    );
    renderEgressNodes();
    const row = await screen.findByTestId("egress-fallback-row-grok_web");

    await chooseRadixOption(
      await within(row).findByRole("combobox", {
        name: i18n.t("settings.egress.fallbackMode", { scope: i18n.t("settings.egress.scopeWeb") }),
      }),
      i18n.t("settings.egress.fallbackDirect"),
    );
    await waitFor(() => expect(screen.getByTestId("egress-automation-save")).toBeEnabled());

    // 切到固定节点后重新打开节点选择器，选择具体候选节点
    await chooseRadixOption(
      await within(row).findByRole("combobox", {
        name: i18n.t("settings.egress.fallbackMode", { scope: i18n.t("settings.egress.scopeWeb") }),
      }),
      i18n.t("settings.egress.fallbackFixed"),
    );
    const nodeTrigger = await screen.findByRole("combobox", {
      name: i18n.t("settings.egress.fallbackNode", { scope: i18n.t("settings.egress.scopeWeb") }),
    });
    expect(nodeTrigger).toHaveTextContent("东京出口");
  });
});
