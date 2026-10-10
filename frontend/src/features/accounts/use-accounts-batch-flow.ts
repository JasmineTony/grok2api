import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import {
  refreshAccountsQuota,
  refreshAccountsTokens,
  resetAccountsQuota,
  updateAccountsEnabled,
  updateAccountsMaxConcurrent,
} from "@/features/accounts/accounts-api";
import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";

type QuotaTask = "sync" | "reset";

export type AccountsBatchFlow = {
  onEnableSelected: () => void;
  onDisableSelected: () => void;
  onRefreshSelectedTokens: () => void;
  onOpenQuotaSync: () => void;
  onOpenConcurrency: () => void;
  concurrency: {
    open: boolean;
    selectedCount: number;
    value: string;
    onValueChange: (value: string) => void;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
  };
  quotaTask: {
    open: boolean;
    selectedCount: number;
    task: QuotaTask;
    onTaskChange: (value: QuotaTask) => void;
    syncPending: boolean;
    resetPending: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
  };
  pending: boolean;
};

function useBulkEnableMutation(ctx: AccountsFlowContext) {
  const { selectedIds, provider, clearSelection, invalidate, showError, t } = ctx;
  return useMutation({
    mutationFn: (enabled: boolean) => updateAccountsEnabled(selectedIds, enabled, provider),
    onSuccess: () => {
      clearSelection();
      invalidate();
      toast.success(t("accounts.batchUpdated"));
    },
    onError: showError,
  });
}

function useBulkTokenMutation(ctx: AccountsFlowContext) {
  const { selectedIds, provider, clearSelection, invalidate, showError, t } = ctx;
  return useMutation({
    mutationFn: () => refreshAccountsTokens(selectedIds, provider),
    onSuccess: (result) => {
      clearSelection();
      invalidate();
      toast.success(t("accounts.allTokensRefreshed", result));
    },
    onError: showError,
  });
}

function useBulkConcurrencyMutation(ctx: AccountsFlowContext, onDone: () => void) {
  const { selectedIds, provider, clearSelection, invalidate, showError, t } = ctx;
  return useMutation({
    mutationFn: (maxConcurrent: number) => updateAccountsMaxConcurrent(selectedIds, maxConcurrent, provider),
    onSuccess: () => {
      onDone();
      clearSelection();
      invalidate();
      toast.success(t("accounts.batchConcurrencyUpdated"));
    },
    onError: showError,
  });
}

/** 批量额度同步与重置共用同一套“关闭弹窗 + 取消选择 + 失效查询”收尾。 */
function useBulkQuotaMutation(ctx: AccountsFlowContext, onDone: () => void, action: QuotaTask) {
  const { selectedIds, provider, clearSelection, invalidate, showError, t } = ctx;
  return useMutation({
    mutationFn: async (): Promise<{ succeeded: number; failed: number } | { reset: number }> =>
      action === "sync"
        ? await refreshAccountsQuota(selectedIds, provider)
        : await resetAccountsQuota(selectedIds, provider),
    onSuccess: (result) => {
      onDone();
      clearSelection();
      invalidate();
      if (action === "sync") toast.success(t("accounts.batchBillingRefreshed", result));
      else toast.success(t("accountQuotaReset.completed", result));
    },
    onError: showError,
  });
}

function useBatchMutations(ctx: AccountsFlowContext, onDone: { quota: () => void; concurrency: () => void }) {
  return {
    enable: useBulkEnableMutation(ctx),
    tokens: useBulkTokenMutation(ctx),
    concurrency: useBulkConcurrencyMutation(ctx, onDone.concurrency),
    sync: useBulkQuotaMutation(ctx, onDone.quota, "sync"),
    reset: useBulkQuotaMutation(ctx, onDone.quota, "reset"),
  };
}

/** 批量操作：启用/禁用、并发上限、额度同步与重置、refresh token。 */
type ConcurrencyState = { open: boolean; value: string };
type QuotaTaskState = { open: boolean; task: QuotaTask };

function useBatchDialogState() {
  const [concurrency, setConcurrency] = useState<ConcurrencyState>({ open: false, value: "1" });
  const [quotaTask, setQuotaTask] = useState<QuotaTaskState>({ open: false, task: "sync" });
  return { concurrency, setConcurrency, quotaTask, setQuotaTask };
}

function buildBatchFlow(input: {
  ctx: AccountsFlowContext;
  mutations: ReturnType<typeof useBatchMutations>;
  dialogs: ReturnType<typeof useBatchDialogState>;
}): AccountsBatchFlow {
  const { ctx, mutations, dialogs } = input;
  const { concurrency, setConcurrency, quotaTask, setQuotaTask } = dialogs;
  return {
    onEnableSelected: () => mutations.enable.mutate(true),
    onDisableSelected: () => mutations.enable.mutate(false),
    onRefreshSelectedTokens: () => mutations.tokens.mutate(),
    onOpenQuotaSync: () => {
      if (ctx.provider !== "grok_build") {
        mutations.sync.mutate();
        return;
      }
      setQuotaTask({ open: true, task: "sync" });
    },
    onOpenConcurrency: () => setConcurrency({ open: true, value: "1" }),
    concurrency: {
      open: concurrency.open,
      selectedCount: ctx.selectedCount,
      value: concurrency.value,
      onValueChange: (value) => setConcurrency({ open: concurrency.open, value }),
      pending: mutations.concurrency.isPending,
      onOpenChange: (open) => setConcurrency({ open, value: concurrency.value }),
      onConfirm: () => mutations.concurrency.mutate(Number(concurrency.value)),
    },
    quotaTask: {
      open: quotaTask.open,
      selectedCount: ctx.selectedCount,
      task: quotaTask.task,
      onTaskChange: (task) => setQuotaTask({ open: quotaTask.open, task }),
      syncPending: mutations.sync.isPending,
      resetPending: mutations.reset.isPending,
      onOpenChange: (open) => setQuotaTask({ open, task: quotaTask.task }),
      onConfirm: () => {
        if (quotaTask.task === "reset") mutations.reset.mutate();
        else mutations.sync.mutate();
      },
    },
    pending:
      mutations.enable.isPending ||
      mutations.concurrency.isPending ||
      mutations.sync.isPending ||
      mutations.reset.isPending ||
      mutations.tokens.isPending,
  };
}

/** 批量操作：启用/禁用、并发上限、额度同步与重置、refresh token。 */
export function useAccountsBatchFlow(ctx: AccountsFlowContext): AccountsBatchFlow {
  const dialogs = useBatchDialogState();
  const mutations = useBatchMutations(ctx, {
    quota: () => dialogs.setQuotaTask({ open: false, task: dialogs.quotaTask.task }),
    concurrency: () => dialogs.setConcurrency({ open: false, value: dialogs.concurrency.value }),
  });
  return buildBatchFlow({ ctx, mutations, dialogs });
}
