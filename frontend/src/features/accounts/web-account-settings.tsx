import type { ReactElement } from "react";
import { Cake, FileCheck2, Settings2, ShieldCheck } from "lucide-react";
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
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import type { AccountDTO } from "@/entities/accounts/types";

export type WebAccountConfirmationAction = "acceptTerms" | "setBirthDate" | "enableNSFW";

export type WebAccountConfirmationTarget = {
  account: AccountDTO;
  action: WebAccountConfirmationAction;
};

type MenuProps = {
  account: AccountDTO;
  disabled: boolean;
  onConfirm: (target: WebAccountConfirmationTarget) => void;
};

export function WebAccountSettingsMenu({ account, disabled, onConfirm }: MenuProps): ReactElement {
  const { t } = useTranslation();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>
        <Settings2 />
        {t("webAccountSettings.menu")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onClick={() => onConfirm({ account, action: "acceptTerms" })}>
          <FileCheck2 />
          {t("webAccountSettings.acceptTerms")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onConfirm({ account, action: "setBirthDate" })}>
          <Cake />
          {t("webAccountSettings.setBirthDate")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onConfirm({ account, action: "enableNSFW" })}>
          <ShieldCheck />
          {t("webAccountSettings.enableNSFW")}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

type DialogsProps = {
  confirmationTarget: WebAccountConfirmationTarget | null;
  confirmationPending: boolean;
  onConfirmationClose: () => void;
  onConfirm: (target: WebAccountConfirmationTarget) => void;
};

/** 三个协议动作各自的确认文案键：标题、说明与确认按钮。 */
const confirmationCopies: Record<WebAccountConfirmationAction, { title: string; description: string; action: string }> =
  {
    acceptTerms: {
      title: "webAccountSettings.acceptTermsTitle",
      description: "webAccountSettings.acceptTermsDescription",
      action: "webAccountSettings.acceptTerms",
    },
    setBirthDate: {
      title: "webAccountSettings.setBirthDateTitle",
      description: "webAccountSettings.setBirthDateDescription",
      action: "webAccountSettings.setBirthDate",
    },
    enableNSFW: {
      title: "webAccountSettings.enableNSFWTitle",
      description: "webAccountSettings.enableNSFWDescription",
      action: "webAccountSettings.enableNSFW",
    },
  };

export function WebAccountSettingsDialogs({
  confirmationTarget,
  confirmationPending,
  onConfirmationClose,
  onConfirm,
}: DialogsProps): ReactElement {
  const { t } = useTranslation();
  const copy = confirmationCopies[confirmationTarget?.action ?? "acceptTerms"];

  return (
    <AlertDialog
      open={confirmationTarget !== null}
      onOpenChange={(open) => {
        if (!open && !confirmationPending) onConfirmationClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(copy.title)}</AlertDialogTitle>
          <AlertDialogDescription>{t(copy.description)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirmationPending}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={confirmationPending || confirmationTarget === null}
            onClick={(event) => {
              event.preventDefault();
              if (confirmationTarget) onConfirm(confirmationTarget);
            }}
          >
            {confirmationPending ? <Spinner /> : null}
            {t(copy.action)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
