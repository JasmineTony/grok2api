import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { getDashboard, type DashboardPeriod } from "@/features/dashboard/dashboard-api";
import { DashboardHeader } from "@/features/dashboard/dashboard-header";
import { DashboardOverview } from "@/features/dashboard/dashboard-overview";
import { DashboardPanels } from "@/features/dashboard/dashboard-panels";
import { ErrorState } from "@/shared/components/data-state";
import { PERIOD_DAYS, toPeriodValue, type PeriodDays } from "@/shared/lib/period";

type DashboardPreferences = { periodDays: PeriodDays };

const DASHBOARD_PREFERENCES_KEY = "grok2api:dashboard-preferences";
const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = { periodDays: 30 };

/** 仪表盘页：持有周期偏好与 dashboard 查询，头部与各面板均为独立组件。 */
export function DashboardPage() {
  const { i18n } = useTranslation();
  const [preferences, setPreferences] = useState<DashboardPreferences>(readDashboardPreferences);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const forceRefresh = useRef(false);
  const { periodDays } = preferences;
  const period: DashboardPeriod = toPeriodValue(periodDays);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  useEffect(() => {
    saveDashboardPreferences(preferences);
  }, [preferences]);

  const dashboardQuery = useQuery({
    queryKey: ["dashboard", period, timezone],
    queryFn: () => getDashboard(period, timezone, forceRefresh.current),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });

  function refreshAll(): void {
    setManualRefreshing(true);
    forceRefresh.current = true;
    void Promise.all([
      dashboardQuery.refetch(),
      new Promise<void>((resolve) => window.setTimeout(resolve, 400)),
    ]).finally(() => {
      forceRefresh.current = false;
      setManualRefreshing(false);
    });
  }

  if (dashboardQuery.isError && !dashboardQuery.data) {
    return <ErrorState message={dashboardQuery.error.message} onRetry={refreshAll} />;
  }

  const dashboard = dashboardQuery.data;
  const loading = dashboardQuery.isPending || dashboardQuery.isPlaceholderData;
  const refreshing = dashboardQuery.isFetching || manualRefreshing;

  return (
    <div className="space-y-5">
      <DashboardHeader
        periodDays={periodDays}
        onPeriodChange={(value) => setPreferences((current) => ({ ...current, periodDays: value }))}
        refreshing={refreshing}
        spinning={manualRefreshing}
        onRefresh={refreshAll}
      />
      <DashboardOverview dashboard={dashboard} locale={i18n.language} loading={loading} />
      <DashboardPanels dashboard={dashboard} locale={i18n.language} loading={loading} />
    </div>
  );
}

function readDashboardPreferences(): DashboardPreferences {
  if (typeof window === "undefined") return DEFAULT_DASHBOARD_PREFERENCES;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(DASHBOARD_PREFERENCES_KEY) ?? "null");
    if (!value || typeof value !== "object") return DEFAULT_DASHBOARD_PREFERENCES;
    const candidate = value as Record<string, unknown>;
    const periodDays = PERIOD_DAYS.find((days) => days === candidate.periodDays);
    if (periodDays === undefined) return DEFAULT_DASHBOARD_PREFERENCES;
    return { periodDays };
  } catch {
    return DEFAULT_DASHBOARD_PREFERENCES;
  }
}

function saveDashboardPreferences(value: DashboardPreferences): void {
  try {
    window.localStorage.setItem(DASHBOARD_PREFERENCES_KEY, JSON.stringify(value));
  } catch {
    return;
  }
}
