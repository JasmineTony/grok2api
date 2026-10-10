import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  guardNode,
  guardNodeState,
  guardStatus,
  installQualityGuardApi,
  lastUrlOf,
  openNodeFilters,
  queryParam,
  renderQualityGuardPage,
  setupUser,
  type RecordedRequest,
} from "@/features/quality-guard/quality-guard-test-support";
import { i18n } from "@/shared/i18n";

// 守护节点关键路径集成测试：只替换网络边界（全局 fetch），节点表格、行操作菜单、
// 编辑/删除弹窗、批量操作、人工探测与筛选状态全部使用真实实现，断言用户可见结果。

const STATUS_PATH = "/api/admin/v1/egress-quality-guard";
const NODES_PATH = "/api/admin/v1/egress-nodes";
const BATCH_PATH = "/api/admin/v1/egress-nodes/batch";
const QUALITY_GUARD_PATH = "/api/admin/v1/egress-quality-guard";

/** 打开筛选菜单 → 进入子菜单 → 选择单选项（Radix 子菜单在 jsdom 中靠指针移动展开）。 */
async function chooseNodeFilter(
  user: ReturnType<typeof setupUser>,
  submenuLabel: string,
  optionLabel: string,
): Promise<void> {
  await openNodeFilters(user);
  await user.pointer({ target: await screen.findByRole("menuitem", { name: new RegExp(`^${submenuLabel}`) }) });
  await user.pointer({ target: await screen.findByRole("menuitemradio", { name: optionLabel }), keys: "[MouseLeft]" });
}

function requestsTo(requests: RecordedRequest[], path: string, method?: string): RecordedRequest[] {
  return requests.filter(
    (request) => request.url.startsWith(path) && (method === undefined || (request.method ?? "GET") === method),
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
});
// jsdom 下整页渲染 + Radix 弹层 + 真实轮询查询比默认 5s 慢，统一放宽单测超时（不掩盖断言失败）。
vi.setConfig({ testTimeout: 15_000 });

