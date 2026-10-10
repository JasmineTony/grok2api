import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import { ModelsToolbar } from "@/features/models/models-toolbar";
import type { ModelBulkMutations } from "@/features/models/use-model-bulk-mutations";
import type { ModelListController } from "@/features/models/use-model-list";
import type { ModelSelectionController } from "@/features/models/use-model-selection";
import { DataTableFilters } from "@/shared/components/data-table-filters";
import { i18n } from "@/shared/i18n";

// models-toolbar 是 props 驱动的工具栏：直接注入受控 controller，
// 断言搜索/筛选回写、批量操作入口显隐、同步按钮 pending 态与新增回调。

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

function renderToolbar(node: ReactNode) {
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

function listController(overrides: Partial<ModelListController> = {}): ModelListController {
  return {
    page: 1,
    pageSize: 20,
    search: "",
    statusFilter: "",
    providerFilter: "",
    sort: { field: "", order: "asc" },
    query: { isPending: false } as ModelListController["query"],
    result: undefined,
    pageIDs: [],
    setSearch: vi.fn(),
    setStatusFilter: vi.fn(),
    setProviderFilter: vi.fn(),
    setPage: vi.fn(),
    setPageSize: vi.fn(),
    changeSort: vi.fn(),
    ...overrides,
  };
}

function selectionController(selected: string[] = []): ModelSelectionController {
  return {
    selected: new Set(selected),
    clear: vi.fn(),
    togglePage: vi.fn(),
    toggleGroup: vi.fn(),
  };
}

function bulkMutations(syncPending = false): ModelBulkMutations {
  return {
    remove: { isPending: false, mutate: vi.fn() },
    removeSelected: { isPending: false, mutate: vi.fn() },
    setEnabled: { isPending: false, mutate: vi.fn() },
    sync: { isPending: syncPending, mutate: vi.fn() },
  } as unknown as ModelBulkMutations;
}

function renderDefault(list: ModelListController, selection: ModelSelectionController, bulk = bulkMutations()) {
  const onCreate = vi.fn();
  const onBatchDelete = vi.fn();
  const view = renderToolbar(
    <ModelsToolbar
      list={list}
      selection={selection}
      bulk={bulk}
      selectedGroups={selection.selected.size}
      onCreate={onCreate}
      onBatchDelete={onBatchDelete}
    />,
  );
  return { ...view, onCreate, onBatchDelete, bulk };
}

describe("ModelsToolbar 搜索与筛选", () => {
  it("输入搜索词回写 setSearch，并展示受控值", async () => {
    const user = userEvent.setup({ delay: null });
    const list = listController({ search: "grok" });
    renderDefault(list, selectionController());

    const search = screen.getByTestId("models-search");
    expect(search).toHaveValue("grok");
    await user.clear(search);
    await user.type(search, "grokx");

    expect(list.setSearch).toHaveBeenCalled();
    expect(list.setSearch).toHaveBeenLastCalledWith("grokx");
  });

  it("筛选器把来源与状态回写到对应 setter", async () => {
    const user = userEvent.setup({ delay: null });
    const list = listController();
    renderDefault(list, selectionController());

    await user.click(screen.getByRole("button", { name: new RegExp(`^${t("common.filter")}`) }));
    await user.click(await screen.findByRole("menuitem", { name: t("models.provider") }));
    await user.pointer({
      target: await screen.findByRole("menuitemradio", { name: t("models.providerGrokWeb") }),
      keys: "[MouseLeft]",
    });

    expect(list.setProviderFilter).toHaveBeenCalledWith("grok_web");
  });

  it("状态筛选仅提供启用/停用两项并回写 setStatusFilter", async () => {
    const user = userEvent.setup({ delay: null });
    const list = listController();
    renderDefault(list, selectionController());

    await user.click(screen.getByRole("button", { name: new RegExp(`^${t("common.filter")}`) }));
    await user.click(await screen.findByRole("menuitem", { name: t("models.status") }));

    const options = await screen.findAllByRole("menuitemradio");
    expect(options.map((option) => option.textContent)).toEqual([
      t("common.all"),
      t("common.enabled"),
      t("common.disabled"),
    ]);
  });
});

describe("ModelsToolbar 批量操作与新建", () => {
  it("未选择任何分组时不渲染批量操作按钮", () => {
    renderDefault(listController(), selectionController());

    expect(screen.queryByTestId("models-selected-count")).not.toBeInTheDocument();
    expect(screen.queryByTestId("models-batch-enable")).not.toBeInTheDocument();
    expect(screen.queryByTestId("models-batch-delete")).not.toBeInTheDocument();
  });

  it("有选中分组时展示数量并触发启用/停用/批量删除", async () => {
    const user = userEvent.setup({ delay: null });
    const bulk = bulkMutations();
    const { onBatchDelete } = renderDefault(listController(), selectionController(["route-1", "route-2"]), bulk);

    expect(screen.getByTestId("models-selected-count")).toHaveTextContent(t("common.selectedCount", { count: 2 }));

    await user.click(screen.getByTestId("models-batch-enable"));
    expect(bulk.setEnabled.mutate).toHaveBeenCalledWith(true);

    await user.click(screen.getByTestId("models-batch-disable"));
    expect(bulk.setEnabled.mutate).toHaveBeenCalledWith(false);

    await user.click(screen.getByTestId("models-batch-delete"));
    expect(onBatchDelete).toHaveBeenCalledTimes(1);
  });

  it("同步按钮在 pending 时禁用并显示加载指示，空闲时触发 mutate", async () => {
    const user = userEvent.setup({ delay: null });
    const idle = bulkMutations(false);
    const pending = bulkMutations(true);

    const { unmount } = renderDefault(listController(), selectionController(), pending);
    const pendingButton = screen.getByTestId("models-sync");
    expect(pendingButton).toBeDisabled();
    expect(pendingButton.querySelector('[role="status"]')).not.toBeNull();
    unmount();

    renderDefault(listController(), selectionController(), idle);
    const idleButton = screen.getByTestId("models-sync");
    expect(idleButton).toBeEnabled();

    await user.click(idleButton);
    expect(idle.sync.mutate).toHaveBeenCalledTimes(1);
  });

  it("新增按钮触发 onCreate", async () => {
    const user = userEvent.setup({ delay: null });
    const { onCreate } = renderDefault(listController(), selectionController());

    await user.click(screen.getByTestId("models-create"));

    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe("DataTableFilters 清除筛选入口", () => {
  it("存在生效筛选时展示计数与清除入口，并清空所有筛选值", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    renderToolbar(
      <DataTableFilters
        filters={[{ id: "status", label: t("models.status"), value: "enabled", options: [], onChange }]}
      />,
    );

    const trigger = screen.getByRole("button", { name: new RegExp(`^${t("common.filter")}`) });
    expect(trigger).toHaveTextContent("1");

    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: t("common.clearFilters") }));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("没有生效筛选时不展示计数与清除入口", async () => {
    const user = userEvent.setup({ delay: null });
    renderToolbar(
      <DataTableFilters
        filters={[{ id: "status", label: t("models.status"), value: "", options: [], onChange: vi.fn() }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: new RegExp(`^${t("common.filter")}`) }));

    expect(screen.queryByRole("menuitem", { name: t("common.clearFilters") })).not.toBeInTheDocument();
  });
});
