import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AccountProvider } from "@/features/accounts/accounts-api";
import type { EgressNodeDTO, EgressScope } from "@/features/settings";

export type EgressConfigurationTask = "bind" | "unbind";

export function AccountEgressBulkDialog({
  open,
  provider,
  count,
  task,
  nodeID,
  nodes,
  pending,
  onOpenChange,
  onTaskChange,
  onNodeChange,
  onSubmit,
}: {
  open: boolean;
  provider: AccountProvider;
  count: number;
  task: EgressConfigurationTask;
  nodeID: string;
  nodes: EgressNodeDTO[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onTaskChange: (task: EgressConfigurationTask) => void;
  onNodeChange: (nodeID: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const compatibleNodes = nodes.filter(
    (node) =>
      node.enabled && node.proxyConfigured && scopeSupportsAccountProvider(node.scope, provider),
  );
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("accounts.egressConfigurationTitle", { count })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("accounts.egressConfigurationDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Tabs
          value={task}
          onValueChange={(value) => onTaskChange(value as EgressConfigurationTask)}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="bind">{t("accounts.bindEgress")}</TabsTrigger>
            <TabsTrigger value="unbind">{t("accounts.unbindEgress")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {task === "bind" ? (
          <Select value={nodeID} onValueChange={onNodeChange}>
            <SelectTrigger aria-label={t("accounts.bindEgressNode")}>
              <SelectValue placeholder={t("accounts.bindEgressNode")} />
            </SelectTrigger>
            <SelectContent>
              {compatibleNodes.map((node) => (
                <SelectItem key={node.id} value={node.id}>
                  {node.name}
                </SelectItem>
              ))}
              {compatibleNodes.length === 0 ? (
                <SelectItem value="__none" disabled>
                  {t("accounts.bindEgressNoNodes")}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-xs text-muted-foreground">{t("accounts.unbindEgressDescription")}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || (task === "bind" && !nodeID)}
            onClick={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            {pending ? <Spinner /> : null}
            {task === "bind" ? t("accounts.bindEgress") : t("accounts.unbindEgress")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function scopeSupportsAccountProvider(scope: EgressScope, provider: AccountProvider): boolean {
  return scope === provider || (scope === "grok_web" && provider === "grok_console");
}
