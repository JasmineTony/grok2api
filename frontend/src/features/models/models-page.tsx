import { useTranslation } from "react-i18next";

import { ModelBatchDeleteDialog, ModelDeleteDialog } from "@/features/models/model-delete-dialogs";
import { ModelEditDialog } from "@/features/models/model-edit-dialog";
import { selectedGroupCount } from "@/features/models/model-selection";
import { ModelsTable } from "@/features/models/models-table";
import { ModelsToolbar } from "@/features/models/models-toolbar";
import { useModelBulkMutations } from "@/features/models/use-model-bulk-mutations";
import { useModelDialogs } from "@/features/models/use-model-dialogs";
import { useModelForm } from "@/features/models/use-model-form";
import { useModelList } from "@/features/models/use-model-list";
import { useModelSaveMutation } from "@/features/models/use-model-save-mutation";
import { useModelSelection } from "@/features/models/use-model-selection";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { Pagination } from "@/shared/components/pagination";

// 模型页只负责组装：列表状态（useModelList）、选择（useModelSelection）、
// 弹窗与表单（useModelDialogs + useModelForm）与 mutation（save/bulk）各自独立，
// 渲染交给 models-toolbar / models-table / 两个弹窗组件。

export function ModelsPage() {
  const { t } = useTranslation();
  const selection = useModelSelection();
  const list = useModelList(selection.clear);
  const form = useModelForm();
  const dialogs = useModelDialogs(form);
  const save = useModelSaveMutation({ selection, dialogs });
  const bulk = useModelBulkMutations({ list, selection, dialogs });
  const selectedGroups = selectedGroupCount(list.result?.items, selection.selected);

  return (
    <div className="space-y-5">
      <header className="flex min-h-8 items-center">
        <h1 className="text-xl font-medium">{t("models.title")}</h1>
        <p className="sr-only">{t("models.description")}</p>
      </header>

      <DataTableShell
        toolbar={
          <ModelsToolbar
            list={list}
            selection={selection}
            bulk={bulk}
            selectedGroups={selectedGroups}
            onCreate={dialogs.beginCreate}
            onBatchDelete={() => dialogs.setBatchDeleteOpen(true)}
          />
        }
        footer={
          list.result && list.result.total > 0 ? (
            <Pagination
              page={list.result.page}
              pageSize={list.result.pageSize}
              total={list.result.total}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
            />
          ) : undefined
        }
      >
        <ModelsTable list={list} selection={selection} onEdit={dialogs.beginEdit} onDelete={dialogs.beginDelete} />
      </DataTableShell>

      <ModelEditDialog dialogs={dialogs} save={save} />
      <ModelDeleteDialog dialogs={dialogs} remove={bulk.remove} />
      <ModelBatchDeleteDialog dialogs={dialogs} removeSelected={bulk.removeSelected} selectedGroups={selectedGroups} />
    </div>
  );
}
