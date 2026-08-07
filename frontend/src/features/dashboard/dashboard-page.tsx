import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Orbit, RadioTower, RefreshCw } from "lucide-react";
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
        <div className="animate-pulse rounded-lg border bg-muted/30" style={{ height: 360 }} />
        <div className="animate-pulse rounded-lg border bg-muted/30" style={{ height: 360 }} />
      </div>
      <div className="animate-pulse rounded-lg border bg-muted/25" style={{ height: 180 }} />
      <div className="grid gap-2 xl:grid-cols-2">
        <div className="animate-pulse rounded-lg border bg-muted/25" style={{ height: 260 }} />
        <div className="animate-pulse rounded-lg border bg-muted/25" style={{ height: 260 }} />
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
        <header className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/90 shadow-xl backdrop-blur-sm px-5 py-6 sm:px-7 sm:py-8 lg:px-9">
          <div className="relative z-10 flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[10px] font-semibold tracking-widest text-primary uppercase">
                <Orbit className="size-3.5" strokeWidth={1.7} />
                {t("dashboard.usage")}
              </div>
              <h1 className="mt-5 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl">
                {t("dashboard.title")}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                {t("dashboard.gatewayReady")}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span
                  className={
                    dashboard
                      ? "inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-emerald-700 dark:text-emerald-300"
                      : "inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-amber-700 dark:text-amber-300"
                  }
                >
                  {loading ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <RadioTower className="size-3.5" />
                  )}
                  {dashboard
                    ? t("dashboard.gatewayOnline")
                    : loading
                      ? t("common.loading")
                      : t("dashboard.gatewayOffline")}
                </span>
                {dashboard?.generatedAt ? (
                  <span className="rounded-full border border-border/70 bg-background/55 px-3 py-1.5 backdrop-blur-md">
                    {t("dashboard.lastUpdated", {
                      time: new Intl.DateTimeFormat(i18n.language, {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }).format(new Date(dashboard.generatedAt)),
                    })}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-background/60 p-2 shadow-sm">
              <PeriodSelector
                value={periodDays}
                onChange={(value) =>
                  setPreferences((current) => ({ ...current, periodDays: value }))
                }
                ariaLabel={t("dashboard.usage")}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={refreshAll}
                disabled={refreshing}
                className="shadow-sm"
              >
                <RefreshCw className={manualRefreshing ? "animate-spin" : undefined} />
                {t("common.refresh")}
              </Button>
            </div>
          </div>
        </header>

        <VersionUpdateBanner />
      </div>

      <DashboardOverview dashboard={dashboard} locale={i18n.language} loading={loading} />

      <div ref={chartsRef} style={{ minHeight: 816 }}>
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
