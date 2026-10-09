import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { EgressNodes } from "@/features/settings/egress-nodes";
import {
  createEgressFakeApi,
  egressNodeListWire,
  egressNodeWire,
  egressOperationsWire,
  egressProxyProfileListWire,
  egressProxyProfileWire,
  egressSourceListWire,
  matchEgressRoute,
  ResizeObserverStub,
  type FakeApiCall,
} from "@/features/settings/egress-test-support";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 关键路径组件集成测试（AGENTS.md TEST-3）：只替换 apiRequest 这一网络边界，
// EgressNodes 容器、settings-api decoder、react-query 状态流与表单校验保持真实实现。
const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

type FakeApiRoutes = import("@/features/settings/egress-test-support").EgressFakeRoutes;
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

/** 只 mock 网络边界：未注册的请求直接失败，避免测试静默通过。 */
function installRoutes(routes: FakeApiRoutes): void {
  apiMock.request.mockImplementation(
    createEgressFakeApi((call: FakeApiCall) => {
      const handler = matchEgressRoute(call, routes);
      if (!handler) throw new ApiError(500, "unexpectedRequest", `未注册的请求：${call.method} ${call.path}`);
      return handler(call);
    }),
  );
}

function renderNodes() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={0}>
          <EgressNodes title={i18n.t("settings.egress.title")} clearanceMode="manual" />
          <Toaster />
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/** 出口节点分区总是同时挂载订阅源与自动化分区，未关注的分区返回空数据。 */
function baseRoutes(routes: FakeApiRoutes): FakeApiRoutes {
  return {
    sources: () => egressSourceListWire([]),
    operations: () => egressOperationsWire(),
    profiles: () => egressProxyProfileListWire([]),
    ...routes,
  };
}

const user = () => userEvent.setup();

beforeEach(async () => {
  apiMock.request.mockReset();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EgressNodes 节点列表", () => {
  it("加载成功后展示名称、作用域、代理、绑定账号与健康度", async () => {
    installRoutes(
      baseRoutes({
        nodes: () =>
          egressNodeListWire([
            egressNodeWire({
              id: "node-1",
              name: "生产出口",
              scope: "grok_web",
              proxyDisplay: "socks5h://host:1080",
              proxyProfileId: "prof-1",
              proxyProfileName: "机房代理",
              accountCapacity: 10,
              assignedAccountCount: 3,
              health: 0.82,
              probeStatus: "healthy",
              ipv4Probe: { status: "healthy", latencyMs: 12, exitIp: "203.0.113.9" },
            }),
            egressNodeWire({ id: "node-2", name: "直连出口", enabled: false, proxyConfigured: false }),
          ]),
      }),
    );

    renderNodes();

    expect(await screen.findByTestId("egress-node-row-node-1")).toBeInTheDocument();
    expect(screen.getByTestId("egress-node-name-node-1")).toHaveTextContent("生产出口");
    expect(screen.getByTestId("egress-node-scope-node-1")).toHaveTextContent(i18n.t("settings.egress.scopeWeb"));
    expect(screen.getByTestId("egress-node-proxy-node-1")).toHaveTextContent("socks5h://host:1080");
    expect(screen.getByTestId("egress-node-proxy-node-1")).toHaveTextContent("机房代理");
    // 绑定账号数 / 容量（账号绑定结果对用户可见的部分）
    expect(screen.getByTestId("egress-node-accounts-node-1")).toHaveTextContent("3 / 10");
    expect(screen.getByTestId("egress-node-health-node-1")).toHaveTextContent("82%");
    expect(screen.getByTestId("egress-node-probe-node-1-ipv4")).toHaveTextContent("203.0.113.9");
    expect(screen.getByTestId("egress-node-probe-node-1-ipv6")).toHaveTextContent(i18n.t("settings.egress.notTested"));
    // 未配置代理的节点显示直连标记；容量为 0 时不显示上限
    expect(screen.getByTestId("egress-node-proxy-direct-node-2")).toHaveTextContent(i18n.t("settings.egress.direct"));
    expect(screen.getByTestId("egress-node-accounts-node-2")).toHaveTextContent("0");
    expect(screen.getByTestId("egress-node-accounts-node-2")).not.toHaveTextContent("/");
  });

  it("空列表展示直连兜底文案", async () => {
    installRoutes(baseRoutes({ nodes: () => egressNodeListWire([]) }));

    renderNodes();

    expect(await screen.findByTestId("egress-nodes-empty")).toHaveTextContent(i18n.t("settings.egress.directFallback"));
    expect(screen.queryByTestId("egress-nodes-table")).toBeInTheDocument();
  });

  it("加载失败展示错误信息，重试后恢复列表", async () => {
    let failed = false;
    installRoutes(
      baseRoutes({
        nodes: (call) => {
          if (call.query.get("pageSize") !== "2000" && !failed) {
            failed = true;
            throw new ApiError(503, "unavailable", "出口服务暂不可用");
          }
          return egressNodeListWire([egressNodeWire({ id: "node-1" })]);
        },
      }),
    );

    renderNodes();

    expect(await screen.findByText("出口服务暂不可用")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: i18n.t("common.retry") }));

    expect(await screen.findByTestId("egress-node-row-node-1")).toBeInTheDocument();
  });
});

