import { KeyRound, Network, Server, type LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodePanel, EmptyPanel, HeadersPanel, OverviewField } from "@/features/audits/audit-detail-common";
import { formattedResponseBody } from "@/features/audits/audit-detail-format";
import type { AuditAttemptDTO } from "@/features/audits/request-audits-api";
import { CopyButton } from "@/shared/components/copy-button";
import { formatDateTime, formatNumber } from "@/shared/lib/format";

const ATTEMPT_SOURCE_ICONS: Record<AuditAttemptDTO["source"], LucideIcon> = {
  upstream_http: Server,
  gateway_transport: Network,
  credential: KeyRound,
};

function AttemptSummary({ attempt }: { attempt: AuditAttemptDTO }) {
  const { t } = useTranslation();
  const isHTTP = attempt.source === "upstream_http";
  const isStreamFailure = isHTTP && attempt.stage === "response_stream";
  const Icon = ATTEMPT_SOURCE_ICONS[attempt.source];
  const title = isStreamFailure
    ? t("audits.upstreamStreamFailure", { status: attempt.upstreamStatusCode ?? "-" })
    : isHTTP
      ? t("audits.upstreamHttpFailure", { status: attempt.upstreamStatusCode ?? "-" })
      : attempt.source === "gateway_transport"
        ? t("audits.gatewayTransportFailure")
        : t("audits.credentialFailure");
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-destructive" />
      <p className="min-w-0 truncate font-medium">{title}</p>
    </div>
  );
}

function AttemptOverview({ attempt }: { attempt: AuditAttemptDTO }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="grid gap-x-10 gap-y-4 px-1 py-3 sm:grid-cols-2">
      <OverviewField label={t("audits.attemptStartedAt")} value={formatDateTime(attempt.startedAt, i18n.language)} />
      <OverviewField label={t("audits.duration")} value={`${formatNumber(attempt.durationMs, i18n.language)} ms`} />
      <OverviewField
        label={t("audits.targetAccount")}
        value={attempt.accountName || (attempt.accountId ? `#${attempt.accountId}` : "-")}
      />
      <OverviewField label={t("audits.requestMethod")} value={attempt.method || "-"} />
      <OverviewField label={t("audits.requestPath")} value={attempt.requestPath || "-"} />
      <OverviewField
        label={t("audits.upstreamStatus")}
        value={attempt.upstreamStatus || (attempt.upstreamStatusCode ? String(attempt.upstreamStatusCode) : "-")}
      />
      <OverviewField
        className="sm:col-span-2"
        label={t("audits.upstreamUrl")}
        value={attempt.upstreamUrl || t("audits.upstreamUrlUnavailable")}
        copy={Boolean(attempt.upstreamUrl)}
      />
      {attempt.transportError ? (
        <OverviewField
          className="sm:col-span-2"
          label={attempt.source === "gateway_transport" ? t("audits.transportError") : t("audits.attemptError")}
          value={attempt.transportError}
          copy
        />
      ) : null}
    </div>
  );
}

function AttemptResponseBody({ attempt }: { attempt: AuditAttemptDTO }) {
  const { t } = useTranslation();
  const displayValue = useMemo(() => formattedResponseBody(attempt), [attempt]);
  return (
    <CodePanel
      value={attempt.responseBody}
      displayValue={displayValue}
      emptyMessage={t("audits.emptyResponseBody")}
      encoding={attempt.responseBodyEncoding}
      truncated={attempt.responseBodyTruncated}
    />
  );
}

function ErrorChainPanel({ attempt }: { attempt: AuditAttemptDTO }) {
  const { t } = useTranslation();
  const copyValue = useMemo(() => JSON.stringify(attempt.errorChain, null, 2), [attempt.errorChain]);
  if (attempt.errorChain.length === 0) return <EmptyPanel icon={<Network />} message={t("audits.emptyErrorChain")} />;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-muted/15">
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <span className="text-muted-foreground text-[11px]">
          {t("audits.errorFrameCount", { count: attempt.errorChain.length })}
        </span>
        <CopyButton value={copyValue} />
      </div>
      <ol className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {attempt.errorChain.map((frame, index) => (
          <li key={`${frame.type}-${index}`} className="rounded-md bg-background/50 p-2.5">
            <div className="flex items-center gap-2 text-muted-foreground text-[11px]">
              <span>#{index + 1}</span>
              <span className="break-all font-medium text-foreground">{frame.type}</span>
            </div>
            <p className="mt-1.5 font-mono text-[11px] whitespace-pre-wrap break-words">{frame.message}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AttemptTabTriggers({
  hasBody,
  hasHeaders,
  hasErrors,
}: {
  hasBody: boolean;
  hasHeaders: boolean;
  hasErrors: boolean;
}) {
  const { t } = useTranslation();
  return (
    <TabsList className="h-7 w-max">
      <TabsTrigger value="overview" className="h-6 px-2.5 text-xs">
        {t("audits.overview")}
      </TabsTrigger>
      {hasBody ? (
        <TabsTrigger value="body" className="h-6 px-2.5 text-xs">
          {t("audits.responseBody")}
        </TabsTrigger>
      ) : null}
      {hasHeaders ? (
        <TabsTrigger value="headers" className="h-6 px-2.5 text-xs">
          {t("audits.responseHeaders")}
        </TabsTrigger>
      ) : null}
      {hasErrors ? (
        <TabsTrigger value="errors" className="h-6 px-2.5 text-xs">
          {t("audits.errorChain")}
        </TabsTrigger>
      ) : null}
    </TabsList>
  );
}

function AttemptTabs({ attempt }: { attempt: AuditAttemptDTO }) {
  const { t } = useTranslation();
  const hasBody = Boolean(attempt.responseBody);
  const hasHeaders = Object.keys(attempt.responseHeaders).length > 0;
  const hasErrors = attempt.errorChain.length > 0;
  return (
    <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 sm:px-5">
      <div className="flex shrink-0 flex-wrap items-center gap-2.5 py-3">
        <AttemptSummary attempt={attempt} />
        <div className="ml-auto max-w-full shrink-0 overflow-x-auto pb-0.5">
          <AttemptTabTriggers hasBody={hasBody} hasHeaders={hasHeaders} hasErrors={hasErrors} />
        </div>
      </div>
      <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto">
        <AttemptOverview attempt={attempt} />
      </TabsContent>
      {hasBody ? (
        <TabsContent value="body" className="min-h-0 flex-1 overflow-hidden pt-2">
          <AttemptResponseBody attempt={attempt} />
        </TabsContent>
      ) : null}
      {hasHeaders ? (
        <TabsContent value="headers" className="min-h-0 flex-1 overflow-hidden pt-2">
          <HeadersPanel title={t("audits.responseHeaders")} headers={attempt.responseHeaders} />
        </TabsContent>
      ) : null}
      {hasErrors ? (
        <TabsContent value="errors" className="min-h-0 flex-1 overflow-hidden pt-2">
          <ErrorChainPanel attempt={attempt} />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

export function AttemptDetail({ attempt }: { attempt: AuditAttemptDTO }) {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AttemptTabs attempt={attempt} />
    </main>
  );
}
