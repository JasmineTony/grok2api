import { AlertCircle, Inbox } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/shared/lib/cn";

export function LoadingState({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-h-44 items-center justify-center", className)}>
      <Spinner className="size-5" />
    </div>
  );
}

export function TableLoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="p-0">
        <LoadingState className="min-h-40" />
      </TableCell>
    </TableRow>
  );
}

export function EmptyState({ message }: { message?: string | undefined }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-2xl border bg-card/90 text-center text-muted-foreground shadow-sm">
      <span className="flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-background/70">
        <Inbox className="size-5 stroke-[1.5]" />
      </span>
      <p className="text-sm">{message ?? t("common.noData")}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-2xl border bg-card/90 text-center shadow-sm">
      <span className="flex size-12 items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/10">
        <AlertCircle className="size-5 text-destructive" />
      </span>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
