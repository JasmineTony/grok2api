import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ClientKeyDTO } from "@/features/client-keys/client-keys-api";
import { ticksToUSD } from "@/shared/lib/cost";

export function BillingUsage({ value }: { value: ClientKeyDTO }) {
  const { t, i18n } = useTranslation();
  const used = ticksToUSD(value.billedUsageUsdTicks);
  if (value.billingLimitUsdTicks <= 0) {
    return (
      <div className="min-w-0">
        <div className="text-xs">{t("keys.unlimited")}</div>
        <div className="truncate text-xs text-muted-foreground">
          {t("keys.billedUsage", { value: formatUSD(used, i18n.language) })}
        </div>
      </div>
    );
  }
  const limit = ticksToUSD(value.billingLimitUsdTicks);
  const percent = Math.min(100, Math.max(0, (used / limit) * 100));
  return (
    <div className="min-w-0 space-y-1.5">
      <div
        className="truncate text-xs tabular-nums"
        title={`${formatUSD(used, i18n.language)} / ${formatUSD(limit, i18n.language)}`}
      >
        {formatUSD(used, i18n.language)} / {formatUSD(limit, i18n.language)}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function formatUSD(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function ModelOptionPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex h-9 items-center justify-between border-t bg-muted/20 px-2">
      <span className="px-1 text-xs text-muted-foreground">
        {t("common.pageOf", { page, pages })}
      </span>
      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={t("common.previousPage")}
        >
          <ChevronLeft />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
          aria-label={t("common.nextPage")}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function ClientKeyStatus({
  value,
  referenceTime,
}: {
  value: ClientKeyDTO;
  referenceTime: number;
}) {
  const { t } = useTranslation();
  if (!value.enabled) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {t("common.disabled")}
      </Badge>
    );
  }
  if (value.expiresAt && new Date(value.expiresAt).getTime() <= referenceTime) {
    return (
      <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-300">
        {t("keys.statusExpired")}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
      {t("keys.statusActive")}
    </Badge>
  );
}
