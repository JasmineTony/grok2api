import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { deleteModels, syncModels, updateModelsEnabled } from "@/entities/model/model-api";
import { deleteModelRoutes, showModelError } from "@/features/models/model-mutations";
import type { ModelDialogsController } from "@/features/models/use-model-dialogs";
import type { ModelListController } from "@/features/models/use-model-list";
import type { ModelSelectionController } from "@/features/models/use-model-selection";

// 批量删除、批量启停与模型同步：成功后统一回到第 1 页并清空选择。
// 单次请求的构造与同步提示放在模块级函数里，hook 只保留 React Query 生命周期接线。

const modelSyncToastID = "model-sync-progress";

export type ModelBulkMutationScope = {
  list: ModelListController;
  selection: ModelSelectionController;
  dialogs: ModelDialogsController;
};

function resetModelList(
  list: ModelListController,
  selection: ModelSelectionController,
  queryClient: QueryClient,
): void {
  selection.clear();
  list.setPage(1);
  void queryClient.invalidateQueries({ queryKey: ["models"] });
}

function syncModelCapabilities(t: TFunction): Promise<{ synced: number }> {
  return syncModels((progress) => {
    toast.loading(t("models.syncingProgress", progress), { id: modelSyncToastID });
  });
}

export function useModelBulkMutations({ list, selection, dialogs }: ModelBulkMutationScope) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const reset = (): void => resetModelList(list, selection, queryClient);

  const remove = useMutation({
    mutationFn: deleteModelRoutes,
    onSuccess: () => {
      reset();
      dialogs.closeDelete();
      toast.success(t("models.deleted"));
    },
    onError: (error) => showModelError(error, t),
  });

  const removeSelected = useMutation({
    mutationFn: () => deleteModels([...selection.selected]),
    onSuccess: (result) => {
      reset();
      dialogs.closeBatchDelete();
      toast.success(t("models.batchDeleted", { count: result.deleted }));
    },
    onError: (error) => showModelError(error, t),
  });

  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) => updateModelsEnabled([...selection.selected], enabled),
    onSuccess: () => {
      reset();
      toast.success(t("models.batchUpdated"));
    },
    onError: (error) => showModelError(error, t),
  });

  const sync = useMutation({
    mutationFn: () => syncModelCapabilities(t),
    onMutate: () => toast.loading(t("models.syncing"), { id: modelSyncToastID }),
    onSuccess: (result) => {
      reset();
      toast.success(t("models.synced", { count: result.synced }), { id: modelSyncToastID });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("errors.generic"), { id: modelSyncToastID });
    },
  });

  return { remove, removeSelected, setEnabled, sync };
}

export type ModelBulkMutations = ReturnType<typeof useModelBulkMutations>;
