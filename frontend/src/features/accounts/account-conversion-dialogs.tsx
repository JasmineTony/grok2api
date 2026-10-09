import { SquareTerminal, Webhook } from "lucide-react";
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
import type { BuildConversionStrategy } from "@/features/accounts/accounts-dto";

type WebConversionTarget = "build" | "console";

type WebConversionDialogProps = {
  open: boolean;
  targets: string[] | "all" | null;
  target: WebConversionTarget;
  onTargetChange: (value: WebConversionTarget) => void;
  strategy: BuildConversionStrategy;
  onStrategyChange: (value: BuildConversionStrategy) => void;
  pending: boolean;
  conversionProgress: AccountTaskProgressDTO | null;
  syncProgress: AccountTaskProgressDTO | null;
  onClose: () => void;
  onConfirm: () => void;
};

/** Grok Web 转 Build / 同步 Console 的确认框：目标与策略两组选项。 */
export function WebConversionDialog({
  open,
  targets,
  target,
  onTargetChange,
  strategy,
  onStrategyChange,
  pending,
  conversionProgress,
  syncProgress,
  onClose,
  onConfirm,
}: WebConversionDialogProps): ReactNode {
  const blocked = pending || targets === null || (Array.isArray(targets) && targets.length === 0);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogContent>
        <ConversionDialogHeader targets={targets} />
        <ConversionTargetTabs target={target} onTargetChange={onTargetChange} disabled={pending} />
        <ConversionStrategyTabs
          target={target}
          strategy={strategy}
          onStrategyChange={onStrategyChange}
          disabled={pending}
        />
        <ConversionFooter
          blocked={blocked}
          pending={pending}
          target={target}
          conversionProgress={conversionProgress}
          syncProgress={syncProgress}
          onConfirm={onConfirm}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConversionFooter({
  blocked,
  pending,
  target,
  conversionProgress,
  syncProgress,
  onConfirm,
}: {
  blocked: boolean;
  pending: boolean;
  target: WebConversionTarget;
  conversionProgress: AccountTaskProgressDTO | null;
  syncProgress: AccountTaskProgressDTO | null;
  onConfirm: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <AlertDialogFooter>
      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
      <AlertDialogAction
        disabled={blocked}
        onClick={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        {pending ? (
          <ConversionPendingLabel target={target} conversionProgress={conversionProgress} syncProgress={syncProgress} />
        ) : (
          t("accountConversion.start")
        )}
      </AlertDialogAction>
    </AlertDialogFooter>
  );
}

function ConversionTargetTabs({
  target,
  onTargetChange,
  disabled,
}: {
  target: WebConversionTarget;
  onTargetChange: (value: WebConversionTarget) => void;
  disabled: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p id="web-conversion-target" className="text-xs font-medium">
        {t("accountConversion.target")}
      </p>
      <Tabs value={target} onValueChange={(value) => onTargetChange(value as WebConversionTarget)}>
        <TabsList aria-labelledby="web-conversion-target" className="grid h-10 w-full grid-cols-2 p-1">
          <TabsTrigger value="build" className="h-8 gap-2 font-normal" disabled={disabled}>
            <SquareTerminal className="text-quota-product-1" />
            Grok Build
          </TabsTrigger>
          <TabsTrigger value="console" className="h-8 gap-2 font-normal" disabled={disabled}>
            <Webhook className="text-quota-product-4" />
            Grok Console
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

function ConversionStrategyTabs({
  target,
  strategy,
  onStrategyChange,
  disabled,
}: {
  target: WebConversionTarget;
  strategy: BuildConversionStrategy;
  onStrategyChange: (value: BuildConversionStrategy) => void;
  disabled: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p id="web-conversion-strategy" className="text-xs font-medium">
        {t("accountConversion.strategy")}
      </p>
      <Tabs value={strategy} onValueChange={(value) => onStrategyChange(value as BuildConversionStrategy)}>
        <TabsList aria-labelledby="web-conversion-strategy" className="grid h-10 w-full grid-cols-2 p-1">
          <TabsTrigger value="missing" className="h-8 font-normal" disabled={disabled}>
            {t("accountConversion.missing")}
          </TabsTrigger>
          <TabsTrigger value="all" className="h-8 font-normal" disabled={disabled}>
            {t("accountConversion.all")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="min-h-8 text-xs text-muted-foreground">
        {t(
          target === "build"
            ? strategy === "missing"
              ? "accountBulk.missingStrategyDescription"
              : "accountBulk.allStrategyDescription"
            : strategy === "missing"
              ? "webConsoleSync.missingStrategyDescription"
              : "webConsoleSync.allStrategyDescription",
        )}
      </p>
    </div>
  );
}

function ConversionPendingLabel({
  target,
  conversionProgress,
  syncProgress,
}: {
  target: WebConversionTarget;
  conversionProgress: AccountTaskProgressDTO | null;
  syncProgress: AccountTaskProgressDTO | null;
}): ReactNode {
  const { t } = useTranslation();
  if (target === "build" && conversionProgress) {
    return (
      <>
        <Spinner />
        <span className="whitespace-nowrap tabular-nums">
          {t(
            conversionProgress.phase === "syncing" ? "accounts.syncingProgress" : "accounts.convertingProgress",
            conversionProgress,
          )}
        </span>
      </>
    );
  }
  if (target === "console" && syncProgress) {
    return (
      <>
        <Spinner />
        <span className="whitespace-nowrap tabular-nums">
          {t(syncProgress.phase === "syncing" ? "common.syncingProgress" : "common.importingProgress", syncProgress)}
        </span>
      </>
    );
  }
  return (
    <>
      <Spinner />
      {t("common.loading")}
    </>
  );
}

type RenewAllTokensDialogProps = {
  open: boolean;
  pending: boolean;
  progress: AccountTaskProgressDTO | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/** 全量刷新 Build 账号凭据的确认框。 */
export function RenewAllTokensDialog({
  open,
  pending,
  progress,
  onOpenChange,
  onConfirm,
}: RenewAllTokensDialogProps): ReactNode {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("accounts.renewAllTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("accounts.renewAllDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending ? (
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
            ) : (
              t("accounts.renewAll")
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConversionDialogHeader({ targets }: { targets: string[] | "all" | null }): ReactNode {
  const { t } = useTranslation();
  const count = Array.isArray(targets) ? targets.length : 0;
  return (
    <AlertDialogHeader>
      <AlertDialogTitle>{t("accountConversion.title")}</AlertDialogTitle>
      <AlertDialogDescription>
        {t(targets === "all" ? "accountConversion.allDescription" : "accountConversion.selectedDescription", {
          count,
        })}
      </AlertDialogDescription>
    </AlertDialogHeader>
  );
}
