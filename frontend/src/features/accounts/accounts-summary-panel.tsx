import { Compass, SquareTerminal, TriangleAlert, Webhook } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Spinner } from "@/components/ui/spinner";
import type { AccountSummaryDTO } from "@/features/accounts/accounts-dto";
import {
  buildAbnormalBreakdown,
  buildAbnormalDetailItems,
  type AccountMetricDetailItem,
  type Translate,
} from "@/features/accounts/accounts-view-model";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";

type ProviderMetric = { value: string; detail: string };
type SummaryMetrics = {
  build: ProviderMetric;
  web: ProviderMetric;
  console: ProviderMetric;
  abnormal: string;
  abnormalTone: string;
  abnormalDetail: string;
  abnormalDetailItems: AccountMetricDetailItem[];
};

/** 总览卡片的数值/明细推导与渲染分离，便于单独验证异常口径。 */
function summaryMetrics(
  summary: AccountSummaryDTO | undefined,
  unavailable: boolean,
  t: Translate,
  language: string,
): SummaryMetrics {
  const format = (value: number): string => formatNumber(value, language, 0);
  const recovering = summary?.recovering ?? 0;
  const disabled = summary?.issues.disabled ?? 0;
  const invalid = summary?.issues.reauthRequired ?? 0;
  const abnormalAccounts = recovering + disabled + invalid;
  const breakdown = buildAbnormalBreakdown(t, {
    cooldown: summary?.recovery.cooldown ?? 0,
    waitingReset: summary?.recovery.waitingReset ?? 0,
    probing: summary?.recovery.probing ?? 0,
    risk: summary?.risk ?? 0,
    disabled,
    reauthRequired: invalid,
  });
  const build = summary?.providers.grok_build ?? { total: 0, available: 0 };
  const web = summary?.providers.grok_web ?? { total: 0, available: 0 };
  const consolePool = summary?.providers.grok_console ?? { total: 0, available: 0 };
  const providerMetric = (item: { total: number; available: number }): ProviderMetric => ({
    value: unavailable ? "-" : format(item.total),
    detail: t("accounts.routableAccountCount", { count: format(item.available) }),
  });
  return {
    build: providerMetric(build),
    web: providerMetric(web),
    console: providerMetric(consolePool),
    abnormal: unavailable ? "-" : format(abnormalAccounts),
    abnormalTone: abnormalAccounts > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
    abnormalDetail: breakdown.map((item) => `${item.label} ${format(item.count)}`).join(" · "),
    abnormalDetailItems: buildAbnormalDetailItems(breakdown, t, format, unavailable),
  };
}

type AccountsSummaryPanelProps = {
  summary: AccountSummaryDTO | undefined;
  loading: boolean;
  unavailable: boolean;
  language: string;
};

export function AccountsSummaryPanel({
  summary,
  loading,
  unavailable,
  language,
}: AccountsSummaryPanelProps): ReactNode {
  const { t } = useTranslation();
  const metrics = summaryMetrics(summary, unavailable, t, language);
  return (
    <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <AccountMetricPanel
        tone="text-quota-product-1"
        icon={<SquareTerminal />}
        loading={loading}
        label={t("accounts.buildAccountCount")}
        value={metrics.build.value}
        detail={metrics.build.detail}
      />
      <AccountMetricPanel
        tone="text-quota-product-2"
        icon={<Compass />}
        loading={loading}
        label={t("accounts.webAccountCount")}
        value={metrics.web.value}
        detail={metrics.web.detail}
      />
      <AccountMetricPanel
        tone="text-quota-product-4"
        icon={<Webhook />}
        loading={loading}
        label={t("accounts.consoleAccountCount")}
        value={metrics.console.value}
        detail={metrics.console.detail}
      />
      <AccountMetricPanel
        tone={metrics.abnormalTone}
        icon={<TriangleAlert />}
        loading={loading}
        label={t("accounts.abnormalAccountCount")}
        value={metrics.abnormal}
        detail={metrics.abnormalDetail}
        detailItems={metrics.abnormalDetailItems}
      />
    </section>
  );
}

function AccountMetricPanel({
  icon,
  label,
  value,
  detail,
  detailItems,
  loading,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  detailItems?: AccountMetricDetailItem[];
  loading: boolean;
  tone: string;
}): ReactNode {
  return (
    <div className="min-h-28 rounded-lg bg-card p-4" aria-busy={loading}>
      <div className="flex min-h-5 items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={cn("flex size-5 items-center justify-center [&_svg]:size-4", tone)}>{icon}</span>
      </div>
      <div className="mt-3 flex min-h-8 items-center text-2xl font-medium tracking-tight tabular-nums">
        {loading ? <Spinner /> : value}
      </div>
      {detailItems ? (
        <AccountMetricDetailItems items={detailItems} detail={detail} loading={loading} />
      ) : (
        <p
          className={cn("mt-1.5 min-h-4 truncate text-[11px] text-muted-foreground", loading && "invisible")}
          title={detail}
        >
          {detail}
        </p>
      )}
    </div>
  );
}

function AccountMetricDetailItems({
  items,
  detail,
  loading,
}: {
  items: AccountMetricDetailItem[];
  detail: string;
  loading: boolean;
}): ReactNode {
  return (
    <div
      className={cn("-ml-1.5 mt-1.5 flex min-h-5 flex-wrap gap-1 text-[11px] leading-4", loading && "invisible")}
      title={detail}
    >
      {items.map((item) => (
        <span
          key={item.label}
          className={cn(
            "inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5",
            item.tone ?? "bg-muted text-muted-foreground",
          )}
        >
          <span>{item.label}</span>
          {item.value ? <span className="font-medium tabular-nums">{item.value}</span> : null}
        </span>
      ))}
    </div>
  );
}
