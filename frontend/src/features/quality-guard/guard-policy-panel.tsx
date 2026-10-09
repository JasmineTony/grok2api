import { Pencil, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { formatDuration, formatTPS } from "@/features/quality-guard/guard-format";
import type { QualityGuardStatus } from "@/features/quality-guard/quality-guard-api";

// 当前策略摘要：从 quality-guard-page.tsx 拆出。展示行与顺序保持不变。

export function Policy({ status, onEdit }: { status: QualityGuardStatus; onEdit: () => void }) {
  const { t } = useTranslation();
  const config = status.config;
  if (!config) return null;
  const rows: [string, string][] = [
    [t("qualityGuard.softThreshold"), `${formatTPS(config.soft_tps)} × ${config.consecutive_soft}`],
    [t("qualityGuard.hardThreshold"), formatTPS(config.hard_tps)],
    [t("qualityGuard.activeInterval"), formatDuration(config.active_interval_seconds)],
    [t("qualityGuard.passiveInterval"), formatDuration(config.passive_poll_seconds)],
    [t("qualityGuard.quarantineDuration"), formatDuration(config.quarantine_seconds)],
    [t("qualityGuard.minimumNodes"), String(config.min_healthy_nodes)],
  ];
  return (
    <section className="rounded-lg bg-card p-4 sm:p-5" aria-labelledby="guard-policy-title" data-testid="guard-policy">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-muted-foreground" />
          <h2 id="guard-policy-title" className="text-sm font-medium">
            {t("qualityGuard.policy")}
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onEdit}
          disabled={!status.editable}
          data-testid="guard-policy-edit"
        >
          <Pencil />
          {t("qualityGuard.editPolicy")}
        </Button>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