describe("EgressNodes 搜索与分页", () => {
  it("搜索经过防抖后写入查询参数并回到第 1 页", async () => {
    installRoutes(
      baseRoutes({
        nodes: (call) => egressNodeListWire(call.query.get("search") ? [] : [egressNodeWire({ id: "node-1" })]),
      }),
    );
    renderNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await user().type(screen.getByTestId("egress-nodes-search"), "生产");

    await waitFor(() => expect(lastNodeListQuery().get("search")).toBe("生产"), { timeout: 3_000 });
    expect(lastNodeListQuery().get("page")).toBe("1");
    expect(await screen.findByTestId("egress-nodes-empty")).toHaveTextContent(i18n.t("settings.egress.noMatches"));
  });

  it("翻页请求下一页节点数据", async () => {
    installRoutes(
      baseRoutes({
        nodes: (call) =>
          egressNodeListWire([egressNodeWire({ id: `node-${call.query.get("page")}` })], {
            page: Number(call.query.get("page")),
            total: 25,
          }),
      }),
    );
    renderNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await user().click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));

    await waitFor(() => expect(lastNodeListQuery().get("page")).toBe("2"));
    expect(await screen.findByTestId("egress-node-row-node-2")).toBeInTheDocument();
  });
});

describe("EgressNodes 表单校验与保存", () => {
  it("新建节点未填名称时保存按钮禁用", async () => {
    installRoutes(baseRoutes({ nodes: () => egressNodeListWire([]) }));
    renderNodes();
    await screen.findByTestId("egress-nodes-empty");

    await user().click(screen.getByTestId("egress-nodes-add"));
    fireEvent.click(await screen.findByTestId("egress-nodes-add-manual"));

    const dialog = await screen.findByTestId("egress-node-dialog");
    expect(within(dialog).getByTestId("egress-node-dialog-save")).toBeDisabled();

    await user().type(within(dialog).getByTestId("egress-node-name"), "新节点");
    expect(within(dialog).getByTestId("egress-node-dialog-save")).toBeEnabled();
    expect(callsOf("POST", "/api/admin/v1/egress-nodes")).toHaveLength(0);
  });

  it("新建节点保存失败时展示服务端错误信息", async () => {
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([]),
        nodeCreate: () => {
          throw new ApiError(400, "duplicate", "节点名称重复");
        },
      }),
    );
    renderNodes();
    await screen.findByTestId("egress-nodes-empty");

    await user().click(screen.getByTestId("egress-nodes-add"));
    fireEvent.click(await screen.findByTestId("egress-nodes-add-manual"));
    const dialog = await screen.findByTestId("egress-node-dialog");
    await user().type(within(dialog).getByTestId("egress-node-name"), "重复节点");
    await user().click(within(dialog).getByTestId("egress-node-dialog-save"));

    expect(await screen.findByText("节点名称重复")).toBeInTheDocument();
    const created = callsOf("POST", "/api/admin/v1/egress-nodes");
    expect(created).toHaveLength(1);
    expect(created[0][1].body).toMatchObject({ name: "重复节点", scope: "grok_build", enabled: true });
    // 失败后弹窗保持打开，用户可以修正后重试
    expect(screen.getByTestId("egress-node-dialog")).toBeInTheDocument();
  });

  it("编辑节点提交 PUT，校验失败时保留弹窗并提示错误", async () => {
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", name: "旧名称", accountCapacity: 5 })]),
        nodeUpdate: () => {
          throw new ApiError(409, "conflict", "节点名称已存在");
        },
      }),
    );
    renderNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await user().click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-edit-node-1"));
    const dialog = await screen.findByTestId("egress-node-dialog");
    const nameInput = within(dialog).getByTestId("egress-node-name");
    expect(nameInput).toHaveValue("旧名称");

    await user().clear(nameInput);
    await user().type(nameInput, "新名称");
    await user().click(within(dialog).getByTestId("egress-node-dialog-save"));

    expect(await screen.findByText("节点名称已存在")).toBeInTheDocument();
    const updated = callsOf("PUT", "/api/admin/v1/egress-nodes/node-1");
    expect(updated).toHaveLength(1);
    expect(updated[0][1].body).toMatchObject({ name: "新名称", accountCapacity: 5 });
    expect(screen.getByTestId("egress-node-dialog")).toBeInTheDocument();
  });
});

