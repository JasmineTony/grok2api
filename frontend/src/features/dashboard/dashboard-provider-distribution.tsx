import { useTranslation } from "react-i18next";

import { Spinner } from "@/components/ui/spinner";
import type { DashboardDTO } from "@/features/dashboard/dashboard-api";
import { DashboardPanel } from "@/features/dashboard/dashboard-panel";
import { ProviderRows } from "@/features/dashboard/dashboard-provider-rows";
import { ProviderStripes } from "@/features/dashboard/dashboard-provider-stripes";
import { useProviderUsage } from "@/features/dashboard/use-provider-usage";
import { formatNumber } from "@/shared/lib/format";

type DashboardProviderDistributionProps = {
  dashboard?: DashboardDTO;
  locale: string;
  loading: boolean;
};

/** Provider 分布面板：顶部为请求占比色带，下方为三类 Provider 明细。 */
export function DashboardProviderDistribution({ dashboard, locale, loading }: DashboardProviderDistributionProps) {
  const { t } = useTranslation();
  const usage = useProviderUsage(dashboard);

  return (
    <DashboardPanel
      id="dashboard-provider-distribution-title"
      title={t("dashboard.providerDistribution")}
      actions={
        <span className="flex min-h-5 items-center gap-1.5">
          {loading ? (
            <Spinner className="size-3.5" />
          ) : (
            <span className="text-base font-medium tabular-nums">
              {formatNumber(usage.averageSuccessRate, locale, 1)}%
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">{t("dashboard.successRate")}</span>
        </span>
      }
      className="flex h-full min-h-[360px] flex-col"
      contentClassName="flex flex-1 flex-col"
    >
      {loading ? (
        <div className="flex min-h-[260px] items-center justify-center">
          <Spinner className="size-5" />
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <ProviderStripes stripes={usage.stripes} totalRequests={usage.totalRequests} locale={locale} />
          <ProviderRows providers={usage.providers} totalRequests={usage.totalRequests} locale={locale} />
        </div>
      )}
    </DashboardPanel>
  );
}
