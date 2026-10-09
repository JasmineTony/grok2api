import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { AccountCleanupStatus, AccountProvider, CleanupPreviewDTO } from "@/features/accounts/accounts-dto";
import { LinkedTargetIcon } from "@/features/accounts/account-provider-icon";
import { linkedTargetLabel, linkedTargetOptions } from "@/features/accounts/accounts-view-model";
import { cn } from "@/shared/lib/cn";

const cleanupStatusLabels: Array<[AccountCleanupStatus, string]> = [
  ["cooldown", "accounts.statusCooldown"],
  ["disabled", "accounts.statusDisabled"],
  ["reauthRequired", "accounts.statusReauthRequired"],
];

type CleanupDialogBodyProps = {
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
};

type CleanupDialogProps = CleanupDialogBodyProps & { open: boolean };

/** 清理异常账号：按状态统计影响面，并可选级联删除关联账号。 */
export function CleanupDialog({ open, onOpenChange, ...body }: CleanupDialogProps): ReactNode {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (body.pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-[440px]">
        <CleanupDialogHeader provider={body.provider} />
        <CleanupDialogBody {...body} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function CleanupDialogHeader({ provider }: { provider: AccountProvider }): ReactNode {
  const { t } = useTranslation();
  const providerLabel =
    provider === "grok_build" ? "Grok Build" : provider === "grok_web" ? "Grok Web" : "Grok Console";
  return (
    <DialogHeader>
      <DialogTitle>{t("accounts.cleanupTitle", { provider: providerLabel })}</DialogTitle>
      <DialogDescription>{t("accounts.cleanupDescription")}</DialogDescription>
    </DialogHeader>
  );
}

function CleanupDialogBody({
  provider,
  statuses,
  targets,
  previewTotals,
  previewError,
  previewFresh,
  pending,
  onOpenChange,
  onToggleStatus,
  onToggleTarget,
  onSelectAllTargets,
  onConfirm,
}: CleanupDialogBodyProps): ReactNode {
  return (
    <>
      <CleanupStatusList
        statuses={statuses}
        disabled={pending}
        previewError={previewError}
        previewFresh={previewFresh}
        previewTotals={previewTotals}
        onToggleStatus={onToggleStatus}
      />
      <CleanupLinkedBlock
        visible={statuses.size > 0}
        provider={provider}
        targets={targets}
        pending={pending}
        previewError={previewError}
        previewFresh={previewFresh}
        previewTotals={previewTotals}
        onToggleTarget={onToggleTarget}
        onSelectAllTargets={onSelectAllTargets}
      />
      <CleanupFooter
        pending={pending}
        canStart={statuses.size > 0 && !previewError && previewFresh}
        onClose={() => onOpenChange(false)}
        onConfirm={onConfirm}
      />
    </>
  );
}

type CleanupStatusListProps = {
  statuses: Set<AccountCleanupStatus>;
  disabled: boolean;
  previewError: boolean;
  previewFresh: boolean;
  previewTotals: CleanupPreviewDTO | null;
  onToggleStatus: (status: AccountCleanupStatus, checked: boolean) => void;
};

function CleanupStatusList({
  statuses,
  disabled,
  previewError,
  previewFresh,
  previewTotals,
  onToggleStatus,
}: CleanupStatusListProps): ReactNode {
  return (
    <div className="space-y-1.5">
      {cleanupStatusLabels.map(([status, labelKey]) => (
        <CleanupStatusRow
          key={status}
          status={status}
          labelKey={labelKey}
          checked={statuses.has(status)}
          disabled={disabled}
          previewError={previewError}
          previewFresh={previewFresh}
          previewTotals={previewTotals}
          onToggleStatus={onToggleStatus}
        />
      ))}
    </div>
  );
}

type CleanupStatusRowProps = Omit<CleanupStatusListProps, "statuses"> & {
  status: AccountCleanupStatus;
  labelKey: string;
  checked: boolean;
};

function CleanupStatusRow({
  status,
  labelKey,
  checked,
  disabled,
  previewError,
  previewFresh,
  previewTotals,
  onToggleStatus,
}: CleanupStatusRowProps): ReactNode {
  const { t } = useTranslation();
  const pending = checked && !previewError && !previewFresh;
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md bg-muted/40 px-3 py-2.5 text-xs">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onToggleStatus(status, value === true)}
      />
      <span>{t(labelKey)}</span>
      {/* Fixed count slot: spinner while previewing, then the matched root count. */}
      <span
        className={cn(
          "ml-auto inline-flex h-4 min-w-[2.5rem] items-center justify-end tabular-nums text-xs",
          previewError ? "text-destructive" : "text-muted-foreground",
          !checked && "invisible",
        )}
        aria-hidden={!checked}
        aria-busy={pending}
      >
        {!checked ? null : previewError ? (
          "!"
        ) : pending ? (
          <Spinner className="size-3.5" />
        ) : (
          (previewTotals?.rootsByStatus?.[status] ?? 0)
        )}
      </span>
    </label>
  );
}

type CleanupLinkedBlockProps = {
  visible: boolean;
  provider: AccountProvider;
  targets: AccountProvider[];
  pending: boolean;
  previewError: boolean;
  previewFresh: boolean;
  previewTotals: CleanupPreviewDTO | null;
  onToggleTarget: (target: AccountProvider, checked: boolean) => void;
  onSelectAllTargets: () => void;
};

/** 平滑展开的关联删除区块，选中任一状态后才展开。 */
function CleanupLinkedBlock({
  visible,
  provider,
  targets,
  pending,
  previewError,
  previewFresh,
  previewTotals,
  onToggleTarget,
  onSelectAllTargets,
}: CleanupLinkedBlockProps): ReactNode {
  return (
    <div
      className={cn(
        "grid transition-all duration-300 ease-in-out",
        visible ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      aria-hidden={!visible}
    >
      <div className="overflow-hidden">
        <div className="space-y-3 border-t pt-3">
          <CleanupLinkedHeader
            provider={provider}
            targets={targets}
            pending={pending}
            onSelectAllTargets={onSelectAllTargets}
          />
          <CleanupTargetList
            provider={provider}
            targets={targets}
            pending={pending}
            previewError={previewError}
            previewFresh={previewFresh}
            previewTotals={previewTotals}
            onToggleTarget={onToggleTarget}
          />
          <CleanupPreviewMessages
            previewError={previewError}
            hasTargets={targets.length > 0}
            previewFresh={previewFresh}
            previewTotals={previewTotals}
          />
        </div>
      </div>
    </div>
  );
}

function CleanupLinkedHeader({
  provider,
  targets,
  pending,
  onSelectAllTargets,
}: {
  provider: AccountProvider;
  targets: AccountProvider[];
  pending: boolean;
  onSelectAllTargets: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const allSelected = linkedTargetOptions(provider).every((item) => targets.includes(item));
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm font-medium">{t("accounts.linkedDeleteTitle")}</p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={pending}
        onClick={onSelectAllTargets}
      >
        {allSelected ? t("accounts.linkedDeleteClearAll") : t("accounts.linkedDeleteSelectAll")}
      </Button>
    </div>
  );
}

type CleanupTargetListProps = {
  provider: AccountProvider;
  targets: AccountProvider[];
  pending: boolean;
  previewError: boolean;
  previewFresh: boolean;
  previewTotals: CleanupPreviewDTO | null;
  onToggleTarget: (target: AccountProvider, checked: boolean) => void;
};

function CleanupTargetList({
  provider,
  targets,
  pending,
  previewError,
  previewFresh,
  previewTotals,
  onToggleTarget,
}: CleanupTargetListProps): ReactNode {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {linkedTargetOptions(provider).map((target) => (
        <CleanupTargetOption
          key={target}
          target={target}
          checked={targets.includes(target)}
          disabled={pending}
          previewError={previewError}
          previewFresh={previewFresh}
          previewTotals={previewTotals}
          onToggleTarget={onToggleTarget}
        />
      ))}
    </div>
  );
}

type CleanupTargetOptionProps = {
  target: AccountProvider;
  checked: boolean;
  disabled: boolean;
  previewError: boolean;
  previewFresh: boolean;
  previewTotals: CleanupPreviewDTO | null;
  onToggleTarget: (target: AccountProvider, checked: boolean) => void;
};

function CleanupTargetOption({
  target,
  checked,
  disabled,
  previewError,
  previewFresh,
  previewTotals,
  onToggleTarget,
}: CleanupTargetOptionProps): ReactNode {
  return (
    <label className="flex min-h-6 items-center gap-2 text-sm">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onToggleTarget(target, value === true)}
      />
      <LinkedTargetIcon target={target} />
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span>{linkedTargetLabel(target)}</span>
        <CleanupTargetCount
          target={target}
          checked={checked}
          previewError={previewError}
          previewFresh={previewFresh}
          previewTotals={previewTotals}
        />
      </span>
    </label>
  );
}

function CleanupTargetCount({
  target,
  checked,
  previewError,
  previewFresh,
  previewTotals,
}: {
  target: AccountProvider;
  checked: boolean;
  previewError: boolean;
  previewFresh: boolean;
  previewTotals: CleanupPreviewDTO | null;
}): ReactNode {
  const { t } = useTranslation();
  const pending = checked && !previewError && !previewFresh;
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-[2.75rem] items-center justify-start tabular-nums text-xs",
        previewError ? "text-destructive" : "text-muted-foreground",
        !checked && "invisible",
      )}
      aria-hidden={!checked}
      aria-busy={pending}
    >
      {!checked ? (
        ""
      ) : previewError ? (
        t("accounts.linkedDeleteExtraFailed")
      ) : pending ? (
        <Spinner className="size-3.5" />
      ) : (
        t("accounts.linkedDeleteExtra", { count: previewTotals?.linkedByProvider?.[target] ?? 0 })
      )}
    </span>
  );
}

