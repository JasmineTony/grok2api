import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { Bot, Compass, Handshake, SquareTerminal, VenusAndMars, Webhook, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AccountDTO, AccountProvider, LinkedAccountDTO } from "@/entities/accounts/types";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";

const providerOrder: Record<AccountProvider, number> = {
  grok_build: 0,
  grok_web: 1,
  grok_console: 2,
};

const providerIcon: Record<AccountProvider, { icon: LucideIcon; className: string }> = {
  grok_build: { icon: SquareTerminal, className: "text-quota-product-1" },
  grok_web: { icon: Compass, className: "text-quota-product-2" },
  grok_console: { icon: Webhook, className: "text-quota-product-4" },
};

// 名称单元格里的一个“连接身份”：账号池加去重后的身份明细。
type AccountConnection = {
  id: string;
  provider: AccountProvider;
  details: string[];
};

function identityDetails(name: string, email?: string, userId?: string): string[] {
  const values = [email?.trim() || name.trim(), userId?.trim()];
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value) return false;
    const normalized = value.toLocaleLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function accountLinks(account: AccountDTO): LinkedAccountDTO[] {
  const links =
    account.linkedAccounts ??
    (account.linkedAccountId && account.linkedProvider
      ? [{ id: account.linkedAccountId, provider: account.linkedProvider, name: account.linkedAccountName ?? "" }]
      : []);
  return [...links].sort(
    (left, right) => providerOrder[left.provider] - providerOrder[right.provider] || left.id.localeCompare(right.id),
  );
}

function providerLabel(provider: AccountProvider, t: TFunction): string {
  if (provider === "grok_build") return t("models.providerGrokBuild");
  if (provider === "grok_web") return t("models.providerGrokWeb");
  return t("console.name");
}

/** 单元格展示的连接列表：自身在前，随后是按账号池排序的跨池关联。 */
function accountConnections(account: AccountDTO): AccountConnection[] {
  return [
    {
      id: account.id,
      provider: account.provider,
      details: identityDetails(account.name, account.email, account.userId),
    },
    ...accountLinks(account)
      .filter((linked) => linked.provider !== account.provider)
      .map((linked) => ({
        id: linked.id,
        provider: linked.provider,
        details: identityDetails(linked.name, linked.email, linked.userId),
      })),
  ].sort((left, right) => providerOrder[left.provider] - providerOrder[right.provider]);
}

export function AccountNameCell({ account }: { account: AccountDTO }): ReactNode {
  const { i18n } = useTranslation();
  const connections = accountConnections(account);

  return (
    <div className="flex min-h-9 min-w-0 flex-col justify-center gap-0.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="min-w-0 truncate text-xs font-medium">{account.name}</span>
          </TooltipTrigger>
          <TooltipContent>{account.name}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-h-4 w-fit min-w-0 items-center">
        <AccountConnectionsTooltip connections={connections} />
        <AccountProtocolMarks account={account} locale={i18n.language} />
        <AccountBotRiskMark account={account} />
      </div>
    </div>
  );
}

/** 账号池图标行：图标集合本身是提示内容的触发器，可访问名列出全部账号池。 */
function AccountConnectionsTooltip({ connections }: { connections: AccountConnection[] }): ReactNode {
  const { t } = useTranslation();
  const label = connections.map((connection) => providerLabel(connection.provider, t)).join(", ");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          aria-label={label}
          className="flex min-w-0 cursor-help items-center gap-1.5 overflow-hidden rounded-sm focus-visible:outline-none"
        >
          {connections.map((connection) => {
            const { icon: ProviderIcon, className } = providerIcon[connection.provider];
            return (
              <ProviderIcon
                key={`${connection.provider}:${connection.id}`}
                className={cn("size-3.5 shrink-0", className)}
              />
            );
          })}
        </div>
      </TooltipTrigger>
      <TooltipContent className="min-w-44 space-y-2 px-2.5 py-2">
        {connections.map((connection) => (
          <AccountConnectionRow key={`${connection.provider}:${connection.id}`} connection={connection} />
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

function AccountConnectionRow({ connection }: { connection: AccountConnection }): ReactNode {
  const { t } = useTranslation();
  const label = providerLabel(connection.provider, t);
  const { icon: ProviderIcon, className } = providerIcon[connection.provider];

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <ProviderIcon className={cn("size-3.5", className)} />
        <span>{label}</span>
      </div>
      {(connection.details.length > 0 ? connection.details : [label]).map((detail, index) => (
        <p key={detail} className={cn("max-w-64 truncate pl-5 text-xs", index > 0 && "text-primary-foreground/70")}>
          {detail}
        </p>
      ))}
    </div>
  );
}

/** 协议标记行：接受条款与 NSFW 标记共用一个分隔符。 */
function AccountProtocolMarks({ account, locale }: { account: AccountDTO; locale: string }): ReactNode {
  if (!account.termsAcceptedAt && !account.nsfwEnabledAt) return null;

  return (
    <>
      <span className="mx-2 h-3 w-px shrink-0 bg-border" aria-hidden="true" />
      <span className="flex items-center gap-1.5">
        <AccountTermsMark acceptedAt={account.termsAcceptedAt} locale={locale} />
        <AccountNsfwMark enabledAt={account.nsfwEnabledAt} locale={locale} />
      </span>
    </>
  );
}

function AccountTermsMark({ acceptedAt, locale }: { acceptedAt?: string; locale: string }): ReactNode {
  const { t } = useTranslation();
  if (!acceptedAt) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={t("webAccountSettings.acceptTerms")}
          className="inline-flex cursor-help text-pink-500 focus-visible:outline-none dark:text-pink-400"
        >
          <Handshake className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {t("webAccountSettings.acceptTerms")} · {formatDateTime(acceptedAt, locale)}
      </TooltipContent>
    </Tooltip>
  );
}

function AccountNsfwMark({ enabledAt, locale }: { enabledAt?: string; locale: string }): ReactNode {
  const { t } = useTranslation();
  if (!enabledAt) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={t("accounts.nsfwEnabledMark")}
          className="inline-flex cursor-help text-yellow-500 focus-visible:outline-none dark:text-yellow-400"
        >
          <VenusAndMars className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("accounts.nsfwEnabledTooltip", { time: formatDateTime(enabledAt, locale) })}</TooltipContent>
    </Tooltip>
  );
}

function AccountBotRiskMark({ account }: { account: AccountDTO }): ReactNode {
  const { t } = useTranslation();
  if (!account.buildBotFlagged) return null;
  const tooltipKey =
    account.buildBotFlagSource === 2
      ? "accounts.botRiskTooltipSource2"
      : account.buildBotFlagSource === 1
        ? "accounts.botRiskTooltipSource1"
        : "accounts.botRiskTooltip";

  return (
    <>
      <span className="mx-2 h-3 w-px shrink-0 bg-border" aria-hidden="true" />
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={t("accounts.botRisk")}
            className={
              account.buildBotFlagSource === 2
                ? "inline-flex cursor-help text-rose-500 focus-visible:outline-none dark:text-rose-400"
                : "inline-flex cursor-help text-amber-500 focus-visible:outline-none dark:text-amber-400"
            }
          >
            <Bot className="size-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{t(tooltipKey)}</TooltipContent>
      </Tooltip>
    </>
  );
}
