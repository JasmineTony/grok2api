import { ArrowRight, FileUp, Link, RefreshCw } from "lucide-react";
import type { ChangeEvent, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatAccountState } from "@/features/accounts/account-state";
import type {
  AccountCleanupStatus,
  AccountDTO,
  AccountProvider,
  AccountStateEventDTO,
  DeviceSessionDTO,
} from "@/features/accounts/accounts-api";
import { CopyButton } from "@/shared/components/copy-button";
import { EmptyState, ErrorState, LoadingState } from "@/shared/components/data-state";
import { formatDateTime } from "@/shared/lib/format";

export function AccountDeviceDialog({
  open,
  onOpenChange,
  status,
  session,
  locale,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: "starting" | "pending" | "failed";
  session: DeviceSessionDTO | null;
  locale: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const openVerification = () => {
    if (!session) return;
    window.open(
      session.verificationUriComplete || session.verificationUri,
      "_blank",
      "noopener,noreferrer",
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px] pb-6">
        <DialogHeader className="pr-7">
          <DialogTitle>{t("accounts.deviceTitle")}</DialogTitle>
          <DialogDescription>{t("accounts.deviceDescription")}</DialogDescription>
        </DialogHeader>
        {status === "starting" ? <LoadingState className="min-h-28" /> : null}
        {session ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 px-3 py-2.5">
              <span className="text-[11px] text-muted-foreground">{t("accounts.userCode")}</span>
              <div className="mt-0.5 flex items-center justify-between gap-3">
                <code className="min-w-0 select-all font-mono text-xl font-semibold tracking-[0.08em] tabular-nums">
                  {session.userCode}
                </code>
                <CopyButton
                  value={session.userCode}
                  className="-mr-1 size-7"
                  onCopied={() => toast.success(t("common.copied"))}
                />
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                {t("accounts.expiresAt", {
                  time: formatDateTime(session.expiresAt, locale),
                })}
              </p>
            </div>
            {status === "pending" ? (
              <div
                className="flex min-h-10 items-center justify-between gap-4 pt-1"
                aria-live="polite"
              >
                <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" />
                  {t("accounts.waiting")}
                </span>
                <Button type="button" size="sm" className="shrink-0" onClick={openVerification}>
                  <Link />
                  {t("accounts.openVerification")}
                </Button>
              </div>
            ) : null}
            {status === "failed" ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">{t("apiErrors.deviceLoginFailed")}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={onRetry}
                >
                  <RefreshCw />
                  {t("common.retry")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {status === "failed" && !session ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="justify-self-end"
            onClick={onRetry}
          >
            <RefreshCw />
            {t("common.retry")}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function AccountQuickImportDialog({
  open,
  onOpenChange,
  provider,
  pending,
  tokens,
  onTokensChange,
  fileInputRef,
  onLoadFile,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: AccountProvider;
  pending: boolean;
  tokens: string;
  onTokensChange: (value: string) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onLoadFile: (file: File | undefined) => Promise<void>;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    void onLoadFile(event.target.files?.[0]);
    event.target.value = "";
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(
              provider === "grok_console"
                ? "console.quickImportTitle"
                : "accounts.quickImportTitle",
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              provider === "grok_console"
                ? "console.quickImportDescription"
                : "accounts.quickImportDescription",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="quick-sso-tokens">{t("accounts.ssoTokens")}</Label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp />
              {t("accounts.uploadTXT")}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="text/plain,.txt"
              className="hidden"
              onChange={handleFile}
            />
          </div>
          <Textarea
            id="quick-sso-tokens"
            className="min-h-56 font-mono"
            autoComplete="off"
            spellCheck={false}
            value={tokens}
            onChange={(event) => onTokensChange(event.target.value)}
            placeholder={t("accounts.ssoTokenPlaceholder")}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" size="sm" disabled={!tokens.trim() || pending} onClick={onSubmit}>
            {pending ? <Spinner /> : null}
            {t("accounts.importAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AccountStateHistoryDialog({
  account,
  events,
  pending,
  error,
  locale,
  onOpenChange,
  onRetry,
}: {
  account: AccountDTO | null;
  events: AccountStateEventDTO[] | undefined;
  pending: boolean;
  error: string;
  locale: string;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={Boolean(account)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{t("accounts.stateHistory")}</DialogTitle>
          <DialogDescription>
            {account?.name}
            {account?.stateChangedAt
              ? ` · ${t("accounts.stateChangedAt", { time: formatDateTime(account.stateChangedAt, locale) })}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {pending ? <LoadingState className="min-h-32" /> : null}
        {error ? <ErrorState message={error} onRetry={onRetry} /> : null}
        {events?.length === 0 ? <EmptyState message={t("accounts.noStateEvents")} /> : null}
        {events && events.length > 0 ? (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {events.map((event) => (
              <div key={event.id} className="rounded-md border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <span>{formatAccountState(event.fromState, t)}</span>
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                    <span>{formatAccountState(event.toState, t)}</span>
                  </div>
                  <time className="text-[11px] text-muted-foreground">
                    {formatDateTime(event.createdAt, locale)}
                  </time>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {event.event}
                  {event.reason ? ` · ${event.reason}` : ""}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function AccountDeleteDialogs({
  deleting,
  batchOpen,
  selectedCount,
  onDeletingChange,
  onBatchOpenChange,
  onDelete,
  onBatchDelete,
}: {
  deleting: AccountDTO | null;
  batchOpen: boolean;
  selectedCount: number;
  onDeletingChange: (account: AccountDTO | null) => void;
  onBatchOpenChange: (open: boolean) => void;
  onDelete: (id: string) => void;
  onBatchDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && onDeletingChange(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("accounts.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("accounts.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleting && onDelete(deleting.id)}
            >
              {t("accounts.cleanupStart")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={batchOpen} onOpenChange={onBatchOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("accounts.batchDeleteTitle", { count: selectedCount })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("accounts.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={onBatchDelete}
            >
              {t("accounts.cleanupStart")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function AccountCleanupDialog({
  open,
  provider,
  statuses,
  pending,
  onOpenChange,
  onStatusesChange,
  onSubmit,
}: {
  open: boolean;
  provider: AccountProvider;
  statuses: Set<AccountCleanupStatus>;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusesChange: (statuses: Set<AccountCleanupStatus>) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const providerName =
    provider === "grok_build"
      ? "Grok Build"
      : provider === "grok_web"
        ? "Grok Web"
        : "Grok Console";
  const options = [
    ["cooldown", t("accounts.statusCooldown")],
    ["disabled", t("accounts.statusDisabled")],
    ["reauthRequired", t("accounts.statusReauthRequired")],
  ] as const;
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t("accounts.cleanupTitle", { provider: providerName })}</DialogTitle>
          <DialogDescription>{t("accounts.cleanupDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {options.map(([status, label]) => (
            <label
              key={status}
              className="flex cursor-pointer items-center gap-3 rounded-md bg-muted/40 px-3 py-2.5 text-xs"
            >
              <Checkbox
                checked={statuses.has(status)}
                disabled={pending}
                onCheckedChange={(checked) => {
                  const next = new Set(statuses);
                  if (checked === true) next.add(status);
                  else next.delete(status);
                  onStatusesChange(next);
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending || statuses.size === 0}
            onClick={onSubmit}
          >
            {pending ? <Spinner /> : null}
            {t("accounts.cleanupStart")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
