import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type {
  ConversionProgress,
  WebConversionTarget,
} from "@/features/accounts/account-bulk-dialogs";
import { type AccountFormValues, createAccountSchema } from "@/features/accounts/account-form";
import {
  createConversionInput,
  createQuickImportFile,
  deriveAccountOverview,
  downloadAccountExport,
  isAbortError,
  readQuickImportFile,
  resetAccountForm,
  showAccountError,
} from "@/features/accounts/account-page-utils";
import { useAccountSelection } from "@/features/accounts/account-selection";
import {
  acceptWebAccountTerms,
  type AccountCleanupStatus,
  type AccountDTO,
  type AccountProvider,
  type AccountTaskProgressDTO,
  type AccountUpdateInput,
  type BuildConversionInput,
  type BuildConversionStrategy,
  cleanupAccounts,
  convertWebAccountsToBuild,
  deleteAccount,
  deleteAccounts,
  type DeviceSessionDTO,
  enableWebAccountNSFW,
  exportAccounts,
  getAccountSummary,
  importAccounts,
  importConsoleAccounts,
  importWebAccounts,
  listAccounts,
  listAccountStateEvents,
  refreshAccountBilling,
  refreshAccountQuota,
  refreshAccountsQuota,
  refreshAccountsTokens,
  refreshAccountToken,
  refreshAllAccountBilling,
  refreshAllAccountTokens,
  refreshAllConsoleAccountQuotas,
  refreshAllWebAccountQuotas,
  runWebAccountScripts,
  setWebAccountBirthDate,
  syncWebAccountsToConsole,
  updateAccount,
  updateAccountsEnabled,
  type WebAccountScriptActions,
  type WebAccountScriptsInput,
  type WebConsoleSyncInput,
} from "@/features/accounts/accounts-api";
import {
  type DeviceAuthorizationStatus,
  useDeviceAuthorization,
} from "@/features/accounts/use-device-authorization";
import { useStartDeviceLogin } from "@/features/accounts/use-device-login";
import type { WebAccountConfirmationTarget } from "@/features/accounts/web-account-settings";
import { useApiClient } from "@/shared/api/use-api-client";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";

