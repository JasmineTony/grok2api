import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import {
  createAccountFormDefaults,
  createAccountFormSchema,
  type AccountForm,
} from "@/features/accounts/account-edit-form";
import { updateAccount, type AccountDTO, type AccountUpdateInput } from "@/features/accounts/accounts-api";
import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import type { BuildRouteMode } from "@/features/accounts/accounts-dto";

export type AccountsEditFlow = {
  editing: AccountDTO | null;
  form: UseFormReturn<AccountForm>;
  pending: boolean;
  accountEnabled: boolean;
  clearCloudflareCookies: boolean;
  buildSuperEntitled: boolean;
  buildRouteMode: BuildRouteMode;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  beginEdit: (account: AccountDTO) => void;
};

function useUpdateAccountMutation(input: { ctx: AccountsFlowContext; editing: AccountDTO | null; onDone: () => void }) {
  const { ctx, editing, onDone } = input;
  const { t, invalidate, invalidateModels, showError } = ctx;
  return useMutation({
    mutationFn: (values: AccountForm) => {
      if (!editing) throw new Error(t("errors.generic"));
      const payload: AccountUpdateInput = {
        name: values.name,
        priority: values.priority,
        maxConcurrent: values.maxConcurrent,
        minimumRemaining: values.minimumRemaining,
      };
      if (values.enabled !== editing.enabled) payload.enabled = values.enabled;
      if (editing.provider !== "grok_build") {
        if (values.clearCloudflareCookies) payload.clearCloudflareCookies = true;
        else if (values.cloudflareCookies.trim()) payload.cloudflareCookies = values.cloudflareCookies;
      } else {
        payload.buildRouteMode = values.buildRouteMode;
        if (values.buildSuperEntitled !== editing.buildSuperEntitled) {
          payload.buildSuperEntitled = values.buildSuperEntitled;
        }
      }
      return updateAccount(editing.id, payload);
    },
    onSuccess: (account, values) => {
      const entitlementChanged =
        editing?.provider === "grok_build" && values.buildSuperEntitled !== editing.buildSuperEntitled;
      invalidate();
      if (entitlementChanged) invalidateModels();
      onDone();
      if (account.modelSyncFailed) toast.warning(t("accounts.updatedWithModelSyncFailure"));
      else if (account.enabledDoesNotClearCooldown) toast.warning(t("accounts.enabledDoesNotClearCooldown"));
      else toast.success(t("accounts.updated"));
    },
    onError: showError,
  });
}

export function useAccountEditFlow(ctx: AccountsFlowContext): AccountsEditFlow {
  const { t } = ctx;
  const [editing, setEditing] = useState<AccountDTO | null>(null);
  const form = useForm<AccountForm>({
    resolver: zodResolver(createAccountFormSchema(t)),
    defaultValues: createAccountFormDefaults(),
  });
  const accountEnabled = useWatch({ control: form.control, name: "enabled" });
  const clearCloudflareCookies = useWatch({ control: form.control, name: "clearCloudflareCookies" });
  const buildSuperEntitled = useWatch({ control: form.control, name: "buildSuperEntitled" });
  const buildRouteMode = useWatch({ control: form.control, name: "buildRouteMode" });
  const mutation = useUpdateAccountMutation({ ctx, editing, onDone: () => setEditing(null) });
  const beginEdit = (account: AccountDTO): void => {
    setEditing(account);
    form.reset({
      name: account.name,
      enabled: account.enabled,
      priority: account.priority,
      maxConcurrent: account.maxConcurrent,
      minimumRemaining: account.minimumRemaining,
      cloudflareCookies: "",
      clearCloudflareCookies: false,
      buildSuperEntitled: account.buildSuperEntitled,
      buildRouteMode: account.buildRouteMode,
    });
  };
  return {
    editing,
    form,
    pending: mutation.isPending,
    accountEnabled,
    clearCloudflareCookies,
    buildSuperEntitled,
    buildRouteMode,
    onClose: () => setEditing(null),
    onSubmit: (event) => {
      void form.handleSubmit((values) => mutation.mutate(values))(event);
    },
    beginEdit,
  };
}
