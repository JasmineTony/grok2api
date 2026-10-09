import type { TFunction } from "i18next";
import { AlertTriangle, BarChart3, Bot, Coins, Eye, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatCount, formatTime } from "@/features/quality-guard/guard-format";
import type { QualityGuardStatistics } from "@/features/quality-guard/quality-guard-api";

// 自动检测统计：从 quality-guard-page.tsx 拆出。条目构造按「检测量 / 异常与动作」分组，渲染单独成组件。

type StatisticItem = { icon: typeof BarChart3; label: string; value: string; detail: string };

function volumeStatisticItems(statistics: QualityGuardStatistics, locale: string, t: TFunction): StatisticItem[] {
  return [
    {
      icon: BarChart3,
      label: t("qualityGuard.statisticsChecks"),
      value: formatCount(statistics.active.total + statistics.passive.total, locale),
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
      detail: t("qualityGuard.statisticsPassiveDetail", { healthy: formatCount(statistics.passive.healthy, locale) }),
    },
  ];
}

function outcomeStatisticItems(statistics: QualityGuardStatistics, locale: string, t: TFunction): StatisticItem[] {
  const anomalies = statistics.active.soft + statistics.active.hard + statistics.passive.soft + statistics.passive.hard;
  return [
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
      detail: t("qualityGuard.statisticsSuppressedActionDetail", {
        restored: formatCount(statistics.actions.restored, locale),
        suppressed: formatCount(statistics.actions.suppressed, locale),
      }),
    },
  ];
}

export function StatisticsPanel({ statistics, locale }: { statistics: QualityGuardStatistics; locale: string }) {
  const { t } = useTranslation();
  const items = [...volumeStatisticItems(statistics, locale, t), ...outcomeStatisticItems(statistics, locale, t)];
  return (
    <section
      className="overflow-hidden rounded-lg bg-card"
      aria-labelledby="guard-statistics-title"
      data-testid="guard-statistics"
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
