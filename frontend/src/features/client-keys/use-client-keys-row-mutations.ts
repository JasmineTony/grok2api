import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { toast } from "sonner";

import { getClientKeySecret } from "@/entities/client-keys/client-keys-api";
import type { ClientKeyDTO } from "@/entities/client-keys/types";
import {
  createClientKey,
  deleteClientKey,
  updateClientKey,
  type CreateKeyResponseDTO,
} from "@/features/client-keys/client-keys-api";
import { clientKeyFormToInput, type ClientKeyFormValues } from "@/features/client-keys/client-key-form-schema";
import type { SecretDialogState } from "@/features/client-keys/client-key-secret-dialog";
import type { ClientKeysTranslate } from "@/features/client-keys/use-client-keys-page-model";

export type ClientKeyRowMutationOptions = {
  editing: ClientKeyDTO | "new" | null;
  t: ClientKeysTranslate;
  notifyError: (error: unknown) => void;
  closeEditor: () => void;
  closeDelete: () => void;
  showSecret: (secret: string, source: SecretDialogState["source"]) => void;
};

export type ClientKeyRowMutations = {
  save: UseMutationResult<CreateKeyResponseDTO | ClientKeyDTO, Error, ClientKeyFormValues>;
  remove: UseMutationResult<{ deleted: boolean }, Error, string>;
  copy: UseMutationResult<{ secret: string }, Error, string>;
};

/** 单行变更：创建/编辑、删除与读取明文。 */
export function useClientKeyRowMutations({
  editing,
  t,
  notifyError,
  closeEditor,
  closeDelete,
  showSecret,
}: ClientKeyRowMutationOptions): ClientKeyRowMutations {
  const queryClient = useQueryClient();
  const invalidate = (): void => void queryClient.invalidateQueries({ queryKey: ["client-keys"] });

  const save = useMutation<CreateKeyResponseDTO | ClientKeyDTO, Error, ClientKeyFormValues>({
    mutationFn: (values: ClientKeyFormValues) => {
      if (editing === "new") return createClientKey(clientKeyFormToInput(values));
      if (!editing) throw new Error(t("errors.generic"));
      return updateClientKey(editing.id, clientKeyFormToInput(values));
    },
    onSuccess: (result) => {
      invalidate();
      if ("secret" in result) {
        showSecret(result.secret, "created");
        toast.success(t("keys.created"));
      } else {
        toast.success(t("keys.updated"));
      }
      closeEditor();
    },
    onError: notifyError,
  });

  const remove = useMutation<{ deleted: boolean }, Error, string>({
    mutationFn: deleteClientKey,
    onSuccess: () => {
      invalidate();
      closeDelete();
      toast.success(t("keys.deleted"));
    },
    onError: notifyError,
  });

  const copy = useMutation<{ secret: string }, Error, string>({
    mutationFn: getClientKeySecret,
    onSuccess: (result) => showSecret(result.secret, "retrieved"),
    onError: notifyError,
  });

  return { save, remove, copy };
}
