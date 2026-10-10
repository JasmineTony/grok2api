import type { AuditAttemptDTO, AuditDTO } from "@/features/audits/request-audits-api";

/** 供纯函数模块注入的 i18n 取值函数；与 react-i18next 的 t 兼容。 */
export type AuditTranslate = (key: string, options?: Record<string, unknown>) => string;

function formatJSONBody(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

/** 仅对 utf8 且（流式或 content-type 含 json）的响应体做美化，其余保持原文。 */
export function formattedResponseBody(attempt: AuditAttemptDTO): string {
  if (attempt.responseBodyEncoding !== "utf8") return attempt.responseBody;
  const contentType =
    Object.entries(attempt.responseHeaders)
      .find(([name]) => name.toLowerCase() === "content-type")?.[1]
      .join(";") ?? "";
  if (attempt.stage !== "response_stream" && !contentType.toLowerCase().includes("json")) return attempt.responseBody;
  return formatJSONBody(attempt.responseBody);
}

export type AuditOverviewField = {
  label: string;
  value: string;
  copy?: boolean;
  fullWidth?: boolean;
};

export function buildAuditOverviewFields(
  audit: AuditDTO,
  formatNumber: (value: number) => string,
  formatCost: string,
  t: AuditTranslate,
): AuditOverviewField[] {
  const fields: AuditOverviewField[] = [
    {
      label: t("audits.targetAccount"),
      value: audit.accountName || (audit.accountId ? `#${audit.accountId}` : "-"),
    },
    { label: t("audits.requestModel"), value: audit.modelPublicId || "-", copy: Boolean(audit.modelPublicId) },
    { label: t("audits.upstreamModel"), value: audit.modelUpstreamModel || "-" },
    {
      label: t("audits.clientApiKey"),
      value: audit.clientKeyName || (audit.clientKeyId ? `#${audit.clientKeyId}` : "-"),
    },
    { label: t("audits.clientIp"), value: audit.clientIp || "-" },
    {
      label: t("audits.egressNode"),
      value: audit.egressNodeName || (audit.egressNodeId ? `#${audit.egressNodeId}` : "-"),
    },
    { label: t("audits.duration"), value: formatDurationWithFirstToken(audit, formatNumber, t) },
    { label: t("audits.cost"), value: formatCost },
  ];
  if (audit.errorCode) {
    fields.push({ label: t("audits.errorLabel"), value: audit.errorCode, copy: true, fullWidth: true });
  }
  const tokens = formatTokenSummary(audit, formatNumber, t);
  if (tokens) fields.push({ label: t("audits.tokenUsage"), value: tokens, fullWidth: true });
  const media = formatMediaSummary(audit, t);
  if (media) fields.push({ label: t("audits.mediaInput"), value: media, fullWidth: true });
  return fields;
}

export function formatTokenSummary(
  audit: AuditDTO,
  formatNumber: (value: number) => string,
  t: AuditTranslate,
): string | null {
  if (!audit.totalTokens && !audit.inputTokens && !audit.outputTokens) return null;
  const parts = [`${t("audits.input")} ${formatNumber(audit.inputTokens)}`];
  if (audit.cachedInputTokens > 0) {
    parts.push(`(${t("audits.cached")} ${formatNumber(audit.cachedInputTokens)})`);
  }
  parts.push(`· ${t("audits.output")} ${formatNumber(audit.outputTokens)}`);
  if (audit.reasoningTokens > 0) {
    parts.push(`(${t("audits.reasoning")} ${formatNumber(audit.reasoningTokens)})`);
  }
  parts.push(`· ${t("audits.total")} ${formatNumber(audit.totalTokens)}`);
  return parts.join(" ");
}

export function formatDurationWithFirstToken(
  audit: AuditDTO,
  formatNumber: (value: number) => string,
  t: AuditTranslate,
): string {
  let text = `${formatNumber(audit.durationMs)} ms`;
  if (audit.firstTokenMs) {
    text += ` (${t("audits.firstTokenMs")}: ${formatNumber(audit.firstTokenMs)} ms)`;
  }
  return text;
}

export function formatMediaSummary(audit: AuditDTO, t: AuditTranslate): string | null {
  if (audit.mediaInputImages <= 0 && audit.mediaOutputImages <= 0 && audit.mediaOutputSeconds <= 0) return null;
  return [
    audit.mediaInputImages > 0
      ? `${t("audits.mediaInput")}: ${t("audits.imageCount", { count: audit.mediaInputImages })}`
      : "",
    audit.mediaOutputImages > 0
      ? `${t("audits.mediaOutput")}: ${t("audits.imageCount", { count: audit.mediaOutputImages })}`
      : "",
    audit.mediaOutputSeconds > 0 ? t("audits.secondsCount", { count: audit.mediaOutputSeconds }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
