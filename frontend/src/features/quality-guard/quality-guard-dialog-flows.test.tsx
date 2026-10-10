import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Policy } from "@/features/quality-guard/guard-policy-panel";
import type { QualityGuardStatus } from "@/features/quality-guard/quality-guard-api";
import {
  guardNode,
  guardStatus,
  installQualityGuardApi,
  openTab,
  probeProfile,
  renderQualityGuardPage,
  setupUser,
} from "@/features/quality-guard/quality-guard-test-support";
import { i18n } from "@/shared/i18n";

// 守护弹窗与面板分支补全测试：
// - 探针方案弹窗的字段编辑、只读语义、取消与保存中不可关闭；
// - 方案列表的匹配方式/预期标记文案与删除确认的取消路径；
// - 节点 tab 的弹窗取消关闭路径与策略摘要缺 config 时不渲染。

const NODES_PATH = "/api/admin/v1/egress-nodes";
const PROFILES_PATH = "/api/admin/v1/egress-quality-guard/profiles";

/** 测试支撑的 wire 构造器返回通用字典，按组件契约收窄类型。 */
function asStatus(value: Record<string, unknown>): QualityGuardStatus {
  return value as unknown as QualityGuardStatus;
}

/** 三种匹配方式都带预期标记的方案，覆盖 matchLabel 的全部分支。 */
function matchProfiles(): Record<string, unknown>[] {
  return [
    probeProfile(),
    probeProfile({ id: "profile-regex", name: "正则方案", built_in: false, match_mode: "regex" }),
    probeProfile({ id: "profile-contains", name: "包含方案", built_in: false, match_mode: "contains" }),
    probeProfile({
      id: "profile-custom",
      name: "自定义方案",
      built_in: false,
      expected_text: undefined,
      match_mode: "regex",
    }),
  ];
}

async function openProfilesTab(user: ReturnType<typeof setupUser>): Promise<void> {
  renderQualityGuardPage();
  await screen.findByTestId("guard-overview");
  await openTab(user, i18n.t("qualityGuard.profilesTab"));
  await screen.findByTestId("probe-profile-row-profile-builtin");
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
// jsdom 下整页渲染 + Radix 弹层比默认 5s 慢，统一放宽单测超时（不掩盖断言失败）。
vi.setConfig({ testTimeout: 15_000 });

describe("策略摘要缺配置", () => {
  it("config 缺失时不渲染策略区块", () => {
    render(<Policy status={asStatus({ available: true, editable: true })} onEdit={() => undefined} />);

    expect(screen.queryByTestId("guard-policy")).not.toBeInTheDocument();
    expect(screen.queryByTestId("guard-policy-edit")).not.toBeInTheDocument();
  });
});

describe("探针方案弹窗字段编辑", () => {
  it("自定义方案可改匹配方式、预期标记与要求 Thinking，并提交修改后的值", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({ profiles: matchProfiles() });
    await openProfilesTab(user);

    await user.click(screen.getByTestId("probe-profile-edit-profile-regex"));
    const dialog = await screen.findByTestId("probe-profile-dialog");
    // 编辑标题、预填的匹配方式与预期标记
    expect(within(dialog).getByRole("heading")).toHaveTextContent(i18n.t("qualityGuard.profileEdit"));
    expect(within(dialog).getByTestId("probe-profile-expected")).toHaveValue("pong");

    const matchTrigger = within(dialog).getByTestId("probe-profile-match");
    matchTrigger.focus();
    fireEvent.keyDown(matchTrigger, { key: "ArrowDown" });
    await screen.findByRole("listbox");
    fireEvent.click(await screen.findByRole("option", { name: i18n.t("qualityGuard.profileMatchContains") }));

    await user.type(within(dialog).getByTestId("probe-profile-expected"), " done");
    await user.click(within(dialog).getByRole("switch"));

    expect(within(dialog).getByTestId("probe-profile-match")).toHaveTextContent(
      i18n.t("qualityGuard.profileMatchContains"),
    );
    expect(within(dialog).getByRole("switch")).toHaveAttribute("aria-checked", "true");

    await user.click(within(dialog).getByTestId("probe-profile-save"));

    await waitFor(() => {
      const puts = requests.filter(
        (request) => request.url === `${PROFILES_PATH}/profile-regex` && request.method === "PUT",
      );
      expect(puts).toHaveLength(1);
      expect(puts[0].body).toEqual({
        name: "正则方案",
        prompt: "ping",
        expectedText: "pong done",
        matchMode: "contains",
        requireThinking: true,
      });
    });
  });

  it("取消按钮关闭弹窗且不发出写入请求", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({ profiles: matchProfiles() });
    await openProfilesTab(user);

    await user.click(screen.getByTestId("probe-profile-create"));
    const dialog = await screen.findByTestId("probe-profile-dialog");
    await user.type(within(dialog).getByTestId("probe-profile-name"), "临时方案");
    await user.click(within(dialog).getByRole("button", { name: i18n.t("common.cancel") }));

    await waitFor(() => expect(screen.queryByTestId("probe-profile-dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(requests.filter((request) => request.method === "POST")).toHaveLength(0));
  });

  it("按 Esc 关闭弹窗；保存进行中时按 Esc 不关闭", async () => {
    const user = setupUser();
    const { fetchMock } = installQualityGuardApi({ profiles: matchProfiles() });
    const respond = fetchMock.getMockImplementation()!;
    let createStarted = false;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      // 首次打开弹窗不受影响；点击保存后的 POST 保持挂起，用于断言保存中不可关闭
      if (String(input) === PROFILES_PATH && init?.method === "POST" && createStarted) return new Promise(() => {});
      return respond(input, init);
    });
    await openProfilesTab(user);

    await user.click(screen.getByTestId("probe-profile-create"));
    await screen.findByTestId("probe-profile-dialog");
    // 未保存时 Esc 走 onOpenChange 的关闭分支
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("probe-profile-dialog")).not.toBeInTheDocument());

    await user.click(screen.getByTestId("probe-profile-create"));
    const dialog = await screen.findByTestId("probe-profile-dialog");
    await user.type(within(dialog).getByTestId("probe-profile-name"), "进行中");
    await user.type(within(dialog).getByTestId("probe-profile-prompt"), "ping");
    createStarted = true;
    await user.click(within(dialog).getByTestId("probe-profile-save"));
    await waitFor(() => expect(createStarted).toBe(true));

    await user.keyboard("{Escape}");

    expect(screen.getByTestId("probe-profile-dialog")).toBeInTheDocument();
  });
});

