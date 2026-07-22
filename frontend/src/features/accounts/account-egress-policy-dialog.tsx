import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  type AccountDTO,
  type AccountEgressPolicyDTO,
  type AccountEgressPolicyStrategy,
  getAccountEgressPolicy,
  updateAccountEgressPolicy,
} from "@/features/accounts/accounts-api";
import { type EgressNodeDTO, listEgressNodes } from "@/features/settings";
import { useApiClient } from "@/shared/api/use-api-client";
import { ErrorState, LoadingState } from "@/shared/components/data-state";

export function AccountEgressPolicyDialog({
  account,
  onOpenChange,
}: {
  account: AccountDTO | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const apiClient = useApiClient();
  const policyQuery = useQuery({
    queryKey: ["accounts", account?.id, "egress-policy"],
    queryFn: () => getAccountEgressPolicy(apiClient, account?.id ?? ""),
    enabled: Boolean(account),
  });
  const nodesQuery = useQuery({
    queryKey: ["egress-nodes", "account-policy"],
    queryFn: () => listEgressNodes(apiClient),
    enabled: Boolean(account),
  });
  const availableNodes = useMemo(
    () => filterNodes(account, nodesQuery.data?.items ?? []),
    [account, nodesQuery.data?.items],
  );
  const pending = policyQuery.isPending || nodesQuery.isPending;
  const error = policyQuery.error ?? nodesQuery.error;

  return (
    <Dialog open={Boolean(account)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("accounts.egressPolicyTitle")}</DialogTitle>
          <DialogDescription>
            {account ? t("accounts.egressPolicyDescription", { name: account.name }) : ""}
          </DialogDescription>
        </DialogHeader>
        {pending ? <LoadingState className="min-h-36" /> : null}
        {error ? (
          <ErrorState
            message={error.message}
            onRetry={() => {
              void policyQuery.refetch();
              void nodesQuery.refetch();
            }}
          />
        ) : null}
        {account && policyQuery.data && !pending && !error ? (
          <PolicyEditor
            key={`${account.id}:${policyQuery.data.updatedAt ?? policyQuery.data.strategy}`}
            account={account}
            policy={policyQuery.data}
            availableNodes={availableNodes}
            apiClient={apiClient}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PolicyEditor({
  apiClient,
  account,
  policy,
  availableNodes,
  onClose,
}: {
  apiClient: import("@/shared/api/client").ApiClient;
  account: AccountDTO;
  policy: AccountEgressPolicyDTO;
  availableNodes: EgressNodeDTO[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [strategy, setStrategy] = useState<AccountEgressPolicyStrategy>(policy.strategy);
  const [egressNodeId, setEgressNodeId] = useState(policy.egressNodeId ?? "");
  const [allowDirectFallback, setAllowDirectFallback] = useState(policy.allowDirectFallback);
  const mutation = useMutation({
    mutationFn: () =>
      updateAccountEgressPolicy(apiClient, account.id, {
        strategy,
        ...(strategy === "node" ? { egressNodeId } : {}),
        allowDirectFallback: strategy === "node" && allowDirectFallback,
      }),
    onSuccess: (value) => {
      queryClient.setQueryData(["accounts", account.id, "egress-policy"], value);
      toast.success(t("accounts.egressPolicySaved"));
      onClose();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("errors.generic")),
  });

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="account-egress-strategy">{t("accounts.egressPolicyStrategy")}</Label>
          <Select
            value={strategy}
            onValueChange={(value) => setStrategy(value as AccountEgressPolicyStrategy)}
          >
            <SelectTrigger id="account-egress-strategy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">{t("accounts.egressPolicyInherit")}</SelectItem>
              <SelectItem value="node">{t("accounts.egressPolicyNode")}</SelectItem>
              <SelectItem value="direct">{t("accounts.egressPolicyDirect")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {strategy === "node" ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="account-egress-node">{t("accounts.egressPolicyNodeLabel")}</Label>
              <Select value={egressNodeId} onValueChange={setEgressNodeId}>
                <SelectTrigger id="account-egress-node">
                  <SelectValue placeholder={t("accounts.egressPolicyNodePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {availableNodes.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.name} · {node.scope}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableNodes.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("accounts.egressPolicyNoNodes")}</p>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">{t("accounts.egressPolicyFallback")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("accounts.egressPolicyFallbackHelp")}
                </p>
              </div>
              <Switch checked={allowDirectFallback} onCheckedChange={setAllowDirectFallback} />
            </div>
          </>
        ) : null}
        {strategy === "direct" ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-muted-foreground">
            {t("accounts.egressPolicyDirectHelp")}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          disabled={mutation.isPending || (strategy === "node" && !egressNodeId)}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? <Spinner /> : null}
          {t("common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}

function filterNodes(account: AccountDTO | null, nodes: EgressNodeDTO[]): EgressNodeDTO[] {
  if (!account) return [];
  return nodes.filter((node) => {
    if (account.provider === "grok_build") return node.scope === "grok_build";
    if (account.provider === "grok_web") return node.scope === "grok_web";
    return node.scope === "grok_console" || node.scope === "grok_web";
  });
}
