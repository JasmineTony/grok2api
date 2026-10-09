import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ModelQuotaBlockTooltip } from "@/features/accounts/account-quota";
import type { AccountDTO, ModelQuotaBlockDTO, QuotaDTO } from "@/features/accounts/accounts-dto";
import type { Translate } from "@/features/accounts/accounts-view-model";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";

const waitingResetBadgeClass = "bg-amber-500/10 text-amber-700 dark:text-amber-300";
const activeBadgeClass = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";

/** 账号类型单元格：Web 分层、Build 额度类型、Console 固定文案共用同一视觉。 */
export function WebAccountType({ tier }: { tier?: AccountDTO["webTier"] }): ReactNode {
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

export function AccountType({ quota }: { quota: QuotaDTO }): ReactNode {
  const { t } = useTranslation();
  if (quota.type === "unknown") {
    return (
      <AccountTypeText label={t("accountType.pending")} title={t("accountType.pendingDescription")} variant="muted" />
    );
  }
  const isFree = quota.type === "free";
  return (
    <AccountTypeText
      label={isFree ? t("accountType.free") : t("accountType.paid")}
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
}): ReactNode {
  if (variant === "muted") {
    return (
      <span title={title ?? label} className="text-xs text-muted-foreground">
        {label}
      </span>
    );
  }
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

/** 账号状态单元格：账号级状态优先，模型级封锁只叠加警示。 */
export function AccountStatus({ account }: { account: AccountDTO }): ReactNode {
  const { t, i18n } = useTranslation();
  if (!account.enabled) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {t("accounts.statusDisabled")}
      </Badge>
    );
  }
  if (account.authStatus === "reauthRequired") return <RefreshErrorStatus account={account} />;
  const resetDetail = waitingResetDetail(account, t, i18n.language);
  if (resetDetail) {
    return (
      <StatusTooltip content={resetDetail}>
        <Badge variant="secondary" className={waitingResetBadgeClass}>
          {t("accounts.waitingReset")}
        </Badge>
      </StatusTooltip>
    );
  }
  if (account.quota.status === "probing") {
    return (
      <StatusTooltip content={t(account.quota.type === "paid" ? "accounts.paidProbingQuota" : "accounts.probingQuota")}>
        <Badge variant="secondary" className="bg-sky-500/10 text-sky-700 dark:text-sky-300">
          {t("accounts.probing")}
        </Badge>
      </StatusTooltip>
    );
  }
  if (account.cooldownUntil && new Date(account.cooldownUntil) > new Date()) {
    return (
      <Badge variant="secondary" className={waitingResetBadgeClass}>
        {t("accounts.statusCooldown")}
      </Badge>
    );
  }
  return <ActiveStatusBadge blocks={account.quota.modelQuotaBlocks ?? []} locale={i18n.language} />;
}

/** 账号级状态仍为可用；模型级封锁只叠加警示，不降级为账号失败。 */
function ActiveStatusBadge({ blocks, locale }: { blocks: ModelQuotaBlockDTO[]; locale: string }): ReactNode {
  const { t } = useTranslation();
  if (blocks.length === 0) {
    return (
      <Badge variant="secondary" className={activeBadgeClass}>
        {t("accounts.statusActive")}
      </Badge>
    );
  }
  return (
    <StatusTooltip content={<ModelQuotaBlockTooltip blocks={blocks} locale={locale} />}>
      <Badge
        variant="secondary"
        data-testid="account-status-model-quota-block-badge"
        className={cn("gap-1", activeBadgeClass)}
      >
        <TriangleAlert className="size-3 text-amber-600 dark:text-amber-400" />
        {t("accounts.statusActive")}
      </Badge>
    </StatusTooltip>
  );
}

