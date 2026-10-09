import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clickRadioItem,
  installModelApi,
  lastListUrl,
  listUrls,
  modelGroup,
  modelRoute,
  openListFilters,
  openRowMenu,
  queryParam,
  renderModelsPage,
  requestsBy,
} from "@/features/models/models-test-support";
import { i18n } from "@/shared/i18n";

// 模型页关键路径集成测试（列表 / 筛选 / 创建编辑）：只替换网络边界（全局 fetch），
// 被测页面、hooks、解码器与 React Query 状态流全部使用真实实现，断言以用户可见结果为准。
// 批量操作与同步见 models-page-actions.test.tsx。

// 整页集成测试在覆盖率插桩 + 并发环境下对逐键等待很敏感，统一关闭按键间隔以留出超时余量。
function setupUser() {
  return userEvent.setup({ delay: null });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ModelsPage 列表状态", () => {
  it("加载完成后渲染分组行、上游模型与分页", async () => {
    const { requests } = installModelApi({
      groups: [
        modelGroup(),
        modelGroup({ routes: [modelRoute({ id: "route-2", publicId: "grok-3", upstreamModel: "Build/grok-3" })] }),
      ],
      total: 2,
    });
    renderModelsPage();

    expect(screen.queryByTestId("models-row-grok-4")).not.toBeInTheDocument();
    expect(await screen.findByTestId("models-row-grok-4")).toHaveTextContent("Build/grok-4");
    expect(screen.getByTestId("models-row-grok-3")).toHaveTextContent("Build/grok-3");
    expect(screen.getByText(i18n.t("common.pageOf", { page: 1, pages: 1 }))).toBeInTheDocument();
    expect(listUrls(requests)).toHaveLength(1);
  });

  it("空结果渲染空态且不渲染表格行", async () => {
    installModelApi({ groups: [], total: 0 });
    renderModelsPage();

    expect(await screen.findByText(i18n.t("common.noData"))).toBeInTheDocument();
    expect(screen.queryByTestId("models-row-grok-4")).not.toBeInTheDocument();
    expect(screen.queryByTestId("models-select-page")).not.toBeInTheDocument();
  });

  it("列表失败展示错误文案，重试会重新发起请求", async () => {
    const user = setupUser();
    const { requests } = installModelApi({ failure: "list" });
    renderModelsPage();

    expect(await screen.findByText(i18n.t("apiErrors.modelListFailed"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: i18n.t("common.retry") }));

    await waitFor(() => expect(listUrls(requests)).toHaveLength(2));
  });

  it("多个接口能力的同一对外名称按分组展示能力与编辑入口", async () => {
    const user = setupUser();
    installModelApi({
      groups: [
        modelGroup({
          endpointCapabilities: ["responses", "image"],
          routes: [
            modelRoute(),
            modelRoute({ id: "route-2", capability: "image", enabled: false, bindingMode: true, supportedAccounts: 0 }),
          ],
        }),
      ],
      total: 1,
    });
    renderModelsPage();

    await screen.findByTestId("models-row-grok-4");
    expect(screen.getByTestId("models-row-grok-4")).toHaveTextContent(i18n.t("models.partiallyEnabled"));

    await openRowMenu(user);
    expect(
      await screen.findByRole("menuitem", { name: i18n.t("models.editCapability", { capability: "Image" }) }),
    ).toBeInTheDocument();
  });
});

describe("ModelsPage 筛选与分页", () => {
  it("搜索词经防抖后写入查询参数", async () => {
    const user = setupUser();
    const { requests } = installModelApi({ total: 40 });
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.type(screen.getByTestId("models-search"), "grok");

    await waitFor(() => expect(queryParam(lastListUrl(requests), "search")).toBe("grok"), { timeout: 3_000 });
  });

  it("来源筛选写入查询参数", async () => {
    const user = setupUser();
    const { requests } = installModelApi({ total: 40 });
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await openListFilters(user);
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("models.provider") }));
    await clickRadioItem(user, i18n.t("models.providerGrokWeb"));

    await waitFor(() => expect(queryParam(lastListUrl(requests), "provider")).toBe("grok_web"));
  });

  it("状态筛选写入查询参数并回到第 1 页", async () => {
    const user = setupUser();
    const { requests } = installModelApi({ total: 40 });
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await openListFilters(user);
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("models.status") }));
    await clickRadioItem(user, i18n.t("common.disabled"));

    await waitFor(() => {
      expect(queryParam(lastListUrl(requests), "status")).toBe("disabled");
      expect(queryParam(lastListUrl(requests), "page")).toBe("1");
    });
  });

  it("翻页请求下一页数据", async () => {
    const user = setupUser();
    const { requests } = installModelApi({ total: 40 });
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));

    await waitFor(() => expect(queryParam(lastListUrl(requests), "page")).toBe("2"));
  });

  it("点击列头切换排序参数", async () => {
    const user = setupUser();
    const { requests } = installModelApi({ total: 40 });
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    const modelColumn = screen.getByRole("button", {
      name: i18n.t("common.sortAscending", { column: i18n.t("models.model") }),
    });
    await user.click(modelColumn);

    await waitFor(() => {
      expect(queryParam(lastListUrl(requests), "sortBy")).toBe("publicId");
      expect(queryParam(lastListUrl(requests), "sortOrder")).toBe("asc");
    });
  });
});

