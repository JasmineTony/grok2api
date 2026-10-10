import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import type { AccountTaskProgressDTO } from "@/features/accounts/account-task-progress";
import {
  convertWebAccountsToBuild,
  importAccounts,
  importConsoleAccounts,
  importWebAccounts,
  runWebAccountScripts,
  syncWebAccountsToConsole,
  type BuildConversionInput,
  type BuildConversionStrategy,
  type WebAccountScriptActions,
  type WebAccountScriptsInput,
  type WebConsoleSyncInput,
} from "@/features/accounts/accounts-api";
import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import { isAbortError } from "@/features/accounts/accounts-view-model";

type AbortRef = { current: AbortController | null };
type ProgressSetter = (value: AccountTaskProgressDTO | null) => void;
type ConversionTarget = "build" | "console";
type ConversionStrategy = BuildConversionStrategy;
type TaskTargets = string[] | "all" | null;

function abortAll(refs: Array<{ current: AbortController | null }>): void {
  for (const ref of refs) ref.current?.abort();
}

function conversionInput(
  targets: Exclude<TaskTargets, null>,
  strategy: ConversionStrategy,
): { all: true; strategy: ConversionStrategy } | { ids: string[]; strategy: ConversionStrategy } {
  // targets 为 null 时调用方已提前返回，这里不存在需要兜底的空集合。
  return targets === "all" ? { all: true, strategy } : { ids: targets, strategy };
}

export type AccountsConversionFlow = {
  open: boolean;
  targets: TaskTargets;
  target: ConversionTarget;
  onTargetChange: (value: ConversionTarget) => void;
  strategy: ConversionStrategy;
  onStrategyChange: (value: ConversionStrategy) => void;
  pending: boolean;
  conversionProgress: AccountTaskProgressDTO | null;
  syncProgress: AccountTaskProgressDTO | null;
  onClose: () => void;
  onConfirm: () => void;
  openDialog: (targets: TaskTargets) => void;
  busy: boolean;
};

/** Grok Web 转 Build 与同步 Console 共用同一个确认框与目标集合。 */
function useWebConversionMutation(input: {
  ctx: AccountsFlowContext;
  abortRef: AbortRef;
  setProgress: ProgressSetter;
  onDone: () => void;
}) {
  const { ctx, abortRef, setProgress, onDone } = input;
  const { clearSelection, invalidate, invalidateModels, showError, t } = ctx;
  return useMutation({
    mutationFn: (values: BuildConversionInput) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setProgress(null);
      return convertWebAccountsToBuild(values, setProgress, controller.signal);
    },
    onSuccess: (result) => {
      setProgress(null);
      onDone();
      clearSelection();
      toast.success(t("accounts.conversionCompleted", result));
    },
    onError: (error) => {
      if (!isAbortError(error)) showError(error);
    },
    onSettled: () => {
      abortRef.current = null;
      setProgress(null);
      invalidate();
      invalidateModels();
    },
  });
}

function useWebConsoleSyncMutation(input: {
  ctx: AccountsFlowContext;
  abortRef: AbortRef;
  setProgress: ProgressSetter;
  onDone: () => void;
}) {
  const { ctx, abortRef, setProgress, onDone } = input;
  const { clearSelection, invalidate, invalidateModels, showError, t } = ctx;
  return useMutation({
    mutationFn: (values: WebConsoleSyncInput) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setProgress(null);
      return syncWebAccountsToConsole(values, setProgress, controller.signal);
    },
    onSuccess: (result) => {
      onDone();
      clearSelection();
      toast.success(t("webConsoleSync.completed", result));
    },
    onError: (error) => {
      if (!isAbortError(error)) showError(error);
    },
    onSettled: () => {
      abortRef.current = null;
      setProgress(null);
      invalidate();
      invalidateModels();
    },
  });
}

/** Grok Web 转 Build 与同步 Console 共用同一个确认框与目标集合。 */
export function useAccountsConversionFlow(ctx: AccountsFlowContext): AccountsConversionFlow {
  const [targets, setTargets] = useState<TaskTargets>(null);
  const [target, setTarget] = useState<ConversionTarget>("build");
  const [strategy, setStrategy] = useState<ConversionStrategy>("missing");
  const [conversionProgress, setConversionProgress] = useState<AccountTaskProgressDTO | null>(null);
  const [syncProgress, setSyncProgress] = useState<AccountTaskProgressDTO | null>(null);
  const conversionAbortRef = useRef<AbortController | null>(null);
  const consoleSyncAbortRef = useRef<AbortController | null>(null);
  const closeDialog = (): void => setTargets(null);
  const conversion = useWebConversionMutation({
    ctx,
    abortRef: conversionAbortRef,
    setProgress: setConversionProgress,
    onDone: closeDialog,
  });
  const consoleSync = useWebConsoleSyncMutation({
    ctx,
    abortRef: consoleSyncAbortRef,
    setProgress: setSyncProgress,
    onDone: closeDialog,
  });
  return {
    open: targets !== null,
    targets,
    target,
    onTargetChange: setTarget,
    strategy,
    onStrategyChange: setStrategy,
    pending: conversion.isPending || consoleSync.isPending,
    conversionProgress,
    syncProgress,
    onClose: () => {
      abortAll([conversionAbortRef, consoleSyncAbortRef]);
      setTargets(null);
    },
    onConfirm: () => {
      if (targets === null) return;
      if (target === "build") conversion.mutate(conversionInput(targets, strategy));
      else consoleSync.mutate(conversionInput(targets, strategy));
    },
    openDialog: (next) => {
      setTarget("build");
      setStrategy("missing");
      setTargets(next);
    },
    busy: conversion.isPending || consoleSync.isPending,
  };
}

