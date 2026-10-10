import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  cleanupAccounts,
  previewCleanup,
  type AccountCleanupStatus,
  type CleanupPreviewDTO,
} from "@/features/accounts/accounts-api";
import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import type { AccountProvider } from "@/features/accounts/accounts-dto";
import { linkedTargetOptions, type Translate } from "@/features/accounts/accounts-view-model";

type CleanupKeyedPreview = { key: string; data: CleanupPreviewDTO };

export type AccountsCleanupFlow = {
  open: boolean;
  provider: AccountProvider;
  statuses: Set<AccountCleanupStatus>;
  targets: AccountProvider[];
  previewTotals: CleanupPreviewDTO | null;
  previewError: boolean;
  previewFresh: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleStatus: (status: AccountCleanupStatus, checked: boolean) => void;
  onToggleTarget: (target: AccountProvider, checked: boolean) => void;
  onSelectAllTargets: () => void;
  onConfirm: () => void;
  openDialog: () => void;
  reset: () => void;
  busy: boolean;
};

function useCleanupSelection(onChange: () => void) {
  const [statuses, setStatuses] = useState<Set<AccountCleanupStatus>>(() => new Set());
  const [targets, setTargets] = useState<AccountProvider[]>([]);
  const reset = (): void => {
    setStatuses(new Set());
    setTargets([]);
  };
  const toggleStatus = (status: AccountCleanupStatus, checked: boolean): void => {
    setStatuses((current) => {
      const next = new Set(current);
      if (checked) next.add(status);
      else next.delete(status);
      return next;
    });
    onChange();
  };
  const toggleTarget = (target: AccountProvider, checked: boolean): void => {
    setTargets((current) =>
      checked ? (current.includes(target) ? current : [...current, target]) : current.filter((item) => item !== target),
    );
    onChange();
  };
  const selectAllTargets = (provider: AccountProvider): void => {
    const options = linkedTargetOptions(provider);
    setTargets(options.every((item) => targets.includes(item)) ? [] : options);
    onChange();
  };
  return {
    statuses,
    targets,
    statusesKey: [...statuses].sort().join(","),
    targetsKey: [...targets].sort().join(","),
    reset,
    toggleStatus,
    toggleTarget,
    selectAllTargets,
  };
}

/**
 * 清理预览计数：按状态/关联目标去抖重新计数；失败时不写假 0，
 * 让确认按钮保持禁用而不是低估破坏性范围。
 */
function useCleanupPreviewEffect(input: {
  open: boolean;
  provider: AccountProvider;
  statusesKey: string;
  targetsKey: string;
  t: Translate;
  setPreview: (value: CleanupKeyedPreview | null) => void;
  setPreviewError: (value: boolean) => void;
}): void {
  const { open, provider, statusesKey, targetsKey, t, setPreview, setPreviewError } = input;
  useEffect(() => {
    if (!open || statusesKey === "") return;
    let cancelled = false;
    const previewKey = `${provider}|${statusesKey}|${targetsKey}`;
    const statuses = statusesKey.split(",") as AccountCleanupStatus[];
    const allowed = linkedTargetOptions(provider);
    const targets = (targetsKey ? (targetsKey.split(",") as AccountProvider[]) : []).filter((target) =>
      allowed.includes(target),
    );
    const timer = window.setTimeout(() => {
      void previewCleanup(provider, statuses, targets)
        .then((next) => {
          if (cancelled) return;
          setPreviewError(false);
          setPreview({ key: previewKey, data: next });
        })
        .catch(() => {
          if (cancelled) return;
          setPreview(null);
          setPreviewError(true);
          toast.error(t("accounts.cleanupPreviewFailed"));
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, provider, statusesKey, targetsKey, t, setPreview, setPreviewError]);
}

function cleanupMessage(input: { t: Translate; deleted: number; linked: number; skipped: number }): void {
  const { t, deleted, linked, skipped } = input;
  if (linked > 0 || skipped > 0) {
    toast.success(t("accounts.cleanupCompletedDetailed", { deleted, linked, skipped }));
    return;
  }
  toast.success(t("accounts.cleanupCompleted", { deleted }));
}

function useCleanupMutation(ctx: AccountsFlowContext, onDone: () => void) {
  const { provider, invalidate, showError, t } = ctx;
  return useMutation({
    mutationFn: (input: { statuses: AccountCleanupStatus[]; targets: AccountProvider[] }) =>
      cleanupAccounts(provider, input.statuses, input.targets),
    onSuccess: (result) => {
      onDone();
      invalidate();
      cleanupMessage({ t, deleted: result.deleted, linked: result.linkedDeleted ?? 0, skipped: result.skipped ?? 0 });
    },
    onError: showError,
  });
}

/** 清理异常账号：按状态统计影响面，并可选择级联删除关联账号。 */
export function useAccountCleanupFlow(ctx: AccountsFlowContext): AccountsCleanupFlow {
  const { t, provider } = ctx;
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CleanupKeyedPreview | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const selection = useCleanupSelection(() => setPreviewError(false));
  useCleanupPreviewEffect({
    open,
    provider,
    statusesKey: selection.statusesKey,
    targetsKey: selection.targetsKey,
    t,
    setPreview,
    setPreviewError,
  });
  const mutation = useCleanupMutation(ctx, () => {
    setOpen(false);
    selection.reset();
  });
  const previewKey = `${provider}|${selection.statusesKey}|${selection.targetsKey}`;
  const previewFresh = !previewError && preview?.key === previewKey;
  return {
    open,
    provider,
    statuses: selection.statuses,
    targets: selection.targets,
    previewTotals: previewFresh ? (preview?.data ?? null) : null,
    previewError,
    previewFresh,
    pending: mutation.isPending,
    onOpenChange: (next) => {
      setOpen(next);
      if (!next) selection.reset();
    },
    onToggleStatus: selection.toggleStatus,
    onToggleTarget: selection.toggleTarget,
    onSelectAllTargets: () => selection.selectAllTargets(provider),
    onConfirm: () => mutation.mutate({ statuses: [...selection.statuses], targets: [...selection.targets] }),
    openDialog: () => {
      selection.reset();
      setOpen(true);
    },
    reset: () => {
      setOpen(false);
      selection.reset();
    },
    busy: mutation.isPending,
  };
}
