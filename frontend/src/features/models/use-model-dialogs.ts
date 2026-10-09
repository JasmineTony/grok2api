import { useState } from "react";

import type { ModelRouteDTO } from "@/entities/model/types";
import type { ModelRouteGroup } from "@/features/models/model-display";
import { emptyModelForm, modelFormValues, type ModelFormReturn } from "@/features/models/use-model-form";

// 模型页的弹窗与表单打开状态：编辑/创建表单实例由 useModelForm 提供，本 hook 只负责
// 打开哪一层弹窗、账号搜索词，以及在打开时把表单重置成对应的初始值。

export type ModelDialogsController = {
  editing: ModelRouteDTO | "new" | null;
  deleting: ModelRouteGroup | null;
  batchDeleteOpen: boolean;
  accountSearch: string;
  form: ModelFormReturn;
  setAccountSearch: (value: string) => void;
  setBatchDeleteOpen: (open: boolean) => void;
  beginCreate: () => void;
  beginEdit: (model: ModelRouteDTO) => void;
  beginDelete: (group: ModelRouteGroup) => void;
  closeEditor: () => void;
  closeDelete: () => void;
  closeBatchDelete: () => void;
  toggleBoundAccount: (id: string, checked: boolean) => void;
};

export function useModelDialogs(form: ModelFormReturn): ModelDialogsController {
  const [editing, setEditing] = useState<ModelRouteDTO | "new" | null>(null);
  const [deleting, setDeleting] = useState<ModelRouteGroup | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");

  function beginEdit(model: ModelRouteDTO): void {
    setEditing(model);
    setAccountSearch("");
    form.reset(modelFormValues(model));
  }

  function beginCreate(): void {
    setEditing("new");
    setAccountSearch("");
    form.reset(emptyModelForm());
  }

  function toggleBoundAccount(id: string, checked: boolean): void {
    const current = form.getValues("accountIds");
    form.setValue("accountIds", checked ? [...new Set([...current, id])] : current.filter((value) => value !== id), {
      shouldValidate: true,
    });
  }

  return {
    editing,
    deleting,
    batchDeleteOpen,
    accountSearch,
    form,
    setAccountSearch,
    setBatchDeleteOpen,
    beginCreate,
    beginEdit,
    beginDelete: setDeleting,
    closeEditor: () => setEditing(null),
    closeDelete: () => setDeleting(null),
    closeBatchDelete: () => setBatchDeleteOpen(false),
    toggleBoundAccount,
  };
}
