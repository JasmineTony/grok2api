import type { TFunction } from "i18next";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  clampTooltipX,
  providerLabel,
  STRIPE_COUNT,
  type ProviderUsage,
} from "@/features/dashboard/dashboard-provider-format";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";

type StripeHover = { index: number; x: number; y: number };

type ProviderStripesProps = {
  stripes: Array<ProviderUsage | null>;
  totalRequests: number;
  locale: string;
};

/** Provider 占比色带：指针命中的色带高亮，并通过 portal 显示明细。 */
export function ProviderStripes({ stripes, totalRequests, locale }: ProviderStripesProps) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<StripeHover | null>(null);

  return (
    <div className="relative">
      <div
        className="flex h-12 cursor-default items-stretch gap-1"
        aria-label={t("dashboard.providerDistribution")}
        data-testid="dashboard-provider-stripes"
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const position = Math.min(0.999, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
          setHover({
            index: Math.floor(position * STRIPE_COUNT),
            x: clampTooltipX(event.clientX),
            y: Math.max(48, event.clientY - 12),
          });
        }}
        onPointerLeave={() => setHover(null)}
      >
        {stripes.map((provider, index) => (
          <span
            key={index}
            className={cn(
              "pointer-events-none min-w-0 flex-1 rounded-[2px] transition-[transform,opacity] duration-150",
              hover?.index === index && "-translate-y-1 opacity-75",
              provider ? provider.color : "bg-muted",
            )}
          />
        ))}
      </div>
      <ProviderStripeTooltip hover={hover} text={resolveStripeTooltip(stripes, hover, totalRequests, locale, t)} />
    </div>
  );
}

/** 命中色带的明细文案；未命中或无请求时给出无请求提示。 */
function resolveStripeTooltip(
  stripes: Array<ProviderUsage | null>,
  hover: StripeHover | null,
  totalRequests: number,
  locale: string,
  t: TFunction,
): string {
  const hovered = hover === null ? null : (stripes[hover.index] ?? null);
  if (!hovered) return t("dashboard.providerNoRequests");
  const share = totalRequests > 0 ? (hovered.requests / totalRequests) * 100 : 0;
  return t("dashboard.providerStripeDetail", {
    provider: providerLabel(hovered.key, t),
    requests: formatNumber(hovered.requests, locale),
    share: formatNumber(share, locale, 1),
  });
}

function ProviderStripeTooltip({ hover, text }: { hover: StripeHover | null; text: string }) {
  if (!hover || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[100] w-max max-w-64 -translate-x-1/2 -translate-y-full truncate rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-lg"
      style={{ left: hover.x, top: hover.y }}
      data-testid="dashboard-provider-stripe-tooltip"
    >
      {text}
    </div>,
    document.body,
  );
}
