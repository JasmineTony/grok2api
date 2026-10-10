import { useMutation } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import type { AccountTaskProgressDTO } from "@/features/accounts/account-task-progress";
import {
  detectBuildAccounts,
  refreshAllAccountBilling,
  refreshAllAccountTokens,
  refreshAllConsoleAccountQuotas,
  refreshAllWebAccountQuotas,
  resetAllAccountQuota,
  type BuildDetectHandlers,
  type BuildDetectItemDTO,
} from "@/features/accounts/accounts-api";
import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import type { AccountProvider } from "@/features/accounts/accounts-dto";
import { isAbortError } from "@/features/accounts/accounts-view-model";

/** 任务流共用的控制器引用契约（AbortController 只在请求期间存活）。 */
type AbortRef = { current: AbortController | null };
type ProgressSetter = (value: AccountTaskProgressDTO | null) => void;
type DetectCounts = Record<BuildDetectItemDTO["outcome"], number>;
type DetectMode = "selected" | "all";

const emptyDetectCounts = (): DetectCounts => ({ ok: 0, invalid: 0, failed: 0 });

export type AccountsDetectFlow = {
  open: boolean;
  mode: DetectMode;
  selectedCount: number;
  pending: boolean;
  progress: AccountTaskProgressDTO | null;
  counts: DetectCounts;
  visibleItems: BuildDetectItemDTO[];
  onOpenChange: (open: boolean) => void;
  onRun: () => void;
  openDialog: (mode: DetectMode) => void;
  busy: boolean;
};

/** 检测结果按账号去重，并只保留最近 200 条，避免长任务把 DOM 拖垮。 */
function useDetectItems() {
  const [items, setItems] = useState<BuildDetectItemDTO[]>([]);
  const [counts, setCounts] = useState<DetectCounts>(emptyDetectCounts);
  const outcomeByIdRef = useRef(new Map<string, BuildDetectItemDTO["outcome"]>());
  const appendItem = useCallback((item: BuildDetectItemDTO) => {
    const previousOutcome = outcomeByIdRef.current.get(item.id);
    outcomeByIdRef.current.set(item.id, item.outcome);
    if (previousOutcome !== item.outcome) {
      setCounts((previous) => ({
        ...previous,
        ...(previousOutcome ? { [previousOutcome]: Math.max(0, previous[previousOutcome] - 1) } : {}),
        [item.outcome]: previous[item.outcome] + 1,
      }));
    }
    setItems((prev) => {
      const next = prev.filter((entry) => entry.id !== item.id);
      next.unshift(item);
      return next.slice(0, 200);
    });
  }, []);
  const reset = useCallback(() => {
    outcomeByIdRef.current.clear();
    setCounts(emptyDetectCounts());
    setItems([]);
  }, []);
  return { items, counts, appendItem, reset };
}

function useDetectMutation(
  ctx: AccountsFlowContext,
  abortRef: AbortRef,
  setProgress: ProgressSetter,
  handlers: { onItem: (item: BuildDetectItemDTO) => void; reset: () => void },
) {
  const { selectedIds, clearSelection, invalidate, showError, t } = ctx;
  return useMutation({
    mutationFn: (mode: DetectMode) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setProgress(null);
      handlers.reset();
      const streamHandlers: BuildDetectHandlers = { onProgress: setProgress, onItem: handlers.onItem };
      if (mode === "all") return detectBuildAccounts({ all: true }, streamHandlers, controller.signal);
      return detectBuildAccounts({ ids: selectedIds }, streamHandlers, controller.signal);
    },
    onSuccess: (result, mode) => {
      if (mode === "selected") clearSelection();
      toast.success(t(mode === "all" ? "accounts.allDetected" : "accounts.batchDetected", result));
    },
    onError: (error) => {
      if (!isAbortError(error)) showError(error);
    },
    onSettled: () => {
      abortRef.current = null;
      invalidate();
    },
  });
}

/** Grok Build 凭据检测：进度、结果清单与中断入口。 */
export function useAccountsDetectFlow(ctx: AccountsFlowContext): AccountsDetectFlow {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DetectMode>("all");
  const [progress, setProgress] = useState<AccountTaskProgressDTO | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const items = useDetectItems();
  const mutation = useDetectMutation(ctx, abortRef, setProgress, { onItem: items.appendItem, reset: items.reset });
  const openDialog = (next: DetectMode): void => {
    setMode(next);
    setProgress(null);
    items.reset();
    setOpen(true);
  };
  const onOpenChange = (next: boolean): void => {
    if (next) {
      setOpen(true);
      return;
    }
    if (mutation.isPending) abortRef.current?.abort();
    setOpen(false);
    setProgress(null);
    if (!mutation.isPending) items.reset();
  };
  const invalidItems = items.items.filter((item) => item.outcome === "invalid");
  return {
    open,
    mode,
    selectedCount: ctx.selectedCount,
    pending: mutation.isPending,
    progress,
    counts: items.counts,
    visibleItems: mode === "selected" ? items.items : invalidItems,
    onOpenChange,
    onRun: () => mutation.mutate(mode),
    openDialog,
    busy: mutation.isPending,
  };
}

