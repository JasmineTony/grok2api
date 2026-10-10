import { useTranslation } from "react-i18next";

import { Spinner } from "@/components/ui/spinner";
import type { DashboardDTO } from "@/features/dashboard/dashboard-api";
import { DashboardPanel } from "@/features/dashboard/dashboard-panel";
import { DashboardResourcesChart } from "@/features/dashboard/dashboard-resources-chart";
import {
  buildResourceRows,
  buildResourcesChartConfig,
  resolveResourcesChart,
} from "@/features/dashboard/dashboard-resources-data";
import { cn } from "@/shared/lib/cn";

type DashboardDataProps = {
  dashboard?: DashboardDTO;
  locale: string;
  loading: boolean;
};

/** 账号资源面板：可用率环形图 + 四行资源明细。 */
export function DashboardResources({ dashboard, locale, loading }: DashboardDataProps) {
  const { t } = useTranslation();
  const model = resolveResourcesChart(dashboard);
  const rows = buildResourceRows(dashboard, locale, t);

  return (
    <DashboardPanel
      id="dashboard-resources-title"
      title={t("dashboard.resourcesTitle")}
      className="flex h-full min-h-[360px] flex-col"
      contentClassName="flex flex-1"
    >
      {loading ? (
        <div className="flex min-h-[260px] items-center justify-center">
          <Spinner className="size-5" />
        </div>
      ) : (
        <div className="grid min-h-[260px] w-full flex-1 grid-cols-[minmax(0,1fr)_minmax(128px,0.8fr)] items-center gap-4">
          <DashboardResourcesChart model={model} config={buildResourcesChartConfig(t)} locale={locale} />
          <div className="min-w-0 divide-y divide-border/60">
            {rows.map((row) => (
              <ResourceSummary
                key={row.key}
                color={row.color}
                label={row.label}
                value={row.value}
                detail={row.detail}
              />
            ))}
          </div>
        </div>
      )}
    </DashboardPanel>
  );
}

function ResourceSummary({
  color,
  label,
  value,
  detail,
}: {
  color: string;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("size-2 shrink-0 rounded-full", color)} />
        <div className="min-w-0">
          <p className="truncate text-xs">{label}</p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={detail}>
            {detail}
          </p>
        </div>
      </div>
      <span className="shrink-0 text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}
