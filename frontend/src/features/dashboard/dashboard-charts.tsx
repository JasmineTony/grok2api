import type { DashboardDTO } from "@/features/dashboard/dashboard-api";
import { DashboardProviderDistribution } from "@/features/dashboard/dashboard-provider-distribution";
import { DashboardTopModels } from "@/features/dashboard/dashboard-top-models";
import { DashboardTrend } from "@/features/dashboard/dashboard-trend";
import { DashboardUsageGovernance } from "@/features/dashboard/dashboard-usage-governance";

type DashboardChartsProps = {
  dashboard?: DashboardDTO | undefined;
  locale: string;
  loading: boolean;
};

export function DashboardCharts({ dashboard, locale, loading }: DashboardChartsProps) {
  return (
    <>
      <div className="grid items-stretch gap-2 xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
        <DashboardTrend dashboard={dashboard} locale={locale} loading={loading} />
        <DashboardProviderDistribution dashboard={dashboard} locale={locale} loading={loading} />
      </div>
      <DashboardTopModels dashboard={dashboard} locale={locale} loading={loading} />
      <DashboardUsageGovernance dashboard={dashboard} locale={locale} loading={loading} />
    </>
  );
}
