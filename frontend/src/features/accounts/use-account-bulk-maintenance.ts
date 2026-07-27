import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  type AccountProvider,
  deleteAccounts,
  refreshAccountsTokens,
  resetAccountsQuota,
  resetAllAccountQuota,
} from "@/features/accounts/accounts-api";
import { useApiClient } from "@/shared/api/use-api-client";

export function useAccountBulkMaintenance({
  provider,
  selected,
  linkedDeleteTargets,
  onClearSelection,
  onBatchDeleteClose,
  onRefresh,
  onError,
}: {
  provider: AccountProvider;
  selected: Set<string>;
  linkedDeleteTargets: AccountProvider[];
  onClearSelection: () => void;
  onBatchDeleteClose: () => void;
  onRefresh: () => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const apiClient = useApiClient();
  const selectedIDs = () => [...selected];
  const completeSelectionTask = (message: string) => {
    onClearSelection();
    onRefresh();
    toast.success(message);
  };
  const batchQuotaResetMutation = useMutation({
    mutationFn: () => resetAccountsQuota(apiClient, selectedIDs(), provider),
    onSuccess: (result) => completeSelectionTask(t("accounts.quotaResetCompleted", result)),
    onError,
  });
  const allQuotaResetMutation = useMutation({
    mutationFn: () => resetAllAccountQuota(apiClient),
    onSuccess: (result) => {
      onRefresh();
      toast.success(t("accounts.quotaResetCompleted", result));
    },
    onError,
  });
  const batchTokenMutation = useMutation({
    mutationFn: () => refreshAccountsTokens(apiClient, selectedIDs(), provider),
    onSuccess: (result) => completeSelectionTask(t("accounts.allTokensRefreshed", result)),
    onError,
  });
  const batchDeleteMutation = useMutation({
    mutationFn: () => deleteAccounts(apiClient, selectedIDs(), provider, linkedDeleteTargets),
    onSuccess: () => {
      onClearSelection();
      onBatchDeleteClose();
      onRefresh();
      toast.success(t("accounts.deleted"));
    },
    onError,
  });

  return {
    batchQuotaResetMutation,
    allQuotaResetMutation,
    batchTokenMutation,
    batchDeleteMutation,
  };
}
