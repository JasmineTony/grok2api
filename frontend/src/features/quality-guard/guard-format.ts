import type { QualityGuardStatus } from "@/features/quality-guard/quality-guard-api";

// 质量守护的展示格式化与「状态是否新鲜」判定：纯函数，从 quality-guard-page.tsx 拆出后由各面板复用。

export function formatTPS(value: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} Token/s`;
}

export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${seconds / 60}m`;
}

export function formatTime(value: number | undefined, locale: string): string {
  return value
    ? new Intl.DateTimeFormat(locale, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(value * 1000))
    : "-";
}

// sidecar 未启用（available=false）、状态过期或缺少配置时一律视为「非新鲜」，
// 避免把「守护没在跑」显示成正常。
export function isFresh(status?: QualityGuardStatus): boolean {
  if (!status?.available || !status.updatedAt || !status.config) return false;
  const expectedUpdateSeconds =
    status.config.mode === "active" ? status.config.active_interval_seconds : status.config.passive_poll_seconds;
  return Date.now() / 1000 - status.updatedAt < Math.max(60, expectedUpdateSeconds * 3);
}
