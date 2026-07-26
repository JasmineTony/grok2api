import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { EgressConfigurationTask } from "@/features/accounts/account-egress-bulk-dialog";
import type { AccountProvider } from "@/features/accounts/accounts-api";
import { assignEgressAccounts, listEgressNodes, unassignEgressAccounts } from "@/features/settings";
import { useApiClient } from "@/shared/api/use-api-client";

export function useAccountEgressBinding({
  provider,
  selected,
  onSuccess,
}: {
  provider: AccountProvider;
  selected: Set<string>;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState<EgressConfigurationTask>("bind");
  const [nodeID, setNodeID] = useState("");
  const nodesQuery = useQuery({
    queryKey: ["egress-nodes", "account-binding"],
    queryFn: () => listEgressNodes(apiClient),
    enabled: open && task === "bind",
  });
  const complete = (message: string) => {
    onSuccess();
    setOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
    toast.success(message);
  };
  const bindMutation = useMutation({
    mutationFn: () => {
      if (!nodeID) throw new Error(t("accounts.bindEgressEmpty"));
      return assignEgressAccounts(apiClient, nodeID, provider, [...selected]);
    },
    onSuccess: () => complete(t("accounts.egressBound")),
    onError: (error) => toast.error(error instanceof Error ? error.message : t("errors.generic")),
  });
  const unbindMutation = useMutation({
    mutationFn: () => unassignEgressAccounts(apiClient, provider, [...selected]),
    onSuccess: () => complete(t("accounts.egressUnbound")),
    onError: (error) => toast.error(error instanceof Error ? error.message : t("errors.generic")),
  });

  return {
    open,
    setOpen,
    task,
    setTask,
    nodeID,
    setNodeID,
    nodesQuery,
    bindMutation,
    unbindMutation,
    pending: bindMutation.isPending || unbindMutation.isPending,
  };
}
