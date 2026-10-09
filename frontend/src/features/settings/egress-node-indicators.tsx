import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EgressErrorTooltip } from "@/features/settings/egress-error-tooltip";
import type { ClearanceMode, EgressIPProbeDTO, EgressNodeDTO } from "@/features/settings/settings-api";
import { cn } from "@/shared/lib/cn";

/** 节点行内的出口状态指示器：清关方式、健康度、IPv4/IPv6 探测结果。 */
export function ClearanceBadge({ node, clearanceMode }: { node: EgressNodeDTO; clearanceMode: ClearanceMode }) {
  const { t } = useTranslation();
  const testId = `egress-node-clearance-${node.id}`;
  if (node.scope === "grok_build")
    return (
      <span className="text-xs text-muted-foreground" data-testid={testId}>
        —
      </span>
    );
  if (clearanceMode === "flaresolverr") {
    return (
      <Badge variant="secondary" className="text-[10px]" data-testid={testId}>
        {node.accountBoundProxy
          ? `${t("settings.web.clearanceFlareSolverr")} · Resin`
          : t("settings.web.clearanceFlareSolverr")}
      </Badge>
    );
  }
  if (clearanceMode === "on_demand") {
    return (
      <Badge variant="secondary" className="text-[10px]" data-testid={testId}>
        {node.accountBoundProxy
          ? `${t("settings.web.clearanceOnDemand")} · Resin`
          : t("settings.web.clearanceOnDemand")}
      </Badge>
    );
  }
  return (
    <Badge
      variant={node.cookieConfigured ? "secondary" : "outline"}
      className={cn("text-[10px]", !node.cookieConfigured && "text-muted-foreground")}
      data-testid={testId}
    >
      {node.cookieConfigured ? t("settings.egress.configured") : t("settings.egress.none")}
    </Badge>
  );
}

export function HealthMeter({ nodeId, value }: { nodeId: string; value: number }) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="mx-auto flex w-20 items-center gap-1.5" data-testid={`egress-node-health-${nodeId}`}>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            percent >= 70 ? "bg-emerald-500" : percent >= 35 ? "bg-amber-500" : "bg-destructive",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">{percent}%</span>
    </div>
  );
}

export function ProbeSummary({ node }: { node: EgressNodeDTO }) {
  return (
    <div className="flex w-full justify-center" data-testid={`egress-node-probe-${node.id}`}>
      <div className="grid w-fit max-w-full grid-cols-[2rem_auto] grid-rows-2 items-center gap-x-2 gap-y-1 py-1 text-left text-xs">
        <ProbeFamilySummary nodeId={node.id} family="IPv4" probe={node.ipv4Probe} row={1} />
        <ProbeFamilySummary nodeId={node.id} family="IPv6" probe={node.ipv6Probe} row={2} />
      </div>
    </div>
  );
}

function ProbeFamilySummary({
  nodeId,
  family,
  probe,
  row,
}: {
  nodeId: string;
  family: "IPv4" | "IPv6";
  probe: EgressIPProbeDTO;
  row: 1 | 2;
}) {
  const { t } = useTranslation();
  const rowClass = row === 1 ? "row-start-1" : "row-start-2";
  const testId = `egress-node-probe-${nodeId}-${family.toLowerCase()}`;
  return (
    <div className="contents">
      <span className={cn("col-start-1 text-[10px] font-medium text-muted-foreground", rowClass)}>{family}</span>
      <span className={cn("col-start-2 flex min-w-0 max-w-[10rem] items-center gap-1.5", rowClass)}>
        {probe.status === "unknown" ? (
          <ProbeState probe={probe} testId={testId} />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="min-w-0 cursor-help">
                <ProbeState probe={probe} testId={testId} />
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("settings.egress.probeLatency", { latency: probe.latencyMs })}</TooltipContent>
          </Tooltip>
        )}
        {probe.status === "unhealthy" && probe.error ? <EgressErrorTooltip message={probe.error} /> : null}
      </span>
    </div>
  );
}

function ProbeState({ probe, testId }: { probe: EgressIPProbeDTO; testId: string }) {
  const { t } = useTranslation();
  const healthy = probe.status === "healthy";
  const unhealthy = probe.status === "unhealthy";
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-testid={testId}>
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          healthy ? "bg-emerald-500" : unhealthy ? "bg-destructive" : "bg-muted-foreground/35",
        )}
      />
      <span
        className={cn(
          "truncate text-[10px]",
          healthy ? "text-foreground" : unhealthy ? "text-destructive" : "text-muted-foreground",
        )}
        title={healthy ? probe.exitIp : undefined}
      >
        {healthy
          ? probe.exitIp || t("settings.egress.healthy")
          : unhealthy
            ? t("settings.egress.unhealthy")
            : t("settings.egress.notTested")}
      </span>
    </span>
  );
}
