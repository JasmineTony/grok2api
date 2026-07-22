import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { getSettings, updateSettings } from "@/features/settings/settings-api";
import {
  type SettingsForm,
  settingsSchema,
  toSettingsDTO,
  toSettingsForm,
} from "@/features/settings/settings-model";
import { useApiClient } from "@/shared/api/use-api-client";

export function useSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: () => getSettings(apiClient) });
  const form = useForm<SettingsForm>({ resolver: zodResolver(settingsSchema) });
  const updateMutation = useMutation({
    mutationFn: (config: SettingsForm) =>
      updateSettings(apiClient, settingsQuery.data?.revision ?? "0", toSettingsDTO(config)),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["settings"], snapshot);
      void queryClient.invalidateQueries({ queryKey: ["system-info"] });
      form.reset(toSettingsForm(snapshot.config));
      toast.success(t("settings.saved"));
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("errors.generic")),
  });

  useEffect(() => {
    if (settingsQuery.data) form.reset(toSettingsForm(settingsQuery.data.config));
  }, [form, settingsQuery.data]);

  return {
    form,
    settingsQuery,
    updateMutation,
    reset: () => {
      if (settingsQuery.data) form.reset(toSettingsForm(settingsQuery.data.config));
    },
  };
}
