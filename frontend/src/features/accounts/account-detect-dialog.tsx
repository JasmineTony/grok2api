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
import type {
  AccountTaskProgressDTO,
  BuildDetectItemDTO,
} from "@/features/accounts/account-tasks-api";

type BuildDetectCounts = Record<BuildDetectItemDTO["outcome"], number>;

export type AccountDetectDialogProps = {
  mode: "selected" | "all" | null;
  selectedCount: number;
  pending: boolean;
  progress: AccountTaskProgressDTO | null;
  items: BuildDetectItemDTO[];
  counts: BuildDetectCounts;
  onOpenChange: (open: boolean) => void;
  onRun: () => void;
};

export function AccountDetectDialog({
  mode,
  selectedCount,
  pending,
  progress,
  items,
  counts,
  onOpenChange,
  onRun,
}: AccountDetectDialogProps) {
  const { t } = useTranslation();
  const visibleItems = mode === "all" ? items.filter((item) => item.outcome === "invalid") : items;
  const totalResults = counts.ok + counts.invalid + counts.failed;

  return (
    <Dialog open={mode !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t(mode === "all" ? "accounts.detectAllTitle" : "accounts.detectSelectedTitle", {
              count: selectedCount,
            })}
          </DialogTitle>
          <DialogDescription>
            {t(
              mode === "all"
                ? "accounts.detectAllDescription"
                : "accounts.detectSelectedDescription",
              { count: selectedCount },
            )}
          </DialogDescription>
        </DialogHeader>
        {pending || progress || visibleItems.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t("accounts.detectProgressLabel")}</span>
              <span className="tabular-nums font-medium">
                {progress
                  ? `${progress.completed} / ${progress.total}`
                  : pending
                    ? t("common.loading")
                    : "—"}
              </span>
            </div>
            {mode === "all" && counts.invalid > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("accounts.detectInvalidCount", { count: counts.invalid })}
              </p>
            ) : null}
            {mode === "selected" && totalResults > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("accounts.detectSelectedSummary", counts)}
              </p>
            ) : null}
            {totalResults > visibleItems.length ? (
              <p className="text-xs text-muted-foreground">
                {t("accounts.detectResultsLimited", { count: 200 })}
              </p>
            ) : null}
            <div className="max-h-64 overflow-y-auto rounded-md border">
              {visibleItems.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {pending
                    ? t(
                        mode === "all"
                          ? "accounts.detectWaitingInvalid"
                          : "accounts.detectWaitingResults",
                      )
                    : t(mode === "all" ? "accounts.detectNoInvalid" : "accounts.detectNoResults")}
                </div>
              ) : (
                <ul className="divide-y">
                  {visibleItems.map((item) => (
                    <li
                      key={`${item.id}-${item.outcome}-${item.reason ?? ""}`}
                      className="flex items-start gap-3 px-3 py-2 text-sm"
                    >
                      <Badge
                        variant="outline"
                        className={
                          item.outcome === "ok"
                            ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                            : item.outcome === "invalid"
                              ? "border-rose-500/40 text-rose-700 dark:text-rose-300"
                              : "border-amber-500/40 text-amber-700 dark:text-amber-300"
                        }
                      >
                        {t(`accounts.detectOutcome.${item.outcome}`)}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{item.name || item.id}</div>
                        {item.email ? (
                          <div className="truncate text-xs text-muted-foreground">{item.email}</div>
                        ) : null}
                        {item.reason ? (
                          <div className="mt-1 text-xs text-muted-foreground">{item.reason}</div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {pending ? t("common.cancel") : t("common.close")}
          </Button>
          <Button
            disabled={pending || (mode === "selected" && selectedCount === 0)}
            onClick={onRun}
          >
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
      </DialogContent>
    </Dialog>
  );
}
