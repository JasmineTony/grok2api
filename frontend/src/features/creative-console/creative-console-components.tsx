import {
  BrainCircuit,
  CheckCircle2,
  Globe,
  Loader2,
  RefreshCw,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Message, MessageContent } from "@/components/ui/message";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ModelRouteDTO } from "@/entities/model/types";
import type { ConversationMessage } from "@/features/creative-console/chat-history";
import type { ChatToolActivity } from "@/features/creative-console/creative-console-api";
import { cn } from "@/shared/lib/cn";
import { SafeMarkdown } from "@/shared/security/safe-markdown";

export function WelcomeState({ title }: { title: string }) {
  return (
    <div className="flex min-h-[20rem] items-center justify-center px-6 text-center">
      <h2 className="max-w-2xl text-xl font-medium tracking-tight text-muted-foreground sm:text-2xl">
        {title}
      </h2>
    </div>
  );
}

export function CompactModelSelect({
  value,
  models,
  onChange,
}: {
  value: string;
  models: ModelRouteDTO[];
  onChange: (model: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={onChange} disabled={models.length === 0}>
      <SelectTrigger
        className="h-8 w-auto max-w-56 gap-1 border-0 bg-transparent px-2 shadow-none hover:bg-secondary/70 focus:bg-secondary/70 focus:ring-0"
        aria-label={t("creativeConsole.model")}
      >
        <SelectValue
          placeholder={
            models.length === 0 ? t("creativeConsole.noModels") : t("creativeConsole.selectModel")
          }
        />
      </SelectTrigger>
      <SelectContent>
        {models.map((item) => (
          <SelectItem key={item.id} value={item.publicId}>
            {item.publicId}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CompactSelect({
  value,
  options,
  onChange,
  ariaLabel,
  suffix,
  icon,
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  ariaLabel: string;
  suffix?: string;
  icon?: ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className="h-8 w-auto gap-1.5 border-0 bg-transparent px-2 shadow-none hover:bg-secondary/70 focus:bg-secondary/70 focus:ring-0 [&>svg]:size-3.5 [&>svg]:shrink-0"
        aria-label={ariaLabel}
      >
        {icon}
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
            {suffix}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CompactIconSelect({
  value,
  options,
  onChange,
  ariaLabel,
  icon,
  active = false,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
  icon: ReactNode;
  active?: boolean;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? ariaLabel;
  return (
    <Select value={value} onValueChange={onChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger
            className={cn(
              "h-8 w-auto min-w-8 gap-1 bg-transparent px-2 shadow-none hover:bg-secondary/70 focus:bg-secondary/70 focus:ring-0",
              active && "bg-secondary/70 text-foreground",
            )}
            aria-label={`${ariaLabel}: ${selectedLabel}`}
          >
            <span className="flex items-center [&_svg]:size-3.5">{icon}</span>
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {ariaLabel} · {selectedLabel}
        </TooltipContent>
      </Tooltip>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function XSocialIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function ChatMessageItem({
  message,
  loading = false,
}: {
  message: ConversationMessage;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  return (
    <Message align={isUser ? "end" : "start"}>
      <MessageContent className={cn(!isUser && "w-full max-w-full")}>
        {!isUser && message.reasoning ? (
          <div className="w-full rounded-xl bg-secondary/45 px-3 py-2.5 text-xs text-muted-foreground">
            <div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground/75">
              <BrainCircuit className="size-3.5" />
              {t("creativeConsole.thinkingProcess")}
            </div>
            <div className="whitespace-pre-wrap break-words leading-5">{message.reasoning}</div>
          </div>
        ) : null}
        {!isUser && message.tools?.length ? (
          <div className="flex w-full flex-col gap-1.5">
            {message.tools.map((tool) => (
              <ToolActivityItem key={tool.id} tool={tool} />
            ))}
          </div>
        ) : null}
        {message.content || isUser ? (
          isUser ? (
            <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm leading-6">
              {message.content}
            </div>
          ) : (
            <SafeMarkdown content={message.content} />
          )
        ) : null}
        {loading ? (
          <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
            <Spinner />
            {t("creativeConsole.streaming")}
          </div>
        ) : null}
      </MessageContent>
    </Message>
  );
}

export function ToolActivityItem({ tool }: { tool: ChatToolActivity }) {
  const { t } = useTranslation();
  const isWebSearch = tool.name === "web_search" || tool.type === "web_search_call";
  const isXSearch = tool.name === "x_search" || tool.type === "x_search_call";
  const label = isWebSearch
    ? t("creativeConsole.toolNames.webSearch")
    : isXSearch
      ? t("creativeConsole.toolNames.xSearch")
      : tool.name;
  const statusLabel = t(`creativeConsole.toolStatus.${tool.status}`);
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-xl bg-secondary/45 px-3 py-2.5 text-xs">
      <span className="mt-0.5 text-muted-foreground">
        {isWebSearch ? (
          <Globe className="size-3.5" />
        ) : isXSearch ? (
          <XSocialIcon className="size-3.5" />
        ) : (
          <Wrench className="size-3.5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">
            {t("creativeConsole.toolCall")} · {label}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
            {tool.status === "in_progress" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : tool.status === "failed" ? (
              <TriangleAlert className="size-3 text-destructive" />
            ) : (
              <CheckCircle2 className="size-3" />
            )}
            {statusLabel}
          </span>
        </div>
        {tool.detail ? (
          <div
            className="mt-1 line-clamp-2 break-all leading-5 text-muted-foreground"
            title={tool.detail}
          >
            {tool.detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function LoadingResult({ text }: { text: string }) {
  return (
    <div className="flex min-h-[20rem] items-center justify-center gap-3 text-xs text-muted-foreground">
      <Spinner className="size-5" />
      {text}
    </div>
  );
}

export function InlineError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md bg-destructive/8 px-3 py-2 text-xs leading-5 text-destructive"
    >
      {message}
    </div>
  );
}

export function RetryableError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md bg-destructive/8 px-3 py-2 text-xs leading-5 text-destructive sm:flex-row sm:items-center sm:justify-between"
    >
      <span>{message}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start text-destructive hover:text-destructive sm:self-auto"
        onClick={onRetry}
      >
        <RefreshCw />
        {t("common.retry")}
      </Button>
    </div>
  );
}

export function MetaItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 py-2">
      <div className="mb-1 text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("truncate text-xs", mono && "font-mono")} title={value}>
        {value}
      </div>
    </div>
  );
}
