import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactElement } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ClientKeyDeleteDialog, ClientKeysBatchDeleteDialog } from "@/features/client-keys/client-key-delete-dialogs";
import { ClientKeyFormDialog } from "@/features/client-keys/client-key-form-dialog";
import {
  clientKeyToFormValues,
  createClientKeyDefaults,
  createClientKeySchema,
  type ClientKeyFormValues,
} from "@/features/client-keys/client-key-form-schema";
import { ClientKeySecretDialog } from "@/features/client-keys/client-key-secret-dialog";
import { ClientKeysTable } from "@/features/client-keys/client-keys-table";
import { ClientKeysToolbar } from "@/features/client-keys/client-keys-toolbar";
import {
  useClientKeyBatchMutations,
  type ClientKeyBatchMutations,
} from "@/features/client-keys/use-client-keys-batch-mutations";
import {
  useClientKeyDialogs,
  useClientKeysListModel,
  useClientKeysSelection,
  type ClientKeyDialogs,
  type ClientKeysListModel,
  type ClientKeysSelection,
  type ClientKeysTranslate,
} from "@/features/client-keys/use-client-keys-page-model";
import {
  useClientKeyRowMutations,
  type ClientKeyRowMutations,
} from "@/features/client-keys/use-client-keys-row-mutations";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { Pagination } from "@/shared/components/pagination";

/** 页面模型：列表查询、选中集合、弹窗状态、表单实例与全部变更。 */
type ClientKeysPageModel = {
  t: ClientKeysTranslate;
  list: ClientKeysListModel;
  selection: ClientKeysSelection;
  dialogs: ClientKeyDialogs;
  form: UseFormReturn<ClientKeyFormValues>;
  rows: ClientKeyRowMutations;
  batch: ClientKeyBatchMutations;
};

/**
 * 客户端密钥页：持有筛选/分页/选中状态与全部查询、变更，
 * 表格、工具栏、创建/编辑弹窗、明文弹窗与删除确认均为独立组件。
 */
export function ClientKeysPage(): ReactElement {
  const { t } = useTranslation();
  const list = useClientKeysListModel();
  const selection = useClientKeysSelection(list.pageIds);
  const dialogs = useClientKeyDialogs();
  const form = useForm<ClientKeyFormValues>({
    resolver: zodResolver(createClientKeySchema(t)),
    defaultValues: createClientKeyDefaults(),
  });

  function showError(error: unknown): void {
    toast.error(error instanceof Error ? error.message : t("errors.generic"));
  }

  const rows = useClientKeyRowMutations({
    editing: dialogs.editing,
    t,
    notifyError: showError,
    closeEditor: () => dialogs.setEditing(null),
    closeDelete: () => dialogs.setDeleting(null),
    showSecret: (secret, source) => dialogs.setSecretDialog({ secret, source }),
  });
  const batch = useClientKeyBatchMutations({
    ids: [...selection.selected],
    t,
    notifyError: showError,
    clearSelection: selection.clear,
    closeBatchDelete: () => dialogs.setBatchDeleteOpen(false),
  });
  const model: ClientKeysPageModel = { t, list, selection, dialogs, form, rows, batch };

  return (
    <div className="space-y-5">
      <ClientKeysPageHeader />
      <ClientKeysListPanel model={model} />
      <ClientKeysDialogPanel model={model} />
    </div>
  );
}

/** 页头：标题与仅供读屏的描述。 */
function ClientKeysPageHeader() {
  const { t } = useTranslation();
  return (
    <header className="flex min-h-8 items-center">
      <h1 className="text-xl font-medium">{t("keys.title")}</h1>
      <p className="sr-only">{t("keys.description")}</p>
    </header>
  );
}

/** 列表区：工具条 + 表格 + 分页脚注；无数据时不渲染脚注。 */
function ClientKeysListPanel({ model }: { model: ClientKeysPageModel }) {
  const result = model.list.keysQuery.data;
  const showFooter = Boolean(result && result.total > 0);
  return (
    <DataTableShell
      toolbar={<ClientKeysToolbarPanel model={model} />}
      footer={showFooter ? <ClientKeysFooterPanel model={model} /> : undefined}
    >
      <ClientKeysTablePanel model={model} />
    </DataTableShell>
  );
}

