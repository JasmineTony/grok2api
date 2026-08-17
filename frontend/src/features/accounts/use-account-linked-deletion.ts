import { useMutation, useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useState } from "react";
import { toast } from "sonner";

import { accountQueryKeys } from "@/features/accounts/account-query-keys";
import {
  type AccountCleanupStatus,
  type AccountDTO,
  type AccountProvider,
  cleanupAccounts,
  deleteAccount,
  previewAccountDeletion,
  previewCleanup,
} from "@/features/accounts/accounts-api";
import type { ApiClient } from "@/shared/api/client";

export function useAccountLinkedDeletion({
  apiClient,
  provider,
  selected,
  batchDeleteOpen,
  cleanupOpen,
  cleanupStatuses,
  setCleanupOpen,
  setCleanupStatuses,
  invalidateAccountData,
  onError,
  t,
}: {
  apiClient: ApiClient;
  provider: AccountProvider;
  selected: Set<string>;
  batchDeleteOpen: boolean;
  cleanupOpen: boolean;
  cleanupStatuses: Set<AccountCleanupStatus>;
  setCleanupOpen: (open: boolean) => void;
  setCleanupStatuses: (statuses: Set<AccountCleanupStatus>) => void;
  invalidateAccountData: () => void;
  onError: (error: unknown) => void;
  t: TFunction;
}) {
  const [deleting, setDeleting] = useState<AccountDTO | null>(null);
  const [linkedDeleteTargets, setLinkedDeleteTargets] = useState<AccountProvider[]>([]);
  const [cleanupLinkedTargets, setCleanupLinkedTargets] = useState<AccountProvider[]>([]);
  const selectedIDs = [...selected].sort();

  const deletionPreviewQuery = useQuery({
    queryKey: accountQueryKeys.deletionPreview(
      provider,
      deleting?.id ?? selectedIDs.join(","),
      linkedDeleteTargets.join(","),
    ),
    queryFn: () =>
      previewAccountDeletion(
        apiClient,
        deleting ? [deleting.id] : selectedIDs,
        provider,
        linkedDeleteTargets,
      ),
    enabled:
      (Boolean(deleting) || batchDeleteOpen) &&
      linkedDeleteTargets.length > 0 &&
      (Boolean(deleting) || selectedIDs.length > 0),
  });

  const cleanupPreviewQuery = useQuery({
    queryKey: accountQueryKeys.cleanupPreview(
      provider,
      [...cleanupStatuses].sort().join(","),
      cleanupLinkedTargets.join(","),
    ),
    queryFn: () => previewCleanup(apiClient, provider, [...cleanupStatuses], cleanupLinkedTargets),
    enabled: cleanupOpen && cleanupStatuses.size > 0,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      deleteAccount(
        apiClient,
        id,
        linkedDeleteTargets.length > 0 ? { provider, linkedDeleteTargets } : undefined,
      ),
    onSuccess: () => {
      invalidateAccountData();
      setDeleting(null);
      setLinkedDeleteTargets([]);
      toast.success(t("accounts.deleted"));
    },
    onError,
  });

  const cleanupMutation = useMutation({
    mutationFn: () =>
      cleanupAccounts(apiClient, provider, [...cleanupStatuses], cleanupLinkedTargets),
    onSuccess: (result) => {
      setCleanupOpen(false);
      setCleanupStatuses(new Set());
      setCleanupLinkedTargets([]);
      invalidateAccountData();
      toast.success(t("accounts.cleanupCompleted", result));
    },
    onError,
  });

  const resetLinkedDeletion = () => {
    setLinkedDeleteTargets([]);
    setCleanupLinkedTargets([]);
  };

  return {
    deleting,
    setDeleting,
    linkedDeleteTargets,
    setLinkedDeleteTargets,
    cleanupLinkedTargets,
    setCleanupLinkedTargets,
    deletionPreviewQuery,
    cleanupPreviewQuery,
    deleteMutation,
    cleanupMutation,
    resetLinkedDeletion,
  };
}
