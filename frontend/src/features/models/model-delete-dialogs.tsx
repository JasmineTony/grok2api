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
import { Spinner } from "@/components/ui/spinner";
import type { ModelRouteGroup } from "@/features/models/model-group-utils";

type ModelDeleteDialogsProps = {
  deleting: ModelRouteGroup | null;
  batchDeleteOpen: boolean;
  selectedGroupCount: number;
  deletePending: boolean;
  batchDeletePending: boolean;
  onDeletingOpenChange: (open: boolean) => void;
  onBatchDeleteOpenChange: (open: boolean) => void;
  onDelete: () => void;
  onBatchDelete: () => void;
};

export function ModelDeleteDialogs({
  deleting,
  batchDeleteOpen,
  selectedGroupCount,
  deletePending,
  batchDeletePending,
  onDeletingOpenChange,
  onBatchDeleteOpenChange,
  onDelete,
  onBatchDelete,
}: ModelDeleteDialogsProps) {
  const { t } = useTranslation();
  return (
    <>
      <AlertDialog open={Boolean(deleting)} onOpenChange={onDeletingOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("models.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                deleting && deleting.routes.length > 1
                  ? "models.deleteGroupDescription"
                  : "models.deleteDescription",
                { name: deleting?.publicId ?? "", count: deleting?.routes.length ?? 0 },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deletePending}
              onClick={onDelete}
            >
              {deletePending ? <Spinner /> : null}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchDeleteOpen} onOpenChange={onBatchDeleteOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("models.batchDeleteTitle", { count: selectedGroupCount })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("models.batchDeleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={batchDeletePending}
              onClick={onBatchDelete}
            >
              {batchDeletePending ? <Spinner /> : null}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
