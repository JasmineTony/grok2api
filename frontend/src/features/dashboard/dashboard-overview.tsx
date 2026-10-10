import { useTranslation } from "react-i18next";

import type { DashboardDTO } from "@/features/dashboard/dashboard-api";
import { DashboardMetric } from "@/features/dashboard/dashboard-metric";
import { buildOverviewMetrics } from "@/features/dashboard/dashboard-overview-metrics";

type DashboardDataProps = {
  dashboard?: DashboardDTO;
  locale: string;
  loading: boolean;
};

/** 概览指标区：五项指标卡，数值与补充说明由 buildOverviewMetrics 计算。 */
export function DashboardOverview({ dashboard, locale, loading }: DashboardDataProps) {
  const { t } = useTranslation();
  const metrics = buildOverviewMetrics(dashboard, locale, t);

  return (
    <section aria-label={t("dashboard.usage")}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <DashboardMetric
            key={metric.key}
            icon={metric.icon}
            label={metric.label}
            value={metric.value}
            detail={metric.detail}
            loading={loading}
          />
        ))}
      </div>
    </section>
  );
}