describe("ModelsPage 创建与编辑", () => {
  it("创建表单必填校验失败时不发起请求并显示两条提示", async () => {
    const user = setupUser();
    const { requests } = installModelApi();
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.click(screen.getByTestId("models-create"));
    expect(await screen.findByTestId("models-edit-dialog")).toBeInTheDocument();

    await user.click(screen.getByTestId("models-submit"));

    expect(await screen.findAllByText(i18n.t("errors.required"))).toHaveLength(2);
    expect(requestsBy(requests, "POST")).toHaveLength(0);
    expect(screen.getByTestId("models-edit-dialog")).toBeInTheDocument();
  });

  it("绑定账号模式未选择账号时提示并阻止提交", async () => {
    const user = setupUser();
    const { requests } = installModelApi({ accountOptions: [{ id: "7", name: "acc-7" }] });
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.click(screen.getByTestId("models-create"));
    await screen.findByTestId("models-edit-dialog");
    await user.type(screen.getByLabelText(i18n.t("models.publicId")), "grok-5");
    await user.type(screen.getByLabelText(i18n.t("models.upstream")), "Build/grok-5");
    await user.click(screen.getByLabelText(i18n.t("models.bindAccounts")));
    expect(await screen.findByText("acc-7")).toBeInTheDocument();

    await user.click(screen.getByTestId("models-submit"));

    expect(await screen.findByText(i18n.t("models.selectAccountRequired"))).toBeInTheDocument();
    expect(requestsBy(requests, "POST")).toHaveLength(0);
  });

  it("勾选/取消可绑定账号都会反映到表单并随提交发送", async () => {
    const user = setupUser();
    const { requests } = installModelApi({ accountOptions: [{ id: "7", name: "acc-7" }] });
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.click(screen.getByTestId("models-create"));
    await screen.findByTestId("models-edit-dialog");
    await user.type(screen.getByLabelText(i18n.t("models.publicId")), "grok-5");
    await user.type(screen.getByLabelText(i18n.t("models.upstream")), "Build/grok-5");
    await user.click(screen.getByLabelText(i18n.t("models.bindAccounts")));

    const account = await screen.findByRole("checkbox", { name: /acc-7/ });
    await user.click(account);
    expect(screen.getByText(i18n.t("models.selectedAccounts", { count: 1 }))).toBeInTheDocument();

    await user.click(account);
    expect(screen.queryByText(i18n.t("models.selectedAccounts", { count: 1 }))).not.toBeInTheDocument();

    await user.click(account);
    await user.click(screen.getByTestId("models-submit"));

    await waitFor(() => expect(screen.queryByTestId("models-edit-dialog")).not.toBeInTheDocument());
    expect(requestsBy(requests, "POST", "/api/admin/v1/models")[0]?.body).toMatchObject({ accountIds: ["7"] });
  });

  it("创建成功提交 POST 并关闭弹窗", async () => {
    const user = setupUser();
    const { requests } = installModelApi();
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.click(screen.getByTestId("models-create"));
    await screen.findByTestId("models-edit-dialog");
    await user.type(screen.getByLabelText(i18n.t("models.publicId")), "grok-5");
    await user.type(screen.getByLabelText(i18n.t("models.upstream")), "Build/grok-5");
    await user.click(screen.getByTestId("models-submit"));

    await waitFor(() => expect(screen.queryByTestId("models-edit-dialog")).not.toBeInTheDocument());
    expect(requestsBy(requests, "POST", "/api/admin/v1/models")[0]?.body).toMatchObject({
      publicId: "grok-5",
      upstreamModel: "Build/grok-5",
      accountIds: [],
    });
  });

  it("编辑提交 PATCH 并携带路由 id", async () => {
    const user = setupUser();
    const { requests } = installModelApi();
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await openRowMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("common.edit") }));
    await screen.findByTestId("models-edit-dialog");
    await user.click(screen.getByTestId("models-submit"));

    await waitFor(() => expect(screen.queryByTestId("models-edit-dialog")).not.toBeInTheDocument());
    expect(requestsBy(requests, "PATCH", "/api/admin/v1/models/route-1")[0]?.body).toMatchObject({
      publicId: "grok-4",
      enabled: true,
      accountIds: [],
    });
  });

  it("保存失败时弹窗保持打开并保留输入", async () => {
    const user = setupUser();
    const { requests } = installModelApi({ failure: "save" });
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await openRowMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("common.edit") }));
    await screen.findByTestId("models-edit-dialog");
    await user.click(screen.getByTestId("models-submit"));

    await waitFor(() => expect(requestsBy(requests, "PATCH")).toHaveLength(1));
    expect(screen.getByTestId("models-edit-dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t("models.publicId"))).toHaveValue("grok-4");
  });

  it("可绑定账号列表失败时展示错误文案", async () => {
    const user = setupUser();
    installModelApi({ failure: "accounts" });
    renderModelsPage();
    await screen.findByTestId("models-row-grok-4");

    await user.click(screen.getByTestId("models-create"));
    await screen.findByTestId("models-edit-dialog");
    await user.click(screen.getByLabelText(i18n.t("models.bindAccounts")));

    expect(await screen.findByText(i18n.t("apiErrors.modelAccountListFailed"))).toBeInTheDocument();
  });
});
