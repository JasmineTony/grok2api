import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type EgressConfigurationTask = "bind" | "unbind";

/** 绑定时可选的出口节点视图契约（仅需要展示与选择所需的字段）。 */
export type BindableEgressNode = {
  id: string;
  name: string;
  assignedAccountCount: number;
  accountCapacity: number;
};

type BatchConcurrencyDialogProps = {
  open: boolean;
  selectedCount: number;
  value: string;
  onValueChange: (value: string) => void;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/** 批量设置最大并发：作用于当前选中集合。 */
export function BatchConcurrencyDialog({
  open,
  selectedCount,
  value,
  onValueChange,
  pending,
  onOpenChange,
  onConfirm,
}: BatchConcurrencyDialogProps): ReactNode {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t("accounts.batchConcurrencyTitle", { count: selectedCount })}</DialogTitle>
          <DialogDescription>{t("accounts.batchConcurrencyDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="batch-account-concurrency">{t("accounts.maxConcurrent")}</Label>
          <Input
            id="batch-account-concurrency"
            type="number"
            min="1"
            max="256"
            value={value}
            disabled={pending}
            onChange={(event) => onValueChange(event.target.value)}
          />
        </div>
        <BatchConcurrencyFooter
          value={value}
          pending={pending}
          onClose={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}

function BatchConcurrencyFooter({
  value,
  pending,
  onClose,
  onConfirm,
}: {
  value: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const numeric = Number(value);
  const invalid = !Number.isInteger(numeric) || numeric < 1 || numeric > 256;
  return (
    <DialogFooter>
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onClose}>
        {t("common.cancel")}
      </Button>
      <Button type="button" size="sm" disabled={pending || invalid} onClick={onConfirm}>
        {pending ? <Spinner /> : null}
        {t("common.save")}
      </Button>
    </DialogFooter>
  );
}

type EgressConfigurationBodyProps = {
  selectedCount: number;
  task: EgressConfigurationTask;
  onTaskChange: (value: EgressConfigurationTask) => void;
  nodeId: string;
  onNodeIdChange: (value: string) => void;
  nodes: readonly BindableEgressNode[];
  nodesPending: boolean;
  nodesError: string | null;
  pending: boolean;
  onConfirm: () => void;
};

type EgressConfigurationDialogProps = EgressConfigurationBodyProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** 批量绑定/解绑代理出口：绑定时只列出当前账号池可用的已启用节点。 */
export function EgressConfigurationDialog({ open, onOpenChange, ...body }: EgressConfigurationDialogProps): ReactNode {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (body.pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[460px]">
        <EgressDialogHeader selectedCount={body.selectedCount} />
        <EgressConfigurationBody {...body} />
        <EgressDialogFooter
          task={body.task}
          nodeId={body.nodeId}
          pending={body.pending}
          nodesPending={body.nodesPending}
          nodesError={body.nodesError}
          onClose={() => onOpenChange(false)}
          onConfirm={body.onConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}

function EgressDialogHeader({ selectedCount }: { selectedCount: number }): ReactNode {
  const { t } = useTranslation();
  return (
    <DialogHeader>
      <DialogTitle>{t("accounts.egressConfigurationTitle", { count: selectedCount })}</DialogTitle>
      <DialogDescription>{t("accounts.egressConfigurationDescription")}</DialogDescription>
    </DialogHeader>
  );
}

function EgressConfigurationBody({
  task,
  onTaskChange,
  nodeId,
  onNodeIdChange,
  nodes,
  nodesPending,
  nodesError,
  pending,
}: EgressConfigurationBodyProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <EgressTaskTabs task={task} onTaskChange={onTaskChange} disabled={pending} />
      {task === "bind" ? (
        <EgressNodePicker
          nodes={nodes}
          nodeId={nodeId}
          onNodeIdChange={onNodeIdChange}
          pending={pending}
          queryPending={nodesPending}
          queryError={nodesError}
        />
      ) : (
        <p className="min-h-20 text-xs leading-5 text-muted-foreground">{t("accounts.unbindEgressDescription")}</p>
      )}
    </div>
  );
}

function EgressTaskTabs({
  task,
  onTaskChange,
  disabled,
}: {
  task: EgressConfigurationTask;
  onTaskChange: (value: EgressConfigurationTask) => void;
  disabled: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <Tabs value={task} onValueChange={(value) => onTaskChange(value as EgressConfigurationTask)}>
      <TabsList className="grid h-10 w-full grid-cols-2 p-1">
        <TabsTrigger value="bind" className="h-8 font-normal" disabled={disabled}>
          {t("accounts.bindEgress")}
        </TabsTrigger>
        <TabsTrigger value="unbind" className="h-8 font-normal" disabled={disabled}>
          {t("accounts.unbindEgress")}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function EgressNodePicker({
  nodes,
  nodeId,
  onNodeIdChange,
  pending,
  queryPending,
  queryError,
}: {
  nodes: readonly BindableEgressNode[];
  nodeId: string;
  onNodeIdChange: (value: string) => void;
  pending: boolean;
  queryPending: boolean;
  queryError: string | null;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="min-h-20">
      {queryPending ? (
        <div className="flex min-h-20 items-center justify-center">
          <Spinner />
        </div>
      ) : null}
      {queryError ? <p className="text-sm text-destructive">{queryError}</p> : null}
      {!queryPending && !queryError ? (
        nodes.length > 0 ? (
          <div className="space-y-2">
            <Label htmlFor="account-egress-node">{t("accounts.bindEgressNode")}</Label>
            <Select value={nodeId} onValueChange={onNodeIdChange} disabled={pending}>
              <SelectTrigger id="account-egress-node">
                <SelectValue placeholder={t("accounts.bindEgressEmpty")} />
              </SelectTrigger>
              <SelectContent>
                {nodes.map((node) => (
                  <SelectItem key={node.id} value={node.id}>
                    {node.name} ({node.assignedAccountCount}
                    {node.accountCapacity > 0 ? ` / ${node.accountCapacity}` : ` / ${t("settings.egress.unlimited")}`})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">{t("accounts.bindEgressNoNodes")}</p>
        )
      ) : null}
    </div>
  );
}

function EgressDialogFooter({
  task,
  nodeId,
  pending,
  nodesPending,
  nodesError,
  onClose,
  onConfirm,
}: {
  task: EgressConfigurationTask;
  nodeId: string;
  pending: boolean;
  nodesPending: boolean;
  nodesError: string | null;
  onClose: () => void;
  onConfirm: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const bindBlocked = task === "bind" && (!nodeId || nodesPending || Boolean(nodesError));
  return (
    <DialogFooter>
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onClose}>
        {t("common.cancel")}
      </Button>
      <Button type="button" size="sm" disabled={pending || bindBlocked} onClick={onConfirm}>
        {pending ? <Spinner /> : null}
        {t("accountQuotaTask.execute")}
      </Button>
    </DialogFooter>
  );
}
