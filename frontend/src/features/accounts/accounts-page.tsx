import { AccountsDialogsPortal } from "@/features/accounts/accounts-dialogs-portal";
import { AccountsOverview } from "@/features/accounts/accounts-overview";
import { AccountsWorkspace } from "@/features/accounts/accounts-workspace";
import { useAccountsPageController } from "@/features/accounts/use-accounts-page-controller";

export function AccountsPage() {
  const {
    t,
    i18n,
    summaryQuery,
    overview,
    provider,
    changeProvider,
    bulkTaskPending,
    fileInputRef,
    startDeviceLogin,
    setQuickImportOpen,
    importMutation,
    setExportOpen,
    search,
    setSearch,
    setPage,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    renewalFilter,
    setRenewalFilter,
    riskFilter,
    setRiskFilter,
    selected,
    selectedOnPage,
    allPageSelected,
    togglePage,
    toggleAccount,
    batchUpdateMutation,
    openWebConversion,
    setWebAccountScriptsTargets,
    batchBillingMutation,
    batchTokenMutation,
    setBatchDeleteOpen,
    setSyncAllOpen,
    setRenewAllOpen,
    setCleanupStatuses,
    setCleanupOpen,
    result,
    setPageSize,
    accountsQuery,
    sort,
    changeSort,
    beginEdit,
    setStateHistoryAccount,
    setEgressPolicyAccount,
    setWebConfirmationTarget,
    tokenMutation,
    billingMutation,
    quotaMutation,
    setDeleting,
    webConfirmationTarget,
    webConfirmationMutation,
    webAccountScriptsTargets,
    webAccountScriptsMutation,
    webAccountScriptsProgress,
    webAccountScriptsAbortRef,
    runSelectedWebAccountScripts,
    syncAllOpen,
    quotaSyncMutation,
    quotaSyncProgress,
    quotaSyncAbortRef,
    webConversionTargets,
    webConversionTarget,
    webConversionStrategy,
    webConversionPending,
    conversionProgress,
    webConsoleSyncProgress,
    closeWebConversion,
    setWebConversionTarget,
    setWebConversionStrategy,
    runWebConversion,
    renewAllOpen,
    allTokenMutation,
    renewalProgress,
    renewalAbortRef,
    exportOpen,
    exportMutation,
    deviceOpen,
    setDeviceOpen,
    deviceStatus,
    deviceSession,
    quickImportOpen,
    quickImportTokens,
    setQuickImportTokens,
    quickImportFileInputRef,
    loadQuickImportFile,
    submitQuickImport,
    editing,
    form,
    accountEnabled,
    clearCloudflareCookies,
    buildSuperEntitled,
    buildRouteMode,
    updateMutation,
    setEditing,
    egressPolicyAccount,
    stateHistoryAccount,
    stateEventsQuery,
    deleting,
    batchDeleteOpen,
    deleteMutation,
    batchDeleteMutation,
    cleanupOpen,
    cleanupStatuses,
    cleanupMutation,
  } = useAccountsPageController();

  return (
    <div className="space-y-5">
      <AccountsOverview
        t={t}
        locale={i18n.language}
        loading={summaryQuery.isPending}
        unavailable={summaryQuery.isError}
        build={overview.build}
        web={overview.web}
        console={overview.console}
        abnormal={overview.abnormal}
        recovering={overview.recovering}
        risk={overview.risk}
        disabled={overview.disabled}
        invalid={overview.invalid}
      />
      <AccountsWorkspace
        t={t}
        i18n={i18n}
        provider={provider}
        changeProvider={changeProvider}
        bulkTaskPending={bulkTaskPending}
        hasProviderAccounts={overview.hasProviderAccounts}
        fileInputRef={fileInputRef}
        startDeviceLogin={startDeviceLogin}
        setQuickImportOpen={setQuickImportOpen}
        importMutation={importMutation}
        setExportOpen={setExportOpen}
        search={search}
        setSearch={setSearch}
        setPage={setPage}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        renewalFilter={renewalFilter}
        setRenewalFilter={setRenewalFilter}
        riskFilter={riskFilter}
        setRiskFilter={setRiskFilter}
        selected={selected}
        selectedOnPage={selectedOnPage}
        allPageSelected={allPageSelected}
        togglePage={togglePage}
        toggleAccount={toggleAccount}
        batchUpdateMutation={batchUpdateMutation}
        openWebConversion={openWebConversion}
        setWebAccountScriptsTargets={setWebAccountScriptsTargets}
        batchBillingMutation={batchBillingMutation}
        batchTokenMutation={batchTokenMutation}
        setBatchDeleteOpen={setBatchDeleteOpen}
        setSyncAllOpen={setSyncAllOpen}
        setRenewAllOpen={setRenewAllOpen}
        setCleanupStatuses={setCleanupStatuses}
        setCleanupOpen={setCleanupOpen}
        result={result}
        setPageSize={setPageSize}
        accountsQuery={accountsQuery}
        sort={sort}
        changeSort={changeSort}
        beginEdit={beginEdit}
        setStateHistoryAccount={setStateHistoryAccount}
        setEgressPolicyAccount={setEgressPolicyAccount}
        setWebConfirmationTarget={setWebConfirmationTarget}
        tokenMutation={tokenMutation}
        billingMutation={billingMutation}
        quotaMutation={quotaMutation}
        setDeleting={setDeleting}
      />

      <AccountsDialogsPortal
        settings={{
          confirmationTarget: webConfirmationTarget,
          confirmationPending: webConfirmationMutation.isPending,
          onConfirmationClose: () => setWebConfirmationTarget(null),
          onConfirm: (target) => webConfirmationMutation.mutate(target),
        }}
        scripts={{
          targets: webAccountScriptsTargets,
          pending: webAccountScriptsMutation.isPending,
          progress: webAccountScriptsProgress,
          onClose: () => {
            webAccountScriptsAbortRef.current?.abort();
            setWebAccountScriptsTargets(null);
          },
          onRun: runSelectedWebAccountScripts,
        }}
        bulk={{
          provider,
          syncOpen: syncAllOpen,
          syncPending: quotaSyncMutation.isPending,
          syncProgress: quotaSyncProgress,
          onSyncOpenChange: (open) => {
            if (!open) quotaSyncAbortRef.current?.abort();
            setSyncAllOpen(open);
          },
          onSync: () => quotaSyncMutation.mutate(provider),
          conversionTargets: webConversionTargets,
          conversionTarget: webConversionTarget,
          conversionStrategy: webConversionStrategy,
          conversionPending: webConversionPending,
          conversionProgress,
          consoleProgress: webConsoleSyncProgress,
          onConversionOpenChange: (open) => {
            if (!open) closeWebConversion();
          },
          onConversionTargetChange: setWebConversionTarget,
          onConversionStrategyChange: setWebConversionStrategy,
          onConvert: runWebConversion,
          renewOpen: renewAllOpen,
          renewPending: allTokenMutation.isPending,
          renewalProgress,
          onRenewOpenChange: (open) => {
            if (!open) renewalAbortRef.current?.abort();
            setRenewAllOpen(open);
          },
          onRenew: () => allTokenMutation.mutate(),
          exportOpen,
          exportPending: exportMutation.isPending,
          onExportOpenChange: setExportOpen,
          onExport: () => exportMutation.mutate(),
        }}
        device={{
          open: deviceOpen,
          onOpenChange: setDeviceOpen,
          status: deviceStatus,
          session: deviceSession,
          locale: i18n.language,
          onRetry: () => void startDeviceLogin(),
        }}
        quickImport={{
          open: quickImportOpen,
          onOpenChange: (open) => {
            setQuickImportOpen(open);
            if (!open) {
              setQuickImportTokens("");
              if (quickImportFileInputRef.current) quickImportFileInputRef.current.value = "";
            }
          },
          provider,
          pending: importMutation.isPending,
          tokens: quickImportTokens,
          onTokensChange: setQuickImportTokens,
          fileInputRef: quickImportFileInputRef,
          onLoadFile: loadQuickImportFile,
          onSubmit: submitQuickImport,
        }}
        edit={{
          account: editing,
          form,
          enabled: accountEnabled,
          clearCloudflareCookies,
          buildSuperEntitled,
          buildRouteMode,
          pending: updateMutation.isPending,
          onClose: () => setEditing(null),
          onSubmit: (values) => updateMutation.mutate(values),
        }}
        egress={{
          account: egressPolicyAccount,
          onOpenChange: (open) => !open && setEgressPolicyAccount(null),
        }}
        history={{
          account: stateHistoryAccount,
          events: stateEventsQuery.data,
          pending: stateEventsQuery.isPending,
          error: stateEventsQuery.isError ? stateEventsQuery.error.message : "",
          locale: i18n.language,
          onOpenChange: (open) => !open && setStateHistoryAccount(null),
          onRetry: () => void stateEventsQuery.refetch(),
        }}
        deletion={{
          deleting,
          batchOpen: batchDeleteOpen,
          selectedCount: selected.size,
          onDeletingChange: setDeleting,
          onBatchOpenChange: setBatchDeleteOpen,
          onDelete: (id) => deleteMutation.mutate(id),
          onBatchDelete: () => batchDeleteMutation.mutate(),
        }}
        cleanup={{
          open: cleanupOpen,
          provider,
          statuses: cleanupStatuses,
          pending: cleanupMutation.isPending,
          onOpenChange: (open) => {
            setCleanupOpen(open);
            if (!open) setCleanupStatuses(new Set());
          },
          onStatusesChange: setCleanupStatuses,
          onSubmit: () => cleanupMutation.mutate(),
        }}
      />
    </div>
  );
}