describe("守护节点行状态与操作可用性", () => {
  it("按判定顺序展示隔离 / 固定回退 / 停用 / 租约 / 只读 / 独立代理 / 探测失败 / 可疑 / 健康 / 待观察", async () => {
    const nodes = [
      guardNode({ id: "node-1", name: "隔离节点" }),
      guardNode({ id: "node-2", name: "固定回退节点" }),
      guardNode({ id: "node-3", name: "停用节点", enabled: false }),
      guardNode({ id: "node-4", name: "租约隔离节点" }),
      guardNode({ id: "node-5", name: "只读节点" }),
      guardNode({ id: "node-6", name: "独立代理节点", accountBoundProxy: true }),
      guardNode({ id: "node-7", name: "探测失败节点" }),
      guardNode({ id: "node-8", name: "可疑节点" }),
      guardNode({ id: "node-9", name: "健康节点" }),
      guardNode({ id: "node-10", name: "待观察节点", accountCapacity: 5, assignedAccountCount: 2 }),
    ];
    installQualityGuardApi({
      nodes,
      status: guardStatus({
        nodes: {
          "node-1": guardNodeState({ disabled_by_guard: true }),
          "node-4": guardNodeState({ quarantined_lease_count: 2 }),
          "node-5": guardNodeState({ observe_only: true, observe_only_reason: "top_tps" }),
          "node-7": guardNodeState({ error_strikes: 1, last_classification: "unknown" }),
          "node-8": guardNodeState({ last_classification: "soft" }),
          "node-9": guardNodeState({ last_classification: "healthy", last_source: "active" }),
        },
        protectedNodeIds: ["node-2"],
      }),
    });
    renderQualityGuardPage();

    await screen.findByTestId("guard-node-row-node-1");
    expect(screen.getByTestId("guard-node-state-node-1")).toHaveTextContent(i18n.t("qualityGuard.quarantined"));
    expect(screen.getByTestId("guard-node-state-node-2")).toHaveTextContent(i18n.t("qualityGuard.fixedFallback"));
    expect(screen.getByTestId("guard-node-state-node-3")).toHaveTextContent(i18n.t("common.disabled"));
    expect(screen.getByTestId("guard-node-state-node-4")).toHaveTextContent(
      i18n.t("qualityGuard.leaseQuarantined", { count: 2 }),
    );
    expect(screen.getByTestId("guard-node-state-node-5")).toHaveTextContent(
      i18n.t("qualityGuard.leaseScopedObserveOnly"),
    );
    expect(screen.getByTestId("guard-node-state-node-6")).toHaveTextContent(i18n.t("qualityGuard.leaseScoped"));
    expect(screen.getByTestId("guard-node-state-node-7")).toHaveTextContent(i18n.t("qualityGuard.probeFailed"));
    expect(screen.getByTestId("guard-node-state-node-8")).toHaveTextContent(i18n.t("qualityGuard.suspect"));
    expect(screen.getByTestId("guard-node-state-node-9")).toHaveTextContent(i18n.t("qualityGuard.healthy"));
    expect(screen.getByTestId("guard-node-state-node-10")).toHaveTextContent(i18n.t("qualityGuard.pending"));

    // 容量 0 时不显示上限；容量 > 0 时显示「已绑定 / 上限」
    expect(screen.getByTestId("guard-node-row-node-10")).toHaveTextContent("2 / 5");
    // 无守护状态的行速度/首 token/来源/命中次数显示占位符
    const pendingRow = screen.getByTestId("guard-node-row-node-10");
    expect(within(pendingRow).getAllByText("-").length).toBeGreaterThanOrEqual(4);

    // 受保护（固定回退）的行不可选择；停用行仍可选择，只是不能被人工探测
    const rowCheckboxes = screen
      .getAllByRole("checkbox")
      .filter((box) => box.getAttribute("aria-label") !== i18n.t("common.selectPage"));
    expect(rowCheckboxes).toHaveLength(10);
    expect(rowCheckboxes.filter((box) => (box as HTMLButtonElement).disabled)).toHaveLength(1);

    // 停用且未隔离的节点不能手动探测（testEnabled 为真但节点停用）
    expect(screen.getByTestId("guard-node-test-node-3")).toBeDisabled();
    expect(screen.getByTestId("guard-node-toggle-node-2")).toBeDisabled();
  });

  it("行操作菜单按启停状态切换启用/禁用与删除", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({ nodes: [guardNode({ id: "node-1" })] });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByTestId("guard-node-menu-node-1"));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("common.disable") }));

    await waitFor(() => {
      const batch = requestsTo(requests, BATCH_PATH, "PATCH");
      expect(batch).toHaveLength(1);
      expect(batch[0].body).toEqual({ ids: ["node-1"], enabled: false });
    });
  });

  it("停用节点展示「启用」菜单项与启用开关，且不可人工探测", async () => {
    const user = setupUser();
    // 空守护状态：节点停用但未被守护隔离，验证「启用节点」与探测禁用条件
    installQualityGuardApi({
      status: guardStatus({ nodes: {}, protectedNodeIds: [] }),
      nodes: [guardNode({ id: "node-1", enabled: false })],
    });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    // 下拉菜单打开时会把其余内容设为 aria-hidden，因此先断言行内开关再打开菜单
    expect(screen.getByTestId("guard-node-toggle-node-1")).toHaveAttribute(
      "aria-label",
      i18n.t("qualityGuard.enableNode", { name: "东京出口" }),
    );
    expect(screen.getByTestId("guard-node-test-node-1")).toBeDisabled();

    await user.click(screen.getByTestId("guard-node-menu-node-1"));

    expect(await screen.findByRole("menuitem", { name: i18n.t("common.enable") })).toBeInTheDocument();
  });
});

