import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installQualityGuardApi,
  openTab,
  renderQualityGuardPage,
  setupUser,
  type RecordedRequest,
} from "@/features/quality-guard/quality-guard-test-support";
import { i18n } from "@/shared/i18n";

// 探测配置（探针方案）关键路径集成测试：只替换网络边界，弹窗、表单状态与 mutation 使用真实实现。
// 覆盖：展示、启用切换、新增、内置方案只读、删除确认。

const PROFILES_PATH = "/api/admin/v1/egress-quality-guard/profiles";

function profileRequests(requests: RecordedRequest[], method: string): RecordedRequest[] {
  return requests.filter((request) => request.url.startsWith(PROFILES_PATH) && (request.method ?? "GET") === method);
}

async function openProfilesTab(user: ReturnType<typeof setupUser>) {
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
});
// jsdom 下真实查询 + Radix 弹层比默认 5s 慢，统一放宽单测超时（不掩盖断言失败）。
vi.setConfig({ testTimeout: 15_000 });

describe("ProbeProfilesPanel", () => {
  it("启用自定义方案时只提交该方案并标记为启用", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi();
    await openProfilesTab(user);

    await user.click(screen.getByTestId("probe-profile-activate-profile-custom"));

    await waitFor(() => {
      const puts = profileRequests(requests, "PUT");
      expect(puts).toHaveLength(1);
      expect(puts[0].url).toBe(`${PROFILES_PATH}/profile-custom`);
      expect(puts[0].body).toEqual({
        name: "自定义方案",
        prompt: "ping",
        expectedText: "",
        matchMode: "regex",
        requireThinking: false,
        active: true,
      });
    });
  });

  it("新增方案提交名称与提示词，名称或提示词为空时保存按钮不可用", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi();
    await openProfilesTab(user);

    await user.click(screen.getByTestId("probe-profile-create"));
    const dialog = await screen.findByTestId("probe-profile-dialog");
    const save = within(dialog).getByTestId("probe-profile-save");
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByTestId("probe-profile-name"), "新方案");
    await user.type(within(dialog).getByTestId("probe-profile-prompt"), "ping 一下");
    expect(save).toBeEnabled();

    await user.click(save);

    await waitFor(() => {
      const posts = profileRequests(requests, "POST");
      expect(posts).toHaveLength(1);
      expect(posts[0].body).toEqual({
        name: "新方案",
        prompt: "ping 一下",
        expectedText: "",
        matchMode: "last_line",
        requireThinking: false,
      });
    });
  });

  it("内置方案以只读方式打开：字段禁用且不提供保存", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi();
    await openProfilesTab(user);

    await user.click(screen.getByTestId("probe-profile-edit-profile-builtin"));

    const dialog = await screen.findByTestId("probe-profile-dialog");
    expect(within(dialog).getByTestId("probe-profile-name")).toBeDisabled();
    expect(within(dialog).getByTestId("probe-profile-expected")).toBeDisabled();
    expect(within(dialog).queryByTestId("probe-profile-save")).toBeNull();
    expect(profileRequests(requests, "PUT")).toHaveLength(0);
  });

  it("删除自定义方案需要确认，确认后发出删除请求", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi();
    await openProfilesTab(user);

    await user.click(screen.getByTestId("probe-profile-delete-profile-custom"));
    const confirmDialog = await screen.findByTestId("probe-profile-delete-dialog");
    expect(confirmDialog).toHaveTextContent(i18n.t("qualityGuard.profileDeleteConfirm", { name: "自定义方案" }));

    await user.click(within(confirmDialog).getByTestId("probe-profile-delete-confirm"));

    await waitFor(() => {
      const deletes = profileRequests(requests, "DELETE");
      expect(deletes).toHaveLength(1);
      expect(deletes[0].url).toBe(`${PROFILES_PATH}/profile-custom`);
    });
  });
});
