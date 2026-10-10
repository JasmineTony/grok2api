import type { ReactElement } from "react";

import { BatchConcurrencyDialog, EgressConfigurationDialog } from "@/features/accounts/account-batch-dialogs";
import { CleanupDialog } from "@/features/accounts/account-cleanup-dialog";
import { RenewAllTokensDialog, WebConversionDialog } from "@/features/accounts/account-conversion-dialogs";
import { AccountBatchDeleteDialog, AccountDeleteDialog } from "@/features/accounts/account-delete-dialogs";
import { BuildDetectDialog } from "@/features/accounts/account-detect-dialog";
import { DeviceLoginDialog } from "@/features/accounts/account-device-dialog";
import { AccountEditDialog } from "@/features/accounts/account-edit-dialog";
import { ExportAccountsDialog } from "@/features/accounts/account-export-dialog";
import { QuickImportDialog } from "@/features/accounts/account-import-dialog";
import { BatchQuotaTaskDialog, QuotaSyncAllDialog } from "@/features/accounts/account-quota-task-dialogs";
import type { AccountsPageModel } from "@/features/accounts/use-accounts-page-model";
import { WebAccountScriptsDialog } from "@/features/accounts/web-account-scripts";
import { WebAccountSettingsDialogs } from "@/features/accounts/web-account-settings";

function AccountsDetectDialogs({ model }: { model: AccountsPageModel }): ReactElement {
  const { detect, conversion, scripts } = model.tasks;
  return (
    <>
      {scripts.targets !== null ? (
        <WebAccountScriptsDialog
          targets={scripts.targets}
          pending={scripts.pending}
          progress={scripts.progress}
          onClose={scripts.onClose}
          onRun={scripts.onRun}
        />
      ) : null}
      <BuildDetectDialog
        open={detect.open}
        mode={detect.mode}
        selectedCount={detect.selectedCount}
        pending={detect.pending}
        progress={detect.progress}
        counts={detect.counts}
        visibleItems={detect.visibleItems}
        onOpenChange={detect.onOpenChange}
        onRun={detect.onRun}
      />
      <WebConversionDialog
        open={conversion.open}
        targets={conversion.targets}
        target={conversion.target}
        onTargetChange={conversion.onTargetChange}
        strategy={conversion.strategy}
        onStrategyChange={conversion.onStrategyChange}
        pending={conversion.pending}
        conversionProgress={conversion.conversionProgress}
        syncProgress={conversion.syncProgress}
        onClose={conversion.onClose}
        onConfirm={conversion.onConfirm}
      />
    </>
  );
}

function AccountsQuotaTaskDialogs({ model }: { model: AccountsPageModel }): ReactElement {
  const { quotaSync, renewal } = model.tasks;
  return (
    <>
      <QuotaSyncAllDialog
        open={quotaSync.open}
        provider={quotaSync.provider}
        task={quotaSync.task}
        onTaskChange={quotaSync.onTaskChange}
        syncPending={quotaSync.syncPending}
        resetPending={quotaSync.resetPending}
        progress={quotaSync.progress}
        onOpenChange={quotaSync.onOpenChange}
        onConfirm={quotaSync.onConfirm}
      />
      <RenewAllTokensDialog
        open={renewal.open}
        pending={renewal.pending}
        progress={renewal.progress}
        onOpenChange={renewal.onOpenChange}
        onConfirm={renewal.onConfirm}
      />
    </>
  );
}

function AccountsTransferDialogs({ model }: { model: AccountsPageModel }): ReactElement {
  const { exportFlow, importFlow, device } = model.tasks;
  return (
    <>
      <ExportAccountsDialog
        open={exportFlow.open}
        provider={exportFlow.provider}
        selectedCount={exportFlow.selectedCount}
        limit={exportFlow.limit}
        onLimitChange={exportFlow.onLimitChange}
        completedCount={exportFlow.completedCount}
        batchNumber={exportFlow.batchNumber}
        snapshotMaxId={exportFlow.snapshotMaxId}
        pending={exportFlow.pending}
        onOpenChange={exportFlow.onOpenChange}
        onConfirm={exportFlow.onConfirm}
      />
      <QuickImportDialog
        open={importFlow.open}
        provider={importFlow.provider}
        tokens={importFlow.tokens}
        pending={importFlow.pending}
        onOpenChange={importFlow.onOpenChange}
        onTokensChange={importFlow.onTokensChange}
        onFileSelected={(file) => void importFlow.onFileSelected(file)}
        onSubmit={importFlow.onSubmit}
      />
      <DeviceLoginDialog
        open={device.open}
        status={device.status}
        session={device.session}
        language={device.language}
        onOpenChange={device.onOpenChange}
        onRetry={device.onRetry}
      />
    </>
  );
}

