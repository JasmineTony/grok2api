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
import type { EgressNodeDTO } from "@/features/settings";

export function QualityGuardNodeDeleteDialog({
  nodes,
  busy,
  onOpenChange,
  onConfirm,
}: {
  nodes: EgressNodeDTO[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={nodes.length > 0} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {nodes.length > 1
              ? t("qualityGuard.deleteNodesTitle", { count: nodes.length })
              : t("qualityGuard.deleteNodeTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {nodes.length > 1
              ? t("qualityGuard.deleteNodesDescription", { count: nodes.length })
              : t("qualityGuard.deleteNodeDescription", { name: nodes[0]?.name ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={busy || nodes.length === 0}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {busy ? <Spinner /> : null}
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
