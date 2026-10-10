import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  deleteAccount,
  deleteAccounts,
  previewAccountDeletion,
  type AccountDTO,
  type AccountDeleteResultDTO,
} from "@/features/accounts/accounts-api";
import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import type { AccountProvider } from "@/features/accounts/accounts-dto";
import { linkedTargetOptions, type Translate } from "@/features/accounts/accounts-view-model";

type LinkedCounts = Partial<Record<AccountProvider, number>>;

export type AccountsDeleteFlow = {
  single: {
    account: AccountDTO | null;
    provider: AccountProvider;
    targets: AccountProvider[];
    counts: LinkedCounts;
    previewError: boolean;
    pending: boolean;
    blocking: boolean;
    onOpenChange: (open: boolean) => void;
    onToggleTarget: (target: AccountProvider, checked: boolean) => void;
    onSelectAll: () => void;
    onConfirm: () => void;
  };
  batch: {
    open: boolean;
    selectedCount: number;
    provider: AccountProvider;
    targets: AccountProvider[];
    counts: LinkedCounts;
    previewError: boolean;
    pending: boolean;
    blocking: boolean;
    onOpenChange: (open: boolean) => void;
    onToggleTarget: (target: AccountProvider, checked: boolean) => void;
    onSelectAll: () => void;
    onConfirm: () => void;
  };
  openDelete: (account: AccountDTO) => void;
  openBatchDelete: () => void;
  busy: boolean;
};

/** 关联删除目标：只允许当前账号池之外的其它 provider。 */
function useLinkedDeleteTargets(provider: AccountProvider) {
  const [targets, setTargets] = useState<AccountProvider[]>([]);
  const [counts, setCounts] = useState<LinkedCounts>({});
  const [previewError, setPreviewError] = useState(false);
  const reset = (): void => {
    setTargets([]);
    setCounts({});
    setPreviewError(false);
  };
  const toggleTarget = (target: AccountProvider, checked: boolean): void => {
    setTargets((current) => {
      const next = checked
        ? current.includes(target)
          ? current
          : [...current, target]
        : current.filter((item) => item !== target);
      if (next.length === 0) {
        setCounts({});
        setPreviewError(false);
      } else if (!checked) {
        setCounts((currentCounts) => {
          const copy = { ...currentCounts };
          delete copy[target];
          return copy;
        });
      } else {
        // 新勾选的目标先清掉上一次的失败标记，等预览重新计数。
        setPreviewError(false);
      }
      return next;
    });
  };
  const selectAll = (): void => {
    const options = linkedTargetOptions(provider);
    if (options.every((item) => targets.includes(item))) {
      setTargets([]);
      setCounts({});
      return;
    }
    setPreviewError(false);
    setCounts({});
    setTargets(options);
  };
  return { targets, counts, previewError, setCounts, setPreviewError, reset, toggleTarget, selectAll };
}

/**
 * 关联删除预览：计数未返回前保持 spinner，失败时不写假 0 —— 破坏性范围不允许被低估。
 */
