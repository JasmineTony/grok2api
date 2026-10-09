import type { TFunction } from "i18next";
import { toast } from "sonner";

import { createModel, deleteModel, deleteModels, updateModel } from "@/entities/model/model-api";
import type { ModelRouteDTO } from "@/entities/model/types";
import type { ModelForm } from "@/features/models/use-model-form";

// 模型 mutation 的纯逻辑与共享提示：从 models-page.tsx 拆出，便于脱离 React Query 验证分支。

export function saveModel(
  editing: ModelRouteDTO | "new" | null,
  values: ModelForm,
  t: TFunction,
): Promise<ModelRouteDTO> {
  if (!editing) throw new Error(t("errors.generic"));
  const input = { ...values, accountIds: values.bindingMode ? values.accountIds : [] };
  if (editing === "new") return createModel(input);
  return updateModel(editing.id, {
    publicId: input.publicId,
    enabled: input.enabled,
    accountIds: input.accountIds,
  });
}

export function deleteModelRoutes(routes: ModelRouteDTO[]): Promise<unknown> {
  if (routes.length === 1) return deleteModel(routes[0].id);
  return deleteModels(routes.map((route) => route.id));
}

export function showModelError(error: unknown, t: TFunction): void {
  toast.error(error instanceof Error ? error.message : t("errors.generic"));
}
