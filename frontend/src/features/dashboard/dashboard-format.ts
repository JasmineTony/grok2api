import { usdTicksToValue } from "@/shared/lib/usd";
import { formatNumber } from "@/shared/lib/format";

export function formatUSD(ticks: number, locale: string): string {
  return formatUSDValue(usdTicksToValue(ticks), locale);
}

export function formatUSDValue(value: number, locale: string): string {
  return `$${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

export function formatCompactUSD(value: number, locale: string): string {
  return `$${new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
}

export function formatCompactNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** 大数值按 K/M/B 后缀压缩；不足 1 万时保持原样。 */
export function formatCompactTokens(value: number, locale: string): string {
  const absolute = Math.abs(value);
  if (absolute < 10_000) return formatNumber(value, locale);
  const units = [
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "K" },
  ];
  const unit = units.find((candidate) => absolute >= candidate.threshold);
  if (!unit) return formatNumber(value, locale);
  const compact = value / unit.threshold;
  const precision = Math.abs(compact) < 10 && !Number.isInteger(compact) ? 1 : 0;
  return `${formatNumber(compact, locale, precision)}${unit.suffix}`;
}
