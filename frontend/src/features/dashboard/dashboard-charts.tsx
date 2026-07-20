import { DashboardProviderDistribution } from "@/features/dashboard/dashboard-provider-distribution";
import { DashboardTopModels } from "@/features/dashboard/dashboard-top-models";
import { DashboardTrend } from "@/features/dashboard/dashboard-trend";
import type { DashboardDTO } from "@/features/dashboard/dashboard-api";

type DashboardChartsProps = {
  dashboard?: DashboardDTO;
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
      <div className="grid items-stretch gap-2 xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
        <DashboardTopModels dashboard={dashboard} locale={locale} loading={loading} />
      </div>
    </>
  );
}
