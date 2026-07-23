import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { DashboardActivity } from "@/features/dashboard/dashboard-activity";
import { type DashboardPeriod, getDashboard } from "@/features/dashboard/dashboard-api";
import { DashboardOverview, DashboardResources } from "@/features/dashboard/dashboard-overview";
import { VersionUpdateBanner } from "@/features/system";
import { useApiClient } from "@/shared/api/use-api-client";
import { ErrorState } from "@/shared/components/data-state";
import { PeriodSelector } from "@/shared/components/period-selector";
import { useDeferredRender } from "@/shared/hooks/use-deferred-render";
import { PERIOD_DAYS, type PeriodDays, toPeriodValue } from "@/shared/lib/period";
import { readStorageJSON, writeStorageJSON } from "@/shared/storage/safe-storage";

type DashboardPreferences = { periodDays: PeriodDays };

const DASHBOARD_PREFERENCES_KEY = "grok2api:dashboard-preferences";
const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = { periodDays: 30 };

const DashboardCharts = lazy(() =>
  import("@/features/dashboard/dashboard-charts").then((module) => ({
    default: module.DashboardCharts,
  })),
);

function DashboardChartsFallback() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <div className="grid gap-2 xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
        <div className="h-[360px] animate-pulse rounded-lg border bg-muted/30" />
        <div className="h-[360px] animate-pulse rounded-lg border bg-muted/30" />
      </div>
      <div className="h-[180px] animate-pulse rounded-lg border bg-muted/25" />
      <div className="grid gap-2 xl:grid-cols-2">
        <div className="h-[260px] animate-pulse rounded-lg border bg-muted/25" />
        <div className="h-[260px] animate-pulse rounded-lg border bg-muted/25" />
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const apiClient = useApiClient();
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
    queryFn: () => getDashboard(apiClient, period, timezone, forceRefresh.current),
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

  const dashboard = dashboardQuery.data;
  const loading = dashboardQuery.isPending || dashboardQuery.isPlaceholderData;
  const refreshing = dashboardQuery.isFetching || manualRefreshing;
  const [chartsRef, chartsReady] = useDeferredRender<HTMLDivElement>(Boolean(dashboard));

  if (dashboardQuery.isError && !dashboard) {
    return <ErrorState message={dashboardQuery.error.message} onRetry={refreshAll} />;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-5">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-medium">{t("dashboard.title")}</h1>
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <PeriodSelector
              value={periodDays}
              onChange={(value) => setPreferences((current) => ({ ...current, periodDays: value }))}
              ariaLabel={t("dashboard.usage")}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={refreshAll}
              disabled={refreshing}
            >
              <RefreshCw className={manualRefreshing ? "animate-spin" : undefined} />
              {t("common.refresh")}
            </Button>
          </div>
        </header>

        <VersionUpdateBanner />
      </div>

      <DashboardOverview dashboard={dashboard} locale={i18n.language} loading={loading} />

      <div ref={chartsRef} className="min-h-[816px]">
        {chartsReady ? (
          <Suspense fallback={<DashboardChartsFallback />}>
            <DashboardCharts dashboard={dashboard} locale={i18n.language} loading={loading} />
          </Suspense>
        ) : (
          <DashboardChartsFallback />
        )}
      </div>

      <div className="grid min-h-0 gap-2 xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
        <DashboardActivity dashboard={dashboard} locale={i18n.language} loading={loading} />
        <DashboardResources dashboard={dashboard} locale={i18n.language} loading={loading} />
      </div>
    </div>
  );
}

function readDashboardPreferences(): DashboardPreferences {
  return readStorageJSON(
    DASHBOARD_PREFERENCES_KEY,
    decodeDashboardPreferences,
    DEFAULT_DASHBOARD_PREFERENCES,
  );
}

function saveDashboardPreferences(value: DashboardPreferences): void {
  writeStorageJSON(DASHBOARD_PREFERENCES_KEY, value);
}

function decodeDashboardPreferences(value: unknown): DashboardPreferences {
  if (!value || typeof value !== "object") return DEFAULT_DASHBOARD_PREFERENCES;
  const periodDays = PERIOD_DAYS.find(
    (days) => days === (value as Record<string, unknown>).periodDays,
  );
  return periodDays === undefined ? DEFAULT_DASHBOARD_PREFERENCES : { periodDays };
}
