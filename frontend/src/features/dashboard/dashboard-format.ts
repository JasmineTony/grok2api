import { ticksToUSD } from "@/shared/lib/cost";

export function formatUSD(ticks: number, locale: string): string {
  return formatUSDValue(ticksToUSD(ticks), locale);
}

export function formatUSDValue(value: number, locale: string): string {
  return `$${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

export function formatCompactUSD(value: number, locale: string): string {
  return `$${new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
}

export function formatCompactNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

export function usdTicksToValue(ticks: number): number {
  return ticksToUSD(ticks);
}
