export const USD_TICKS_PER_UNIT = 10_000_000_000;

export function usdToTicks(value: number): number {
  return Math.round(value * USD_TICKS_PER_UNIT);
}

export function ticksToUSD(value: number): number {
  return value / USD_TICKS_PER_UNIT;
}
