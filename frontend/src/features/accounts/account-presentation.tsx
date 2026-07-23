import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AccountDTO, QuotaDTO } from "@/features/accounts/accounts-api";
import { MetricCard } from "@/shared/components/metric-card";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";

export function AccountMetricPanel({
  icon,
  label,
  value,
  detail,
  loading,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  loading: boolean;
  tone: string;
}) {
  return (
    <MetricCard
      className="min-h-28"
      label={label}
      value={loading ? <Spinner /> : value}
      icon={
        <span className={cn("flex size-5 items-center justify-center [&_svg]:size-4", tone)}>
          {icon}
        </span>
      }
      detail={
        <span className={cn("block truncate", loading && "invisible")} title={detail}>
          {detail}
        </span>
      }
    />
  );
}

export function WebAccountType({ tier }: { tier?: AccountDTO["webTier"] }) {
  const { t } = useTranslation();
  const label =
    tier === "basic"
      ? t("accountType.free")
      : tier === "super"
        ? t("accountType.super")
        : tier === "heavy"
          ? t("accountType.heavy")
          : t("accountType.auto");
  return <AccountTypeText label={label} variant={tier === "basic" ? "free" : "default"} />;
}

export function AccountType({ quota }: { quota: QuotaDTO }) {
  const { t } = useTranslation();
  if (quota.type === "unknown")
    return (
      <AccountTypeText
        label={t("accountType.pending")}
        title={t("accountType.pendingDescription")}
        variant="muted"
      />
    );
  const isFree = quota.type === "free";
  return (
    <AccountTypeText
      label={t(isFree ? "accountType.free" : "accountType.paid")}
      variant={isFree ? "free" : "default"}
    />
  );
}

export function AccountTypeText({
  label,
  title,
  variant,
}: {
  label: string;
  title?: string;
  variant: "default" | "free" | "muted";
}) {
  if (variant === "muted")
    return (
      <span title={title ?? label} className="text-xs text-muted-foreground">
        {label}
      </span>
    );
  return (
    <span
      title={title ?? label}
      className={cn(
        "max-w-32 truncate text-xs font-medium",
        variant === "free" ? "text-emerald-700 dark:text-emerald-300" : "text-primary",
      )}
    >
      {label}
    </span>
  );
}

export function AccountStatus({ account }: { account: AccountDTO }) {
  const { t, i18n } = useTranslation();
  if (!account.enabled || account.state === "disabled")
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {t("accounts.statusDisabled")}
      </Badge>
    );
  if (account.authStatus === "reauthRequired" || account.state === "reauth_required")
    return <Badge variant="destructive">{t("accounts.statusReauthRequired")}</Badge>;
  if (account.state === "degraded")
    return (
      <Badge variant="secondary" className="bg-orange-500/10 text-orange-700 dark:text-orange-300">
        {t("accounts.statusDegraded")}
      </Badge>
    );

  const consoleWindow =
    account.provider === "grok_console"
      ? account.quotaWindows?.find((window) => window.mode === "console" && window.remaining <= 0)
      : undefined;
  if (consoleWindow) {
    const detail = consoleWindow.resetAt
      ? t("accounts.quotaResetAt", { time: formatDateTime(consoleWindow.resetAt, i18n.language) })
      : t("accounts.quotaResetUnknown");
    return (
      <StatusTooltip content={detail}>
        <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-300">
          {t("accounts.waitingReset")}
        </Badge>
      </StatusTooltip>
    );
  }
  if (account.state === "quota_exhausted" || account.quota.status === "waitingReset") {
    const detail = account.quota.nextProbeAt
      ? t(
          account.quota.type === "paid"
            ? "accounts.paidWaitingResetUntil"
            : "accounts.waitingResetUntil",
          { time: formatDateTime(account.quota.nextProbeAt, i18n.language) },
        )
      : t("accounts.quotaResetUnknown");
    return (
      <StatusTooltip content={detail}>
        <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-300">
          {t("accounts.waitingReset")}
        </Badge>
      </StatusTooltip>
    );
  }
  if (account.quota.status === "probing")
    return (
      <StatusTooltip
        content={t(
          account.quota.type === "paid" ? "accounts.paidProbingQuota" : "accounts.probingQuota",
        )}
      >
        <Badge variant="secondary" className="bg-primary/10 text-sky-700 dark:text-sky-300">
          {t("accounts.probing")}
        </Badge>
      </StatusTooltip>
    );
  if (
    account.state === "cooldown" ||
    (account.cooldownUntil && new Date(account.cooldownUntil) > new Date())
  )
    return (
      <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-300">
        {t("accounts.statusCooldown")}
      </Badge>
    );
  return (
    <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
      {t("accounts.statusActive")}
    </Badge>
  );
}

function StatusTooltip({ children, content }: { children: ReactNode; content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-help">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{content}</TooltipContent>
    </Tooltip>
  );
}