function RefreshErrorStatus({ account }: { account: AccountDTO }): ReactNode {
  const { t } = useTranslation();
  const details = formatAdditionalRefreshErrorDetails(account);
  const hasError = Boolean(
    account.lastRefreshErrorStatus || account.lastRefreshErrorCode || account.lastRefreshErrorMessage || details,
  );
  if (!hasError) return <Badge variant="destructive">{t("accounts.statusReauthRequired")}</Badge>;
  return (
    <StatusTooltip content={<RefreshErrorTooltipContent account={account} details={details} />}>
      <Badge variant="destructive">{t("accounts.statusReauthRequired")}</Badge>
    </StatusTooltip>
  );
}

function RefreshErrorTooltipContent({
  account,
  details,
}: {
  account: AccountDTO;
  details: string | undefined;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="grid w-72 max-w-[calc(100vw-2rem)] grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs font-normal leading-5">
      {account.lastRefreshErrorStatus ? (
        <>
          <span className="text-primary-foreground/60">{t("accounts.refreshErrorStatus")}</span>
          <span>{account.lastRefreshErrorStatus}</span>
        </>
      ) : null}
      {account.lastRefreshErrorCode ? (
        <>
          <span className="text-primary-foreground/60">{t("accounts.refreshErrorCode")}</span>
          <span className="break-all">{account.lastRefreshErrorCode}</span>
        </>
      ) : null}
      {account.lastRefreshErrorMessage ? (
        <>
          <span className="text-primary-foreground/60">{t("accounts.refreshErrorMessage")}</span>
          <span className="break-words">{account.lastRefreshErrorMessage}</span>
        </>
      ) : null}
      {details ? (
        <>
          <span className="text-primary-foreground/60">{t("accounts.refreshErrorResponse")}</span>
          <span className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{details}</span>
        </>
      ) : null}
    </div>
  );
}

/** Console 模式额度窗口耗尽或额度等待重置时，展示重置时间提示。 */
function waitingResetDetail(account: AccountDTO, t: Translate, language: string): string | null {
  const consoleWindow =
    account.provider === "grok_console"
      ? account.quotaWindows?.find((window) => window.mode === "console" && window.remaining <= 0)
      : undefined;
  if (consoleWindow) {
    return consoleWindow.resetAt
      ? t("accounts.quotaResetAt", { time: formatDateTime(consoleWindow.resetAt, language) })
      : t("accounts.quotaResetUnknown");
  }
  if (account.quota.status !== "waitingReset") return null;
  return account.quota.nextProbeAt
    ? t(account.quota.type === "paid" ? "accounts.paidWaitingResetUntil" : "accounts.waitingResetUntil", {
        time: formatDateTime(account.quota.nextProbeAt, language),
      })
    : t("accounts.quotaResetUnknown");
}

function StatusTooltip({ children, content }: { children: ReactNode; content: ReactNode }): ReactNode {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-help">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="w-max max-w-sm">{content}</TooltipContent>
    </Tooltip>
  );
}

function formatAdditionalRefreshErrorDetails(account: AccountDTO): string | undefined {
  const response = account.lastRefreshErrorResponse?.trim();
  if (!response) return undefined;
  try {
    const parsed: unknown = JSON.parse(response);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return response;
    const details = { ...(parsed as Record<string, unknown>) };
    const messages = new Set(
      (account.lastRefreshErrorMessage ?? "")
        .split(" · ")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (typeof details.error === "string" && details.error === account.lastRefreshErrorCode) delete details.error;
    for (const key of ["error_description", "message", "detail", "description", "title"]) {
      if (typeof details[key] === "string" && messages.has(details[key])) delete details[key];
    }
    if (details.error && typeof details.error === "object" && !Array.isArray(details.error)) {
      const nested = { ...(details.error as Record<string, unknown>) };
      if (typeof nested.code === "string" && nested.code === account.lastRefreshErrorCode) delete nested.code;
      for (const key of ["error_description", "message", "detail", "description"]) {
        if (typeof nested[key] === "string" && messages.has(nested[key])) delete nested[key];
      }
      if (Object.keys(nested).length === 0) delete details.error;
      else details.error = nested;
    }
    if (Object.keys(details).length === 0) return undefined;
    return JSON.stringify(details, null, 2);
  } catch {
    return response;
  }
}
