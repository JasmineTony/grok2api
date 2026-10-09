import { Link, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { DeviceSessionDTO } from "@/features/accounts/accounts-dto";
import { CopyButton } from "@/shared/components/copy-button";
import { LoadingState } from "@/shared/components/data-state";
import { formatDateTime } from "@/shared/lib/format";

type DeviceStatus = "starting" | "pending" | "failed";

type DeviceLoginDialogProps = {
  open: boolean;
  status: DeviceStatus;
  session: DeviceSessionDTO | null;
  language: string;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
};

/** Grok Build 设备授权弹窗：展示 user code 与轮询状态。 */
export function DeviceLoginDialog({
  open,
  status,
  session,
  language,
  onOpenChange,
  onRetry,
}: DeviceLoginDialogProps): ReactNode {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px] pb-6">
        <DialogHeader className="pr-7">
          <DialogTitle>{t("accounts.deviceTitle")}</DialogTitle>
          <DialogDescription>{t("accounts.deviceDescription")}</DialogDescription>
        </DialogHeader>
        {status === "starting" ? <LoadingState className="min-h-28" /> : null}
        {session ? (
          <DeviceSessionPanel session={session} status={status} language={language} onRetry={onRetry} />
        ) : null}
        {status === "failed" && !session ? (
          <Button type="button" variant="secondary" size="sm" className="justify-self-end" onClick={onRetry}>
            <RefreshCw />
            {t("common.retry")}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type DeviceSessionPanelProps = {
  session: DeviceSessionDTO;
  status: DeviceStatus;
  language: string;
  onRetry: () => void;
};

function DeviceSessionPanel({ session, status, language, onRetry }: DeviceSessionPanelProps): ReactNode {
  return (
    <div className="space-y-4">
      <DeviceUserCode session={session} language={language} />
      {status === "pending" ? <DeviceWaitingRow session={session} /> : null}
      {status === "failed" ? <DeviceRetryRow onRetry={onRetry} /> : null}
    </div>
  );
}

function DeviceUserCode({ session, language }: { session: DeviceSessionDTO; language: string }): ReactNode {
  const { t } = useTranslation();
  return (
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
        {t("accounts.expiresAt", { time: formatDateTime(session.expiresAt, language) })}
      </p>
    </div>
  );
}

function DeviceWaitingRow({ session }: { session: DeviceSessionDTO }): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 pt-1" aria-live="polite">
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        {t("accounts.waiting")}
      </span>
      <Button
        type="button"
        size="sm"
        className="shrink-0"
        onClick={() =>
          window.open(session.verificationUriComplete || session.verificationUri, "_blank", "noopener,noreferrer")
        }
      >
        <Link />
        {t("accounts.openVerification")}
      </Button>
    </div>
  );
}

function DeviceRetryRow({ onRetry }: { onRetry: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">{t("apiErrors.deviceLoginFailed")}</p>
      <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={onRetry}>
        <RefreshCw />
        {t("common.retry")}
      </Button>
    </div>
  );
}