describe("守护节点新增与编辑", () => {
  it("新增节点提交名称、容量与代理地址，保存后关闭弹窗", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({ nodes: [] });
    renderQualityGuardPage();
    await screen.findByTestId("guard-nodes-empty");

    await user.click(screen.getByTestId("guard-node-create"));
    const dialog = await screen.findByTestId("guard-node-editor");
    expect(within(dialog).getByRole("heading")).toHaveTextContent(i18n.t("settings.egress.addTitle"));
    const save = within(dialog).getByTestId("guard-node-save");
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByTestId("guard-node-name"), "新出口");
    await user.type(within(dialog).getByTestId("guard-node-capacity"), "7");
    await user.type(within(dialog).getByTestId("guard-node-proxy"), "socks5h://user:pass@host:1080");
    await user.click(within(dialog).getByTestId("guard-node-enabled"));
    expect(save).toBeEnabled();

    await user.click(save);

    await waitFor(() => {
      const created = requestsTo(requests, NODES_PATH, "POST");
      expect(created).toHaveLength(1);
      expect(created[0].body).toEqual({
        name: "新出口",
        scope: "grok_build",
        enabled: false,
        proxyPool: false,
        accountCapacity: 7,
        proxyURL: "socks5h://user:pass@host:1080",
        userAgent: "",
        cloudflareCookies: undefined,
      });
    });
    await waitFor(() => expect(screen.queryByTestId("guard-node-editor")).not.toBeInTheDocument());
    expect(await screen.findByText(i18n.t("settings.egress.saved"))).toBeInTheDocument();
  });

  it("代理池开关在清空代理地址后自动关闭，并在有代理时可用", async () => {
    const user = setupUser();
    installQualityGuardApi({ nodes: [] });
    renderQualityGuardPage();
    await screen.findByTestId("guard-nodes-empty");

    await user.click(screen.getByTestId("guard-node-create"));
    const dialog = await screen.findByTestId("guard-node-editor");
    const pool = within(dialog).getByRole("switch", { name: i18n.t("settings.egress.proxyPool") });
    expect(pool).toBeDisabled();

    await user.type(within(dialog).getByTestId("guard-node-proxy"), "socks5h://host:1080");
    expect(pool).toBeEnabled();
    await user.click(pool);
    expect(pool).toBeChecked();

    await user.clear(within(dialog).getByTestId("guard-node-proxy"));
    expect(pool).not.toBeChecked();
  });

  it("编辑节点预填字段，保存提交 PUT 并保留代理池开关", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({
      nodes: [guardNode({ id: "node-1", name: "旧名称", accountCapacity: 5, proxyConfigured: true, proxyPool: true })],
    });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByTestId("guard-node-menu-node-1"));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("common.edit") }));

    const dialog = await screen.findByTestId("guard-node-editor");
    expect(within(dialog).getByRole("heading")).toHaveTextContent(i18n.t("settings.egress.editTitle"));
    const name = within(dialog).getByTestId("guard-node-name");
    expect(name).toHaveValue("旧名称");
    expect(within(dialog).getByTestId("guard-node-proxy")).toHaveAttribute(
      "placeholder",
      i18n.t("settings.egress.keepConfigured"),
    );

    await user.type(within(dialog).getByTestId("guard-node-proxy"), "socks5h://new:1080");
    await user.click(within(dialog).getByTestId("guard-node-save"));

    await waitFor(() => {
      const updated = requestsTo(requests, `${NODES_PATH}/node-1`, "PUT");
      expect(updated).toHaveLength(1);
      expect(updated[0].body).toMatchObject({ name: "旧名称", proxyPool: true, proxyURL: "socks5h://new:1080" });
    });
  });

  it("订阅源托管节点不显示代理配置选择，保存失败时保留弹窗并提示错误", async () => {
    const user = setupUser();
    installQualityGuardApi({
      nodes: [guardNode({ id: "node-1", sourceId: "src-1" })],
      failure: "nodeAction",
    });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByTestId("guard-node-menu-node-1"));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("common.edit") }));
    const dialog = await screen.findByTestId("guard-node-editor");
    expect(within(dialog).queryByTestId("egress-proxy-profile-picker")).toBeNull();

    await user.click(within(dialog).getByTestId("guard-node-save"));

    expect(await screen.findByText("节点写入失败")).toBeInTheDocument();
    expect(screen.getByTestId("guard-node-editor")).toBeInTheDocument();
  });

  it("保存进行中按 Esc 不会关闭弹窗（保存成功后由成功回调关闭）", async () => {
    const user = setupUser();
    const { fetchMock } = installQualityGuardApi({ nodes: [] });
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith(NODES_PATH) && (init?.method ?? "GET") === "POST") return new Promise(() => {});
      return respond(input, init);
    });
    renderQualityGuardPage();
    await screen.findByTestId("guard-nodes-empty");

    await user.click(screen.getByTestId("guard-node-create"));
    const dialog = await screen.findByTestId("guard-node-editor");
    await user.type(within(dialog).getByTestId("guard-node-name"), "进行中");
    await user.click(within(dialog).getByTestId("guard-node-save"));
    await waitFor(() => expect(within(dialog).getByTestId("guard-node-save")).toBeDisabled());

    await user.keyboard("{Escape}");

    expect(screen.getByTestId("guard-node-editor")).toBeInTheDocument();
  });
});