export type AccountsScriptsFlow = {
  targets: TaskTargets;
  pending: boolean;
  progress: AccountTaskProgressDTO | null;
  onClose: () => void;
  onRun: (actions: WebAccountScriptActions) => void;
  openDialog: (targets: TaskTargets) => void;
  busy: boolean;
};

function useScriptsMutation(
  ctx: AccountsFlowContext,
  setProgress: ProgressSetter,
  abortRef: AbortRef,
  closeTargets: () => void,
) {
  const { invalidate, clearSelection, showError, t } = ctx;
  return useMutation({
    mutationFn: (input: WebAccountScriptsInput) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setProgress(null);
      return runWebAccountScripts(input, setProgress, controller.signal);
    },
    onSuccess: (result) => {
      closeTargets();
      clearSelection();
      if (result.failed > 0) toast.warning(t("webAccountScripts.completedWithFailures", result));
      else toast.success(t("webAccountScripts.completed", result));
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

/** Grok Web 脚本任务：仅对选中集合或全部账号运行。 */
export function useAccountsScriptsFlow(ctx: AccountsFlowContext): AccountsScriptsFlow {
  const [targets, setTargets] = useState<TaskTargets>(null);
  const [progress, setProgress] = useState<AccountTaskProgressDTO | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mutation = useScriptsMutation(ctx, setProgress, abortRef, () => setTargets(null));
  const onClose = (): void => {
    abortRef.current?.abort();
    setTargets(null);
  };
  const onRun = (actions: WebAccountScriptActions): void => {
    if (targets === "all") mutation.mutate({ all: true, actions });
    else if (targets) mutation.mutate({ ids: targets, actions });
  };
  return {
    targets,
    pending: mutation.isPending,
    progress,
    onClose,
    onRun,
    openDialog: (next) => setTargets(next),
    busy: mutation.isPending,
  };
}

export type AccountsImportFlow = {
  open: boolean;
  provider: AccountsFlowContext["provider"];
  tokens: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onTokensChange: (value: string) => void;
  onFileSelected: (file: File | undefined) => void;
  onSubmit: () => void;
  importFiles: (files: File[]) => void;
  openQuickImport: () => void;
  reset: () => void;
  busy: boolean;
};

function quickImportFilename(provider: AccountsFlowContext["provider"]): string {
  if (provider === "grok_build") return "grok-build-refresh-tokens.txt";
  if (provider === "grok_console") return "grok-console-sso-tokens.txt";
  return "grok-web-sso-tokens.txt";
}

function useImportMutation(
  ctx: AccountsFlowContext,
  abortRef: AbortRef,
  toastIdRef: { current: string | number | null },
  onDone: () => void,
) {
  const { provider, invalidate, showError, t } = ctx;
  return useMutation({
    mutationFn: (files: File[]) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const toastID = toast.loading(t("common.importingProgress", { completed: 0, total: "…" }));
      toastIdRef.current = toastID;
      const onProgress = (progress: AccountTaskProgressDTO) => {
        toast.loading(
          t(progress.phase === "syncing" ? "common.syncingProgress" : "common.importingProgress", progress),
          { id: toastID },
        );
      };
      if (provider === "grok_web") return importWebAccounts(files, onProgress, controller.signal);
      if (provider === "grok_console") return importConsoleAccounts(files, onProgress, controller.signal);
      return importAccounts(files, onProgress, controller.signal);
    },
    onSuccess: (result) => {
      if (toastIdRef.current !== null) toast.dismiss(toastIdRef.current);
      toastIdRef.current = null;
      abortRef.current = null;
      onDone();
      if (result.failed > 0) {
        toast.warning(t("accounts.importedWithFailures", result));
        return;
      }
      if (result.syncFailed > 0) {
        toast.warning(t("accounts.importedWithSyncFailures", result));
        return;
      }
      toast.success(t("accounts.imported", result));
    },
    onError: (error) => {
      if (toastIdRef.current !== null) toast.dismiss(toastIdRef.current);
      toastIdRef.current = null;
      abortRef.current = null;
      if (!isAbortError(error)) showError(error);
    },
    onSettled: () => {
      abortRef.current = null;
      invalidate();
    },
  });
}

/** token 文本快速导入与文件导入共用一条导入流水线。 */
export function useAccountsImportFlow(ctx: AccountsFlowContext): AccountsImportFlow {
  const { t } = ctx;
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const toastIdRef = useRef<string | number | null>(null);
  const reset = (): void => {
    setOpen(false);
    setTokens("");
  };
  const mutation = useImportMutation(ctx, abortRef, toastIdRef, reset);
  const onFileSelected = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      toast.error(t("apiErrors.accountImportFileTooLarge"));
      return;
    }
    try {
      setTokens(await file.text());
    } catch {
      toast.error(t("errors.generic"));
    }
  };
  return {
    open,
    provider: ctx.provider,
    tokens,
    pending: mutation.isPending,
    onOpenChange: (next) => {
      setOpen(next);
      if (!next) setTokens("");
    },
    onTokensChange: setTokens,
    onFileSelected,
    onSubmit: () => {
      const value = tokens.trim();
      if (!value) return;
      mutation.mutate([new File([value], quickImportFilename(ctx.provider), { type: "text/plain" })]);
    },
    importFiles: (files) => {
      if (files.length > 0) mutation.mutate(files);
    },
    openQuickImport: () => setOpen(true),
    reset,
    busy: mutation.isPending,
  };
}