describe("探针方案列表与删除确认", () => {
  it("按匹配方式与预期标记渲染说明文案", async () => {
    const user = setupUser();
    installQualityGuardApi({ profiles: matchProfiles() });
    await openProfilesTab(user);

    const label = (value: string): string => `${i18n.t("qualityGuard.profileExpected")} ${value}`;
    expect(screen.getByTestId("probe-profile-row-profile-builtin")).toHaveTextContent(
      `${label("pong")} · ${i18n.t("qualityGuard.profileMatchLastLine")}`,
    );
    expect(screen.getByTestId("probe-profile-row-profile-regex")).toHaveTextContent(
      `${label("pong")} · ${i18n.t("qualityGuard.profileMatchRegex")}`,
    );
    expect(screen.getByTestId("probe-profile-row-profile-contains")).toHaveTextContent(
      `${label("pong")} · ${i18n.t("qualityGuard.profileMatchContains")}`,
    );
    expect(screen.getByTestId("probe-profile-row-profile-custom")).toHaveTextContent(
      i18n.t("qualityGuard.profileNoExpected"),
    );
    // 内置方案只读：没有删除按钮
    expect(screen.queryByTestId("probe-profile-delete-profile-builtin")).toBeNull();
  });

  it("取消删除确认不发请求，Esc 也能关闭确认弹窗", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({ profiles: matchProfiles() });
    await openProfilesTab(user);

    await user.click(screen.getByTestId("probe-profile-delete-profile-custom"));
    const dialog = await screen.findByTestId("probe-profile-delete-dialog");
    await user.click(within(dialog).getByRole("button", { name: i18n.t("common.cancel") }));
    await waitFor(() => expect(screen.queryByTestId("probe-profile-delete-dialog")).not.toBeInTheDocument());
    expect(requests.filter((request) => request.method === "DELETE")).toHaveLength(0);

    await user.click(screen.getByTestId("probe-profile-delete-profile-custom"));
    await screen.findByTestId("probe-profile-delete-dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("probe-profile-delete-dialog")).not.toBeInTheDocument());
    expect(requests.filter((request) => request.method === "DELETE")).toHaveLength(0);
  });

  it("删除进行中展示加载态，Esc 不关闭确认弹窗", async () => {
    const user = setupUser();
    const { fetchMock } = installQualityGuardApi({ profiles: matchProfiles() });
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      // 删除请求保持挂起，用于断言 deletingPending 期间的不可关闭与加载态
      if (String(input) === `${PROFILES_PATH}/profile-custom` && init?.method === "DELETE")
        return new Promise(() => {});
      return respond(input, init);
    });
    await openProfilesTab(user);

    await user.click(screen.getByTestId("probe-profile-delete-profile-custom"));
    const dialog = await screen.findByTestId("probe-profile-delete-dialog");
    await user.click(within(dialog).getByTestId("probe-profile-delete-confirm"));
    await waitFor(() => expect(within(dialog).getByTestId("probe-profile-delete-confirm")).toBeDisabled());
    // 进行中展示 Spinner（确认按钮内的 svg + 可访问的取消按钮也变为禁用）
    expect(within(dialog).getByTestId("probe-profile-delete-confirm").querySelector("svg")).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: i18n.t("common.cancel") })).toBeDisabled();

    await user.keyboard("{Escape}");

    expect(screen.getByTestId("probe-profile-delete-dialog")).toBeInTheDocument();
  });
});

