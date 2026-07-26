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

export type PendingTruncateAction =
  | { kind: "delete"; messageId: string; trailingCount: number }
  | { kind: "regenerate"; messageId: string; trailingCount: number }
  | { kind: "edit-user"; messageId: string; content: string; trailingCount: number };

type ChatTruncateDialogProps = {
  pending: PendingTruncateAction | null;
  onClose: () => void;
  onConfirm: () => void;
};

export function ChatTruncateDialog({ pending, onClose, onConfirm }: ChatTruncateDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pending?.kind === "edit-user"
              ? t("creativeConsole.editUserTruncateTitle")
              : pending?.kind === "regenerate"
                ? t("creativeConsole.regenerateTruncateTitle")
                : t("creativeConsole.deleteMessageConfirmTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pending
              ? t(
                  pending.kind === "edit-user"
                    ? "creativeConsole.editUserTruncateDescription"
                    : pending.kind === "regenerate"
                      ? "creativeConsole.regenerateTruncateDescription"
                      : "creativeConsole.deleteMessageConfirmDescription",
                  { count: pending.trailingCount },
                )
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={
              pending?.kind === "delete"
                ? "bg-destructive text-white hover:bg-destructive/90"
                : undefined
            }
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending?.kind === "edit-user"
              ? t("creativeConsole.saveAndRegenerate")
              : pending?.kind === "regenerate"
                ? t("creativeConsole.regenerate")
                : t("creativeConsole.deleteMessage")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