function AccountsEditDialogHost({ model }: { model: AccountsPageModel }): ReactElement {
  const { edit } = model.records;
  return (
    <AccountEditDialog
      editing={edit.editing}
      form={edit.form}
      pending={edit.pending}
      accountEnabled={edit.accountEnabled}
      clearCloudflareCookies={edit.clearCloudflareCookies}
      buildSuperEntitled={edit.buildSuperEntitled}
      buildRouteMode={edit.buildRouteMode}
      onClose={edit.onClose}
      onSubmit={edit.onSubmit}
    />
  );
}

function AccountsDeleteDialogs({ model }: { model: AccountsPageModel }): ReactElement {
  const { single, batch } = model.records.remove;
  return (
    <>
      <AccountDeleteDialog
        account={single.account}
        provider={single.provider}
        targets={single.targets}
        counts={single.counts}
        previewError={single.previewError}
        pending={single.pending}
        blocking={single.blocking}
        onOpenChange={single.onOpenChange}
        onToggleTarget={single.onToggleTarget}
        onSelectAll={single.onSelectAll}
        onConfirm={single.onConfirm}
      />
      <AccountBatchDeleteDialog
        open={batch.open}
        selectedCount={batch.selectedCount}
        provider={batch.provider}
        targets={batch.targets}
        counts={batch.counts}
        previewError={batch.previewError}
        pending={batch.pending}
        blocking={batch.blocking}
        onOpenChange={batch.onOpenChange}
        onToggleTarget={batch.onToggleTarget}
        onSelectAll={batch.onSelectAll}
        onConfirm={batch.onConfirm}
      />
    </>
  );
}

function AccountsMaintenanceDialogs({ model }: { model: AccountsPageModel }): ReactElement {
  const { concurrency, quotaTask } = model.records.batch;
  const egress = model.tasks.egress;
  return (
    <>
      <BatchConcurrencyDialog
        open={concurrency.open}
        selectedCount={concurrency.selectedCount}
        value={concurrency.value}
        onValueChange={concurrency.onValueChange}
        pending={concurrency.pending}
        onOpenChange={concurrency.onOpenChange}
        onConfirm={concurrency.onConfirm}
      />
      <BatchQuotaTaskDialog
        open={quotaTask.open}
        selectedCount={quotaTask.selectedCount}
        task={quotaTask.task}
        onTaskChange={quotaTask.onTaskChange}
        syncPending={quotaTask.syncPending}
        resetPending={quotaTask.resetPending}
        onOpenChange={quotaTask.onOpenChange}
        onConfirm={quotaTask.onConfirm}
      />
      <EgressConfigurationDialog
        open={egress.open}
        selectedCount={egress.selectedCount}
        task={egress.task}
        onTaskChange={egress.onTaskChange}
        nodeId={egress.nodeId}
        onNodeIdChange={egress.onNodeIdChange}
        nodes={egress.nodes}
        nodesPending={egress.nodesPending}
        nodesError={egress.nodesError}
        pending={egress.pending}
        onOpenChange={egress.onOpenChange}
        onConfirm={egress.onConfirm}
      />
    </>
  );
}

function AccountsCleanupDialogs({ model }: { model: AccountsPageModel }): ReactElement {
  const { cleanup } = model.tasks;
  const confirmation = model.records.rows.confirmation;
  return (
    <>
      <CleanupDialog
        open={cleanup.open}
        provider={cleanup.provider}
        statuses={cleanup.statuses}
        targets={cleanup.targets}
        previewTotals={cleanup.previewTotals}
        previewError={cleanup.previewError}
        previewFresh={cleanup.previewFresh}
        pending={cleanup.pending}
        onOpenChange={cleanup.onOpenChange}
        onToggleStatus={cleanup.onToggleStatus}
        onToggleTarget={cleanup.onToggleTarget}
        onSelectAllTargets={cleanup.onSelectAllTargets}
        onConfirm={cleanup.onConfirm}
      />
      <WebAccountSettingsDialogs
        confirmationTarget={confirmation.target}
        confirmationPending={confirmation.pending}
        onConfirmationClose={() => confirmation.onTargetChange(null)}
        onConfirm={confirmation.onConfirm}
      />
    </>
  );
}

/** 账号页弹窗宿主：只做流程状态到弹窗 props 的映射，不承载业务规则。 */
export function AccountsDialogHost({ model }: { model: AccountsPageModel }): ReactElement {
  return (
    <>
      <AccountsDetectDialogs model={model} />
      <AccountsQuotaTaskDialogs model={model} />
      <AccountsTransferDialogs model={model} />
      <AccountsEditDialogHost model={model} />
      <AccountsDeleteDialogs model={model} />
      <AccountsMaintenanceDialogs model={model} />
      <AccountsCleanupDialogs model={model} />
    </>
  );
}
