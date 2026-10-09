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
import type { EgressNodeDTO } from "@/features/settings/settings-api";

// 节点删除确认：从 quality-guard-page.tsx 拆出。单个/批量文案与拆分前一致。

export function NodeDeleteDialog({
  nodes,
  pending,
  onOpenChange,
  onConfirm,
}: {
  nodes: EgressNodeDTO[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (nodes: EgressNodeDTO[]) => void;
}) {
  const { t } = useTranslation();
  const multiple = nodes.length > 1;
  return (
    <AlertDialog open={nodes.length > 0} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="guard-node-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {multiple ? t("qualityGuard.deleteNodesTitle", { count: nodes.length }) : t("qualityGuard.deleteNodeTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {multiple
              ? t("qualityGuard.deleteNodesDescription", { count: nodes.length })
              : t("qualityGuard.deleteNodeDescription", { name: nodes[0]?.name ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={pending || nodes.length === 0}
            onClick={(event) => {
              event.preventDefault();
              if (nodes.length > 0) onConfirm(nodes);
            }}
            data-testid="guard-node-delete-confirm"
          >
            {pending ? <Spinner /> : null}
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
