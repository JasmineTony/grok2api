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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { AccountProvider } from "@/features/accounts/accounts-dto";

const exportProviderLabels: Record<AccountProvider, string> = {
  grok_build: "Grok Build",
  grok_web: "Grok Web",
  grok_console: "Grok Console",
};

type ExportAccountsDialogProps = {
  open: boolean;
  provider: AccountProvider;
  selectedCount: number;
  limit: string;
  onLimitChange: (value: string) => void;
  completedCount: number;
  batchNumber: number;
  snapshotMaxId: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/** 账号导出确认框：按选中集合导出，或按上限分批导出整个账号池。 */
export function ExportAccountsDialog({
  open,
  provider,
  selectedCount,
  limit,
  onLimitChange,
  completedCount,
  batchNumber,
  snapshotMaxId,
  pending,
  onOpenChange,
  onConfirm,
}: ExportAccountsDialogProps): ReactNode {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("accounts.exportTitle", { provider: exportProviderLabels[provider] })}</AlertDialogTitle>
          <AlertDialogDescription>{t("accounts.exportDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        {selectedCount > 0 ? (
          <p className="text-sm text-muted-foreground">{t("common.selectedCount", { count: selectedCount })}</p>
        ) : (
          <ExportBatchFields
            limit={limit}
            onLimitChange={onLimitChange}
            locked={snapshotMaxId !== "0"}
            completedCount={completedCount}
            batchNumber={batchNumber}
          />
        )}
        <ExportDialogFooter
          selectedCount={selectedCount}
          limit={limit}
          completedCount={completedCount}
          pending={pending}
          onConfirm={onConfirm}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ExportDialogFooter({
  selectedCount,
  limit,
  completedCount,
  pending,
  onConfirm,
}: {
  selectedCount: number;
  limit: string;
  completedCount: number;
  pending: boolean;
  onConfirm: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const numericLimit = Number(limit);
  const invalidLimit = !Number.isInteger(numericLimit) || numericLimit < 1 || numericLimit > 10000;
  return (
    <AlertDialogFooter>
      <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
      <AlertDialogAction
        disabled={pending || (selectedCount === 0 && invalidLimit)}
        onClick={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        {pending ? <Spinner /> : null}
        {selectedCount === 0 && completedCount > 0 ? t("accountExport.nextBatch") : t("accounts.exportAuth")}
      </AlertDialogAction>
    </AlertDialogFooter>
  );
}

function ExportBatchFields({
  limit,
  onLimitChange,
  locked,
  completedCount,
  batchNumber,
}: {
  limit: string;
  onLimitChange: (value: string) => void;
  locked: boolean;
  completedCount: number;
  batchNumber: number;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2">
      <Label htmlFor="account-export-limit">{t("accounts.exportCount")}</Label>
      <Input
        id="account-export-limit"
        type="number"
        min={1}
        max={10000}
        value={limit}
        disabled={locked}
        onChange={(event) => onLimitChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">{t("accountExport.countDescription")}</p>
      {completedCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("accountExport.batchProgress", { count: completedCount, batch: batchNumber })}
        </p>
      ) : null}
    </div>
  );
}
