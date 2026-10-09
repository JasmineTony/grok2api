import type { UseMutationResult } from "@tanstack/react-query";
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
import type { EgressUnhealthyCleanupPreviewDTO } from "@/features/settings/settings-api";

/** 批量删除节点确认：展示选中数量、受影响账号与订阅源托管数量。 */
export function EgressNodesBatchDeleteDialog({
  open,
  selectedCount,
  assignedAccounts,
  sourceNodes,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  selectedCount: number;
  assignedAccounts: number;
  sourceNodes: number;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="egress-nodes-batch-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("settings.egress.batchDeleteTitle", { count: selectedCount })}</AlertDialogTitle>
          <EgressBatchDeleteDescription
            selectedCount={selectedCount}
            assignedAccounts={assignedAccounts}
            sourceNodes={sourceNodes}
          />
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} data-testid="egress-nodes-batch-delete-cancel">
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            data-testid="egress-nodes-batch-delete-confirm"
          >
            {pending ? <Spinner /> : null}
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EgressBatchDeleteDescription({
  selectedCount,
  assignedAccounts,
  sourceNodes,
}: {
  selectedCount: number;
  assignedAccounts: number;
  sourceNodes: number;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialogDescription className="space-y-1">
      <span className="block">
        {t("settings.egress.batchDeleteDescription", { count: selectedCount, accounts: assignedAccounts })}
      </span>
      {sourceNodes > 0 ? (
        <span className="block">{t("settings.egress.batchDeleteSourceHint", { count: sourceNodes })}</span>
      ) : null}
    </AlertDialogDescription>
  );
}

/** 清理不可用节点确认：先展示预览统计，再允许执行清理。 */
export function EgressNodesCleanupDialog({
  open,
  preview,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  preview: UseMutationResult<EgressUnhealthyCleanupPreviewDTO, Error, void>;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="egress-nodes-cleanup-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("settings.egress.cleanupUnavailableTitle")}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">{t("settings.egress.cleanupUnavailableDescription")}</span>
            <span className="block">{t("settings.egress.cleanupUnavailableImpact")}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <EgressCleanupPreviewPanel preview={preview} />
        <EgressCleanupFooter
          pending={pending}
          disabled={pending || !preview.data || preview.data.nodes === 0}
          onConfirm={onConfirm}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EgressCleanupPreviewPanel({
  preview,
}: {
  preview: UseMutationResult<EgressUnhealthyCleanupPreviewDTO, Error, void>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="min-h-20 rounded-md bg-muted/45 p-3 text-xs">
        {preview.isPending ? (
          <div className="flex h-14 items-center justify-center gap-2 text-muted-foreground">
            <Spinner />
            {t("settings.egress.cleanupPreviewLoading")}
          </div>
        ) : null}
        {preview.isError ? (
          <div className="flex h-14 items-center justify-center text-center text-destructive">
            {t("settings.egress.cleanupPreviewFailed")}
          </div>
        ) : null}
        {preview.data ? (
          <div className="grid grid-cols-3 gap-3 text-center">
            <CleanupPreviewValue label={t("settings.egress.cleanupNodeCount")} value={preview.data.nodes} />
            <CleanupPreviewValue label={t("settings.egress.cleanupAccountCount")} value={preview.data.boundAccounts} />
            <CleanupPreviewValue
              label={t("settings.egress.cleanupSubscriptionCount")}
              value={preview.data.subscriptionManaged}
            />
          </div>
        ) : null}
      </div>
      {preview.data && preview.data.subscriptionManaged > 0 ? (
        <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
          {t("settings.egress.cleanupSubscriptionHint")}
        </p>
      ) : null}
    </>
  );
}

function EgressCleanupFooter({
  pending,
  disabled,
  onConfirm,
}: {
  pending: boolean;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialogFooter>
      <AlertDialogCancel disabled={pending} data-testid="egress-nodes-cleanup-cancel">
        {t("common.cancel")}
      </AlertDialogCancel>
      <AlertDialogAction
        className="bg-destructive text-white hover:bg-destructive/90"
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          onConfirm();
        }}
        data-testid="egress-nodes-cleanup-confirm"
      >
        {pending ? <Spinner /> : null}
        {t("settings.egress.cleanupUnavailableConfirm")}
      </AlertDialogAction>
    </AlertDialogFooter>
  );
}

function CleanupPreviewValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="text-base font-medium tabular-nums text-foreground">{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}