export type AccountsQuotaSyncFlow = {
  open: boolean;
  provider: AccountProvider;
  task: "sync" | "reset";
  onTaskChange: (value: "sync" | "reset") => void;
  syncPending: boolean;
  resetPending: boolean;
  progress: AccountTaskProgressDTO | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  openDialog: (task: "sync" | "reset") => void;
  busy: boolean;
};

function taskProviderRequest(provider: AccountProvider, setProgress: ProgressSetter, signal: AbortSignal) {
  if (provider === "grok_web") return refreshAllWebAccountQuotas(setProgress, signal);
  if (provider === "grok_console") return refreshAllConsoleAccountQuotas(setProgress, signal);
  return refreshAllAccountBilling(setProgress, signal);
}

/** 全量额度同步（按账号池分派接口）与额度重置。 */
function useProviderQuotaSyncMutation(input: {
  ctx: AccountsFlowContext;
  abortRef: AbortRef;
  setProgress: ProgressSetter;
  onDone: () => void;
}) {
  const { ctx, abortRef, setProgress, onDone } = input;
  const { invalidate, showError, t } = ctx;
  return useMutation({
    mutationFn: (targetProvider: AccountProvider) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setProgress(null);
      return taskProviderRequest(targetProvider, setProgress, controller.signal);
    },
    onSuccess: (result) => {
      onDone();
      toast.success(t("accounts.allBillingRefreshed", result));
    },
    onError: (error) => {
      if (!isAbortError(error)) showError(error);
    },
    onSettled: () => {
      abortRef.current = null;
      setProgress(null);
      invalidate();
    },
  });
}

function useAllQuotaResetMutation(input: { ctx: AccountsFlowContext; onDone: () => void }) {
  const { ctx, onDone } = input;
  const { invalidate, showError, t } = ctx;
  return useMutation({
    mutationFn: resetAllAccountQuota,
    onSuccess: (result) => {
      onDone();
      toast.success(t("accountQuotaReset.completed", result));
    },
    onError: showError,
    onSettled: invalidate,
  });
}

/** 全量额度同步（按账号池分派接口）与额度重置。 */
export function useAccountsQuotaSyncFlow(ctx: AccountsFlowContext): AccountsQuotaSyncFlow {
  const { provider } = ctx;
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState<"sync" | "reset">("sync");
  const [progress, setProgress] = useState<AccountTaskProgressDTO | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const closeDialog = (): void => setOpen(false);
  const sync = useProviderQuotaSyncMutation({ ctx, abortRef, setProgress, onDone: closeDialog });
  const reset = useAllQuotaResetMutation({ ctx, onDone: closeDialog });
  return {
    open,
    provider,
    task,
    onTaskChange: setTask,
    syncPending: sync.isPending,
    resetPending: reset.isPending,
    progress,
    onOpenChange: (next) => {
      if (!next) abortRef.current?.abort();
      setOpen(next);
    },
    onConfirm: () => {
      if (provider === "grok_build" && task === "reset") reset.mutate();
      else sync.mutate(provider);
    },
    openDialog: (next) => {
      setTask(next);
      setOpen(true);
    },
    busy: sync.isPending || reset.isPending,
  };
}

export type AccountsRenewalFlow = {
  open: boolean;
  pending: boolean;
  progress: AccountTaskProgressDTO | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  openDialog: () => void;
  busy: boolean;
};

/** Grok Build 全量刷新 refresh token。 */
export function useAccountsRenewalFlow(ctx: AccountsFlowContext): AccountsRenewalFlow {
  const { invalidate, showError, t } = ctx;
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<AccountTaskProgressDTO | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setProgress(null);
      return refreshAllAccountTokens(setProgress, controller.signal);
    },
    onSuccess: (result) => {
      setOpen(false);
      toast.success(t("accounts.allTokensRefreshed", result));
    },
    onError: (error) => {
      if (!isAbortError(error)) showError(error);
    },
    onSettled: () => {
      abortRef.current = null;
      setProgress(null);
      invalidate();
    },
  });
  return {
    open,
    pending: mutation.isPending,
    progress,
    onOpenChange: (next) => {
      if (!next) abortRef.current?.abort();
      setOpen(next);
    },
    onConfirm: () => mutation.mutate(),
    openDialog: () => setOpen(true),
    busy: mutation.isPending,
  };
}
