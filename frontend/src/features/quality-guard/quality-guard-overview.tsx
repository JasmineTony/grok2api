import { type UseMutationResult } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  Coins,
  Eye,
  type LucideIcon,
  MoreHorizontal,
  Pencil,
  Power,
  PowerOff,
  RotateCw,
  Shield,
  ShieldX,
  Trash2,
} from "lucide-react";
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
import { TableCell, TableRow } from "@/components/ui/table";
import {
  type QualityGuardEvent,
  type QualityGuardNodeState,
  type QualityGuardStatistics,
  type QualityGuardStatus,
  type QualityTestResult,
} from "@/features/quality-guard/quality-guard-api";
import { formatCount, formatTime, formatTPS } from "@/features/quality-guard/quality-guard-utils";
import { type EgressNodeDTO } from "@/features/settings";
import { cn } from "@/shared/lib/cn";

export function StatisticsPanel({
  statistics,
  locale,
}: {
  statistics: QualityGuardStatistics;
  locale: string;
}) {
  const { t } = useTranslation();
  const anomalies =
    statistics.active.soft +
    statistics.active.hard +
    statistics.passive.soft +
    statistics.passive.hard;
  const checks = statistics.active.total + statistics.passive.total;
  const items = [
    {
      icon: BarChart3,
      label: t("qualityGuard.statisticsChecks"),
      value: formatCount(checks, locale),
      detail: t("qualityGuard.statisticsChecksHelp"),
    },
    {
      icon: Bot,
      label: t("qualityGuard.statisticsActive"),
      value: formatCount(statistics.active.total, locale),
      detail: t("qualityGuard.statisticsActiveDetail", {
        healthy: formatCount(statistics.active.healthy, locale),
        errors: formatCount(statistics.active.errors, locale),
      }),
    },
    {
      icon: Eye,
      label: t("qualityGuard.statisticsPassive"),
      value: formatCount(statistics.passive.total, locale),
      detail: t("qualityGuard.statisticsPassiveDetail", {
        healthy: formatCount(statistics.passive.healthy, locale),
      }),
    },
    {
      icon: Coins,
      label: t("qualityGuard.statisticsTokens"),
      value: formatCount(statistics.active.output_tokens, locale),
      detail: t("qualityGuard.statisticsTokensHelp"),
    },
    {
      icon: AlertTriangle,
      label: t("qualityGuard.statisticsAnomalies"),
      value: formatCount(anomalies, locale),
      detail: t("qualityGuard.statisticsAnomalyDetail", {
        soft: formatCount(statistics.active.soft + statistics.passive.soft, locale),
        hard: formatCount(statistics.active.hard + statistics.passive.hard, locale),
      }),
    },
    {
      icon: Shield,
      label: t("qualityGuard.statisticsQuarantines"),
      value: formatCount(statistics.actions.quarantined, locale),
      detail: t("qualityGuard.statisticsActionDetail", {
        restored: formatCount(statistics.actions.restored, locale),
        suppressed: formatCount(statistics.actions.suppressed, locale),
      }),
    },
  ];
  return (
    <section
      className="overflow-hidden rounded-lg bg-card"
      aria-labelledby="guard-statistics-title"
    >
      <div className="px-4 py-4 sm:px-5">
        <h2 id="guard-statistics-title" className="text-sm font-medium">
          {t("qualityGuard.statistics")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("qualityGuard.statisticsSince", { time: formatTime(statistics.started_at, locale) })}
        </p>
      </div>
      <div className="grid border-t sm:grid-cols-2 xl:grid-cols-3">
        {items.map(({ icon: Icon, label, value, detail }) => (
          <div
            key={label}
            className="flex min-h-24 gap-3 border-b p-4 last:border-b-0 sm:[&:nth-child(odd)]:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-r xl:[&:nth-child(3n)]:border-r-0 xl:[&:nth-last-child(-n+3)]:border-b-0"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-medium tabular-nums">{value}</p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground" title={detail}>
                {detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="flex min-h-24 items-center gap-3 border-b p-4 last:border-b-0 sm:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
          tone === "bad" && "text-destructive",
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 truncate text-lg font-medium tabular-nums">{value}</p>
      </div>
    </div>
  );
}

export function NodeRow({
  node,
  protectedNode,
  selected,
  onSelect,
  state,
  locale,
  status,
  testMutation,
  toggleMutation,
  onEdit,
  onDelete,
}: {
  node: EgressNodeDTO;
  protectedNode: boolean;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  state?: QualityGuardNodeState;
  locale: string;
  status: QualityGuardStatus;
  testMutation: UseMutationResult<
    QualityTestResult,
    Error,
    { nodeId: string; status: QualityGuardStatus }
  >;
  toggleMutation: UseMutationResult<
    { updated: number },
    Error,
    { node: EgressNodeDTO; enabled: boolean }
  >;
  onEdit: (node: EgressNodeDTO) => void;
  onDelete: (node: EgressNodeDTO) => void;
}) {
  const { t } = useTranslation();
  const testing = testMutation.isPending && testMutation.variables?.nodeId === node.id;
  const toggling = toggleMutation.isPending && toggleMutation.variables?.node.id === node.id;
  const classification = state?.last_classification || "unknown";
  return (
    <TableRow>
      <TableCell className="px-3">
        <Checkbox
          checked={selected}
          disabled={protectedNode}
          onCheckedChange={(checked) => onSelect(checked === true)}
          aria-label={t("common.selectItem", { name: node.name })}
        />
      </TableCell>
      <TableCell>
        <div className="font-medium">{node.name}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">ID {node.id}</div>
      </TableCell>
      <TableCell>
        <StateBadge node={node} state={state} protectedNode={protectedNode} />
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums">
        <span className="font-medium">{node.assignedAccountCount}</span>
        {node.accountCapacity > 0 ? (
          <span className="text-muted-foreground"> / {node.accountCapacity}</span>
        ) : null}
      </TableCell>
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
      <TableCell className="text-xs tabular-nums">
        {state
          ? `${state.passive_soft_strikes} / ${state.active_soft_strikes} / ${state.error_strikes}`
          : "-"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatTime(state?.last_observed_at, locale)}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Switch
            checked={node.enabled}
            disabled={toggling || protectedNode}
            onCheckedChange={(enabled) => toggleMutation.mutate({ node, enabled })}
            aria-label={t(node.enabled ? "qualityGuard.disableNode" : "qualityGuard.enableNode", {
              name: node.name,
            })}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={testing || !status.config || (!node.enabled && !state?.disabled_by_guard)}
            onClick={() => testMutation.mutate({ nodeId: node.id, status })}
          >
            <RotateCw className={cn(testing && "animate-spin")} />
            {t("qualityGuard.test")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("common.actions")}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(node)}>
                <Pencil />
                {t("common.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={toggling || protectedNode}
                onClick={() => toggleMutation.mutate({ node, enabled: !node.enabled })}
              >
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
        </div>
      </TableCell>
    </TableRow>
  );
}

function StateBadge({
  node,
  state,
  protectedNode,
}: {
  node: EgressNodeDTO;
  state: QualityGuardNodeState | undefined;
  protectedNode: boolean;
}) {
  const { t } = useTranslation();
  if (state?.disabled_by_guard)
    return <Badge variant="destructive">{t("qualityGuard.quarantined")}</Badge>;
  if (protectedNode) return <Badge variant="secondary">{t("qualityGuard.fixedFallback")}</Badge>;
  if (!node.enabled) return <Badge variant="secondary">{t("common.disabled")}</Badge>;
  if (state?.error_strikes)
    return (
      <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
        {t("qualityGuard.probeFailed")}
      </Badge>
    );
  if (state?.last_classification === "hard" || state?.last_classification === "soft")
    return (
      <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
        {t("qualityGuard.suspect")}
      </Badge>
    );
  if (state?.last_classification === "healthy")
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
      >
        {t("qualityGuard.healthy")}
      </Badge>
    );
  return <Badge variant="secondary">{t("qualityGuard.pending")}</Badge>;
}

export function EventList({ events, locale }: { events: QualityGuardEvent[]; locale: string }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-lg bg-card p-4 sm:p-5" aria-labelledby="guard-events-title">
      <h2 id="guard-events-title" className="text-sm font-medium">
        {t("qualityGuard.events")}
      </h2>
      {events.length === 0 ? (
        <p className="mt-8 text-center text-xs text-muted-foreground">
          {t("qualityGuard.noEvents")}
        </p>
      ) : (
        <div className="mt-3 space-y-1">
          {[...events]
            .reverse()
            .slice(0, 10)
            .map((event, index) => (
              <div
                key={`${event.ts}-${index}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-md px-2 py-2 hover:bg-secondary/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {event.node_name || `ID ${event.node_id}`} ·{" "}
                    {t(`qualityGuard.eventTypes.${event.event}`)}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    {t(`qualityGuard.reasons.${event.reason || "unknown"}`)}
                    {event.output_tps ? ` · ${formatTPS(event.output_tps)}` : ""}
                  </p>
                </div>
                <time className="text-[11px] text-muted-foreground">
                  {formatTime(event.ts, locale)}
                </time>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

export function UnavailableState() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-lg bg-card px-6 text-center">
      <ShieldX className="size-7 text-muted-foreground" />
      <h2 className="mt-4 text-sm font-medium">{t("qualityGuard.unavailable")}</h2>
      <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">
        {t("qualityGuard.unavailableHelp")}
      </p>
    </div>
  );
}
