import {
  type QualityGuardNodeState,
  type QualityGuardStatus,
  type QualityTestResult,
} from "@/features/quality-guard/quality-guard-api";
import { type EgressNodeInput } from "@/features/settings";

export function emptyNodeInput(): EgressNodeInput {
  return {
    name: "",
    scope: "grok_build",
    enabled: true,
    proxyPool: false,
    accountCapacity: 0,
    proxyURL: "",
    userAgent: "",
    cloudflareCookies: "",
  };
}

export function isFresh(status?: QualityGuardStatus): boolean {
  if (!status?.available || !status.updatedAt || !status.config) return false;
  const expectedUpdateSeconds =
    status.config.mode === "active"
      ? status.config.active_interval_seconds
      : status.config.passive_poll_seconds;
  return Date.now() / 1000 - status.updatedAt < Math.max(60, expectedUpdateSeconds * 3);
}
export function qualityTestState(
  result: QualityTestResult,
  status: QualityGuardStatus,
): QualityGuardNodeState {
  const softTPS = status.config?.soft_tps ?? 500;
  const hardTPS = status.config?.hard_tps ?? 1000;
  let classification = "healthy";
  let reason = "within_threshold";
  if (!result.expectedMatched) {
    classification = "soft";
    reason = "expected_marker_missing";
  } else if (result.outputTokens < 32) {
    classification = "soft";
    reason = "insufficient_output_tokens";
  } else if (result.outputTokensPerSecond >= hardTPS) {
    classification = "hard";
    reason = "hard_tps";
  } else if (result.outputTokensPerSecond >= softTPS) {
    classification = "soft";
    reason = "soft_tps";
  }
  const now = Date.now() / 1000;
  return {
    active_soft_strikes:
      classification === "soft"
        ? 1
        : classification === "hard"
          ? (status.config?.consecutive_soft ?? 2)
          : 0,
    passive_soft_strikes: 0,
    error_strikes: 0,
    quarantined_until: 0,
    disabled_by_guard: false,
    last_reason: reason,
    last_probe_at: now,
    last_observed_at: now,
    last_source: "active",
    last_classification: classification,
    last_output_tps: result.outputTokensPerSecond,
    last_output_tokens: result.outputTokens,
    last_first_token_ms: result.firstTokenMs,
    last_duration_ms: result.durationMs,
  };
}
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
