import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { VersionUpdateBanner } from "@/features/system/version-update";
import { PeriodSelector } from "@/shared/components/period-selector";
import type { PeriodDays } from "@/shared/lib/period";

type DashboardHeaderProps = {
  periodDays: PeriodDays;
  onPeriodChange: (value: PeriodDays) => void;
  refreshing: boolean;
  spinning: boolean;
  onRefresh: () => void;
};

/** 仪表盘头部：标题、时间范围选择、刷新按钮与版本更新横幅。 */
export function DashboardHeader({ periodDays, onPeriodChange, refreshing, spinning, onRefresh }: DashboardHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-medium">{t("dashboard.title")}</h1>
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <PeriodSelector value={periodDays} onChange={onPeriodChange} ariaLabel={t("dashboard.usage")} />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            data-testid="dashboard-refresh"
          >
            <RefreshCw className={spinning ? "animate-spin" : undefined} />
            {t("common.refresh")}
          </Button>
        </div>
      </header>
      <VersionUpdateBanner />
    </div>
  );
}
