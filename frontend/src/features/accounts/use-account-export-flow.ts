import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { exportAccountBatch, exportSelectedAccounts } from "@/features/accounts/accounts-api";
import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import { downloadAccountExport } from "@/features/accounts/accounts-view-model";

type ExportProgress = { cursor: string; snapshotMaxId: string; batchNumber: number; completed: number };
type ExportInput =
  | { kind: "selected"; ids: string[] }
  | { kind: "batch"; limit: number; afterId: string; snapshotMaxId: string; batchNumber: number };

const initialExportProgress: ExportProgress = { cursor: "0", snapshotMaxId: "0", batchNumber: 1, completed: 0 };

export type AccountsExportFlow = {
  open: boolean;
  provider: AccountsFlowContext["provider"];
  selectedCount: number;
  limit: string;
  onLimitChange: (value: string) => void;
  completedCount: number;
  batchNumber: number;
  snapshotMaxId: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  openProviderExport: () => void;
  openSelectedExport: () => void;
};

function useExportMutation(input: {
  ctx: AccountsFlowContext;
  progress: ExportProgress;
  setProgress: (value: ExportProgress) => void;
  closeDialog: () => void;
}) {
  const { ctx, progress, setProgress, closeDialog } = input;
  const { provider, showError, t } = ctx;
  return useMutation({
    mutationFn: async (payload: ExportInput) => {
      if (payload.kind === "selected") {
        return { kind: payload.kind, blob: await exportSelectedAccounts(provider, payload.ids) } as const;
      }
      return {
        kind: payload.kind,
        batchNumber: payload.batchNumber,
        batch: await exportAccountBatch(provider, payload.limit, payload.afterId, payload.snapshotMaxId),
      } as const;
    },
    onSuccess: (result) => {
      if (result.kind === "selected") {
        downloadAccountExport(result.blob, provider, "selected");
        closeDialog();
        toast.success(t("accounts.exported"));
        return;
      }
      downloadAccountExport(result.batch.blob, provider, `batch-${String(result.batchNumber).padStart(4, "0")}`);
      const completed = progress.completed + result.batch.count;
      if (result.batch.hasMore) {
        setProgress({
          cursor: result.batch.nextId,
          snapshotMaxId: result.batch.snapshotMaxId,
          batchNumber: result.batchNumber + 1,
          completed,
        });
        toast.success(t("accountExport.batchCompleted", { count: result.batch.count }));
        return;
      }
      closeDialog();
      toast.success(t("accountExport.completed", { count: completed }));
    },
    onError: showError,
  });
}

/** 导出确认框：按选中集合导出，或按上限分批导出整个账号池。 */
export function useAccountsExportFlow(ctx: AccountsFlowContext): AccountsExportFlow {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState("1000");
  const [progress, setProgress] = useState(initialExportProgress);
  const mutation = useExportMutation({ ctx, progress, setProgress, closeDialog: () => setOpen(false) });
  const resetProgress = (): void => setProgress(initialExportProgress);
  return {
    open,
    provider: ctx.provider,
    selectedCount: ctx.selectedCount,
    limit,
    onLimitChange: setLimit,
    completedCount: progress.completed,
    batchNumber: progress.batchNumber,
    snapshotMaxId: progress.snapshotMaxId,
    pending: mutation.isPending,
    onOpenChange: setOpen,
    onConfirm: () => {
      if (ctx.selectedCount > 0) {
        mutation.mutate({ kind: "selected", ids: ctx.selectedIds });
        return;
      }
      mutation.mutate({
        kind: "batch",
        limit: Number(limit),
        afterId: progress.cursor,
        snapshotMaxId: progress.snapshotMaxId,
        batchNumber: progress.batchNumber,
      });
    },
    openProviderExport: () => {
      ctx.clearSelection();
      resetProgress();
      setOpen(true);
    },
    openSelectedExport: () => {
      resetProgress();
      setOpen(true);
    },
  };
}
