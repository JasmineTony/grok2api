import { useTranslation } from "react-i18next";

import { providerLabel, type ProviderUsage } from "@/features/dashboard/dashboard-provider-format";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";

type ProviderRowsProps = {
  providers: ProviderUsage[];
  totalRequests: number;
  locale: string;
};

/** 三类 Provider 明细行：调用量占比、成功率与 tokens。 */
export function ProviderRows({ providers, totalRequests, locale }: ProviderRowsProps) {
  return (
    <div className="mt-3 grid flex-1 grid-rows-3 divide-y">
      {providers.map((provider) => (
        <ProviderRow key={provider.key} provider={provider} totalRequests={totalRequests} locale={locale} />
      ))}
    </div>
  );
}

function ProviderRow({
  provider,
  totalRequests,
  locale,
}: {
  provider: ProviderUsage;
  totalRequests: number;
  locale: string;
}) {
  const { t } = useTranslation();
  const share = totalRequests > 0 ? (provider.requests / totalRequests) * 100 : 0;
  const successRate = provider.requests > 0 ? (provider.successfulRequests / provider.requests) * 100 : 0;
  return (
    <div className="flex min-h-16 items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn("size-2 shrink-0 rounded-full", provider.dot)} />
        <div className="min-w-0">
          <p className="truncate text-xs">{providerLabel(provider.key, t)}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {t("dashboard.providerDetail", {
              rate: formatNumber(successRate, locale, 1),
              tokens: formatNumber(provider.tokens, locale),
            })}
          </p>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-medium tabular-nums">{formatNumber(provider.requests, locale)}</p>
        <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{formatNumber(share, locale, 1)}%</p>
      </div>
    </div>
  );
}