describe("守护节点弹窗的取消关闭路径", () => {
  it("节点编辑弹窗未保存时按 Esc 关闭", async () => {
    const user = setupUser();
    installQualityGuardApi({ nodes: [guardNode({ id: "node-1" })] });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByTestId("guard-node-menu-node-1"));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("common.edit") }));
    await screen.findByTestId("guard-node-editor");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByTestId("guard-node-editor")).not.toBeInTheDocument());
  });

  it("新增节点弹窗未保存时按 Esc 关闭", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({ nodes: [] });
    renderQualityGuardPage();
    await screen.findByTestId("guard-nodes-empty");

    await user.click(screen.getByTestId("guard-node-create"));
    const dialog = await screen.findByTestId("guard-node-editor");
    await user.type(within(dialog).getByTestId("guard-node-name"), "未保存节点");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByTestId("guard-node-editor")).not.toBeInTheDocument());
    expect(requests.filter((request) => request.url === NODES_PATH && request.method === "POST")).toHaveLength(0);
  });

  it("删除确认弹窗未进行删除时按 Esc 关闭且不发请求", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({ nodes: [guardNode({ id: "node-1", name: "东京出口" })] });
    renderQualityGuardPage();
    await screen.findByTestId("guard-node-row-node-1");

    await user.click(screen.getByTestId("guard-node-menu-node-1"));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("common.delete") }));
    await screen.findByTestId("guard-node-delete-dialog");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByTestId("guard-node-delete-dialog")).not.toBeInTheDocument());
    expect(requests.filter((request) => request.method === "DELETE")).toHaveLength(0);
  });

  it("不可编辑守护状态下不打开策略编辑弹窗入口", async () => {
    const user = setupUser();
    installQualityGuardApi({ status: guardStatus({ editable: false, statistics: undefined }) });
    renderQualityGuardPage();
    await screen.findByTestId("guard-policy");

    expect(screen.getByTestId("guard-policy-edit")).toBeDisabled();
    await user.click(screen.getByTestId("guard-policy-edit"));

    expect(screen.queryByTestId("guard-policy-editor")).not.toBeInTheDocument();
  });
});

describe("守护面板补充路径", () => {
  it("内置方案只读弹窗提交表单不发出写入请求", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({ profiles: matchProfiles() });
    await openProfilesTab(user);

    await user.click(screen.getByTestId("probe-profile-edit-profile-builtin"));
    const dialog = await screen.findByTestId("probe-profile-dialog");
    // 只读弹窗没有提交按钮，直接提交表单验证 readonly 守卫
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(screen.getByTestId("probe-profile-dialog")).toBeInTheDocument());
    expect(
      requests.filter((request) => request.url.startsWith(PROFILES_PATH) && request.method !== "GET"),
    ).toHaveLength(0);
  });

  it("守护状态最近事件为空数组时渲染空事件列表", async () => {
    // recentEvents 由解码器强制校验为数组，空数组是能从网络边界到达的最接近缺失的取值；
    // guard-nodes-tab.tsx:32 的 `?? []` 兜底分支在解码器约束下不可达，已在报告中登记。
    installQualityGuardApi({ status: guardStatus({ recentEvents: [] }) });
    renderQualityGuardPage();
    await screen.findByTestId("guard-overview");

    expect(screen.getByTestId("guard-events")).toHaveTextContent(i18n.t("qualityGuard.noEvents"));
    // 空事件不影响策略摘要与节点卡片
    expect(screen.getByTestId("guard-policy")).toBeInTheDocument();
    expect(screen.getByTestId("guard-nodes-card")).toBeInTheDocument();
  });
});
