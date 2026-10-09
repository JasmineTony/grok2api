import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

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
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AccountTaskProgressDTO } from "@/features/accounts/account-task-progress";
import type { AccountProvider } from "@/features/accounts/accounts-dto";

type BuildQuotaTask = "sync" | "reset";

function QuotaTaskTabs({
  task,
  onTaskChange,
  disabled,
}: {
  task: BuildQuotaTask;
  onTaskChange: (value: BuildQuotaTask) => void;
  disabled: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <Tabs value={task} onValueChange={(value) => onTaskChange(value as BuildQuotaTask)}>
      <TabsList className="grid h-10 w-full grid-cols-2 p-1">
        <TabsTrigger value="sync" className="h-8 font-normal" disabled={disabled}>
          {t("accounts.refreshBilling")}
        </TabsTrigger>
        <TabsTrigger value="reset" className="h-8 font-normal" disabled={disabled}>
          {t("accountQuotaReset.action")}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

type QuotaSyncAllDialogProps = {
  open: boolean;
  provider: AccountProvider;
  task: BuildQuotaTask;
  onTaskChange: (value: BuildQuotaTask) => void;
  syncPending: boolean;
  resetPending: boolean;
  progress: AccountTaskProgressDTO | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/** 全量额度同步/重置确认框；Build 池额外提供同步与重置两种任务。 */
export function QuotaSyncAllDialog({
  open,
  provider,
  task,
  onTaskChange,
  syncPending,
  resetPending,
  progress,
  onOpenChange,
  onConfirm,
}: QuotaSyncAllDialogProps): ReactNode {
  const busy = syncPending || resetPending;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <QuotaSyncAllHeader provider={provider} />
        <QuotaSyncAllBody provider={provider} task={task} onTaskChange={onTaskChange} busy={busy} />
        <QuotaSyncAllFooter
          provider={provider}
          syncPending={syncPending}
          resetPending={resetPending}
          progress={progress}
          onConfirm={onConfirm}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function QuotaSyncAllFooter({
  provider,
  syncPending,
  resetPending,
  progress,
  onConfirm,
}: {
  provider: AccountProvider;
  syncPending: boolean;
  resetPending: boolean;
  progress: AccountTaskProgressDTO | null;
  onConfirm: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const busy = syncPending || resetPending;
  return (
    <AlertDialogFooter>
      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
      <AlertDialogAction
        disabled={busy}
        onClick={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        {syncPending ? (
          <>
            <Spinner />
            {progress ? (
              <span className="tabular-nums">
                {progress.completed} / {progress.total}
              </span>
            ) : (
              t("common.loading")
            )}
          </>
        ) : resetPending ? (
          <Spinner />
        ) : (
          t(provider === "grok_build" ? "accountQuotaTask.execute" : "accounts.syncAll")
        )}
      </AlertDialogAction>
    </AlertDialogFooter>
  );
}

type BatchQuotaTaskDialogProps = {
  open: boolean;
  selectedCount: number;
  task: BuildQuotaTask;
  onTaskChange: (value: BuildQuotaTask) => void;
  syncPending: boolean;
  resetPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/** 选中账号的额度同步/重置确认框（仅 Build 池）。 */
export function BatchQuotaTaskDialog({
  open,
  selectedCount,
  task,
  onTaskChange,
  syncPending,
  resetPending,
  onOpenChange,
  onConfirm,
}: BatchQuotaTaskDialogProps): ReactNode {
  const { t } = useTranslation();
  const busy = syncPending || resetPending;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("accountQuotaTask.title", { count: selectedCount })}</AlertDialogTitle>
          <AlertDialogDescription>{t("accountQuotaTask.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <QuotaTaskTabs task={task} onTaskChange={onTaskChange} disabled={busy} />
          <p className="min-h-10 text-xs leading-5 text-muted-foreground">
            {t(task === "sync" ? "accountQuotaTask.syncDescription" : "accountQuotaReset.description")}
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {busy ? <Spinner /> : null}
            {t("accountQuotaTask.execute")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function QuotaSyncAllHeader({ provider }: { provider: AccountProvider }): ReactNode {
  const { t } = useTranslation();
  const description =
    provider === "grok_build"
      ? "accountQuotaTask.allDescription"
      : provider === "grok_web"
        ? "accounts.syncAllWebDescription"
        : "console.syncAllDescription";
  return (
    <AlertDialogHeader>
      <AlertDialogTitle>
        {t(provider === "grok_build" ? "accountQuotaTask.allTitle" : "accounts.syncAllTitle")}
      </AlertDialogTitle>
      <AlertDialogDescription>{t(description)}</AlertDialogDescription>
    </AlertDialogHeader>
  );
}

function QuotaSyncAllBody({
  provider,
  task,
  onTaskChange,
  busy,
}: {
  provider: AccountProvider;
  task: BuildQuotaTask;
  onTaskChange: (value: BuildQuotaTask) => void;
  busy: boolean;
}): ReactNode {
  const { t } = useTranslation();
  if (provider !== "grok_build") return null;
  return (
    <div className="space-y-3">
      <QuotaTaskTabs task={task} onTaskChange={onTaskChange} disabled={busy} />
      <p className="min-h-10 text-xs leading-5 text-muted-foreground">
        {t(task === "sync" ? "accounts.syncAllDescription" : "accountQuotaTask.resetAllDescription")}
      </p>
    </div>
  );
}
