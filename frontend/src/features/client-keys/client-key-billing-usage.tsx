import { useTranslation } from "react-i18next";

import type { ClientKeyDTO } from "@/features/client-keys/client-keys-api";
import { USD_TICKS_PER_DOLLAR } from "@/shared/lib/usd";

function formatUSD(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** 计费用量单元格：额度为 0 表示不限，只展示已用量。 */
export function BillingUsage({ value }: { value: ClientKeyDTO }) {
  const { t, i18n } = useTranslation();
  const used = value.billedUsageUsdTicks / USD_TICKS_PER_DOLLAR;
  if (value.billingLimitUsdTicks <= 0) {
    return (
      <div className="min-w-0" data-testid={`client-keys-billing-${value.id}`}>
        <div className="text-xs">{t("keys.unlimited")}</div>
        <div className="truncate text-xs text-muted-foreground">
          {t("keys.billedUsage", { value: formatUSD(used, i18n.language) })}
        </div>
      </div>
    );
  }
  const limit = value.billingLimitUsdTicks / USD_TICKS_PER_DOLLAR;
  const percent = Math.min(100, Math.max(0, (used / limit) * 100));
  return (
    <div className="min-w-0 space-y-1.5" data-testid={`client-keys-billing-${value.id}`}>
      <div
        className="truncate text-xs tabular-nums"
        title={`${formatUSD(used, i18n.language)} / ${formatUSD(limit, i18n.language)}`}
      >
        {formatUSD(used, i18n.language)} / {formatUSD(limit, i18n.language)}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
