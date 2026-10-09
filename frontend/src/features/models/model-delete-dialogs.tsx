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
import type { ModelRouteDTO } from "@/entities/model/types";
import type { ModelDialogsController } from "@/features/models/use-model-dialogs";

// 删除确认：单个模型分组（可含多项接口能力）与批量删除两个确认弹窗。

type ModelRouteRemoval = { isPending: boolean; mutate: (routes: ModelRouteDTO[]) => void };
type ModelSelectionRemoval = { isPending: boolean; mutate: () => void };

export function ModelDeleteDialog({ dialogs, remove }: { dialogs: ModelDialogsController; remove: ModelRouteRemoval }) {
  const { t } = useTranslation();
  const { deleting } = dialogs;
  return (
    <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && dialogs.closeDelete()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("models.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(deleting && deleting.routes.length > 1 ? "models.deleteGroupDescription" : "models.deleteDescription", {
              name: deleting?.publicId ?? "",
              count: deleting?.routes.length ?? 0,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="models-delete-cancel">{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={remove.isPending}
            onClick={() => deleting && remove.mutate(deleting.routes)}
            data-testid="models-delete-confirm"
          >
            {remove.isPending ? <Spinner /> : null}
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ModelBatchDeleteDialog({
  dialogs,
  removeSelected,
  selectedGroups,
}: {
  dialogs: ModelDialogsController;
  removeSelected: ModelSelectionRemoval;
  selectedGroups: number;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={dialogs.batchDeleteOpen} onOpenChange={dialogs.setBatchDeleteOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("models.batchDeleteTitle", { count: selectedGroups })}</AlertDialogTitle>
          <AlertDialogDescription>{t("models.batchDeleteDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="models-batch-delete-cancel">{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={removeSelected.isPending}
            onClick={() => removeSelected.mutate()}
            data-testid="models-batch-delete-confirm"
          >
            {removeSelected.isPending ? <Spinner /> : null}
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
