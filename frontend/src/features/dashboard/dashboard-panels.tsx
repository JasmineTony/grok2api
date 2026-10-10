import type { DashboardDTO } from "@/features/dashboard/dashboard-api";
import { DashboardActivity } from "@/features/dashboard/dashboard-activity";
import { DashboardProviderDistribution } from "@/features/dashboard/dashboard-provider-distribution";
import { DashboardResources } from "@/features/dashboard/dashboard-resources";
import { DashboardTopModels } from "@/features/dashboard/dashboard-top-models";
import { DashboardTrend } from "@/features/dashboard/dashboard-trend";

type DashboardPanelsProps = {
  dashboard?: DashboardDTO;
  locale: string;
  loading: boolean;
};

/** 图表与明细区：趋势/Provider 分布、Top 模型/活动/账号资源的两列布局。 */
export function DashboardPanels({ dashboard, locale, loading }: DashboardPanelsProps) {
  return (
    <>
      <div className="grid items-stretch gap-2 xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
        <DashboardTrend dashboard={dashboard} locale={locale} loading={loading} />
        <DashboardProviderDistribution dashboard={dashboard} locale={locale} loading={loading} />
      </div>

      <div className="grid items-stretch gap-2 xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
        <DashboardTopModels dashboard={dashboard} locale={locale} loading={loading} />
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 xl:h-full">
          <DashboardActivity dashboard={dashboard} locale={locale} loading={loading} />
          <DashboardResources dashboard={dashboard} locale={locale} loading={loading} />
        </div>
      </div>
    </>
  );
}
