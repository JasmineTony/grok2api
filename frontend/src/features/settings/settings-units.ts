/** 时长/字节大小的表单值与后端字符串之间的单位换算：纯函数，无业务状态。 */
export type DurationUnit = "s" | "m" | "h" | "d";
export type DurationValue = { value: number; unit: DurationUnit };
export type ByteSizeUnit = "MiB" | "GiB";
export type ByteSizeValue = { value: number; unit: ByteSizeUnit };

export function isDurationUnit(value: string): value is DurationUnit {
  return value === "s" || value === "m" || value === "h" || value === "d";
}

export function isByteSizeUnit(value: string): value is ByteSizeUnit {
  return value === "MiB" || value === "GiB";
}

export function byteSizeBytes(value: ByteSizeValue): number {
  return Math.round(value.value * (value.unit === "GiB" ? 2 ** 30 : 2 ** 20));
}

export function parseByteSize(bytes: number): ByteSizeValue {
  if (bytes >= 2 ** 30 && bytes % 2 ** 30 === 0) return { value: bytes / 2 ** 30, unit: "GiB" };
  return { value: bytes / 2 ** 20, unit: "MiB" };
}

export function durationSeconds(value: DurationValue): number {
  const factors: Record<DurationUnit, number> = { s: 1, m: 60, h: 3_600, d: 86_400 };
  return value.value * factors[value.unit];
}

export function formatDuration(value: DurationValue): string {
  if (value.unit === "d") return `${value.value * 24}h`;
  return `${value.value}${value.unit}`;
}

export function parseDuration(value: string): DurationValue {
  const simple = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (simple) {
    const amount = Number(simple[1]);
    if (simple[2] === "ms") return { value: amount / 1000, unit: "s" };
    if (simple[2] === "h" && amount >= 24 && amount % 24 === 0) return { value: amount / 24, unit: "d" };
    if (isDurationUnit(simple[2])) return { value: amount, unit: simple[2] };
  }

  const factors: Record<string, number> = {
    ns: 0.000001,
    us: 0.001,
    µs: 0.001,
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
  };
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g)];
  if (parts.map((part) => part[0]).join("") !== value || parts.length === 0) return { value: 1, unit: "s" };
  const milliseconds = parts.reduce((total, part) => total + Number(part[1]) * factors[part[2]], 0);
  const units: Array<[DurationUnit, number]> = [
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["m", 60_000],
    ["s", 1000],
  ];
  for (const [unit, factor] of units) {
    const amount = milliseconds / factor;
    if (amount >= 1 && Number.isInteger(amount)) return { value: amount, unit };
  }
  return { value: milliseconds / 1000, unit: "s" };
}

export function parseDurationMilliseconds(value: string): number {
  return Math.round(durationSeconds(parseDuration(value)) * 1000);
}
