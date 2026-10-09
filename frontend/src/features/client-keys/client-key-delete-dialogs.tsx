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
import type { ClientKeyDTO } from "@/features/client-keys/client-keys-api";

type DeleteConfirmDialogProps = {
  open: boolean;
  testId: string;
  title: string;
  description: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/** 删除确认框共用结构：单个删除与批量删除只在标题与触发方式上不同。 */
function DeleteConfirmDialog({ open, testId, title, description, onOpenChange, onConfirm }: DeleteConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid={testId}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid={`${testId}-cancel`}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={onConfirm}
            data-testid={`${testId}-confirm`}
          >
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ClientKeyDeleteDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: ClientKeyDTO | null;
  onClose: () => void;
  onConfirm: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <DeleteConfirmDialog
      open={Boolean(target)}
      testId="client-keys-delete-dialog"
      title={t("keys.deleteTitle")}
      description={t("keys.deleteDescription")}
      onOpenChange={(open) => !open && onClose()}
      onConfirm={() => target && onConfirm(target.id)}
    />
  );
}

export function ClientKeysBatchDeleteDialog({
  open,
  count,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  count: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DeleteConfirmDialog
      open={open}
      testId="client-keys-batch-delete-dialog"
      title={t("keys.batchDeleteTitle", { count })}
      description={t("keys.deleteDescription")}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
    />
  );
}