describe("守护节点删除", () => {
  it("单个删除确认后提交 DELETE 并关闭弹窗", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({ nodes: [guardNode({ id: "node-1", name: "东京出口" })] });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByTestId("guard-node-menu-node-1"));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("common.delete") }));

    const dialog = await screen.findByTestId("guard-node-delete-dialog");
    expect(dialog).toHaveTextContent(i18n.t("qualityGuard.deleteNodeTitle"));
    expect(dialog).toHaveTextContent(i18n.t("qualityGuard.deleteNodeDescription", { name: "东京出口" }));

    await user.click(within(dialog).getByTestId("guard-node-delete-confirm"));

    await waitFor(() => {
      // 单行删除同样走批量删除接口，只提交该节点 id
      const removed = requestsTo(requests, NODES_PATH, "DELETE");
      expect(removed).toHaveLength(1);
      expect(removed[0].body).toEqual({ ids: ["node-1"] });
    });
    await waitFor(() => expect(screen.queryByTestId("guard-node-delete-dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(i18n.t("settings.egress.deleted"))).toBeInTheDocument();
  });

  it("批量删除展示多选文案并提交所选 id", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({
      // 默认守护状态把 node-2 标为固定回退（不可选），这里清空以便验证批量选择
      status: guardStatus({ protectedNodeIds: [] }),
      nodes: [
        guardNode({ id: "node-1", enabled: true }),
        guardNode({ id: "node-2", name: "新加坡出口", enabled: false }),
      ],
    });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByTestId("guard-select-page"));
    await user.click(await screen.findByRole("button", { name: i18n.t("common.delete") }));

    const dialog = await screen.findByTestId("guard-node-delete-dialog");
    expect(dialog).toHaveTextContent(i18n.t("qualityGuard.deleteNodesTitle", { count: 2 }));

    await user.click(within(dialog).getByTestId("guard-node-delete-confirm"));

    await waitFor(() => {
      const removed = requestsTo(requests, NODES_PATH, "DELETE");
      expect(removed).toHaveLength(1);
      expect(removed[0].body).toEqual({ ids: ["node-1", "node-2"] });
    });
  });

  it("删除进行中按 Esc 不会关闭确认弹窗", async () => {
    const user = setupUser();
    const { fetchMock } = installQualityGuardApi({ nodes: [guardNode({ id: "node-1" })] });
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === NODES_PATH && init?.method === "DELETE") return new Promise(() => {});
      return respond(input, init);
    });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByTestId("guard-node-menu-node-1"));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("common.delete") }));
    const dialog = await screen.findByTestId("guard-node-delete-dialog");
    await user.click(within(dialog).getByTestId("guard-node-delete-confirm"));
    await waitFor(() => expect(within(dialog).getByTestId("guard-node-delete-confirm")).toBeDisabled());

    await user.keyboard("{Escape}");

    expect(screen.getByTestId("guard-node-delete-dialog")).toBeInTheDocument();
  });
});

describe("守护节点批量启停", () => {
  it("批量启用与批量停用分别提交所选 id，并在成功后清空选择", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({
      status: guardStatus({ protectedNodeIds: [] }),
      nodes: [guardNode({ id: "node-1", enabled: true }), guardNode({ id: "node-2", enabled: false })],
    });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByTestId("guard-select-page"));
    await user.click(await screen.findByRole("button", { name: i18n.t("common.enable") }));

    await waitFor(() => {
      const batch = requestsTo(requests, BATCH_PATH, "PATCH");
      expect(batch).toHaveLength(1);
      expect(batch[0].body).toEqual({ ids: ["node-1", "node-2"], enabled: true });
    });
    // 成功后清空选择：批量操作条消失
    await waitFor(() =>
      expect(screen.queryByText(i18n.t("common.selectedCount", { count: 2 }))).not.toBeInTheDocument(),
    );

    await user.click(screen.getByTestId("guard-select-page"));
    await user.click(await screen.findByRole("button", { name: i18n.t("common.disable") }));

    await waitFor(() => {
      const batch = requestsTo(requests, BATCH_PATH, "PATCH");
      expect(batch).toHaveLength(2);
      expect(batch[1].body).toEqual({ ids: ["node-1", "node-2"], enabled: false });
    });
  });

  it("节点启停失败时展示服务端错误信息", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({
      status: guardStatus({ protectedNodeIds: [] }),
      nodes: [guardNode({ id: "node-1" })],
      failure: "nodeAction",
    });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByTestId("guard-node-toggle-node-1"));

    await waitFor(() => expect(requestsTo(requests, BATCH_PATH, "PATCH")).toHaveLength(1));
    expect(await screen.findByText("节点批量操作失败")).toBeInTheDocument();
  });
});

