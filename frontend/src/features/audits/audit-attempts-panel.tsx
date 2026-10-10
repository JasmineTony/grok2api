import { CheckCircle2, KeyRound, Network, Server, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/features/audits/audit-detail-common";
import { AttemptDetail } from "@/features/audits/audit-attempt-detail";
import type { AuditAttemptDTO, AuditDTO } from "@/features/audits/request-audits-api";
import { cn } from "@/shared/lib/cn";

const PRE_UPSTREAM_ERROR_CODES = new Set([
  "model_not_allowed",
  "upstream_cooling",
  "upstream_model_cooling",
  "upstream_model_unavailable",
  "upstream_pinned_account_unavailable",
  "upstream_quota_exhausted",
  "upstream_saturated",
  "upstream_unavailable",
]);

function NoAttemptsState({ audit }: { audit: AuditDTO }) {
  const { t } = useTranslation();
  const isSuccess = audit.statusCode >= 200 && audit.statusCode < 300 && !audit.errorCode;
  if (isSuccess) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <CheckCircle2 className="size-8 stroke-1 text-emerald-500" />
        <p className="text-xs">{t("audits.successNoAttempts")}</p>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      <TriangleAlert className="size-8 stroke-1 text-amber-500" />
      <p className="max-w-md text-xs">
        {t(
          audit.errorCode && PRE_UPSTREAM_ERROR_CODES.has(audit.errorCode)
            ? "audits.noUpstreamAttempt"
            : "audits.noFailureAttempts",
        )}
      </p>
      {audit.errorCode ? (
        <Badge variant="outline" className="font-mono text-xs">
          {audit.errorCode}
        </Badge>
      ) : null}
    </div>
  );
}

function AttemptButton({
  attempt,
  statusCode,
  selected,
  onClick,
}: {
  attempt: AuditAttemptDTO;
  statusCode: number;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const Icon =
    attempt.source === "upstream_http" ? Server : attempt.source === "gateway_transport" ? Network : KeyRound;
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 w-36 shrink-0 items-center justify-between gap-2 rounded-lg px-2.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 lg:w-full",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="flex min-w-0 items-center gap-2 truncate">
        <Icon className="size-3.5 shrink-0" />
        {t("audits.attemptNumber", { number: attempt.number })}
      </span>
      {statusCode ? (
        <StatusBadge statusCode={statusCode} failed={attempt.stage === "response_stream"} />
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">—</span>
      )}
    </button>
  );
}

export function UpstreamAttemptsPanel({ audit, attempts }: { audit: AuditDTO; attempts: AuditAttemptDTO[] }) {
  const { t } = useTranslation();
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  if (attempts.length === 0) {
    return <NoAttemptsState audit={audit} />;
  }
  const selectedAttempt = attempts.find((attempt) => attempt.number === selectedNumber) ?? attempts[0];
  const terminalAttemptNumber = Math.max(...attempts.map((attempt) => attempt.number));
  return (
    <div className="grid h-full min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[190px_minmax(0,1fr)] lg:grid-rows-1">
      <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-border/40 bg-muted/25 px-4 py-2 sm:px-5 lg:border-r lg:border-b-0 lg:pr-2.5">
        <p className="mb-0.5 shrink-0 text-xs text-muted-foreground">{t("audits.attemptTimeline")}</p>
        <div className="flex max-h-28 gap-1 overflow-auto lg:min-h-0 lg:max-h-none lg:flex-1 lg:flex-col">
          {attempts.map((attempt) => (
            <AttemptButton
              key={attempt.id}
              attempt={attempt}
              statusCode={
                attempt.upstreamStatusCode || (attempt.number === terminalAttemptNumber ? audit.statusCode : 0)
              }
              selected={attempt.number === selectedAttempt.number}
              onClick={() => setSelectedNumber(attempt.number)}
            />
          ))}
        </div>
      </aside>
      <AttemptDetail key={selectedAttempt.id} attempt={selectedAttempt} />
    </div>
  );
}
