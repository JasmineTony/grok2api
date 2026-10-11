import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { toast } from "sonner";

import { deleteClientKeys, updateClientKeysEnabled } from "@/features/client-keys/client-keys-api";
import type { ClientKeysTranslate } from "@/features/client-keys/use-client-keys-page-model";

export type ClientKeyBatchMutationOptions = {
  ids: string[];
  t: ClientKeysTranslate;
  notifyError: (error: unknown) => void;
  clearSelection: () => void;
  closeBatchDelete: () => void;
};

export type ClientKeyBatchMutations = {
  updateEnabled: UseMutationResult<{ updated: number }, Error, boolean>;
  remove: UseMutationResult<{ deleted: number }, Error, void>;
};

/** 批量变更：启用/停用与批量删除；成功后清空选择。 */
export function useClientKeyBatchMutations({
  ids,
  t,
  notifyError,
  clearSelection,
  closeBatchDelete,
}: ClientKeyBatchMutationOptions): ClientKeyBatchMutations {
  const queryClient = useQueryClient();
  const invalidate = (): void => void queryClient.invalidateQueries({ queryKey: ["client-keys"] });

  const updateEnabled = useMutation<{ updated: number }, Error, boolean>({
    mutationFn: (enabled: boolean) => updateClientKeysEnabled(ids, enabled),
    onSuccess: () => {
      clearSelection();
      invalidate();
      toast.success(t("keys.batchUpdated"));
    },
    onError: notifyError,
  });

  const remove = useMutation<{ deleted: number }, Error, void>({
    mutationFn: () => deleteClientKeys(ids),
    onSuccess: () => {
      clearSelection();
      closeBatchDelete();
      invalidate();
      toast.success(t("keys.deleted"));
    },
    onError: notifyError,
  });

  return { updateEnabled, remove };
}
