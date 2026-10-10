import type { ReactNode } from "react";
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
import type { PendingTruncateAction } from "@/features/creative-console/chat-session-model";
import type { CreativeChatController } from "@/features/creative-console/use-creative-chat";

const truncateCopyKeys: Record<PendingTruncateAction["kind"], { title: string; description: string; action: string }> =
  {
    delete: {
      title: "creativeConsole.deleteMessageConfirmTitle",
      description: "creativeConsole.deleteMessageConfirmDescription",
      action: "creativeConsole.deleteMessage",
    },
    regenerate: {
      title: "creativeConsole.regenerateTruncateTitle",
      description: "creativeConsole.regenerateTruncateDescription",
      action: "creativeConsole.regenerate",
    },
    "edit-user": {
      title: "creativeConsole.editUserTruncateTitle",
      description: "creativeConsole.editUserTruncateDescription",
      action: "creativeConsole.saveAndRegenerate",
    },
  };

/** 截断二次确认：删除、重新生成、编辑用户消息都会丢弃目标位置之后的轮次。 */
export function ChatTruncateDialog({ controller }: { controller: CreativeChatController }): ReactNode {
  const action = controller.pendingTruncate;
  return (
    <AlertDialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) controller.setPendingTruncate(null);
      }}
    >
      {action ? <ChatTruncateDialogContent action={action} onConfirm={controller.confirmPendingTruncate} /> : null}
    </AlertDialog>
  );
}

function ChatTruncateDialogContent({
  action,
  onConfirm,
}: {
  action: PendingTruncateAction;
  onConfirm: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const copy = truncateCopyKeys[action.kind];
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t(copy.title)}</AlertDialogTitle>
        <AlertDialogDescription>{t(copy.description, { count: action.trailingCount })}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
        <AlertDialogAction
          className={action.kind === "delete" ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
          onClick={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          {t(copy.action)}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
