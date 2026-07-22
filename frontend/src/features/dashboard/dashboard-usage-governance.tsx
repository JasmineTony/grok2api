import { KeyRound, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { DashboardDimensionUsageDTO, DashboardDTO } from "@/features/dashboard/dashboard-api";
import { formatUSD } from "@/features/dashboard/dashboard-format";
import { DashboardPanel } from "@/features/dashboard/dashboard-panel";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";

export function DashboardUsageGovernance({
  dashboard,
  locale,
  loading,
}: {
  dashboard?: DashboardDTO | undefined;
  locale: string;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="grid min-w-0 gap-2 xl:grid-cols-2"
      aria-label={t("dashboard.governanceTitle")}
    >
      <DimensionPanel
        id="dashboard-account-usage"
        icon={UserRound}
        title={t("dashboard.topAccounts")}
        empty={t("dashboard.noAccountUsage")}
        loading={loading}
        locale={locale}
        rows={
          dashboard?.topAccounts.map((item) => ({
            id: item.accountId,
            name: item.accountName,
            subtitle: item.provider,
            usage: item.usage,
          })) ?? []
        }
      />
      <DimensionPanel
        id="dashboard-client-key-usage"
        icon={KeyRound}
        title={t("dashboard.topClientKeys")}
        empty={t("dashboard.noClientKeyUsage")}
        loading={loading}
        locale={locale}
        rows={
          dashboard?.topClientKeys.map((item) => ({
            id: item.clientKeyId,
            name: item.clientKeyName,
            subtitle: item.clientKeyId,
            usage: item.usage,
          })) ?? []
        }
      />
    </section>
  );
}

function DimensionPanel({
  id,
  icon: Icon,
  title,
  empty,
  loading,
  locale,
  rows,
}: {
  id: string;
  icon: typeof UserRound;
  title: string;
  empty: string;
  loading: boolean;
  locale: string;
  rows: Array<{ id: string; name: string; subtitle: string; usage: DashboardDimensionUsageDTO }>;
}) {
  const { t } = useTranslation();
  return (
    <DashboardPanel id={id} title={title} className="min-w-0" contentClassName="p-0">
      {loading ? (
        <div className="h-52 animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
      ) : rows.length === 0 ? (
        <div className="flex min-h-52 items-center justify-center px-4 text-sm text-muted-foreground">
          <Icon className="mr-2 size-4" />
          {empty}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t("dashboard.dimension")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("dashboard.requests")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("dashboard.tokens")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("dashboard.billing")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.slice(0, 10).map((row) => (
                <tr key={row.id} className="align-middle">
                  <td className="max-w-[220px] px-4 py-3">
                    <div className="truncate font-medium" title={row.name}>
                      {row.name}
                    </div>
                    <div
                      className="mt-0.5 truncate text-xs text-muted-foreground"
                      title={row.subtitle}
                    >
                      {row.subtitle}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatNumber(row.usage.requests, locale, 0)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <div>{formatNumber(row.usage.tokens, locale, 0)}</div>
                    <div
                      className={cn(
                        "mt-0.5 text-xs text-muted-foreground",
                        row.usage.inputTokens > 0 ? "" : "invisible",
                      )}
                    >
                      {t("dashboard.tokenEfficiency", {
                        rate: formatNumber(
                          row.usage.inputTokens > 0
                            ? (row.usage.cachedInputTokens / row.usage.inputTokens) * 100
                            : 0,
                          locale,
                          1,
                        ),
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {formatUSD(row.usage.billedCostUsdTicks, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardPanel>
  );
}
