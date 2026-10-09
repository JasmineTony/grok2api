import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { saveModel, showModelError } from "@/features/models/model-mutations";
import type { ModelDialogsController } from "@/features/models/use-model-dialogs";
import type { ModelForm } from "@/features/models/use-model-form";
import type { ModelSelectionController } from "@/features/models/use-model-selection";

// 单个模型路由的创建/编辑提交：成功后清空选择、刷新列表并关闭弹窗。

export type ModelSaveMutationScope = {
  selection: ModelSelectionController;
  dialogs: ModelDialogsController;
};

export function useModelSaveMutation({ selection, dialogs }: ModelSaveMutationScope) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: ModelForm) => saveModel(dialogs.editing, values, t),
    onSuccess: () => {
      selection.clear();
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      dialogs.closeEditor();
      toast.success(t(dialogs.editing === "new" ? "models.created" : "models.updated"));
    },
    onError: (error) => showModelError(error, t),
  });
}
