import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { AccountTaskProgressDTO } from "@/features/accounts/account-task-progress";
import type { BuildDetectItemDTO } from "@/features/accounts/accounts-dto";
import { cn } from "@/shared/lib/cn";

type BuildDetectCounts = Record<BuildDetectItemDTO["outcome"], number>;
type DetectMode = "selected" | "all";

type BuildDetectDialogProps = {
  open: boolean;
  mode: DetectMode;
  selectedCount: number;
  pending: boolean;
  progress: AccountTaskProgressDTO | null;
  counts: BuildDetectCounts;
  visibleItems: BuildDetectItemDTO[];
  onOpenChange: (open: boolean) => void;
  onRun: () => void;
};

/** Grok Build 凭据检测弹窗：进度、结果清单与中断入口。 */
export function BuildDetectDialog({
  open,
  mode,
  selectedCount,
  pending,
  progress,
  counts,
  visibleItems,
  onOpenChange,
  onRun,
}: BuildDetectDialogProps): ReactNode {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "all"
              ? t("accounts.detectAllTitle")
              : t("accounts.detectSelectedTitle", { count: selectedCount })}
          </DialogTitle>
          <DialogDescription>
            {mode === "all"
              ? t("accounts.detectAllDescription")
              : t("accounts.detectSelectedDescription", { count: selectedCount })}
          </DialogDescription>
        </DialogHeader>
        {pending || progress || visibleItems.length > 0 ? (
          <DetectProgressPanel pending={pending} progress={progress} mode={mode} counts={counts} items={visibleItems} />
        ) : null}
        <DetectFooter
          mode={mode}
          selectedCount={selectedCount}
          pending={pending}
          progress={progress}
          onOpenChange={onOpenChange}
          onRun={onRun}
        />
      </DialogContent>
    </Dialog>
  );
}

function DetectFooter({
  mode,
  selectedCount,
  pending,
  progress,
  onOpenChange,
  onRun,
}: {
  mode: DetectMode;
  selectedCount: number;
  pending: boolean;
  progress: AccountTaskProgressDTO | null;
  onOpenChange: (open: boolean) => void;
  onRun: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <DialogFooter>
      <Button variant="outline" onClick={() => onOpenChange(false)}>
        {pending ? t("common.cancel") : t("common.close")}
      </Button>
      <Button disabled={pending || (mode === "selected" && selectedCount === 0)} onClick={onRun}>
        {pending ? (
          <>
            <Spinner />
            {progress ? (
              <span className="tabular-nums">
                {progress.completed} / {progress.total}
              </span>
            ) : (
              t("common.loading")
            )}
          </>
        ) : (
          t("accounts.detectAll")
        )}
      </Button>
    </DialogFooter>
  );
}

type DetectProgressPanelProps = {
  pending: boolean;
  progress: AccountTaskProgressDTO | null;
  mode: DetectMode;
  counts: BuildDetectCounts;
  items: BuildDetectItemDTO[];
};

function DetectProgressPanel({ pending, progress, mode, counts, items }: DetectProgressPanelProps): ReactNode {
  const { t } = useTranslation();
  const total = counts.ok + counts.invalid + counts.failed;
  return (
    <div className="space-y-3">
      <DetectProgressHeader pending={pending} progress={progress} />
      {mode === "all" && counts.invalid > 0 ? (
        <p className="text-xs text-muted-foreground">{t("accounts.detectInvalidCount", { count: counts.invalid })}</p>
      ) : null}
      {mode === "selected" && total > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("accounts.detectSelectedSummary", { ok: counts.ok, invalid: counts.invalid, failed: counts.failed })}
        </p>
      ) : null}
      {total > items.length ? (
        <p className="text-xs text-muted-foreground">{t("accounts.detectResultsLimited", { count: 200 })}</p>
      ) : null}
      <DetectResultList items={items} pending={pending} mode={mode} />
    </div>
  );
}

function DetectProgressHeader({
  pending,
  progress,
}: {
  pending: boolean;
  progress: AccountTaskProgressDTO | null;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{t("accounts.detectProgressLabel")}</span>
      <span className="tabular-nums font-medium">
        {progress ? `${progress.completed} / ${progress.total}` : pending ? t("common.loading") : "—"}
      </span>
    </div>
  );
}

function DetectResultList({
  items,
  pending,
  mode,
}: {
  items: BuildDetectItemDTO[];
  pending: boolean;
  mode: DetectMode;
}): ReactNode {
  const { t } = useTranslation();
  if (items.length === 0) {
    return (
      <div className="max-h-64 overflow-y-auto rounded-md border">
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          {pending
            ? t(mode === "all" ? "accounts.detectWaitingInvalid" : "accounts.detectWaitingResults")
            : t(mode === "all" ? "accounts.detectNoInvalid" : "accounts.detectNoResults")}
        </div>
      </div>
    );
  }
  return (
    <div className="max-h-64 overflow-y-auto rounded-md border">
      <ul className="divide-y">
        {items.map((item) => (
          <DetectResultItem key={`${item.id}-${item.outcome}-${item.reason ?? ""}`} item={item} />
        ))}
      </ul>
    </div>
  );
}

function DetectResultItem({ item }: { item: BuildDetectItemDTO }): ReactNode {
  const { t } = useTranslation();
  return (
    <li className="flex items-start gap-3 px-3 py-2 text-sm">
      <Badge
        variant="outline"
        className={cn(
          "mt-0.5 shrink-0",
          item.outcome === "ok" && "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
          item.outcome === "invalid" && "border-destructive/40 text-destructive",
          item.outcome === "failed" && "border-amber-500/40 text-amber-700 dark:text-amber-300",
        )}
      >
        {t(`accounts.detectOutcome.${item.outcome}`)}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{item.name || item.id}</div>
        {item.email ? <div className="truncate text-xs text-muted-foreground">{item.email}</div> : null}
        {item.reason ? <div className="mt-0.5 break-all text-xs text-muted-foreground">{item.reason}</div> : null}
      </div>
    </li>
  );
}
