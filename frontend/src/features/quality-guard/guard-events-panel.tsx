import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { formatTPS, formatTime } from "@/features/quality-guard/guard-format";
import type { QualityGuardEvent } from "@/features/quality-guard/quality-guard-api";

// 最近事件列表：从 quality-guard-page.tsx 拆出。事件类型/原因到 i18n key 的映射保持原有兜底规则。

function eventLabelKey(event: string): string {
  if (event === "lease_scoped_quarantine_suppressed") return "qualityGuard.leaseScopedQuarantineSuppressedEvent";
  if (event === "lease_scoped_guard_released") return "qualityGuard.leaseScopedGuardReleasedEvent";
  if (event === "lease_quarantined") return "qualityGuard.leaseQuarantinedEvent";
  if (event === "lease_restored") return "qualityGuard.leaseRestoredEvent";
  if (event === "lease_quarantine_extended") return "qualityGuard.leaseQuarantineExtendedEvent";
  if (event === "lease_quarantine_failed" || event === "lease_quarantine_suppressed")
    return "qualityGuard.leaseQuarantineFailedEvent";
  return `qualityGuard.eventTypes.${event}`;
}

function reasonLabelKey(reason: string): string {
  if (reason === "lease_scoped_node") return "qualityGuard.leaseScopedNodeReason";
  if (reason === "fixed_fallback_node") return "qualityGuard.fixedFallback";
  return `qualityGuard.reasons.${reason || "unknown"}`;
}

function eventReasonLine(event: QualityGuardEvent, locale: string, t: TFunction): string {
  const parts = [t(reasonLabelKey(event.reason))];
  if (event.account_id) parts.push(t("qualityGuard.accountLease", { id: event.account_id }));
  if (event.request_id) parts.push(event.request_id);
  if (event.cooldown_until)
    parts.push(t("qualityGuard.leaseUntil", { time: formatTime(event.cooldown_until, locale) }));
  if (event.output_tps) parts.push(formatTPS(event.output_tps));
  return parts.join(" · ");
}

function GuardEventRow({ event, locale }: { event: QualityGuardEvent; locale: string }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-md px-2 py-2 hover:bg-secondary/40">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">
          {event.node_name || `ID ${event.node_id}`} · {t(eventLabelKey(event.event))}
        </p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{eventReasonLine(event, locale, t)}</p>
      </div>
      <time className="text-[11px] text-muted-foreground">{formatTime(event.ts, locale)}</time>
    </div>
  );
}

export function EventList({ events, locale }: { events: QualityGuardEvent[]; locale: string }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-lg bg-card p-4 sm:p-5" aria-labelledby="guard-events-title" data-testid="guard-events">
      <h2 id="guard-events-title" className="text-sm font-medium">
        {t("qualityGuard.events")}
      </h2>
      {events.length === 0 ? (
        <p className="mt-8 text-center text-xs text-muted-foreground">{t("qualityGuard.noEvents")}</p>
      ) : (
        <div className="mt-3 space-y-1">
          {[...events]
            .reverse()
            .slice(0, 10)
            .map((event, index) => (
              <GuardEventRow key={`${event.ts}-${index}`} event={event} locale={locale} />
            ))}
        </div>
      )}
    </section>
  );
}
