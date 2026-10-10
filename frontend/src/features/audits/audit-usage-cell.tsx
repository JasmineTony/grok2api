import { Minimize2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { reasoningEffortTone } from "@/features/audits/audit-format";
import { buildAuditUsageView } from "@/features/audits/audit-usage";
import type { AuditDTO } from "@/features/audits/request-audits-api";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";

function UsageMetric({
  label,
  value,
  reasoningEffort,
}: {
  label: string;
  value: string;
  reasoningEffort?: AuditDTO["reasoningEffort"];
}) {
  const { t } = useTranslation();
  const fullLabel = reasoningEffort ? `${label} · ${t(`audits.reasoningEfforts.${reasoningEffort}`)}` : label;
  return (
    <div className="flex h-6 min-w-0 items-center justify-between gap-2 rounded-md bg-muted/45 px-2 text-[11px]">
      <span className="flex min-w-0 items-center gap-1" title={fullLabel}>
        <span className="truncate text-muted-foreground">{label}</span>
        {reasoningEffort ? (
          <span className={cn("shrink-0 font-medium", reasoningEffortTone(reasoningEffort))}>
            · {t(`audits.reasoningEfforts.${reasoningEffort}`)}
          </span>
        ) : null}
      </span>
      <span className="truncate font-medium tabular-nums" title={value}>
        {value}
      </span>
    </div>
  );
}

function UsagePlaceholderPanel({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex h-[52px] w-full items-center gap-2 rounded-md bg-muted/45 px-2.5 text-[11px]">
      {icon ? icon : null}
      <div className="min-w-0">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

type UsageItem = { key: string; label: string; value: string };

function UsageMetricGrid({
  items,
  reasoningEffort,
}: {
  items: UsageItem[];
  reasoningEffort?: AuditDTO["reasoningEffort"];
}) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {items.map((item) => (
        <UsageMetric
          key={item.key}
          label={item.label}
          value={item.value}
          reasoningEffort={item.key === "reasoning" ? reasoningEffort : undefined}
        />
      ))}
    </div>
  );
}

export function UsageDetails({ audit, locale }: { audit: AuditDTO; locale: string }) {
  const { t } = useTranslation();
  const view = buildAuditUsageView(audit, (value) => formatNumber(value, locale), {
    input: t("audits.input"),
    output: t("audits.output"),
    cached: t("audits.cached"),
    reasoning: t("audits.reasoning"),
    mediaInput: t("audits.mediaInput"),
    mediaOutput: t("audits.mediaOutput"),
    imageCount: (count) => t("audits.imageCount", { count }),
    secondsCount: (count) => t("audits.secondsCount", { count }),
  });
  if (view.mode === "compaction") {
    return (
      <UsagePlaceholderPanel
        icon={<Minimize2 className="size-3.5 shrink-0 text-muted-foreground" />}
        title={t("audits.operations.compaction")}
        detail={t("audits.compactionUsageUnavailable")}
      />
    );
  }
  if (view.mode === "duration") {
    return (
      <UsagePlaceholderPanel
        icon={null}
        title={t(`audits.operations.${audit.operation}`)}
        detail={`${view.durationSeconds}s`}
      />
    );
  }
  return (
    <div className="w-full space-y-1">
      {view.mediaItems?.length ? <UsageMetricGrid items={view.mediaItems} /> : null}
      {view.tokenItems?.length ? (
        <UsageMetricGrid items={view.tokenItems} reasoningEffort={audit.reasoningEffort} />
      ) : null}
    </div>
  );
}
