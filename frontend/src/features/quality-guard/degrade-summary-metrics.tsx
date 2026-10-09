import { AlertTriangle, Gauge, PowerOff, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { DegradeSummaryDTO } from "@/features/quality-guard/quality-guard-api";
import { cn } from "@/shared/lib/cn";

// 降级账号总览四指标：从 degrade-accounts-panel.tsx 拆出，指标口径与色调判定保持不变。

function DegradeMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
  testId,
}: {
  icon: typeof AlertTriangle;
  label: string;
  value: string;
  detail: string;
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
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export function DegradeSummaryMetrics({ summary }: { summary: DegradeSummaryDTO }) {
  const { t } = useTranslation();
  return (
    <section
      className="grid overflow-hidden rounded-lg bg-card sm:grid-cols-2 xl:grid-cols-4"
      aria-label={t("qualityGuard.degrade.overview")}
      data-testid="degrade-overview"
    >
      <DegradeMetric
        testId="degrade-metric-hits"
        icon={AlertTriangle}
        label={t("qualityGuard.degrade.hits")}
        value={String(summary.totals.hits)}
        detail={t("qualityGuard.degrade.hitsHelp", {
          burst: summary.totals.burst,
          soft: summary.totals.soft,
          hard: summary.totals.hard,
          thinking: summary.totals.thinking,
        })}
        tone={summary.totals.hits ? "bad" : "good"}
      />
      <DegradeMetric
        testId="degrade-metric-accounts"
        icon={Users}
        label={t("qualityGuard.degrade.accounts")}
        value={String(summary.totals.accounts)}
        detail={t("qualityGuard.degrade.accountsHelp", { deleted: summary.totals.deleted })}
      />
      <DegradeMetric
        testId="degrade-metric-still-enabled"
        icon={PowerOff}
        label={t("qualityGuard.degrade.stillEnabled")}
        value={String(summary.totals.stillEnabled)}
        detail={t("qualityGuard.degrade.stillEnabledHelp")}
        tone={summary.totals.stillEnabled ? "bad" : "good"}
      />
      <DegradeMetric
        testId="degrade-metric-max-tps"
        icon={Gauge}
        label={t("qualityGuard.degrade.maxTPS")}
        value={Math.round(summary.totals.maxTPS).toString()}
        detail={t("qualityGuard.degrade.maxTPSHelp")}
        tone={summary.totals.maxTPS >= summary.thresholds.hardTPS ? "bad" : undefined}
      />
    </section>
  );
}
