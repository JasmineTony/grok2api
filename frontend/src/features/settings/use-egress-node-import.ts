import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { emptyEgressImport, type EgressImportForm } from "@/features/settings/egress-import-form";
import { egressNodeMutationError, invalidateEgressNodes } from "@/features/settings/egress-node-mutations";
import { importEgressText } from "@/entities/egress/egress-api";

export type EgressNodeImport = {
  importOpen: boolean;
  importForm: EgressImportForm;
  importPending: boolean;
  openImport: () => void;
  closeImport: () => void;
  updateImportForm: (changes: Partial<EgressImportForm>) => void;
  submitImport: () => void;
};

/** 代理文本批量导入：草稿状态与提交，成功后关闭弹窗并刷新节点列表。 */
export function useEgressNodeImport(): EgressNodeImport {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [importForm, setImportForm] = useState<EgressImportForm>(emptyEgressImport);

  const importText = useMutation({
    mutationFn: () => importEgressText(importForm),
    onSuccess: (value) => {
      invalidateEgressNodes(queryClient);
      setImportOpen(false);
      toast.success(t("settings.egress.imported", value));
    },
    onError: egressNodeMutationError(t),
  });

  function openImport(): void {
    setImportForm(emptyEgressImport);
    setImportOpen(true);
  }

  function closeImport(): void {
    setImportOpen(false);
  }

  function updateImportForm(changes: Partial<EgressImportForm>): void {
    setImportForm((current) => ({ ...current, ...changes }));
  }

  return {
    importOpen,
    importForm,
    importPending: importText.isPending,
    openImport,
    closeImport,
    updateImportForm,
    submitImport: () => importText.mutate(),
  };
}