describe("守护节点人工探测", () => {
  it("探测成功后立即刷新该行分类、TPS 与命中次数", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({ nodes: [guardNode({ id: "node-1" })] });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByTestId("guard-node-test-node-1"));

    await waitFor(() => {
      const tests = requestsTo(requests, `${QUALITY_GUARD_PATH}/nodes/node-1/test`, "POST");
      expect(tests).toHaveLength(1);
    });
    // hard 分类：软命中次数使用配置的 consecutive_soft（2）
    await waitFor(() => expect(screen.getByTestId("guard-node-row-node-1")).toHaveTextContent("0 / 2 / 0"));
    expect(screen.getByTestId("guard-node-state-node-1")).toHaveTextContent(i18n.t("qualityGuard.suspect"));
    expect(
      await screen.findByText(i18n.t("qualityGuard.testComplete", { speed: "1,200 Token/s" })),
    ).toBeInTheDocument();
  });

  it("探测失败时展示错误提示且不改变行分类", async () => {
    const user = setupUser();
    installQualityGuardApi({ nodes: [guardNode({ id: "node-1" })], failure: "nodeTest" });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByTestId("guard-node-test-node-1"));

    expect(await screen.findByText("节点探测失败")).toBeInTheDocument();
    expect(screen.getByTestId("guard-node-state-node-1")).toHaveTextContent(i18n.t("qualityGuard.quarantined"));
  });
});

describe("守护节点筛选、分页与空态", () => {
  it("无筛选的空列表展示通用空态并禁用全选", async () => {
    installQualityGuardApi({ nodes: [] });
    renderQualityGuardPage();

    const empty = await screen.findByTestId("guard-nodes-empty");
    expect(empty).toHaveTextContent(i18n.t("common.noData"));
    expect(screen.getByTestId("guard-select-page")).toBeDisabled();
    await waitFor(() => expect(screen.queryByTestId("guard-node-row-node-1")).not.toBeInTheDocument());
  });

  it("启停与绑定筛选写入查询参数，翻页回到第 1 页", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({ nodesTotal: 45 });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));
    await waitFor(() => expect(queryParam(lastUrlOf(requests, NODES_PATH), "page")).toBe("2"));

    await chooseNodeFilter(user, i18n.t("settings.egress.enabled"), i18n.t("common.enable"));
    await waitFor(() => {
      const url = lastUrlOf(requests, NODES_PATH);
      expect(queryParam(url, "enabled")).toBe("enabled");
      expect(queryParam(url, "page")).toBe("1");
    });

    await chooseNodeFilter(user, i18n.t("settings.egress.accounts"), i18n.t("settings.egress.assigned"));
    await waitFor(() => expect(queryParam(lastUrlOf(requests, NODES_PATH), "assignment")).toBe("bound"));
  });

  it("有筛选条件时空列表展示无匹配文案，刷新按钮重新请求", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({ nodes: [] });
    renderQualityGuardPage();
    await screen.findByTestId("guard-nodes-empty");

    await user.type(screen.getByTestId("guard-nodes-search"), "不存在的节点");
    await waitFor(() => expect(queryParam(lastUrlOf(requests, NODES_PATH), "search")).toBe("不存在的节点"), {
      timeout: 3_000,
    });
    expect(await screen.findByTestId("guard-nodes-empty")).toHaveTextContent(i18n.t("settings.egress.noMatches"));

    const before = requestsTo(requests, STATUS_PATH).length;
    await user.click(screen.getByRole("button", { name: i18n.t("qualityGuard.refreshNodes") }));
    await waitFor(() => expect(requestsTo(requests, NODES_PATH).length).toBeGreaterThan(before));
  });

  it("切换页大小写回查询参数", async () => {
    const { requests } = installQualityGuardApi({ nodesTotal: 45 });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    // 分页选择器不在表单内，Radix 不渲染隐藏原生 select，用键盘驱动（jsdom 下指针路径不可靠）
    const trigger = screen.getByRole("combobox", { name: i18n.t("common.perPage") });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await screen.findByRole("listbox");
    // Radix Select 的 pointerTypeRef 初始为 touch：直接 click 选项即走 handleSelect（jsdom 无真实指针）
    fireEvent.click(await screen.findByRole("option", { name: "50" }));

    await waitFor(() => expect(queryParam(lastUrlOf(requests, NODES_PATH), "pageSize")).toBe("50"));
  });
});

describe("守护状态派生值", () => {
  it("缺少 nodeSummary 时按节点状态汇总隔离数与租约数", async () => {
    installQualityGuardApi({
      status: guardStatus({
        nodeSummary: undefined,
        nodes: {
          "node-1": guardNodeState({ disabled_by_guard: true, quarantined_lease_count: 2 }),
          "node-2": guardNodeState({ quarantined_lease_count: 1 }),
        },
      }),
    });
    renderQualityGuardPage();

    expect(await screen.findByTestId("guard-metric-quarantined")).toHaveTextContent("4");
  });

  it("缺少统计数据时不渲染统计面板", async () => {
    installQualityGuardApi({ status: guardStatus({ statistics: undefined }) });
    renderQualityGuardPage();

    await screen.findByTestId("guard-overview");
    expect(screen.queryByTestId("guard-statistics")).not.toBeInTheDocument();
  });
});