export function useAccountsPageController() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const quickImportFileInputRef = useRef<HTMLInputElement>(null);
  const quotaSyncAbortRef = useRef<AbortController | null>(null);
  const renewalAbortRef = useRef<AbortController | null>(null);
  const conversionAbortRef = useRef<AbortController | null>(null);
  const webConsoleSyncAbortRef = useRef<AbortController | null>(null);
  const webAccountScriptsAbortRef = useRef<AbortController | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const importToastRef = useRef<string | number | null>(null);
  const [provider, setProvider] = useState<AccountProvider>("grok_build");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [renewalFilter, setRenewalFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [sort, setSort] = useState<TableSort>({
    field: "createdAt",
    order: "desc",
  });
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupStatuses, setCleanupStatuses] = useState<Set<AccountCleanupStatus>>(
    () => new Set(),
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [syncAllOpen, setSyncAllOpen] = useState(false);
  const [quotaSyncProgress, setQuotaSyncProgress] = useState<AccountTaskProgressDTO | null>(null);
  const [webConversionTargets, setWebConversionTargets] = useState<string[] | "all" | null>(null);
  const [webConversionTarget, setWebConversionTarget] = useState<WebConversionTarget>("build");
  const [webConversionStrategy, setWebConversionStrategy] =
    useState<BuildConversionStrategy>("missing");
  const [conversionProgress, setConversionProgress] = useState<ConversionProgress | null>(null);
  const [webConsoleSyncProgress, setWebConsoleSyncProgress] =
    useState<AccountTaskProgressDTO | null>(null);
  const [webAccountScriptsTargets, setWebAccountScriptsTargets] = useState<string[] | "all" | null>(
    null,
  );
  const [webAccountScriptsProgress, setWebAccountScriptsProgress] =
    useState<AccountTaskProgressDTO | null>(null);
  const [renewAllOpen, setRenewAllOpen] = useState(false);
  const [renewalProgress, setRenewalProgress] = useState<AccountTaskProgressDTO | null>(null);
  const [editing, setEditing] = useState<AccountDTO | null>(null);
  const [deleting, setDeleting] = useState<AccountDTO | null>(null);
  const [stateHistoryAccount, setStateHistoryAccount] = useState<AccountDTO | null>(null);
  const [egressPolicyAccount, setEgressPolicyAccount] = useState<AccountDTO | null>(null);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [deviceSession, setDeviceSession] = useState<DeviceSessionDTO | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DeviceAuthorizationStatus>("starting");
  const [quickImportOpen, setQuickImportOpen] = useState(false);
  const [quickImportTokens, setQuickImportTokens] = useState("");
  const [webConfirmationTarget, setWebConfirmationTarget] =
    useState<WebAccountConfirmationTarget | null>(null);
  const debouncedSearch = useDebouncedValue(search);
  useEffect(
    () => () => {
      quotaSyncAbortRef.current?.abort();
      renewalAbortRef.current?.abort();
      conversionAbortRef.current?.abort();
      webConsoleSyncAbortRef.current?.abort();
      webAccountScriptsAbortRef.current?.abort();
      importAbortRef.current?.abort();
      if (importToastRef.current !== null) toast.dismiss(importToastRef.current);
    },
    [],
  );
  const accountSchema = createAccountSchema(t);
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: "",
      enabled: true,
      priority: 1,
      maxConcurrent: 8,
      minimumRemaining: 0,
      cloudflareCookies: "",
      clearCloudflareCookies: false,
      buildSuperEntitled: false,
      buildRouteMode: "auto",
    },
  });
  const accountEnabled = useWatch({ control: form.control, name: "enabled" });
  const clearCloudflareCookies = useWatch({
    control: form.control,
    name: "clearCloudflareCookies",
  });
  const buildSuperEntitled = useWatch({
    control: form.control,
    name: "buildSuperEntitled",
  });
  const buildRouteMode = useWatch({
    control: form.control,
    name: "buildRouteMode",
  });
  const accountsQuery = useQuery({
    queryKey: [
      "accounts",
      provider,
      page,
      pageSize,
      debouncedSearch,
      typeFilter,
      statusFilter,
      renewalFilter,
      riskFilter,
      sort.field,
      sort.order,
    ],
    queryFn: () =>
      listAccounts(apiClient, {
        provider,
        page,
        pageSize,
        search: debouncedSearch,
        type: typeFilter,
        status: statusFilter,
        ...(provider === "grok_build" ? { renewal: renewalFilter, risk: riskFilter } : {}),
        sortBy: sort.field,
        sortOrder: sort.order,
      }),
  });
  const summaryQuery = useQuery({
    queryKey: ["accounts", "summary"],
    queryFn: () => getAccountSummary(apiClient),
  });
  const stateEventsQuery = useQuery({
    queryKey: ["accounts", stateHistoryAccount?.id, "state-events"],
    queryFn: () => listAccountStateEvents(apiClient, stateHistoryAccount?.id ?? ""),
    enabled: Boolean(stateHistoryAccount),
  });
  const invalidateAccountData = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["accounts", "summary"] });
  }, [queryClient]);
  const updateMutation = useMutation({
    mutationFn: (values: AccountFormValues) => {
      if (!editing) throw new Error(t("errors.generic"));
      const input: AccountUpdateInput = {
        name: values.name,
        enabled: values.enabled,
        priority: values.priority,
        maxConcurrent: values.maxConcurrent,
        minimumRemaining: values.minimumRemaining,
      };
      if (editing.provider !== "grok_build") {
        if (values.clearCloudflareCookies) input.clearCloudflareCookies = true;
        else if (values.cloudflareCookies.trim())
          input.cloudflareCookies = values.cloudflareCookies;
      } else {
        input.buildRouteMode = values.buildRouteMode;
        if (values.buildSuperEntitled !== editing.buildSuperEntitled)
          input.buildSuperEntitled = values.buildSuperEntitled;
      }
      return updateAccount(apiClient, editing.id, input);
    },
    onSuccess: (account, values) => {
      const entitlementChanged =
        editing?.provider === "grok_build" &&
        values.buildSuperEntitled !== editing.buildSuperEntitled;
      invalidateAccountData();
      if (entitlementChanged) void queryClient.invalidateQueries({ queryKey: ["models"] });
      setEditing(null);
      if (account.modelSyncFailed) toast.warning(t("accounts.updatedWithModelSyncFailure"));
      else toast.success(t("accounts.updated"));
    },
    onError: showError,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAccount(apiClient, id),
    onSuccess: () => {
      invalidateAccountData();
      setDeleting(null);
      toast.success(t("accounts.deleted"));
    },
    onError: showError,
  });
  const billingMutation = useMutation({
    mutationFn: (id: string) => refreshAccountBilling(apiClient, id),
    onSuccess: () => {
      invalidateAccountData();
      toast.success(t("accounts.billingRefreshed"));
    },
    onError: showError,
  });
  const tokenMutation = useMutation({
    mutationFn: (id: string) => refreshAccountToken(apiClient, id),
    onSuccess: () => {
      invalidateAccountData();
      toast.success(t("accounts.authRefreshed"));
    },
    onError: showError,
  });
  const quotaMutation = useMutation({
    mutationFn: (id: string) => refreshAccountQuota(apiClient, id),
    onSuccess: () => {
      invalidateAccountData();
      toast.success(t("accounts.billingRefreshed"));
    },
    onError: showError,
  });
  const webConfirmationMutation = useMutation({
    mutationFn: ({ account, action }: WebAccountConfirmationTarget) => {
      if (action === "acceptTerms") return acceptWebAccountTerms(apiClient, account.id);
      if (action === "setBirthDate") return setWebAccountBirthDate(apiClient, account.id);
      return enableWebAccountNSFW(apiClient, account.id);
    },
    onSuccess: (_, target) => {
      setWebConfirmationTarget(null);
      const messageKey =
        target.action === "acceptTerms"
          ? "webAccountSettings.termsAccepted"
          : target.action === "setBirthDate"
            ? "webAccountSettings.birthDateSaved"
            : "webAccountSettings.nsfwEnabled";
      toast.success(t(messageKey));
    },
    onError: showError,
    onSettled: invalidateAccountData,
  });
  const allTokenMutation = useMutation({
    mutationFn: () => {
      const controller = new AbortController();
      renewalAbortRef.current = controller;
      setRenewalProgress(null);
      return refreshAllAccountTokens(apiClient, setRenewalProgress, controller.signal);
    },
    onSuccess: (result) => {
      setRenewAllOpen(false);
      toast.success(t("accounts.allTokensRefreshed", result));
    },
    onError: (error) => {
      if (!isAbortError(error)) showError(error);
    },
    onSettled: () => {
      renewalAbortRef.current = null;
      setRenewalProgress(null);
      invalidateAccountData();
    },
  });
  const quotaSyncMutation = useMutation({
    mutationFn: (targetProvider: AccountProvider) => {
      const controller = new AbortController();
      quotaSyncAbortRef.current = controller;
      setQuotaSyncProgress(null);
      if (targetProvider === "grok_web")
        return refreshAllWebAccountQuotas(apiClient, setQuotaSyncProgress, controller.signal);
      if (targetProvider === "grok_console")
        return refreshAllConsoleAccountQuotas(apiClient, setQuotaSyncProgress, controller.signal);
      return refreshAllAccountBilling(apiClient, setQuotaSyncProgress, controller.signal);
    },
    onSuccess: (result) => {
      setSyncAllOpen(false);
      toast.success(t("accounts.allBillingRefreshed", result));
    },
    onError: (error) => {
      if (!isAbortError(error)) showError(error);
    },
    onSettled: () => {
      quotaSyncAbortRef.current = null;
      setQuotaSyncProgress(null);
      invalidateAccountData();
    },
  });
  const conversionMutation = useMutation({
    mutationFn: (input: BuildConversionInput) => {
      const controller = new AbortController();
      conversionAbortRef.current = controller;
      setConversionProgress(null);
      return convertWebAccountsToBuild(
        apiClient,
        input,
        (progress) => {
          const phase = progress.phase === "syncing" ? "syncing" : "converting";
          setConversionProgress((current) => ({
            ...(current ?? {}),
            [phase]: progress,
          }));
        },
        controller.signal,
      );
    },
    onSuccess: (conversion) => {
      setConversionProgress(null);
      setWebConversionTargets(null);
      clearSelection();
      toast.success(t("accounts.conversionCompleted", conversion));
    },
    onError: (error) => {
      if (!isAbortError(error)) showError(error);
    },
    onSettled: () => {
      conversionAbortRef.current = null;
      setConversionProgress(null);
      invalidateAccountData();
      void queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });
  const webConsoleSyncMutation = useMutation({
    mutationFn: (input: WebConsoleSyncInput) => {
      const controller = new AbortController();
      webConsoleSyncAbortRef.current = controller;
      setWebConsoleSyncProgress(null);
      return syncWebAccountsToConsole(
        apiClient,
        input,
        setWebConsoleSyncProgress,
        controller.signal,
      );
    },
    onSuccess: (result) => {
      setWebConversionTargets(null);
      clearSelection();
      toast.success(t("webConsoleSync.completed", result));
    },
    onError: (error) => {
      if (!isAbortError(error)) showError(error);
    },
    onSettled: () => {
      webConsoleSyncAbortRef.current = null;
      setWebConsoleSyncProgress(null);
      invalidateAccountData();
      void queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });
  const webAccountScriptsMutation = useMutation({
    mutationFn: (input: WebAccountScriptsInput) => {
      const controller = new AbortController();
      webAccountScriptsAbortRef.current = controller;
      setWebAccountScriptsProgress(null);
      return runWebAccountScripts(
        apiClient,
        input,
        setWebAccountScriptsProgress,
        controller.signal,
      );
    },
    onSuccess: (result) => {
      setWebAccountScriptsTargets(null);
      clearSelection();
      if (result.failed > 0) {
        toast.warning(t("webAccountScripts.completedWithFailures", result));
      } else {
        toast.success(t("webAccountScripts.completed", result));
      }
    },
    onError: (error) => {
      if (!isAbortError(error)) showError(error);
    },
    onSettled: () => {
      webAccountScriptsAbortRef.current = null;
      setWebAccountScriptsProgress(null);
      invalidateAccountData();
    },
  });
  const importMutation = useMutation({
    mutationFn: (files: File[]) => {
      const controller = new AbortController();
      importAbortRef.current = controller;
      const toastID = toast.loading(t("common.importingProgress", { completed: 0, total: "?" }));
      importToastRef.current = toastID;
      const onProgress = (progress: AccountTaskProgressDTO) => {
        toast.loading(
          t(
            progress.phase === "syncing" ? "common.syncingProgress" : "common.importingProgress",
            progress,
          ),
          { id: toastID },
        );
      };
      if (provider === "grok_web")
        return importWebAccounts(apiClient, files, onProgress, controller.signal);
      if (provider === "grok_console")
        return importConsoleAccounts(apiClient, files, onProgress, controller.signal);
      return importAccounts(apiClient, files, onProgress, controller.signal);
    },
    onSuccess: (result) => {
      if (importToastRef.current !== null) toast.dismiss(importToastRef.current);
      importToastRef.current = null;
      importAbortRef.current = null;
      setQuickImportOpen(false);
      setQuickImportTokens("");
      if (result.syncFailed > 0) {
        toast.warning(t("accounts.importedWithSyncFailures", result));
        return;
      }
      toast.success(t("accounts.imported", result));
    },
    onError: (error) => {
      if (importToastRef.current !== null) toast.dismiss(importToastRef.current);
      importToastRef.current = null;
      importAbortRef.current = null;
      if (!isAbortError(error)) showError(error);
    },
    onSettled: () => {
      importAbortRef.current = null;
      invalidateAccountData();
    },
  });
  const exportMutation = useMutation({
    mutationFn: () => exportAccounts(apiClient, provider),
    onSuccess: (blob) => {
      downloadAccountExport(blob, provider);
      setExportOpen(false);
      toast.success(t("accounts.exported"));
    },
    onError: showError,
  });
  const batchUpdateMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      updateAccountsEnabled(apiClient, [...selected], enabled, provider),
    onSuccess: () => {
      clearSelection();
      invalidateAccountData();
      toast.success(t("accounts.batchUpdated"));
    },
    onError: showError,
  });
  const batchBillingMutation = useMutation({
    mutationFn: () => refreshAccountsQuota(apiClient, [...selected], provider),
    onSuccess: (result) => {
      clearSelection();
      invalidateAccountData();
      toast.success(t("accounts.batchBillingRefreshed", result));
    },
    onError: showError,
  });
  const batchTokenMutation = useMutation({
    mutationFn: () => refreshAccountsTokens(apiClient, [...selected], provider),
    onSuccess: (result) => {
      clearSelection();
      invalidateAccountData();
      toast.success(t("accounts.allTokensRefreshed", result));
    },
    onError: showError,
  });
  const batchDeleteMutation = useMutation({
    mutationFn: () => deleteAccounts(apiClient, [...selected], provider),
    onSuccess: () => {
      clearSelection();
      setBatchDeleteOpen(false);
      invalidateAccountData();
      toast.success(t("accounts.deleted"));
    },
    onError: showError,
  });
  const cleanupMutation = useMutation({
    mutationFn: () => cleanupAccounts(apiClient, provider, [...cleanupStatuses]),
    onSuccess: (result) => {
      setCleanupOpen(false);
      setCleanupStatuses(new Set());
      invalidateAccountData();
      toast.success(t("accounts.cleanupCompleted", result));
    },
    onError: showError,
  });

  useDeviceAuthorization({
    open: deviceOpen,
    session: deviceSession,
    status: deviceStatus,
    setOpen: setDeviceOpen,
    setSession: setDeviceSession,
    setStatus: setDeviceStatus,
    invalidateAccountData,
    t,
  });

  const startDeviceLogin = useStartDeviceLogin({
    setOpen: setDeviceOpen,
    setSession: setDeviceSession,
    setStatus: setDeviceStatus,
    onError: showError,
  });

  function changeProvider(value: AccountProvider) {
    setProvider(value);
    setPage(1);
    resetSelection(value);
    setTypeFilter("");
    setStatusFilter("");
    setRenewalFilter("");
    setRiskFilter("");
    setQuickImportOpen(false);
    setQuickImportTokens("");
  }

  function submitQuickImport(): void {
    const file = createQuickImportFile(quickImportTokens, provider);
    if (file) importMutation.mutate([file]);
  }

  async function loadQuickImportFile(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      setQuickImportTokens(await readQuickImportFile(file));
    } catch (error) {
      toast.error(
        error instanceof RangeError
          ? t("apiErrors.accountImportFileTooLarge")
          : t("errors.generic"),
      );
    }
  }

  function openWebConversion(targets: string[] | "all"): void {
    setWebConversionTarget("build");
    setWebConversionStrategy("missing");
    setWebConversionTargets(targets);
  }

  function closeWebConversion(): void {
    conversionAbortRef.current?.abort();
    webConsoleSyncAbortRef.current?.abort();
    setWebConversionTargets(null);
  }

  function runWebConversion(): void {
    if (webConversionTargets === null) return;
    if (webConversionTarget === "build") {
      conversionMutation.mutate(createConversionInput(webConversionTargets, webConversionStrategy));
      return;
    }
    webConsoleSyncMutation.mutate(
      createConversionInput(webConversionTargets, webConversionStrategy),
    );
  }

  function runSelectedWebAccountScripts(actions: WebAccountScriptActions): void {
    if (webAccountScriptsTargets === "all") {
      webAccountScriptsMutation.mutate({ all: true, actions });
    } else if (webAccountScriptsTargets) {
      webAccountScriptsMutation.mutate({
        ids: webAccountScriptsTargets,
        actions,
      });
    }
  }

  function beginEdit(account: AccountDTO): void {
    setEditing(account);
    resetAccountForm(form, account);
  }

  const webConversionPending = conversionMutation.isPending || webConsoleSyncMutation.isPending;

  function showError(error: unknown): void {
    showAccountError(error, t);
  }

  const result = accountsQuery.data;
  const pageIDs = result?.items.map((account) => account.id) ?? [];
  const { selected, selectedOnPage, allPageSelected, resetSelection, togglePage, toggleAccount } =
    useAccountSelection(provider, pageIDs);

  function clearSelection(): void {
    resetSelection();
  }

  function changeSort(field: string, initialOrder: SortOrder): void {
    setSort((current) => nextTableSort(current, field, initialOrder));
    setPage(1);
  }

  const overview = deriveAccountOverview(summaryQuery.data, provider, result?.total ?? 0);
  const bulkTaskPending =
    quotaSyncMutation.isPending ||
    allTokenMutation.isPending ||
    conversionMutation.isPending ||
    webConsoleSyncMutation.isPending ||
    importMutation.isPending ||
    batchUpdateMutation.isPending ||
    batchBillingMutation.isPending ||
    batchTokenMutation.isPending ||
    batchDeleteMutation.isPending ||
    cleanupMutation.isPending ||
    webConfirmationMutation.isPending ||
    webAccountScriptsMutation.isPending;

  return {
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
  };
}

export type AccountsPageController = ReturnType<typeof useAccountsPageController>;
