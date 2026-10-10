import type { TFunction } from "i18next";

import type { ChartConfig } from "@/components/ui/chart";
import type { DashboardDTO } from "@/features/dashboard/dashboard-api";
import { formatNumber } from "@/shared/lib/format";

export type ResourcesChartModel = {
  activeAccounts: number;
  unavailableAccounts: number;
  totalAccounts: number;
  availability: number;
};

export type ResourcesChartDatum = { status: string; value: number; fill: string };

export type ResourceRow = { key: string; color: string; label: string; value: string; detail: string };

/** 活跃/不可用账号与可用率；总数为 0 时可用率为 0。 */
export function resolveResourcesChart(dashboard: DashboardDTO | undefined): ResourcesChartModel {
  const resources = dashboard?.resources;
  const activeAccounts = resources?.activeAccounts ?? 0;
  const totalAccounts = resources?.totalAccounts ?? 0;
  return {
    activeAccounts,
    unavailableAccounts: Math.max(0, totalAccounts - activeAccounts),
    totalAccounts,
    availability: totalAccounts > 0 ? (activeAccounts / totalAccounts) * 100 : 0,
  };
}

export function buildResourcesChartConfig(t: TFunction): ChartConfig {
  return {
    active: {
      label: t("dashboard.activeAccounts"),
      theme: { light: "oklch(0.68 0.14 160)", dark: "oklch(0.74 0.12 160)" },
    },
    unavailable: {
      label: t("dashboard.unavailableAccounts"),
      theme: { light: "oklch(0.88 0.01 250)", dark: "oklch(0.36 0.01 250)" },
    },
  };
}

/** 无账号时用单一占位扇区，避免空环图。 */
export function buildResourcesChartData(model: ResourcesChartModel): ResourcesChartDatum[] {
  if (model.totalAccounts <= 0) return [{ status: "unavailable", value: 1, fill: "var(--color-unavailable)" }];
  return [
    { status: "active", value: model.activeAccounts, fill: "var(--color-active)" },
    { status: "unavailable", value: model.unavailableAccounts, fill: "var(--color-unavailable)" },
  ];
}

/** 资源明细四行：活跃账号、不可用账号、启用模型与活跃密钥。 */
export function buildResourceRows(dashboard: DashboardDTO | undefined, locale: string, t: TFunction): ResourceRow[] {
  const resources = dashboard?.resources;
  const activeAccounts = resources?.activeAccounts ?? 0;
  const totalAccounts = resources?.totalAccounts ?? 0;
  const unavailableAccounts = Math.max(0, totalAccounts - activeAccounts);
  const enabledModels = resources?.enabledModels ?? 0;
  const activeClientKeys = resources?.activeClientKeys ?? 0;
  return [
    {
      key: "active",
      color: "bg-emerald-500",
      label: t("dashboard.activeAccounts"),
      value: formatNumber(activeAccounts, locale),
      detail: t("dashboard.availableSummary", {
        active: formatNumber(activeAccounts, locale),
        total: formatNumber(totalAccounts, locale),
      }),
    },
    {
      key: "unavailable",
      color: "bg-muted-foreground/35",
      label: t("dashboard.unavailableAccounts"),
      value: formatNumber(unavailableAccounts, locale),
      detail: t("dashboard.unavailableSummary", {
        unavailable: formatNumber(unavailableAccounts, locale),
        total: formatNumber(totalAccounts, locale),
      }),
    },
    {
      key: "models",
      color: "bg-violet-500",
      label: t("dashboard.enabledModels"),
      value: formatNumber(enabledModels, locale),
      detail: t("dashboard.modelsAvailableSummary", {
        enabled: formatNumber(enabledModels, locale),
        total: formatNumber(resources?.totalModels ?? 0, locale),
      }),
    },
    {
      key: "clientKeys",
      color: "bg-sky-500",
      label: t("dashboard.activeClientKeys"),
      value: formatNumber(activeClientKeys, locale),
      detail: t("dashboard.keysAvailableSummary", {
        active: formatNumber(activeClientKeys, locale),
        total: formatNumber(resources?.totalClientKeys ?? 0, locale),
      }),
    },
  ];
}