function useLinkedDeletePreview(input: {
  active: boolean;
  idsKey: string;
  provider: AccountProvider;
  targets: AccountProvider[];
  setCounts: (value: LinkedCounts) => void;
  setPreviewError: (value: boolean) => void;
  t: Translate;
}): void {
  const { active, idsKey, provider, targets, setCounts, setPreviewError, t } = input;
  useEffect(() => {
    if (!active || targets.length === 0 || idsKey === "") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void previewAccountDeletion(idsKey.split(","), provider, targets)
        .then((preview) => {
          if (cancelled) return;
          const next: LinkedCounts = {};
          for (const target of targets) next[target] = preview.linkedByProvider?.[target] ?? 0;
          setPreviewError(false);
          setCounts(next);
        })
        .catch(() => {
          if (cancelled) return;
          setCounts({});
          setPreviewError(true);
          toast.error(t("accounts.linkedDeletePreviewFailed"));
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, idsKey, provider, targets, setCounts, setPreviewError, t]);
}

function notifyDeleteResult(t: Translate, result: AccountDeleteResultDTO): void {
  const skipped = result.skipped ?? 0;
  if (skipped > 0) {
    toast.warning(t("accounts.deletedWithSkipped", { deleted: result.deleted, skipped }));
    return;
  }
  toast.success(t("accounts.deleted"));
}

function useDeleteAccountMutation(ctx: AccountsFlowContext, onDone: () => void) {
  const { invalidate, showError, t } = ctx;
  return useMutation({
    mutationFn: (input: { id: string; provider: AccountProvider; linkedDeleteTargets: AccountProvider[] }) =>
      deleteAccount(
        input.id,
        input.linkedDeleteTargets.length
          ? { provider: input.provider, linkedDeleteTargets: input.linkedDeleteTargets }
          : undefined,
      ),
    onSuccess: () => {
      invalidate();
      onDone();
      toast.success(t("accounts.deleted"));
    },
    onError: showError,
  });
}

function useBatchDeleteMutation(ctx: AccountsFlowContext, onDone: () => void) {
  const { invalidate, clearSelection, showError, t } = ctx;
  return useMutation({
    mutationFn: (input: { ids: string[]; provider: AccountProvider; linkedDeleteTargets: AccountProvider[] }) =>
      deleteAccounts(input.ids, input.provider, input.linkedDeleteTargets),
    onSuccess: (result) => {
      clearSelection();
      onDone();
      invalidate();
      notifyDeleteResult(t, result);
    },
    onError: showError,
  });
}

function useDeleteDialogs(ctx: AccountsFlowContext) {
  const { t, provider, selectedIds, selectedCount } = ctx;
  const [deleting, setDeleting] = useState<AccountDTO | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const linked = useLinkedDeleteTargets(provider);
  const idsKey = deleting?.id ?? selectedIds.join(",");
  useLinkedDeletePreview({
    active: Boolean(deleting) || batchOpen,
    idsKey,
    provider,
    targets: linked.targets,
    setCounts: linked.setCounts,
    setPreviewError: linked.setPreviewError,
    t,
  });
  const blocking =
    linked.targets.length > 0 && (linked.previewError || linked.targets.some((target) => !(target in linked.counts)));
  const single = useDeleteAccountMutation(ctx, () => {
    setDeleting(null);
    linked.reset();
  });
  const batch = useBatchDeleteMutation(ctx, () => {
    setBatchOpen(false);
    linked.reset();
  });
  return {
    deleting,
    setDeleting,
    batchOpen,
    setBatchOpen,
    linked,
    blocking,
    single,
    batch,
    selectedCount,
    provider,
    selectedIds,
  };
}

function useDeleteFlowActions(state: ReturnType<typeof useDeleteDialogs>): AccountsDeleteFlow["single"] {
  const { deleting, setDeleting, linked, blocking, single, provider } = state;
  const shared = {
    provider,
    targets: linked.targets,
    counts: linked.counts,
    previewError: linked.previewError,
    blocking,
    onToggleTarget: linked.toggleTarget,
    onSelectAll: linked.selectAll,
  };
  return {
    ...shared,
    account: deleting,
    pending: single.isPending,
    onOpenChange: (open) => {
      if (open) return;
      setDeleting(null);
      linked.reset();
    },
    onConfirm: () => {
      if (!deleting) return;
      const ids = [...linked.targets];
      single.mutate({ id: deleting.id, provider, linkedDeleteTargets: ids });
    },
  };
}
function useDeleteBatchActions(state: ReturnType<typeof useDeleteDialogs>): AccountsDeleteFlow["batch"] {
  const { setBatchOpen, linked, blocking, batch, selectedCount, provider, selectedIds } = state;
  return {
    provider,
    targets: linked.targets,
    counts: linked.counts,
    previewError: linked.previewError,
    blocking,
    onToggleTarget: linked.toggleTarget,
    onSelectAll: linked.selectAll,
    open: state.batchOpen,
    selectedCount,
    pending: batch.isPending,
    onOpenChange: (open) => {
      setBatchOpen(open);
      if (!open) linked.reset();
    },
    onConfirm: () => {
      batch.mutate({ ids: selectedIds, provider, linkedDeleteTargets: [...linked.targets] });
    },
  };
}

export function useAccountDeleteFlow(ctx: AccountsFlowContext): AccountsDeleteFlow {
  const state = useDeleteDialogs(ctx);
  const singleActions = useDeleteFlowActions(state);
  const batchActions = useDeleteBatchActions(state);
  return {
    single: singleActions,
    batch: batchActions,
    openDelete: (account) => {
      state.linked.reset();
      state.setDeleting(account);
    },
    openBatchDelete: () => {
      state.linked.reset();
      state.setBatchOpen(true);
    },
    busy: state.batch.isPending,
  };
}
