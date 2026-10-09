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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import type { AccountDTO, AccountProvider } from "@/features/accounts/accounts-dto";
import { LinkedTargetIcon } from "@/features/accounts/account-provider-icon";
import { linkedTargetLabel, linkedTargetOptions } from "@/features/accounts/accounts-view-model";
import { cn } from "@/shared/lib/cn";

type LinkedDeleteTargetsProps = {
  provider: AccountProvider;
  targets: AccountProvider[];
  counts: Partial<Record<AccountProvider, number>>;
  previewError: boolean;
  disabled?: boolean;
  onToggle: (target: AccountProvider, checked: boolean) => void;
  onSelectAll: () => void;
};

/** 关联删除目标选择：计数未返回前显示 spinner，失败时明确报错而不是显示 +0。 */
function LinkedDeleteTargets({
  provider,
  targets,
  counts,
  previewError,
  disabled,
  onToggle,
  onSelectAll,
}: LinkedDeleteTargetsProps): ReactNode {
  const { t } = useTranslation();
  const options = linkedTargetOptions(provider);
  const allSelected = options.every((item) => targets.includes(item));
  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{t("accounts.linkedDeleteTitle")}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={disabled}
          onClick={onSelectAll}
        >
          {allSelected ? t("accounts.linkedDeleteClearAll") : t("accounts.linkedDeleteSelectAll")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {options.map((target) => (
          <LinkedDeleteTargetOption
            key={target}
            target={target}
            checked={targets.includes(target)}
            counts={counts}
            previewError={previewError}
            onToggle={onToggle}
          />
        ))}
      </div>
      <p className="min-h-4 text-xs text-muted-foreground">
        {previewError ? t("accounts.linkedDeletePreviewFailed") : t("accounts.linkedDeleteHint")}
      </p>
    </div>
  );
}

type LinkedDeleteTargetOptionProps = {
  target: AccountProvider;
  checked: boolean;
  counts: Partial<Record<AccountProvider, number>>;
  previewError: boolean;
  onToggle: (target: AccountProvider, checked: boolean) => void;
};

function LinkedDeleteTargetOption({
  target,
  checked,
  counts,
  previewError,
  onToggle,
}: LinkedDeleteTargetOptionProps): ReactNode {
  const { t } = useTranslation();
  const pending = checked && !previewError && !(target in counts);
  const failed = checked && previewError && !(target in counts);
  const extra = !checked
    ? ""
    : failed
      ? t("accounts.linkedDeleteExtraFailed")
      : pending
        ? ""
        : t("accounts.linkedDeleteExtra", { count: counts[target] ?? 0 });
  return (
    <label className="flex min-h-6 items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(value) => onToggle(target, value === true)} />
      <LinkedTargetIcon target={target} />
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span>{linkedTargetLabel(target)}</span>
        {/* Fixed slot: spinner while waiting, then +N — never show +0 as a fake result. */}
        <span
          className={cn(
            "inline-flex h-4 min-w-[2.75rem] items-center justify-start tabular-nums text-xs",
            failed ? "text-destructive" : "text-muted-foreground",
            !checked && "invisible",
          )}
          aria-hidden={!checked}
          aria-busy={pending}
        >
          {pending ? <Spinner className="size-3.5" /> : extra}
        </span>
      </span>
    </label>
  );
}

type AccountDeleteDialogProps = {
  account: AccountDTO | null;
  provider: AccountProvider;
  targets: AccountProvider[];
  counts: Partial<Record<AccountProvider, number>>;
  previewError: boolean;
  pending: boolean;
  blocking: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleTarget: (target: AccountProvider, checked: boolean) => void;
  onSelectAll: () => void;
  onConfirm: () => void;
};

/** 单账号删除确认：可选级联删除关联 provider 账号。 */
export function AccountDeleteDialog({
  account,
  provider,
  targets,
  counts,
  previewError,
  pending,
  blocking,
  onOpenChange,
  onToggleTarget,
  onSelectAll,
  onConfirm,
}: AccountDeleteDialogProps): ReactNode {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={Boolean(account)}
      onOpenChange={(next) => {
        // Do not clear linked targets while a delete request is in flight.
        if (!next && pending) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("accounts.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("accounts.deleteDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <LinkedDeleteTargets
          provider={provider}
          targets={targets}
          counts={counts}
          previewError={previewError}
          onToggle={onToggleTarget}
          onSelectAll={onSelectAll}
        />
        <DeleteConfirmFooter blocked={pending || !account || blocking} onConfirm={onConfirm} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

type AccountBatchDeleteDialogProps = {
  open: boolean;
  selectedCount: number;
  provider: AccountProvider;
  targets: AccountProvider[];
  counts: Partial<Record<AccountProvider, number>>;
  previewError: boolean;
  pending: boolean;
  blocking: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleTarget: (target: AccountProvider, checked: boolean) => void;
  onSelectAll: () => void;
  onConfirm: () => void;
};

/** 批量删除确认：与单账号删除共用关联目标选择，但作用域是当前选中集合。 */
export function AccountBatchDeleteDialog({
  open,
  selectedCount,
  provider,
  targets,
  counts,
  previewError,
  pending,
  blocking,
  onOpenChange,
  onToggleTarget,
  onSelectAll,
  onConfirm,
}: AccountBatchDeleteDialogProps): ReactNode {
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
          <AlertDialogTitle>{t("accounts.batchDeleteTitle", { count: selectedCount })}</AlertDialogTitle>
          <AlertDialogDescription>{t("accounts.deleteDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <LinkedDeleteTargets
          provider={provider}
          targets={targets}
          counts={counts}
          previewError={previewError}
          onToggle={onToggleTarget}
          onSelectAll={onSelectAll}
        />
        <DeleteConfirmFooter blocked={pending || selectedCount === 0 || blocking} onConfirm={onConfirm} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteConfirmFooter({ blocked, onConfirm }: { blocked: boolean; onConfirm: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <AlertDialogFooter>
      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
      <AlertDialogAction
        className="bg-destructive text-white hover:bg-destructive/90"
        disabled={blocked}
        onClick={(event) => {
          event.preventDefault();
          if (blocked) return;
          onConfirm();
        }}
      >
        {t("accounts.deleteConfirm")}
      </AlertDialogAction>
    </AlertDialogFooter>
  );
}
