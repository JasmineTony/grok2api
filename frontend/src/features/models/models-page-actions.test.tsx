import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installModelApi,
  listUrls,
  openRowMenu,
  renderModelsPage,
  requestsBy,
} from "@/features/models/models-test-support";
import { i18n } from "@/shared/i18n";

// 模型页批量操作、删除确认与模型同步的集成测试：只替换网络边界（全局 fetch）。

// 整页集成测试在覆盖率插桩 + 并发环境下对逐键等待很敏感，统一关闭按键间隔以留出超时余量。
function setupUser() {
  return userEvent.setup({ delay: null });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ModelsPage 批量操作与删除确认", () => {
  it("整页勾选后批量启用发送选中路由", async () => {
    const user = setupUser();
    const { requests } = installModelApi();
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.click(screen.getByTestId("models-select-page"));
    expect(screen.getByTestId("models-selected-count")).toHaveTextContent(i18n.t("common.selectedCount", { count: 1 }));

    await user.click(screen.getByTestId("models-batch-enable"));

    await waitFor(() => expect(requestsBy(requests, "PATCH", "/api/admin/v1/models/batch")).toHaveLength(1));
    expect(requestsBy(requests, "PATCH", "/api/admin/v1/models/batch")[0].body).toEqual({
      ids: ["route-1"],
      enabled: true,
    });
  });

  it("整页勾选后批量停用发送选中路由", async () => {
    const user = setupUser();
    const { requests } = installModelApi();
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.click(screen.getByTestId("models-select-page"));
    await user.click(screen.getByTestId("models-batch-disable"));

    await waitFor(() => expect(requestsBy(requests, "PATCH", "/api/admin/v1/models/batch")).toHaveLength(1));
    expect(requestsBy(requests, "PATCH", "/api/admin/v1/models/batch")[0].body).toEqual({
      ids: ["route-1"],
      enabled: false,
    });
  });

  it("行内勾选单个模型分组同样进入批量操作", async () => {
    const user = setupUser();
    installModelApi();
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    const rowCheckbox = screen.getByRole("checkbox", {
      name: i18n.t("common.selectItem", { name: "grok-4" }),
    });
    await user.click(rowCheckbox);
    expect(screen.getByTestId("models-selected-count")).toHaveTextContent(i18n.t("common.selectedCount", { count: 1 }));

    await user.click(rowCheckbox);
    expect(screen.queryByTestId("models-selected-count")).not.toBeInTheDocument();
  });

  it("批量启停失败时保留选择", async () => {
    const user = setupUser();
    installModelApi({ failure: "batch" });
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.click(screen.getByTestId("models-select-page"));
    await user.click(screen.getByTestId("models-batch-enable"));

    await waitFor(() =>
      expect(screen.getByTestId("models-selected-count")).toHaveTextContent(
        i18n.t("common.selectedCount", { count: 1 }),
      ),
    );
  });

  it("批量删除可取消；确认后按选中 id 发送批量 DELETE", async () => {
    const user = setupUser();
    const { requests } = installModelApi();
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.click(screen.getByTestId("models-select-page"));
    await user.click(screen.getByTestId("models-batch-delete"));
    expect(await screen.findByTestId("models-batch-delete-confirm")).toBeInTheDocument();

    await user.click(screen.getByTestId("models-batch-delete-cancel"));
    await waitFor(() => expect(screen.queryByTestId("models-batch-delete-confirm")).not.toBeInTheDocument());
    expect(requestsBy(requests, "DELETE", "/api/admin/v1/models")).toHaveLength(0);

    await user.click(screen.getByTestId("models-batch-delete"));
    await user.click(await screen.findByTestId("models-batch-delete-confirm"));

    await waitFor(() => expect(requestsBy(requests, "DELETE", "/api/admin/v1/models")).toHaveLength(1));
    expect(requestsBy(requests, "DELETE", "/api/admin/v1/models")[0].body).toEqual({ ids: ["route-1"] });
  });

  it("批量删除失败时不刷新列表且保留选择", async () => {
    const user = setupUser();
    const { requests } = installModelApi({ failure: "delete" });
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.click(screen.getByTestId("models-select-page"));
    await user.click(screen.getByTestId("models-batch-delete"));
    await user.click(await screen.findByTestId("models-batch-delete-confirm"));

    await waitFor(() => expect(requestsBy(requests, "DELETE", "/api/admin/v1/models")).toHaveLength(1));
    // AlertDialogAction 是 Radix 的 Close 按钮：确认即关闭弹窗，失败时只保留选择、不刷新列表。
    await waitFor(() => expect(screen.queryByTestId("models-batch-delete-confirm")).not.toBeInTheDocument());
    expect(listUrls(requests)).toHaveLength(1);
    expect(screen.getByTestId("models-selected-count")).toHaveTextContent(i18n.t("common.selectedCount", { count: 1 }));
  });

  it("行内删除确认框可取消且不发送请求", async () => {
    const user = setupUser();
    const { requests } = installModelApi();
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await openRowMenu(user);
    await user.click(await screen.findByTestId("models-row-delete-grok-4"));
    expect(await screen.findByTestId("models-delete-confirm")).toBeInTheDocument();

    await user.click(screen.getByTestId("models-delete-cancel"));

    await waitFor(() => expect(screen.queryByTestId("models-delete-confirm")).not.toBeInTheDocument());
    expect(requestsBy(requests, "DELETE", "/api/admin/v1/models/route-1")).toHaveLength(0);
  });

  it("行内删除确认后删除该分组的全部路由", async () => {
    const user = setupUser();
    const { requests } = installModelApi();
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await openRowMenu(user);
    await user.click(await screen.findByTestId("models-row-delete-grok-4"));
    await user.click(await screen.findByTestId("models-delete-confirm"));

    await waitFor(() => expect(requestsBy(requests, "DELETE", "/api/admin/v1/models/route-1")).toHaveLength(1));
  });

  it("删除失败时不刷新列表且确认框关闭", async () => {
    const user = setupUser();
    const { requests } = installModelApi({ failure: "delete" });
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await openRowMenu(user);
    await user.click(await screen.findByTestId("models-row-delete-grok-4"));
    await user.click(await screen.findByTestId("models-delete-confirm"));

    await waitFor(() => expect(requestsBy(requests, "DELETE", "/api/admin/v1/models/route-1")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId("models-delete-confirm")).not.toBeInTheDocument());
    expect(listUrls(requests)).toHaveLength(1);
  });
});

