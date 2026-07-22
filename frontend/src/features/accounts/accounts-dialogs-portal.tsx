import type { ComponentProps } from "react";

import { AccountBulkDialogs } from "@/features/accounts/account-bulk-dialogs";
import {
  AccountCleanupDialog,
  AccountDeleteDialogs,
  AccountDeviceDialog,
  AccountQuickImportDialog,
  AccountStateHistoryDialog,
} from "@/features/accounts/account-dialogs";
import { AccountEditDialog } from "@/features/accounts/account-edit-dialog";
import { AccountEgressPolicyDialog } from "@/features/accounts/account-egress-policy-dialog";
import { WebAccountScriptsDialog } from "@/features/accounts/web-account-scripts";
import { WebAccountSettingsDialogs } from "@/features/accounts/web-account-settings";

type AccountsDialogsPortalProps = {
  settings: ComponentProps<typeof WebAccountSettingsDialogs>;
  scripts: Omit<ComponentProps<typeof WebAccountScriptsDialog>, "targets"> & {
    targets: readonly string[] | "all" | null;
  };
  bulk: ComponentProps<typeof AccountBulkDialogs>;
  device: ComponentProps<typeof AccountDeviceDialog>;
  quickImport: ComponentProps<typeof AccountQuickImportDialog>;
  edit: ComponentProps<typeof AccountEditDialog>;
  egress: ComponentProps<typeof AccountEgressPolicyDialog>;
  history: ComponentProps<typeof AccountStateHistoryDialog>;
  deletion: ComponentProps<typeof AccountDeleteDialogs>;
  cleanup: ComponentProps<typeof AccountCleanupDialog>;
};

/** Keeps the account page focused on state orchestration rather than dialog markup. */
export function AccountsDialogsPortal({
  settings,
  scripts,
  bulk,
  device,
  quickImport,
  edit,
  egress,
  history,
  deletion,
  cleanup,
}: AccountsDialogsPortalProps) {
  return (
    <>
      <WebAccountSettingsDialogs {...settings} />
      {scripts.targets !== null ? (
        <WebAccountScriptsDialog
          pending={scripts.pending}
          progress={scripts.progress}
          onClose={scripts.onClose}
          onRun={scripts.onRun}
          targets={scripts.targets}
        />
      ) : null}
      <AccountBulkDialogs {...bulk} />
      <AccountDeviceDialog {...device} />
      <AccountQuickImportDialog {...quickImport} />
      <AccountEditDialog {...edit} />
      <AccountEgressPolicyDialog {...egress} />
      <AccountStateHistoryDialog {...history} />
      <AccountDeleteDialogs {...deletion} />
      <AccountCleanupDialog {...cleanup} />
    </>
  );
}
