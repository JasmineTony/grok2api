import { Activity, Gauge, ShieldCheck, ShieldX, TimerReset } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { QualityGuardStatus } from "@/features/quality-guard/quality-guard-api";
import type { GuardNodesView } from "@/features/quality-guard/use-guard-nodes";
import { cn } from "@/shared/lib/cn";

// 守护总览四指标与「服务不可用」占位：从 quality-guard-page.tsx 拆出。
// available=false（sidecar 未启用或未连接）必须显示为明确的不可用状态，而不是伪装成正常。

export function Metric({
  icon: Icon,
  label,
  value,
  tone,
  testId,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  tone?: "good" | "bad";
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex min-h-24 items-center gap-3 border-b p-4 last:border-b-0 sm:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0"
    >
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

export function GuardOverview({ status, view }: { status: QualityGuardStatus; view: GuardNodesView }) {
  const { t } = useTranslation();
  return (
    <section
      className="grid overflow-hidden rounded-lg bg-card sm:grid-cols-2 xl:grid-cols-4"
      aria-label={t("qualityGuard.overview")}
      data-testid="guard-overview"
    >
      <Metric
        testId="guard-metric-service-status"
        icon={view.fresh ? ShieldCheck : ShieldX}
        label={t("qualityGuard.serviceStatus")}
        value={view.fresh ? t("qualityGuard.running") : t("qualityGuard.stale")}
        tone={view.fresh ? "good" : "bad"}
      />
      <Metric
        testId="guard-metric-mode"
        icon={Activity}
        label={t("qualityGuard.mode")}
        value={t(`qualityGuard.modes.${status.config?.mode ?? "hybrid"}`)}
      />
      <Metric
        testId="guard-metric-nodes"
        icon={Gauge}
        label={t("qualityGuard.availableNodes")}
        value={`${view.enabledNodes ?? "-"} / ${view.totalNodes}`}
      />
      <Metric
        testId="guard-metric-quarantined"
        icon={TimerReset}
        label={t("qualityGuard.quarantinedTargets")}
        value={String(view.quarantined + view.quarantinedLeases)}
        tone={view.quarantined || view.quarantinedLeases ? "bad" : "good"}
      />
    </section>
  );
}

export function UnavailableState() {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-h-72 flex-col items-center justify-center rounded-lg bg-card px-6 text-center"
      data-testid="guard-unavailable"
    >
      <ShieldX className="size-7 text-muted-foreground" />
      <h2 className="mt-4 text-sm font-medium">{t("qualityGuard.unavailable")}</h2>
      <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">{t("qualityGuard.unavailableHelp")}</p>
    </div>
  );
}