describe("EgressNodes 批量删除", () => {
  it("取消确认框不发起删除请求", async () => {
    installRoutes(baseRoutes({ nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1" })]) }));
    renderNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await user().click(screen.getByTestId("egress-nodes-select-page"));
    await user().click(await screen.findByTestId("egress-nodes-batch-delete"));
    expect(await screen.findByTestId("egress-nodes-batch-delete-dialog")).toBeInTheDocument();

    await user().click(screen.getByTestId("egress-nodes-batch-delete-cancel"));

    await waitFor(() => expect(screen.queryByTestId("egress-nodes-batch-delete-dialog")).not.toBeInTheDocument());
    expect(callsOf("DELETE", "/api/admin/v1/egress-nodes")).toHaveLength(0);
    expect(screen.getByTestId("egress-node-row-node-1")).toBeInTheDocument();
  });

  it("确认后提交所选 id 并提示已删除", async () => {
    installRoutes(
      baseRoutes({
        nodes: () =>
          egressNodeListWire([
            egressNodeWire({ id: "node-1", assignedAccountCount: 2 }),
            egressNodeWire({ id: "node-2", assignedAccountCount: 0, sourceId: "src-1" }),
          ]),
        nodeBatchRemove: (call) => ({ deleted: (call.body as { ids: string[] }).ids.length }),
      }),
    );
    renderNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await user().click(screen.getByTestId("egress-nodes-select-page"));
    await user().click(await screen.findByTestId("egress-nodes-batch-delete"));
    const dialog = await screen.findByTestId("egress-nodes-batch-delete-dialog");
    expect(dialog).toHaveTextContent(i18n.t("settings.egress.batchDeleteTitle", { count: 2 }));
    // 受影响账号与订阅源托管节点数量对用户可见
    expect(dialog).toHaveTextContent(i18n.t("settings.egress.batchDeleteDescription", { count: 2, accounts: 2 }));
    expect(dialog).toHaveTextContent(i18n.t("settings.egress.batchDeleteSourceHint", { count: 1 }));

    await user().click(screen.getByTestId("egress-nodes-batch-delete-confirm"));

    await waitFor(() => expect(callsOf("DELETE", "/api/admin/v1/egress-nodes")).toHaveLength(1));
    expect(callsOf("DELETE", "/api/admin/v1/egress-nodes")[0][1].body).toEqual({ ids: ["node-1", "node-2"] });
    expect(await screen.findByText(i18n.t("settings.egress.batchDeleted", { deleted: 2 }))).toBeInTheDocument();
  });
});

describe("EgressNodes 代理配置选择", () => {
  it("选择代理配置后绑定该配置并禁用独立代理地址输入", async () => {
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", proxyConfigured: false })]),
        profiles: () => egressProxyProfileListWire([egressProxyProfileWire({ id: "prof-1", name: "机房代理" })]),
        profileSelected: () => egressProxyProfileWire({ id: "prof-1", name: "机房代理" }),
      }),
    );
    renderNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await user().click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-edit-node-1"));
    const dialog = await screen.findByTestId("egress-node-dialog");

    await user().click(within(dialog).getByTestId("egress-proxy-profile-picker"));
    fireEvent.click(await screen.findByTestId("egress-proxy-profile-option-prof-1"));

    await waitFor(() =>
      expect(within(dialog).getByTestId("egress-proxy-profile-picker")).toHaveTextContent("机房代理"),
    );
    expect(within(dialog).getByTestId("egress-node-proxy-url")).toBeDisabled();
  });

  it("代理配置选择器分页请求第二页", async () => {
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([egressNodeWire({ id: "node-1", proxyConfigured: false })]),
        profiles: (call) =>
          egressProxyProfileListWire([egressProxyProfileWire({ id: `prof-${call.query.get("page")}` })], {
            page: Number(call.query.get("page")),
            total: 25,
          }),
        profileSelected: () => egressProxyProfileWire({ id: "prof-1" }),
      }),
    );
    renderNodes();
    await screen.findByTestId("egress-node-row-node-1");

    await user().click(screen.getByTestId("egress-node-actions-node-1"));
    fireEvent.click(await screen.findByTestId("egress-node-edit-node-1"));
    const dialog = await screen.findByTestId("egress-node-dialog");

    await user().click(within(dialog).getByTestId("egress-proxy-profile-picker"));
    await screen.findByTestId("egress-proxy-profile-option-prof-1");
    await user().click(screen.getByTestId("egress-proxy-profile-picker-next"));

    await waitFor(() => {
      const queries = callsOf("GET", "/api/admin/v1/egress-proxy-profiles?").map(
        ([path]) => new URLSearchParams(path.slice(path.indexOf("?") + 1)),
      );
      expect(queries.some((query) => query.get("page") === "2")).toBe(true);
    });
  });
});

describe("EgressNodes 自动化配置", () => {
  it("修改开关后保存提交自动化配置并提示成功", async () => {
    installRoutes(
      baseRoutes({
        nodes: () => egressNodeListWire([]),
        operationsSave: () => egressOperationsWire({ autoAssignEnabled: true }),
      }),
    );
    renderNodes();
    await screen.findByTestId("egress-automation");

    const saveButton = screen.getByTestId("egress-automation-save");
    expect(saveButton).toBeDisabled();

    await user().click(await screen.findByRole("switch", { name: i18n.t("settings.egress.autoAssign") }));
    expect(screen.getByTestId("egress-automation-save")).toBeEnabled();
    await user().click(screen.getByTestId("egress-automation-save"));

    await waitFor(() => expect(callsOf("PUT", "/api/admin/v1/egress-operations")).toHaveLength(1));
    expect(callsOf("PUT", "/api/admin/v1/egress-operations")[0][1].body).toMatchObject({
      autoAssignEnabled: true,
      probeProvider: "cloudflare",
    });
    expect(await screen.findByText(i18n.t("settings.egress.automationSaved"))).toBeInTheDocument();
  });
});
