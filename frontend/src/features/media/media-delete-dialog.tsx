import { Trash2 } from "lucide-react";
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

type MediaDeleteDialogProps = {
  open: boolean;
  /** 标题 i18n key，接收 count 插值。 */
  titleKey: string;
  descriptionKey: string;
  count: number;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/** 媒体删除确认弹窗：图库与视频任务共用同一视觉、禁用与取消语义。 */
export function MediaDeleteDialog({
  open,
  titleKey,
  descriptionKey,
  count,
  pending,
  onOpenChange,
  onConfirm,
}: MediaDeleteDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="media-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t(titleKey, { count })}</AlertDialogTitle>
          <AlertDialogDescription>{t(descriptionKey)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={pending}
            onClick={onConfirm}
            data-testid="media-delete-confirm"
          >
            {pending ? <Spinner /> : <Trash2 />}
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