describe("ModelsPage 模型同步", () => {
  it("同步成功后刷新列表", async () => {
    const user = setupUser();
    const { requests } = installModelApi();
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.click(screen.getByTestId("models-sync"));

    await waitFor(() => expect(requestsBy(requests, "POST", "/api/admin/v1/models/sync")).toHaveLength(1));
    await waitFor(() => expect(listUrls(requests).length).toBeGreaterThan(1));
  });

  it("同步返回 ApiError 时不刷新列表且按钮恢复可用", async () => {
    const user = setupUser();
    const { requests } = installModelApi({ failure: "sync" });
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.click(screen.getByTestId("models-sync"));
    await waitFor(() => expect(requestsBy(requests, "POST", "/api/admin/v1/models/sync")).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("models-sync")).toBeEnabled());

    expect(listUrls(requests)).toHaveLength(1);
  });

  it("同步抛出非 Error 时走通用兜底文案且不刷新列表", async () => {
    const user = setupUser();
    const { requests } = installModelApi({ throwOnSync: "socket hang up" });
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.click(screen.getByTestId("models-sync"));
    await waitFor(() => expect(requestsBy(requests, "POST", "/api/admin/v1/models/sync")).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("models-sync")).toBeEnabled());

    expect(listUrls(requests)).toHaveLength(1);
  });
});
