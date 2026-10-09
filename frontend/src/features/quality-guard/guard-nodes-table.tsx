import type { TFunction } from "i18next";
import { MoreHorizontal, Pencil, Power, PowerOff, RotateCw, Trash2 } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTPS, formatTime } from "@/features/quality-guard/guard-format";
import type { QualityGuardNodeState } from "@/features/quality-guard/quality-guard-api";
import type { GuardNodesController } from "@/features/quality-guard/use-guard-nodes";
import type { EgressNodeDTO } from "@/features/settings/settings-api";
import { TableLoadingRow } from "@/shared/components/data-state";
import { cn } from "@/shared/lib/cn";

// 节点质量表格：从 quality-guard-page.tsx 拆出。列顺序、状态徽标判定顺序与行操作菜单保持不变。

const AMBER_BADGE = "border-amber-500/40 text-amber-700 dark:text-amber-400";
const SKY_BADGE = "border-sky-500/40 text-sky-700 dark:text-sky-400";
const EMERALD_BADGE = "border-emerald-500/40 text-emerald-700 dark:text-emerald-400";

type NodeBadgeSpec = {
  tone: "destructive" | "secondary" | "outline";
  label: string;
  className?: string;
  title?: string;
};

// 判定顺序与拆分前一致：隔离 > 受保护 > 停用 > 租约 > 观测态 > 探测失败 > 分类 > 待观察。
function nodeStateBadgeSpec(
  node: EgressNodeDTO,
  state: QualityGuardNodeState | undefined,
  protectedNode: boolean,
  t: TFunction,
): NodeBadgeSpec {
  if (state?.disabled_by_guard) return { tone: "destructive", label: t("qualityGuard.quarantined") };
  if (protectedNode) return { tone: "secondary", label: t("qualityGuard.fixedFallback") };
  if (!node.enabled) return { tone: "secondary", label: t("common.disabled") };
  if (state?.quarantined_lease_count)
    return {
      tone: "outline",
      className: AMBER_BADGE,
      title: t("qualityGuard.leaseScopedHelp"),
      label: t("qualityGuard.leaseQuarantined", { count: state.quarantined_lease_count }),
    };
  if (state?.observe_only)
    return {
      tone: "outline",
      className: SKY_BADGE,
      title: t("qualityGuard.leaseScopedObserveOnlyHelp"),
      label: t("qualityGuard.leaseScopedObserveOnly"),
    };
  if (node.accountBoundProxy)
    return {
      tone: "outline",
      className: SKY_BADGE,
      title: t("qualityGuard.leaseScopedHelp"),
      label: t("qualityGuard.leaseScoped"),
    };
  if (state?.error_strikes) return { tone: "outline", className: AMBER_BADGE, label: t("qualityGuard.probeFailed") };
  if (state?.last_classification === "hard" || state?.last_classification === "soft")
    return { tone: "outline", className: AMBER_BADGE, label: t("qualityGuard.suspect") };
  if (state?.last_classification === "healthy")
    return { tone: "outline", className: EMERALD_BADGE, label: t("qualityGuard.healthy") };
  return { tone: "secondary", label: t("qualityGuard.pending") };
}

function StateBadge({
  node,
  state,
  protectedNode,
}: {
  node: EgressNodeDTO;
  state?: QualityGuardNodeState;
  protectedNode: boolean;
}) {
  const { t } = useTranslation();
  const spec = nodeStateBadgeSpec(node, state, protectedNode, t);
  return (
    <Badge
      variant={spec.tone}
      className={spec.className}
      title={spec.title}
      data-testid={`guard-node-state-${node.id}`}
    >
      {spec.label}
    </Badge>
  );
}

type NodeActionProps = {
  node: EgressNodeDTO;
  state?: QualityGuardNodeState;
  protectedNode: boolean;
  testEnabled: boolean;
  testing: boolean;
  toggling: boolean;
  onTest: (nodeId: string) => void;
  onToggle: (node: EgressNodeDTO, enabled: boolean) => void;
  onEdit: (node: EgressNodeDTO) => void;
  onDelete: (node: EgressNodeDTO) => void;
};

