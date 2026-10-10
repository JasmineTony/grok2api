import type { AuditBillingBreakdownDTO, AuditDTO } from "@/features/audits/request-audits-api";

export function splitDuration(value: string): { value: string; unit: string } {
  const separator = value.lastIndexOf(" ");
  if (separator < 0) {
    return { value, unit: "" };
  }
  return { value: value.slice(0, separator), unit: value.slice(separator + 1) };
}

export function reasoningEffortTone(effort: NonNullable<AuditDTO["reasoningEffort"]>): string {
  switch (effort) {
    case "none":
      return "text-muted-foreground";
    case "minimal":
      return "text-teal-600 dark:text-teal-400";
    case "low":
      return "text-sky-600 dark:text-sky-400";
    case "medium":
      return "text-amber-600 dark:text-amber-400";
    case "high":
      return "text-orange-600 dark:text-orange-400";
    case "xhigh":
      return "text-rose-600 dark:text-rose-400";
    case "max":
      return "text-fuchsia-600 dark:text-fuchsia-400";
    case "auto":
      return "text-violet-600 dark:text-violet-400";
    case "fixed":
      return "text-indigo-600 dark:text-indigo-400";
  }
}

export function statusTone(statusCode: number, hasError = false): { dot: string; text: string } {
  if (hasError) return { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" };
  if (statusCode >= 500) return { dot: "bg-red-500", text: "text-red-700 dark:text-red-300" };
  if (statusCode >= 400) return { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" };
  if (statusCode >= 200 && statusCode < 300)
    return { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" };
  return { dot: "bg-muted-foreground/50", text: "text-muted-foreground" };
}

export function providerLabel(provider: AuditDTO["provider"]): string {
  switch (provider) {
    case "grok_build":
      return "Grok Build";
    case "grok_web":
      return "Grok Web";
    case "grok_console":
      return "Grok Console";
  }
}

export function auditProtocolLabel(operation: AuditDTO["operation"]): string {
  switch (operation) {
    case "responses":
      return "Responses";
    case "compaction":
      return "Responses Compact";
    case "chat":
      return "Chat Completions";
    case "messages":
      return "Anthropic Messages";
    case "image":
    case "image_edit":
      return "Images";
    case "video":
      return "Videos";
    case "tts":
      return "Audio Speech";
    case "stt":
      return "Audio Transcriptions";
    case "realtime":
      return "Realtime";
    case "voice":
      return "Voice";
  }
}

export function providerShortLabel(provider: AuditDTO["provider"]): string {
  switch (provider) {
    case "grok_build":
      return "Build";
    case "grok_web":
      return "Web";
    case "grok_console":
      return "Console";
  }
}

export function auditFilterOptionSearch(value: string): string {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? `#${trimmed}` : trimmed;
}

export function fallbackBillingBreakdown(audit: AuditDTO): AuditBillingBreakdownDTO | undefined {
  if (audit.costInUsdTicks > 0) {
    return { source: "upstream", method: "upstream_reported", components: [], totalInUsdTicks: audit.costInUsdTicks };
  }
  if (!audit.pricingModel) {
    return undefined;
  }
  return {
    source: "official",
    method: "stored_estimate",
    model: audit.pricingModel,
    version: audit.pricingVersion,
    components: [],
    totalInUsdTicks: audit.estimatedCostInUsdTicks,
  };
}

export function auditCacheRate(summary: { cachedInputTokens: number; inputTokens: number } | undefined): number {
  if (!summary?.inputTokens) return 0;
  return (summary.cachedInputTokens / summary.inputTokens) * 100;
}

export type AuditRouteSummaryInput = {
  provider: AuditDTO["provider"];
  operation: AuditDTO["operation"];
};

export function auditChannelProtocolLabel(audit: AuditRouteSummaryInput): string {
  return `${providerLabel(audit.provider)} · ${auditProtocolLabel(audit.operation)}`;
}

export function auditErrorLabel(
  statusCode: number,
  hasError: boolean,
): { showErrorLabel: boolean; statusPrefix: string } {
  // 保留真实 HTTP 状态，同时明确标识 2xx 响应头之后发生的流式失败；
  // statusCode 0 仅兼容曾运行过早期实现的开发数据库。
  const showErrorLabel = hasError && (statusCode === 0 || (statusCode >= 200 && statusCode < 300));
  return { showErrorLabel, statusPrefix: showErrorLabel && statusCode > 0 ? `${statusCode} · ` : "" };
}
