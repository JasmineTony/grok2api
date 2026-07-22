import { SquareTerminal, Webhook } from "lucide-react";
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
import type {
  AccountProvider,
  AccountTaskProgressDTO,
  BuildConversionStrategy,
} from "@/features/accounts/accounts-api";

export type WebConversionTarget = "build" | "console";
export type ConversionProgress = {
  converting?: AccountTaskProgressDTO;
  syncing?: AccountTaskProgressDTO;
};

export function AccountBulkDialogs({
  provider,
  syncOpen,
  syncPending,
  syncProgress,
  onSyncOpenChange,
  onSync,
  conversionTargets,
  conversionTarget,
  conversionStrategy,
  conversionPending,
  conversionProgress,
  consoleProgress,
  onConversionOpenChange,
  onConversionTargetChange,
  onConversionStrategyChange,
  onConvert,
  renewOpen,
  renewPending,
  renewalProgress,
  onRenewOpenChange,
  onRenew,
  exportOpen,
  exportPending,
  onExportOpenChange,
  onExport,
}: {
  provider: AccountProvider;
  syncOpen: boolean;
  syncPending: boolean;
  syncProgress: AccountTaskProgressDTO | null;
  onSyncOpenChange: (open: boolean) => void;
  onSync: () => void;
  conversionTargets: string[] | "all" | null;
  conversionTarget: WebConversionTarget;
  conversionStrategy: BuildConversionStrategy;
  conversionPending: boolean;
  conversionProgress: ConversionProgress | null;
  consoleProgress: AccountTaskProgressDTO | null;
  onConversionOpenChange: (open: boolean) => void;
  onConversionTargetChange: (target: WebConversionTarget) => void;
  onConversionStrategyChange: (strategy: BuildConversionStrategy) => void;
  onConvert: () => void;
  renewOpen: boolean;
  renewPending: boolean;
  renewalProgress: AccountTaskProgressDTO | null;
  onRenewOpenChange: (open: boolean) => void;
  onRenew: () => void;
  exportOpen: boolean;
  exportPending: boolean;
  onExportOpenChange: (open: boolean) => void;
  onExport: () => void;
}) {
  const { t } = useTranslation();
  const converting = conversionProgress?.converting;
  const syncing = conversionProgress?.syncing;
  const activeProgress =
    converting?.completed === converting?.total && syncing
      ? { ...syncing, phase: "syncing" }
      : converting
        ? { ...converting, phase: "converting" }
        : syncing
          ? { ...syncing, phase: "syncing" }
          : null;
  return (
    <>
      <AlertDialog open={syncOpen} onOpenChange={onSyncOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("accounts.syncAllTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                provider === "grok_web"
                  ? "accounts.syncAllWebDescription"
                  : provider === "grok_console"
                    ? "console.syncAllDescription"
                    : "accounts.syncAllDescription",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={syncPending}
              onClick={(event) => {
                event.preventDefault();
                onSync();
              }}
            >
              {syncPending ? (
                <>
                  <Spinner />
                  {syncProgress ? (
                    <span className="tabular-nums">
                      {syncProgress.completed} / {syncProgress.total}
                    </span>
                  ) : (
                    t("common.loading")
                  )}
                </>
              ) : (
                t("accounts.syncAll")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={conversionTargets !== null} onOpenChange={onConversionOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("accountConversion.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                conversionTargets === "all"
                  ? "accountConversion.allDescription"
                  : "accountConversion.selectedDescription",
                {
                  count: Array.isArray(conversionTargets) ? conversionTargets.length : 0,
                },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <p id="web-conversion-target" className="text-xs font-medium">
              {t("accountConversion.target")}
            </p>
            <Tabs
              value={conversionTarget}
              onValueChange={(value) => onConversionTargetChange(value as WebConversionTarget)}
            >
              <TabsList
                aria-labelledby="web-conversion-target"
                className="grid h-10 w-full grid-cols-2 p-1"
              >
                <TabsTrigger
                  value="build"
                  className="h-8 gap-2 font-normal"
                  disabled={conversionPending}
                >
                  <SquareTerminal className="text-quota-product-1" />
                  Grok Build
                </TabsTrigger>
                <TabsTrigger
                  value="console"
                  className="h-8 gap-2 font-normal"
                  disabled={conversionPending}
                >
                  <Webhook className="text-quota-product-4" />
                  Grok Console
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="space-y-2">
            <p id="web-conversion-strategy" className="text-xs font-medium">
              {t("accountConversion.strategy")}
            </p>
            <Tabs
              value={conversionStrategy}
              onValueChange={(value) =>
                onConversionStrategyChange(value as BuildConversionStrategy)
              }
            >
              <TabsList
                aria-labelledby="web-conversion-strategy"
                className="grid h-10 w-full grid-cols-2 p-1"
              >
                <TabsTrigger
                  value="missing"
                  className="h-8 font-normal"
                  disabled={conversionPending}
                >
                  {t("accountConversion.missing")}
                </TabsTrigger>
                <TabsTrigger value="all" className="h-8 font-normal" disabled={conversionPending}>
                  {t("accountConversion.all")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="min-h-8 text-xs text-muted-foreground">
              {t(
                conversionTarget === "build"
                  ? conversionStrategy === "missing"
                    ? "accountBulk.missingStrategyDescription"
                    : "accountBulk.allStrategyDescription"
                  : conversionStrategy === "missing"
                    ? "webConsoleSync.missingStrategyDescription"
                    : "webConsoleSync.allStrategyDescription",
              )}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                conversionPending ||
                conversionTargets === null ||
                (Array.isArray(conversionTargets) && conversionTargets.length === 0)
              }
              onClick={(event) => {
                event.preventDefault();
                onConvert();
              }}
            >
              {conversionPending ? (
                <>
                  <Spinner />
                  {conversionTarget === "build" && activeProgress ? (
                    <span className="whitespace-nowrap tabular-nums">
                      {t(
                        activeProgress.phase === "syncing"
                          ? "accounts.syncingProgress"
                          : "accounts.convertingProgress",
                        activeProgress,
                      )}
                    </span>
                  ) : consoleProgress ? (
                    <span className="tabular-nums">
                      {consoleProgress.completed} / {consoleProgress.total}
                    </span>
                  ) : (
                    t("common.loading")
                  )}
                </>
              ) : (
                t("accountConversion.start")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={renewOpen} onOpenChange={onRenewOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("accounts.renewAllTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("accounts.renewAllDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={renewPending}
              onClick={(event) => {
                event.preventDefault();
                onRenew();
              }}
            >
              {renewPending ? (
                <>
                  <Spinner />
                  {renewalProgress ? (
                    <span className="tabular-nums">
                      {renewalProgress.completed} / {renewalProgress.total}
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
      <AlertDialog open={exportOpen} onOpenChange={onExportOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("accounts.exportTitle", {
                provider:
                  provider === "grok_build"
                    ? "Grok Build"
                    : provider === "grok_web"
                      ? "Grok Web"
                      : "Grok Console",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("accounts.exportDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={exportPending} onClick={onExport}>
              {t("accounts.exportAuth")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