function NodeSelectCell({
  node,
  selected,
  protectedNode,
  onSelect,
}: {
  node: EgressNodeDTO;
  selected: boolean;
  protectedNode: boolean;
  onSelect: (nodeId: string, checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <TableCell className="px-3">
      <Checkbox
        checked={selected}
        disabled={protectedNode}
        onCheckedChange={(checked) => onSelect(node.id, checked === true)}
        aria-label={t("common.selectItem", { name: node.name })}
      />
    </TableCell>
  );
}

function NodeSpeedCells({ state }: { state?: QualityGuardNodeState }) {
  const { t } = useTranslation();
  const classification = state?.last_classification || "unknown";
  return (
    <>
      <TableCell
        className={cn(
          "text-right font-mono text-xs tabular-nums",
          classification === "hard" && "font-medium text-destructive",
          classification === "soft" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {state?.last_observed_at ? formatTPS(state.last_output_tps) : "-"}
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {state?.last_first_token_ms ? `${state.last_first_token_ms} ms` : "-"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {state?.last_source ? t(`qualityGuard.sources.${state.last_source}`) : "-"}
      </TableCell>
    </>
  );
}

function NodeRowMenu({ node, protectedNode, toggling, onToggle, onEdit, onDelete }: NodeActionProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t("common.actions")}
          data-testid={`guard-node-menu-${node.id}`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onEdit(node)}>
          <Pencil />
          {t("common.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={toggling || protectedNode} onClick={() => onToggle(node, !node.enabled)}>
          {node.enabled ? <PowerOff /> : <Power />}
          {t(node.enabled ? "common.disable" : "common.enable")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={protectedNode}
          className="text-destructive focus:text-destructive"
          onClick={() => onDelete(node)}
        >
          <Trash2 />
          {t("common.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NodeToggleAndTest({
  node,
  state,
  protectedNode,
  testEnabled,
  testing,
  toggling,
  onTest,
  onToggle,
}: NodeActionProps) {
  const { t } = useTranslation();
  return (
    <>
      <Switch
        checked={node.enabled}
        disabled={toggling || protectedNode}
        onCheckedChange={(enabled) => onToggle(node, enabled)}
        aria-label={t(node.enabled ? "qualityGuard.disableNode" : "qualityGuard.enableNode", { name: node.name })}
        data-testid={`guard-node-toggle-${node.id}`}
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={testing || !testEnabled || (!node.enabled && !state?.disabled_by_guard)}
        onClick={() => onTest(node.id)}
        data-testid={`guard-node-test-${node.id}`}
      >
        <RotateCw className={cn(testing && "animate-spin")} />
        {t("qualityGuard.test")}
      </Button>
    </>
  );
}

function NodeActionsCell(props: NodeActionProps) {
  return (
    <TableCell className="text-right">
      <div className="flex items-center justify-end gap-1">
        <NodeToggleAndTest {...props} />
        <NodeRowMenu {...props} />
      </div>
    </TableCell>
  );
}

type NodeRowProps = {
  node: EgressNodeDTO;
  protectedNode: boolean;
  selected: boolean;
  onSelect: (nodeId: string, checked: boolean) => void;
  state?: QualityGuardNodeState;
  locale: string;
  testEnabled: boolean;
  testing: boolean;
  toggling: boolean;
  onTest: (nodeId: string) => void;
  onToggle: (node: EgressNodeDTO, enabled: boolean) => void;
  onEdit: (node: EgressNodeDTO) => void;
  onDelete: (node: EgressNodeDTO) => void;
};

const NodeRow = memo(function NodeRow(props: NodeRowProps) {
  const { node, protectedNode, selected, onSelect, state, locale } = props;
  return (
    <TableRow data-testid={`guard-node-row-${node.id}`}>
      <NodeSelectCell node={node} selected={selected} protectedNode={protectedNode} onSelect={onSelect} />
      <TableCell>
        <div className="font-medium">{node.name}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">ID {node.id}</div>
      </TableCell>
      <TableCell>
        <StateBadge node={node} state={state} protectedNode={protectedNode} />
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums">
        <span className="font-medium">{node.assignedAccountCount}</span>
        {node.accountCapacity > 0 ? <span className="text-muted-foreground"> / {node.accountCapacity}</span> : null}
      </TableCell>
      <NodeSpeedCells state={state} />
      <TableCell className="text-xs tabular-nums">
        {state ? `${state.passive_soft_strikes} / ${state.active_soft_strikes} / ${state.error_strikes}` : "-"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{formatTime(state?.last_observed_at, locale)}</TableCell>
      <NodeActionsCell {...props} />
    </TableRow>
  );
});

function NodeTableHeader({
  allSelected,
  someSelected,
  selectable,
  onToggleAll,
}: {
  allSelected: boolean;
  someSelected: boolean;
  selectable: boolean;
  onToggleAll: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow>
        <TableHead className="w-10 px-3">
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            disabled={!selectable}
            onCheckedChange={(checked) => onToggleAll(checked === true)}
            aria-label={t("common.selectPage")}
            data-testid="guard-select-page"
          />
        </TableHead>
        <TableHead>{t("qualityGuard.node")}</TableHead>
        <TableHead>{t("qualityGuard.state")}</TableHead>
        <TableHead className="text-right">{t("settings.egress.accounts")}</TableHead>
        <TableHead className="text-right">{t("qualityGuard.outputTPS")}</TableHead>
        <TableHead className="text-right">{t("qualityGuard.firstToken")}</TableHead>
        <TableHead>{t("qualityGuard.source")}</TableHead>
        <TableHead>{t("qualityGuard.strikes")}</TableHead>
        <TableHead>{t("qualityGuard.lastObserved")}</TableHead>
        <TableHead className="w-48 text-right">{t("common.actions")}</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function NodeTableBody({ controller }: { controller: GuardNodesController }) {
  const { t, i18n } = useTranslation();
  const { view, filters, actions, selection } = controller;
  return (
    <TableBody>
      {view.nodes.map((node) => (
        <NodeRow
          key={node.id}
          node={node}
          protectedNode={view.protectedNodeIDs.has(node.id)}
          selected={selection.selectedNodeIDs.has(node.id)}
          onSelect={selection.toggleSelectedNode}
          state={actions.manualResults[node.id] ?? view.guardedNodes[node.id]}
          locale={i18n.language}
          testEnabled={Boolean(view.status?.config)}
          testing={actions.testingNodeID === node.id}
          toggling={actions.togglingNodeID === node.id}
          onTest={actions.testNode}
          onToggle={actions.toggleNode}
          onEdit={controller.dialogs.beginEdit}
          onDelete={(node) => controller.dialogs.beginDelete([node])}
        />
      ))}
      {view.nodes.length === 0 ? (
        <TableRow>
          <TableCell
            colSpan={10}
            className="h-24 text-center text-xs text-muted-foreground"
            data-testid="guard-nodes-empty"
          >
            {filters.hasNodeFilters ? t("settings.egress.noMatches") : t("common.noData")}
          </TableCell>
        </TableRow>
      ) : null}
    </TableBody>
  );
}

export function GuardNodesTable({ controller }: { controller: GuardNodesController }) {
  const { view, nodesQuery, selection } = controller;
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[1040px]" data-testid="guard-nodes-table">
        <NodeTableHeader
          allSelected={view.allNodesSelected}
          someSelected={view.selectedNodes.length > 0}
          selectable={view.selectableNodes.length > 0}
          onToggleAll={selection.toggleAllNodes}
        />
        {nodesQuery.isPending ? (
          <TableBody>
            <TableLoadingRow colSpan={10} />
          </TableBody>
        ) : (
          <NodeTableBody controller={controller} />
        )}
      </Table>
    </div>
  );
}