/** 提示/警告/错误叠放，容器高度取最高变体，切换时不改变弹窗高度。 */
function CleanupPreviewMessages({
  previewError,
  hasTargets,
  previewFresh,
  previewTotals,
}: {
  previewError: boolean;
  hasTargets: boolean;
  previewFresh: boolean;
  previewTotals: CleanupPreviewDTO | null;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid text-xs">
        {(
          [
            ["error", previewError, t("accounts.cleanupPreviewFailed"), "text-destructive"],
            ["warning", !previewError && hasTargets, t("accounts.cleanupLinkedWarning"), "text-destructive"],
            ["hint", !previewError && !hasTargets, t("accounts.linkedDeleteHint"), "text-muted-foreground"],
          ] as const
        ).map(([key, visible, text, tone]) => (
          <p key={key} aria-hidden={!visible} className={cn("col-start-1 row-start-1", tone, !visible && "invisible")}>
            {text}
          </p>
        ))}
      </div>
      {/* Always rendered so the total line never unmounts between refreshes. */}
      <p
        className="flex min-h-4 items-center gap-1.5 text-xs text-muted-foreground"
        aria-busy={!previewFresh && !previewError}
      >
        {previewError ? (
          t("accounts.cleanupPreviewFailed")
        ) : !previewFresh ? (
          <Spinner className="size-3.5" />
        ) : (
          t("accounts.cleanupPreviewTotal", { total: previewTotals?.total ?? 0 })
        )}
      </p>
    </>
  );
}

function CleanupFooter({
  pending,
  canStart,
  onClose,
  onConfirm,
}: {
  pending: boolean;
  canStart: boolean;
  onClose: () => void;
  onConfirm: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <DialogFooter>
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onClose}>
        {t("common.cancel")}
      </Button>
      <Button type="button" variant="destructive" size="sm" disabled={pending || !canStart} onClick={onConfirm}>
        {pending ? <Spinner /> : null}
        {t("accounts.cleanupStart")}
      </Button>
    </DialogFooter>
  );
}
