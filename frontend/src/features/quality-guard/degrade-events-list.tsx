import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import type { DegradeClass, DegradeEventDTO } from "@/features/quality-guard/quality-guard-api";
import { EmptyState } from "@/shared/components/data-state";
import { formatCompactDateTime } from "@/shared/lib/format";

// 降级请求事件列表：从 degrade-accounts-panel.tsx 拆出，行内字段与分类徽标保持不变。

function classBadge(cls: DegradeClass) {
  if (cls === "missing_thinking")
    return (
      <Badge variant="outline" className="text-destructive">
        thinking
      </Badge>
    );
  if (cls === "hard_tps")
    return (
      <Badge variant="outline" className="text-destructive">
        hard
      </Badge>
    );
  if (cls === "buffered_burst")
    return (
      <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
        burst
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-muted-foreground">
      soft
    </Badge>
  );
}

function DegradeEventRow({ event, locale }: { event: DegradeEventDTO; locale: string }) {
  return (
    <div
      className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] gap-3 border-b px-4 py-2 last:border-b-0 sm:px-5"
      data-testid={`degrade-event-${event.id}`}
    >
      <div className="font-mono text-[11px] text-muted-foreground">
        {formatCompactDateTime(event.createdAt, locale)}
      </div>
      <div className="truncate text-xs">
        #{event.accountId ?? "-"} {event.accountName} · {event.nodeName} · out {event.outputTokens} · {event.requestId}
      </div>
      <div className="flex items-center gap-2">
        {classBadge(event.class)}
        <span className="font-mono text-xs tabular-nums">{event.tps}</span>
      </div>
    </div>
  );
}

export function DegradeEventsList({ events }: { events: DegradeEventDTO[] }) {
  const { t, i18n } = useTranslation();
  return (
    <section className="overflow-hidden rounded-lg bg-card" data-testid="degrade-events">
      <div className="border-b px-4 py-4 sm:px-5">
        <h2 className="text-sm font-medium">{t("qualityGuard.degrade.events")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("qualityGuard.degrade.eventsHelp")}</p>
      </div>
      <div className="max-h-72 overflow-auto">
        {events.length === 0 ? (
          <EmptyState message={t("qualityGuard.degrade.noEvents")} />
        ) : (
          events.map((event) => <DegradeEventRow key={event.id} event={event} locale={i18n.language} />)
        )}
      </div>
    </section>
  );
}