/** 列表工具条：搜索、筛选、批量操作与创建入口。 */
function ClientKeysToolbarPanel({ model }: { model: ClientKeysPageModel }) {
  const { list, selection, dialogs, batch, form } = model;
  return (
    <ClientKeysToolbar
      search={list.search}
      onSearchChange={(value) => {
        list.setSearch(value);
        list.setPage(1);
      }}
      statusFilter={list.statusFilter}
      onStatusFilterChange={(value) => {
        list.setStatusFilter(value);
        list.setPage(1);
      }}
      modelScopeFilter={list.modelScopeFilter}
      onModelScopeFilterChange={(value) => {
        list.setModelScopeFilter(value);
        list.setPage(1);
      }}
      selectedCount={selection.selected.size}
      onBatchEnable={() => batch.updateEnabled.mutate(true)}
      onBatchDisable={() => batch.updateEnabled.mutate(false)}
      onBatchDelete={() => dialogs.setBatchDeleteOpen(true)}
      onCreate={() => {
        dialogs.setEditing("new");
        form.reset(createClientKeyDefaults());
      }}
    />
  );
}

/** 分页脚注：换页或换页长时回到第 1 页。 */
function ClientKeysFooterPanel({ model }: { model: ClientKeysPageModel }) {
  const result = model.list.keysQuery.data;
  if (!result) return null;
  return (
    <Pagination
      page={result.page}
      pageSize={result.pageSize}
      total={result.total}
      onPageChange={model.list.setPage}
      onPageSizeChange={(value) => {
        model.list.setPageSize(value);
        model.list.setPage(1);
      }}
    />
  );
}

/** 密钥表格：数据、选中、排序、明文与行操作全部来自页面模型。 */
function ClientKeysTablePanel({ model }: { model: ClientKeysPageModel }) {
  const { list, selection, dialogs, rows, form } = model;
  const keysQuery = list.keysQuery;
  return (
    <ClientKeysTable
      result={keysQuery.data}
      isPending={keysQuery.isPending}
      isError={keysQuery.isError}
      errorMessage={keysQuery.error?.message ?? ""}
      onRetry={() => void keysQuery.refetch()}
      selected={selection.selected}
      onTogglePage={selection.togglePage}
      onToggleKey={selection.toggleKey}
      sort={list.sort}
      onSort={list.changeSort}
      referenceTime={dialogs.statusReferenceTime}
      copyPending={rows.copy.isPending}
      copyPendingId={rows.copy.variables}
      onCopySecret={(id) => rows.copy.mutate(id)}
      onEdit={(key) => {
        dialogs.setEditing(key);
        form.reset(clientKeyToFormValues(key));
      }}
      onDelete={dialogs.setDeleting}
    />
  );
}

/** 弹窗区：创建/编辑、明文、单条删除与批量删除确认。 */
function ClientKeysDialogPanel({ model }: { model: ClientKeysPageModel }) {
  const { dialogs, selection, form, rows, batch } = model;
  return (
    <>
      <ClientKeyFormDialog
        editing={dialogs.editing}
        form={form}
        isPending={rows.save.isPending}
        onClose={() => dialogs.setEditing(null)}
        onSubmit={(values) => rows.save.mutate(values)}
      />
      <ClientKeySecretDialog state={dialogs.secretDialog} onClose={() => dialogs.setSecretDialog(null)} />
      <ClientKeyDeleteDialog
        target={dialogs.deleting}
        onClose={() => dialogs.setDeleting(null)}
        onConfirm={(id) => rows.remove.mutate(id)}
      />
      <ClientKeysBatchDeleteDialog
        open={dialogs.batchDeleteOpen}
        count={selection.selected.size}
        onOpenChange={dialogs.setBatchDeleteOpen}
        onConfirm={() => batch.remove.mutate()}
      />
    </>
  );
}
