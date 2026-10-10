import { useTranslation } from "react-i18next";
import { Pie, PieChart } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { buildResourcesChartData, type ResourcesChartModel } from "@/features/dashboard/dashboard-resources-data";
import { formatNumber } from "@/shared/lib/format";

type DashboardResourcesChartProps = {
  model: ResourcesChartModel;
  config: ChartConfig;
  locale: string;
};

/** 账号可用率环形图：中心展示可用率百分比。 */
export function DashboardResourcesChart({ model, config, locale }: DashboardResourcesChartProps) {
  const { t } = useTranslation();
  return (
    <div className="relative mx-auto size-44 max-w-full">
      <ChartContainer config={config} className="size-full aspect-square" aria-label={t("dashboard.resourcesTitle")}>
        <PieChart>
          <Pie
            data={buildResourcesChartData(model)}
            dataKey="value"
            nameKey="status"
            innerRadius={56}
            outerRadius={78}
            paddingAngle={model.activeAccounts > 0 && model.unavailableAccounts > 0 ? 3 : 0}
            strokeWidth={0}
            animationDuration={700}
            animationEasing="ease-out"
          />
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-medium tabular-nums">{formatNumber(model.availability, locale, 0)}%</span>
        <span className="mt-1 text-[10px] text-muted-foreground">{t("dashboard.availability")}</span>
      </div>
    </div>
  );
}
