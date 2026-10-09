import { zodResolver } from "@hookform/resolvers/zod";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ClipboardPaste,
  Compass,
  Download,
  ExternalLink,
  FileUp,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  SquareTerminal,
  TimerOff,
  Trash2,
  Webhook,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableActionCell,
  TableActionHead,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError } from "@/shared/api/client";
import { EmptyState, ErrorState, TableLoadingRow } from "@/shared/components/data-state";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { DataTableFilters } from "@/shared/components/data-table-filters";
import { Pagination } from "@/shared/components/pagination";
import { SortableTableHead } from "@/shared/components/sortable-table-head";
import { VirtualTableBody } from "@/shared/components/virtual-table-body";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";
import {
  acceptWebAccountTerms,
  cleanupAccounts,
  clearAccountCooldown,
  deleteAccount,
  deleteAccounts,
  previewAccountDeletion,
  previewCleanup,
  enableWebAccountNSFW,
  convertWebAccountsToBuild,
  detectBuildAccounts,
  exportAccountBatch,
  exportSelectedAccounts,
  getAccountSummary,
  importAccounts,
  importConsoleAccounts,
  importWebAccounts,
  listAccounts,
  pollDeviceAuthorization,
  refreshAccountBilling,
  refreshAccountsQuota,
  resetAccountsQuota,
  resetAllAccountQuota,
  refreshAccountsTokens,
  refreshAccountToken,
  refreshAccountQuota,
  refreshAllAccountBilling,
  refreshAllAccountTokens,
  refreshAllConsoleAccountQuotas,
  refreshAllWebAccountQuotas,
  runWebAccountScripts,
  setWebAccountBirthDate,
  startDeviceAuthorization,
  syncWebAccountsToConsole,
  updateAccount,
  updateAccountsEnabled,
  updateAccountsMaxConcurrent,
  type AccountDTO,
  type AccountCleanupStatus,
  type AccountProvider,
  type CleanupPreviewDTO,
  type AccountUpdateInput,
  type AccountTaskProgressDTO,
  type BuildConversionInput,
  type BuildConversionStrategy,
  type BuildDetectItemDTO,
  type WebConsoleSyncInput,
  type WebAccountScriptActions,
  type WebAccountScriptsInput,
  type DeviceSessionDTO,
} from "@/features/accounts/accounts-api";
import { AccountQuota, ConsoleQuota, WebQuota } from "@/features/accounts/account-quota";
import { AccountNameCell } from "@/features/accounts/account-name-cell";
import { AccountStatus, AccountType, AccountTypeText, WebAccountType } from "@/features/accounts/account-cells";
import { AccountsSummaryPanel } from "@/features/accounts/accounts-summary-panel";
import { WebAccountScriptsDialog } from "@/features/accounts/web-account-scripts";
import {
  WebAccountSettingsDialogs,
  WebAccountSettingsMenu,
  type WebAccountConfirmationTarget,
} from "@/features/accounts/web-account-settings";
import { downloadAccountExport, isAbortError, linkedTargetOptions } from "@/features/accounts/accounts-view-model";
import { AccountEditDialog } from "@/features/accounts/account-edit-dialog";
import {
  createAccountFormDefaults,
  createAccountFormSchema,
  type AccountForm,
} from "@/features/accounts/account-edit-form";
import { AccountBatchDeleteDialog, AccountDeleteDialog } from "@/features/accounts/account-delete-dialogs";
import { BatchConcurrencyDialog, EgressConfigurationDialog } from "@/features/accounts/account-batch-dialogs";
import { CleanupDialog } from "@/features/accounts/account-cleanup-dialog";
import { BuildDetectDialog } from "@/features/accounts/account-detect-dialog";
import { DeviceLoginDialog } from "@/features/accounts/account-device-dialog";
import { ExportAccountsDialog } from "@/features/accounts/account-export-dialog";
import { QuickImportDialog } from "@/features/accounts/account-import-dialog";
import { BatchQuotaTaskDialog, QuotaSyncAllDialog } from "@/features/accounts/account-quota-task-dialogs";
import { RenewAllTokensDialog, WebConversionDialog } from "@/features/accounts/account-conversion-dialogs";
import {
  assignEgressAccounts,
  listAllEgressNodes,
  listEgressNodes,
  listEgressSources,
  unassignEgressAccounts,
  type EgressScope,
} from "@/features/settings/settings-api";

type WebConversionTarget = "build" | "console";
type BuildQuotaTask = "sync" | "reset";
type EgressConfigurationTask = "bind" | "unbind";
type BuildDetectCounts = Record<BuildDetectItemDTO["outcome"], number>;

const emptyBuildDetectCounts = (): BuildDetectCounts => ({ ok: 0, invalid: 0, failed: 0 });

const egressFilterNodePageSize = 100;
const egressFilterSourcePageSize = 100;

type AccountSelection = {
  provider: AccountProvider;
  ids: Set<string>;
};

export function AccountsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const quotaSyncAbortRef = useRef<AbortController | null>(null);
  const detectAbortRef = useRef<AbortController | null>(null);
  const detectOutcomeByIDRef = useRef(new Map<string, BuildDetectItemDTO["outcome"]>());
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
  const [egressFilter, setEgressFilter] = useState("");
  const [egressFilterSelectedLabel, setEgressFilterSelectedLabel] = useState("");
  const [egressFilterOptionsOpen, setEgressFilterOptionsOpen] = useState(false);
  const [egressFilterOptionsSearch, setEgressFilterOptionsSearch] = useState("");
  const [renewalFilter, setRenewalFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [agreementFilter, setAgreementFilter] = useState("");
  const [associationFilter, setAssociationFilter] = useState("");
  const [sort, setSort] = useState<TableSort>({ field: "createdAt", order: "desc" });
  const [selection, setSelection] = useState<AccountSelection>(() => ({ provider: "grok_build", ids: new Set() }));
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchConcurrencyOpen, setBatchConcurrencyOpen] = useState(false);
  const [batchMaxConcurrent, setBatchMaxConcurrent] = useState("1");
  const [batchQuotaTaskOpen, setBatchQuotaTaskOpen] = useState(false);
  const [batchQuotaTask, setBatchQuotaTask] = useState<BuildQuotaTask>("sync");
  const [egressConfigurationOpen, setEgressConfigurationOpen] = useState(false);
  const [egressConfigurationTask, setEgressConfigurationTask] = useState<EgressConfigurationTask>("bind");
  const [egressNodeID, setEgressNodeID] = useState("");
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupStatuses, setCleanupStatuses] = useState<Set<AccountCleanupStatus>>(() => new Set());
  // Cleanup preview + optional linked deletion (independent from the delete dialogs' state).
  const [cleanupLinkedTargets, setCleanupLinkedTargets] = useState<AccountProvider[]>([]);
  // Keyed preview: a stale result stays mounted while the next one loads, so the
  // dialog never reflows between "has counts" and "no counts".
  const [cleanupPreview, setCleanupPreview] = useState<{ key: string; data: CleanupPreviewDTO } | null>(null);
  const [cleanupPreviewError, setCleanupPreviewError] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportLimit, setExportLimit] = useState("1000");
  const [exportCursor, setExportCursor] = useState("0");
  const [exportSnapshotMaxId, setExportSnapshotMaxId] = useState("0");
  const [exportBatchNumber, setExportBatchNumber] = useState(1);
  const [exportCompletedCount, setExportCompletedCount] = useState(0);
  const [syncAllOpen, setSyncAllOpen] = useState(false);
  const [detectDialogOpen, setDetectDialogOpen] = useState(false);
  const [detectMode, setDetectMode] = useState<"selected" | "all">("all");
  const [allQuotaTask, setAllQuotaTask] = useState<BuildQuotaTask>("sync");
  const [quotaSyncProgress, setQuotaSyncProgress] = useState<AccountTaskProgressDTO | null>(null);
  const [detectProgress, setDetectProgress] = useState<AccountTaskProgressDTO | null>(null);
  const [detectItems, setDetectItems] = useState<BuildDetectItemDTO[]>([]);
  const [detectCounts, setDetectCounts] = useState<BuildDetectCounts>(emptyBuildDetectCounts);
  const [webConversionTargets, setWebConversionTargets] = useState<string[] | "all" | null>(null);
  const [webConversionTarget, setWebConversionTarget] = useState<WebConversionTarget>("build");
  const [webConversionStrategy, setWebConversionStrategy] = useState<BuildConversionStrategy>("missing");
  const [conversionProgress, setConversionProgress] = useState<AccountTaskProgressDTO | null>(null);
  const [webConsoleSyncProgress, setWebConsoleSyncProgress] = useState<AccountTaskProgressDTO | null>(null);
  const [webAccountScriptsTargets, setWebAccountScriptsTargets] = useState<string[] | "all" | null>(null);
  const [webAccountScriptsProgress, setWebAccountScriptsProgress] = useState<AccountTaskProgressDTO | null>(null);
  const [renewAllOpen, setRenewAllOpen] = useState(false);
  const [renewalProgress, setRenewalProgress] = useState<AccountTaskProgressDTO | null>(null);
  const [editing, setEditing] = useState<AccountDTO | null>(null);
  const [deleting, setDeleting] = useState<AccountDTO | null>(null);
  const [linkedDeleteTargets, setLinkedDeleteTargets] = useState<AccountProvider[]>([]);
  const [linkedDeleteCounts, setLinkedDeleteCounts] = useState<Partial<Record<AccountProvider, number>>>({});
  // Preview failures must not be painted as +0 — block confirm until a successful recount.
  const [linkedDeletePreviewError, setLinkedDeletePreviewError] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [deviceSession, setDeviceSession] = useState<DeviceSessionDTO | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<"starting" | "pending" | "failed">("starting");
  const [quickImportOpen, setQuickImportOpen] = useState(false);
  const [quickImportTokens, setQuickImportTokens] = useState("");
  const [webConfirmationTarget, setWebConfirmationTarget] = useState<WebAccountConfirmationTarget | null>(null);
  const debouncedSearch = useDebouncedValue(search);
  const debouncedEgressFilterOptionsSearch = useDebouncedValue(egressFilterOptionsSearch);

  useEffect(
    () => () => {
      quotaSyncAbortRef.current?.abort();
      detectAbortRef.current?.abort();
      renewalAbortRef.current?.abort();
      conversionAbortRef.current?.abort();
      webConsoleSyncAbortRef.current?.abort();
      webAccountScriptsAbortRef.current?.abort();
      importAbortRef.current?.abort();
      if (importToastRef.current !== null) toast.dismiss(importToastRef.current);
    },
    [],
  );

  const accountSchema = createAccountFormSchema(t);
  const form = useForm<AccountForm>({
    resolver: zodResolver(accountSchema),
    defaultValues: createAccountFormDefaults(),
  });
  const accountEnabled = useWatch({ control: form.control, name: "enabled" });
  const clearCloudflareCookies = useWatch({ control: form.control, name: "clearCloudflareCookies" });
  const buildSuperEntitled = useWatch({ control: form.control, name: "buildSuperEntitled" });
  const buildRouteMode = useWatch({ control: form.control, name: "buildRouteMode" });
  const selected = selection.provider === provider ? selection.ids : new Set<string>();
  const selectedIdsKey = Array.from(selected).sort().join(",");

  const accountsQuery = useQuery({
    queryKey: [
      "accounts",
      provider,
      page,
      pageSize,
      debouncedSearch,
      typeFilter,
      statusFilter,
      egressFilter,
      renewalFilter,
      riskFilter,
      agreementFilter,
      associationFilter,
      sort.field,
      sort.order,
    ],
    queryFn: () =>
      listAccounts({
        provider,
        page,
        pageSize,
        search: debouncedSearch,
        type: typeFilter,
        status: statusFilter,
        egress: egressFilter,
        renewal: provider === "grok_build" ? renewalFilter : undefined,
        risk: provider === "grok_build" ? riskFilter : undefined,
        agreement: provider === "grok_web" ? agreementFilter : undefined,
        association: associationFilter || undefined,
        sortBy: sort.field,
        sortOrder: sort.order,
      }),
  });

  const summaryQuery = useQuery({
    queryKey: ["accounts", "summary"],
    queryFn: getAccountSummary,
  });
  // The binding dialog still needs every compatible node, but only while open.
  const egressNodesQuery = useQuery({
    queryKey: ["egress-nodes", "account-binding"],
    queryFn: () => listAllEgressNodes(),
    enabled: egressConfigurationOpen && egressConfigurationTask === "bind",
    staleTime: 60_000,
  });
  // Filter choices are loaded only when the third-level menu opens. Nodes and
  // subscription sources use bounded pages so large pools do not flood the page.
  const egressFilterPrimaryScope = accountProviderPrimaryEgressScope(provider);
  const egressFilterNodesQuery = useInfiniteQuery({
    queryKey: ["egress-nodes", "account-filter", egressFilterPrimaryScope, debouncedEgressFilterOptionsSearch],
    queryFn: ({ pageParam }) =>
      listEgressNodes({
        page: pageParam,
        pageSize: egressFilterNodePageSize,
        search: debouncedEgressFilterOptionsSearch,
        scope: egressFilterPrimaryScope,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined,
    enabled: egressFilterOptionsOpen,
    staleTime: 60_000,
  });
  // Console routing supports both native Console exits and Grok Web exits. Keep
  // the second scope independently paginated so unrelated Build/asset nodes can
  // never consume the Console result pages.
  const egressFilterConsoleWebNodesQuery = useInfiniteQuery({
    queryKey: ["egress-nodes", "account-filter", "console-web", debouncedEgressFilterOptionsSearch],
    queryFn: ({ pageParam }) =>
      listEgressNodes({
        page: pageParam,
        pageSize: egressFilterNodePageSize,
        search: debouncedEgressFilterOptionsSearch,
        scope: "grok_web",
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined,
    enabled: egressFilterOptionsOpen && provider === "grok_console",
    staleTime: 60_000,
  });
  const egressFilterSourcesQuery = useInfiniteQuery({
    queryKey: ["egress-sources", "account-filter", egressFilterPrimaryScope, debouncedEgressFilterOptionsSearch],
    queryFn: ({ pageParam }) =>
      listEgressSources({
        page: pageParam,
        pageSize: egressFilterSourcePageSize,
        search: debouncedEgressFilterOptionsSearch,
        scope: egressFilterPrimaryScope,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined,
    enabled: egressFilterOptionsOpen,
    staleTime: 60_000,
  });
  const egressFilterConsoleWebSourcesQuery = useInfiniteQuery({
    queryKey: ["egress-sources", "account-filter", "console-web", debouncedEgressFilterOptionsSearch],
    queryFn: ({ pageParam }) =>
      listEgressSources({
        page: pageParam,
        pageSize: egressFilterSourcePageSize,
        search: debouncedEgressFilterOptionsSearch,
        scope: "grok_web",
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined,
    enabled: egressFilterOptionsOpen && provider === "grok_console",
    staleTime: 60_000,
  });

  const invalidateAccountData = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["accounts", "summary"] });
  }, [queryClient]);

  const updateMutation = useMutation({
    mutationFn: (values: AccountForm) => {
      if (!editing) throw new Error(t("errors.generic"));
      const input: AccountUpdateInput = {
        name: values.name,
        priority: values.priority,
        maxConcurrent: values.maxConcurrent,
        minimumRemaining: values.minimumRemaining,
      };
      if (values.enabled !== editing.enabled) input.enabled = values.enabled;
      if (editing.provider !== "grok_build") {
        if (values.clearCloudflareCookies) input.clearCloudflareCookies = true;
        else if (values.cloudflareCookies.trim()) input.cloudflareCookies = values.cloudflareCookies;
      } else {
        input.buildRouteMode = values.buildRouteMode;
        if (values.buildSuperEntitled !== editing.buildSuperEntitled)
          input.buildSuperEntitled = values.buildSuperEntitled;
      }
      return updateAccount(editing.id, input);
    },
    onSuccess: (account, values) => {
      const entitlementChanged =
        editing?.provider === "grok_build" && values.buildSuperEntitled !== editing.buildSuperEntitled;
      invalidateAccountData();
      if (entitlementChanged) void queryClient.invalidateQueries({ queryKey: ["models"] });
      setEditing(null);
      if (account.modelSyncFailed) toast.warning(t("accounts.updatedWithModelSyncFailure"));
      else if (account.enabledDoesNotClearCooldown) toast.warning(t("accounts.enabledDoesNotClearCooldown"));
      else toast.success(t("accounts.updated"));
    },
    onError: showError,
  });

  useEffect(() => {
    if (!deleting && !batchDeleteOpen) return;
    const ids = deleting ? [deleting.id] : selectedIdsKey ? selectedIdsKey.split(",") : [];
    if (linkedDeleteTargets.length === 0 || ids.length === 0) return;
    let cancelled = false;
    // Keep dialog height stable: never mount/unmount loading rows; only update counts in place.
    // Clear error/counts only inside the async path (not sync in effect body) to satisfy react-hooks/set-state-in-effect.
    const timer = window.setTimeout(() => {
      void previewAccountDeletion(ids, provider, linkedDeleteTargets)
        .then((preview) => {
          if (cancelled) return;
          // Always materialize a count for every selected target (including 0),
          // otherwise a missing key would leave the spinner forever.
          const next: Partial<Record<AccountProvider, number>> = {};
          for (const target of linkedDeleteTargets) {
            next[target] = preview.linkedByProvider?.[target] ?? 0;
          }
          setLinkedDeletePreviewError(false);
          setLinkedDeleteCounts(next);
        })
        .catch(() => {
          if (cancelled) return;
          // Do NOT write fake +0 — that understates destructive scope. Block confirm until retry succeeds.
          setLinkedDeleteCounts({});
          setLinkedDeletePreviewError(true);
          toast.error(t("accounts.linkedDeletePreviewFailed"));
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [batchDeleteOpen, deleting, linkedDeleteTargets, provider, selectedIdsKey, t]);

  // When any linked target is checked, require a successful preview before confirm.
  const linkedPreviewBlocking =
    linkedDeleteTargets.length > 0 &&
    (linkedDeletePreviewError || linkedDeleteTargets.some((target) => !(target in linkedDeleteCounts)));

  const resetLinkedDeleteState = () => {
    setLinkedDeleteTargets([]);
    setLinkedDeleteCounts({});
    setLinkedDeletePreviewError(false);
  };

  const toggleLinkedDeleteTarget = (target: AccountProvider, checked: boolean) => {
    setLinkedDeleteTargets((current) => {
      const next = checked
        ? current.includes(target)
          ? current
          : [...current, target]
        : current.filter((item) => item !== target);
      if (next.length === 0) {
        setLinkedDeleteCounts({});
        setLinkedDeletePreviewError(false);
      } else if (!checked) {
        setLinkedDeleteCounts((counts) => {
          const copy = { ...counts };
          delete copy[target];
          return copy;
        });
      } else {
        // New selection: drop previous error and recount.
        setLinkedDeletePreviewError(false);
      }
      return next;
    });
  };

  const selectAllLinkedTargets = () => {
    const options = linkedTargetOptions(provider);
    const allSelected = options.every((item) => linkedDeleteTargets.includes(item));
    if (allSelected) {
      setLinkedDeleteTargets([]);
      setLinkedDeleteCounts({});
      return;
    }
    // Clear counts so newly selected targets show spinner until preview returns.
    setLinkedDeletePreviewError(false);
    setLinkedDeleteCounts({});
    setLinkedDeleteTargets(options);
  };

  const deleteMutation = useMutation({
    // Snapshot id/targets in mutate() args so AlertDialog close/reset cannot clear linkedDeleteTargets mid-flight.
    mutationFn: (input: { id: string; provider: AccountProvider; linkedDeleteTargets: AccountProvider[] }) =>
      deleteAccount(
        input.id,
        input.linkedDeleteTargets.length
          ? { provider: input.provider, linkedDeleteTargets: input.linkedDeleteTargets }
          : undefined,
      ),
    onSuccess: () => {
      invalidateAccountData();
      setDeleting(null);
      resetLinkedDeleteState();
      toast.success(t("accounts.deleted"));
    },
    onError: showError,
  });

  // Batch paths skip groups that still have active media jobs; surface that instead of a bare success.
  const notifyDeleteResult = (result: { deleted?: number; skipped?: number } | { deleted: boolean }) => {
    const skipped = typeof result === "object" && "skipped" in result ? (result.skipped ?? 0) : 0;
    if (skipped > 0) {
      const deleted = typeof result === "object" && typeof result.deleted === "number" ? result.deleted : 0;
      toast.warning(t("accounts.deletedWithSkipped", { deleted, skipped }));
      return;
    }
    toast.success(t("accounts.deleted"));
  };

  const billingMutation = useMutation({
    mutationFn: refreshAccountBilling,
    onSuccess: () => {
      invalidateAccountData();
      toast.success(t("accounts.billingRefreshed"));
    },
    onError: showError,
  });

  const tokenMutation = useMutation({
    mutationFn: refreshAccountToken,
    onSuccess: () => {
      invalidateAccountData();
      toast.success(t("accounts.authRefreshed"));
    },
    onError: showError,
  });

  const clearCooldownMutation = useMutation({
    mutationFn: clearAccountCooldown,
    onSuccess: () => {
      invalidateAccountData();
      toast.success(t("accounts.cooldownCleared"));
    },
    onError: showError,
  });

  const quotaMutation = useMutation({
    mutationFn: refreshAccountQuota,
    onSuccess: () => {
      invalidateAccountData();
      toast.success(t("accounts.billingRefreshed"));
    },
    onError: showError,
  });

  const webConfirmationMutation = useMutation({
    mutationFn: ({ account, action }: WebAccountConfirmationTarget) => {
      if (action === "acceptTerms") return acceptWebAccountTerms(account.id);
      if (action === "setBirthDate") return setWebAccountBirthDate(account.id);
      return enableWebAccountNSFW(account.id);
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
      return refreshAllAccountTokens(setRenewalProgress, controller.signal);
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
      if (targetProvider === "grok_web") return refreshAllWebAccountQuotas(setQuotaSyncProgress, controller.signal);
      if (targetProvider === "grok_console")
        return refreshAllConsoleAccountQuotas(setQuotaSyncProgress, controller.signal);
      return refreshAllAccountBilling(setQuotaSyncProgress, controller.signal);
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

  const allQuotaResetMutation = useMutation({
    mutationFn: resetAllAccountQuota,
    onSuccess: (result) => {
      setSyncAllOpen(false);
      toast.success(t("accountQuotaReset.completed", result));
    },
    onError: showError,
    onSettled: invalidateAccountData,
  });
  const conversionMutation = useMutation({
    mutationFn: (input: BuildConversionInput) => {
      const controller = new AbortController();
      conversionAbortRef.current = controller;
      setConversionProgress(null);
      return convertWebAccountsToBuild(input, setConversionProgress, controller.signal);
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
      return syncWebAccountsToConsole(input, setWebConsoleSyncProgress, controller.signal);
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
      return runWebAccountScripts(input, setWebAccountScriptsProgress, controller.signal);
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
      const toastID = toast.loading(t("common.importingProgress", { completed: 0, total: "…" }));
      importToastRef.current = toastID;
      const onProgress = (progress: AccountTaskProgressDTO) => {
        toast.loading(
          t(progress.phase === "syncing" ? "common.syncingProgress" : "common.importingProgress", progress),
          { id: toastID },
        );
      };
      if (provider === "grok_web") return importWebAccounts(files, onProgress, controller.signal);
      if (provider === "grok_console") return importConsoleAccounts(files, onProgress, controller.signal);
      return importAccounts(files, onProgress, controller.signal);
    },
    onSuccess: (result) => {
      if (importToastRef.current !== null) toast.dismiss(importToastRef.current);
      importToastRef.current = null;
      importAbortRef.current = null;
      setQuickImportOpen(false);
      setQuickImportTokens("");
      if (result.failed > 0) {
        toast.warning(t("accounts.importedWithFailures", result));
        return;
      }
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
    mutationFn: async (
      input:
        | { kind: "selected"; ids: string[] }
        | { kind: "batch"; limit: number; afterId: string; snapshotMaxId: string; batchNumber: number },
    ) => {
      if (input.kind === "selected") {
        return { kind: input.kind, blob: await exportSelectedAccounts(provider, input.ids) } as const;
      }
      return {
        kind: input.kind,
        batchNumber: input.batchNumber,
        batch: await exportAccountBatch(provider, input.limit, input.afterId, input.snapshotMaxId),
      } as const;
    },
    onSuccess: (result) => {
      if (result.kind === "selected") {
        downloadAccountExport(result.blob, provider, "selected");
        setExportOpen(false);
        toast.success(t("accounts.exported"));
        return;
      }
      downloadAccountExport(result.batch.blob, provider, `batch-${String(result.batchNumber).padStart(4, "0")}`);
      const completed = exportCompletedCount + result.batch.count;
      if (result.batch.hasMore) {
        setExportCursor(result.batch.nextId);
        setExportSnapshotMaxId(result.batch.snapshotMaxId);
        setExportBatchNumber(result.batchNumber + 1);
        setExportCompletedCount(completed);
        toast.success(t("accountExport.batchCompleted", { count: result.batch.count }));
        return;
      }
      setExportOpen(false);
      toast.success(t("accountExport.completed", { count: completed }));
    },
    onError: showError,
  });

  const batchUpdateMutation = useMutation({
    mutationFn: (enabled: boolean) => updateAccountsEnabled([...selected], enabled, provider),
    onSuccess: () => {
      clearSelection();
      invalidateAccountData();
      toast.success(t("accounts.batchUpdated"));
    },
    onError: showError,
  });

  const batchConcurrencyMutation = useMutation({
    mutationFn: (maxConcurrent: number) => updateAccountsMaxConcurrent([...selected], maxConcurrent, provider),
    onSuccess: () => {
      setBatchConcurrencyOpen(false);
      clearSelection();
      invalidateAccountData();
      toast.success(t("accounts.batchConcurrencyUpdated"));
    },
    onError: showError,
  });

  const batchBillingMutation = useMutation({
    mutationFn: () => refreshAccountsQuota([...selected], provider),
    onSuccess: (result) => {
      clearSelection();
      setBatchQuotaTaskOpen(false);
      invalidateAccountData();
      toast.success(t("accounts.batchBillingRefreshed", result));
    },
    onError: showError,
  });

  const appendDetectItem = useCallback((item: BuildDetectItemDTO) => {
    const previousOutcome = detectOutcomeByIDRef.current.get(item.id);
    detectOutcomeByIDRef.current.set(item.id, item.outcome);
    if (previousOutcome !== item.outcome) {
      setDetectCounts((previous) => ({
        ...previous,
        ...(previousOutcome ? { [previousOutcome]: Math.max(0, previous[previousOutcome] - 1) } : {}),
        [item.outcome]: previous[item.outcome] + 1,
      }));
    }
    setDetectItems((prev) => {
      const next = prev.filter((entry) => entry.id !== item.id);
      next.unshift(item);
      return next.slice(0, 200);
    });
  }, []);

  const detectMutation = useMutation({
    mutationFn: (mode: "selected" | "all") => {
      const controller = new AbortController();
      detectAbortRef.current = controller;
      setDetectProgress(null);
      detectOutcomeByIDRef.current.clear();
      setDetectCounts(emptyBuildDetectCounts());
      setDetectItems([]);
      const handlers = {
        onProgress: setDetectProgress,
        onItem: appendDetectItem,
      };
      if (mode === "all") {
        return detectBuildAccounts({ all: true }, handlers, controller.signal);
      }
      return detectBuildAccounts({ ids: [...selected] }, handlers, controller.signal);
    },
    onSuccess: (result, mode) => {
      if (mode === "selected") clearSelection();
      toast.success(t(mode === "all" ? "accounts.allDetected" : "accounts.batchDetected", result));
    },
    onError: (error) => {
      if (!isAbortError(error)) showError(error);
    },
    onSettled: () => {
      detectAbortRef.current = null;
      invalidateAccountData();
    },
  });

  const openDetectDialog = (mode: "selected" | "all") => {
    setDetectMode(mode);
    setDetectProgress(null);
    detectOutcomeByIDRef.current.clear();
    setDetectCounts(emptyBuildDetectCounts());
    setDetectItems([]);
    setDetectDialogOpen(true);
  };

  const closeDetectDialog = (open: boolean) => {
    if (!open) {
      if (detectMutation.isPending) detectAbortRef.current?.abort();
      setDetectDialogOpen(false);
      setDetectProgress(null);
      // 保留结果列表直到下次打开，便于查看完成摘要；关闭后清空避免残留。
      if (!detectMutation.isPending) setDetectItems([]);
      return;
    }
    setDetectDialogOpen(true);
  };

  const batchQuotaResetMutation = useMutation({
    mutationFn: () => resetAccountsQuota([...selected], provider),
    onSuccess: (result) => {
      clearSelection();
      setBatchQuotaTaskOpen(false);
      invalidateAccountData();
      toast.success(t("accountQuotaReset.completed", result));
    },
    onError: showError,
  });

  const batchTokenMutation = useMutation({
    mutationFn: () => refreshAccountsTokens([...selected], provider),
    onSuccess: (result) => {
      clearSelection();
      invalidateAccountData();
      toast.success(t("accounts.allTokensRefreshed", result));
    },
    onError: showError,
  });

  const batchDeleteMutation = useMutation({
    // Snapshot selection/targets at click time; dialog unmount/reset must not empty targets.
    mutationFn: (input: { ids: string[]; provider: AccountProvider; linkedDeleteTargets: AccountProvider[] }) =>
      deleteAccounts(input.ids, input.provider, input.linkedDeleteTargets),
    onSuccess: (result) => {
      clearSelection();
      setBatchDeleteOpen(false);
      resetLinkedDeleteState();
      invalidateAccountData();
      notifyDeleteResult(result);
    },
    onError: showError,
  });

  const bindEgressMutation = useMutation({
    mutationFn: () => {
      if (!egressNodeID) throw new Error(t("accounts.bindEgressEmpty"));
      return assignEgressAccounts(egressNodeID, provider, [...selected]);
    },
    onSuccess: () => {
      clearSelection();
      setEgressConfigurationOpen(false);
      invalidateAccountData();
      void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
      toast.success(t("accounts.egressBound"));
    },
    onError: showError,
  });
  const unbindEgressMutation = useMutation({
    mutationFn: () => unassignEgressAccounts(provider, [...selected]),
    onSuccess: () => {
      clearSelection();
      setEgressConfigurationOpen(false);
      invalidateAccountData();
      void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
      toast.success(t("accounts.egressUnbound"));
    },
    onError: showError,
  });

  const resetCleanupState = () => {
    setCleanupStatuses(new Set());
    setCleanupLinkedTargets([]);
    setCleanupPreview(null);
    setCleanupPreviewError(false);
  };

  // Toggles never drop the previous preview: freshness is derived from the key below.
  const toggleCleanupTarget = (target: AccountProvider, checked: boolean) => {
    setCleanupLinkedTargets((current) =>
      checked ? (current.includes(target) ? current : [...current, target]) : current.filter((item) => item !== target),
    );
    setCleanupPreviewError(false);
  };

  const selectAllCleanupTargets = () => {
    const options = linkedTargetOptions(provider);
    const allSelected = options.every((item) => cleanupLinkedTargets.includes(item));
    setCleanupLinkedTargets(allSelected ? [] : options);
    setCleanupPreviewError(false);
  };

  const cleanupMutation = useMutation({
    // Snapshot statuses/targets at click; dialog close/reset must not mutate an in-flight request.
    mutationFn: (input: { statuses: AccountCleanupStatus[]; targets: AccountProvider[] }) =>
      cleanupAccounts(provider, input.statuses, input.targets),
    onSuccess: (result) => {
      setCleanupOpen(false);
      resetCleanupState();
      invalidateAccountData();
      const linked = result.linkedDeleted ?? 0;
      const skipped = result.skipped ?? 0;
      if (linked > 0 || skipped > 0) {
        toast.success(t("accounts.cleanupCompletedDetailed", { deleted: result.deleted, linked, skipped }));
      } else {
        toast.success(t("accounts.cleanupCompleted", { deleted: result.deleted }));
      }
    },
    onError: showError,
  });

  // Debounced cleanup preview: counts refresh whenever statuses/targets change.
  // setState only inside timeout/promise callbacks (react-hooks/set-state-in-effect).
  const cleanupStatusesKey = [...cleanupStatuses].sort().join(",");
  const cleanupTargetsKey = [...cleanupLinkedTargets].sort().join(",");
  const cleanupPreviewKey = `${provider}|${cleanupStatusesKey}|${cleanupTargetsKey}`;
  // Fresh = the loaded preview matches the current selection; otherwise show spinners
  // in the fixed-size count slots and keep the confirm button disabled.
  const cleanupPreviewFresh = !cleanupPreviewError && cleanupPreview?.key === cleanupPreviewKey;
  const cleanupPreviewTotals = cleanupPreviewFresh ? (cleanupPreview?.data ?? null) : null;
  useEffect(() => {
    if (!cleanupOpen || cleanupStatusesKey === "") return;
    let cancelled = false;
    const previewKey = `${provider}|${cleanupStatusesKey}|${cleanupTargetsKey}`;
    const statuses = cleanupStatusesKey.split(",") as AccountCleanupStatus[];
    // Defense in depth: never send a target that is invalid for the current pool.
    const allowed = linkedTargetOptions(provider);
    const targets = (cleanupTargetsKey ? (cleanupTargetsKey.split(",") as AccountProvider[]) : []).filter((target) =>
      allowed.includes(target),
    );
    const timer = window.setTimeout(() => {
      void previewCleanup(provider, statuses, targets)
        .then((preview) => {
          if (cancelled) return;
          setCleanupPreviewError(false);
          setCleanupPreview({ key: previewKey, data: preview });
        })
        .catch(() => {
          if (cancelled) return;
          // No fake zeros: destructive scope must never be understated.
          setCleanupPreview(null);
          setCleanupPreviewError(true);
          toast.error(t("accounts.cleanupPreviewFailed"));
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cleanupOpen, cleanupStatusesKey, cleanupTargetsKey, provider, t]);

  useEffect(() => {
    if (!deviceOpen || !deviceSession || deviceStatus !== "pending") {
      return;
    }
    const controller = new AbortController();
    let timeout = 0;
    const poll = async () => {
      try {
        const result = await pollDeviceAuthorization(deviceSession.sessionId, controller.signal);
        if (result.status === "succeeded") {
          toast.success(t("accounts.created"));
          setDeviceOpen(false);
          setDeviceSession(null);
          invalidateAccountData();
          return;
        }
        if (result.status === "syncFailed") {
          toast.warning(t("accounts.createdWithSyncFailure"));
          setDeviceOpen(false);
          setDeviceSession(null);
          invalidateAccountData();
          return;
        }
        timeout = window.setTimeout(poll, deviceSession.intervalSeconds * 1000);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 429) {
          timeout = window.setTimeout(poll, (deviceSession.intervalSeconds + 5) * 1000);
          return;
        }
        setDeviceStatus("failed");
        toast.error(error instanceof Error ? error.message : t("errors.generic"));
      }
    };
    timeout = window.setTimeout(poll, deviceSession.intervalSeconds * 1000);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [deviceOpen, deviceSession, deviceStatus, invalidateAccountData, t]);

  function changeProvider(value: AccountProvider) {
    setProvider(value);
    setPage(1);
    setSelection({ provider: value, ids: new Set() });
    setTypeFilter("");
    setStatusFilter("");
    // A node or subscription narrowing belongs to the previous pool's scope;
    // keep the plain bound filter and drop the target.
    setEgressFilter((current) => (current.includes(":") ? "bound" : current));
    setEgressFilterSelectedLabel("");
    setEgressFilterOptionsOpen(false);
    setEgressFilterOptionsSearch("");
    setRenewalFilter("");
    setRiskFilter("");
    setAgreementFilter("");
    setAssociationFilter("");
    setQuickImportOpen(false);
    setQuickImportTokens("");
    // Cleanup dialog state is provider-scoped: linked targets from another pool
    // would be rejected by the API (self-target 400) once the dialog reopens.
    setCleanupOpen(false);
    setCleanupStatuses(new Set());
    setCleanupLinkedTargets([]);
    setCleanupPreview(null);
    setCleanupPreviewError(false);
  }

  function submitQuickImport(): void {
    const value = quickImportTokens.trim();
    if (!value) return;
    const filename =
      provider === "grok_build"
        ? "grok-build-refresh-tokens.txt"
        : provider === "grok_console"
          ? "grok-console-sso-tokens.txt"
          : "grok-web-sso-tokens.txt";
    importMutation.mutate([new File([value], filename, { type: "text/plain" })]);
  }

  async function loadQuickImportFile(file: File | undefined): Promise<void> {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      toast.error(t("apiErrors.accountImportFileTooLarge"));
      return;
    }
    try {
      setQuickImportTokens(await file.text());
    } catch {
      toast.error(t("errors.generic"));
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
      const input: BuildConversionInput =
        webConversionTargets === "all"
          ? { all: true, strategy: webConversionStrategy }
          : { ids: webConversionTargets, strategy: webConversionStrategy };
      conversionMutation.mutate(input);
      return;
    }
    const input: WebConsoleSyncInput =
      webConversionTargets === "all"
        ? { all: true, strategy: webConversionStrategy }
        : { ids: webConversionTargets, strategy: webConversionStrategy };
    webConsoleSyncMutation.mutate(input);
  }

  function runSelectedWebAccountScripts(actions: WebAccountScriptActions): void {
    if (webAccountScriptsTargets === "all") {
      webAccountScriptsMutation.mutate({ all: true, actions });
    } else if (webAccountScriptsTargets) {
      webAccountScriptsMutation.mutate({ ids: webAccountScriptsTargets, actions });
    }
  }

  async function startDeviceLogin(): Promise<void> {
    setDeviceOpen(true);
    setDeviceStatus("starting");
    setDeviceSession(null);
    try {
      const session = await startDeviceAuthorization();
      setDeviceSession(session);
      setDeviceStatus("pending");
    } catch (error) {
      setDeviceStatus("failed");
      showError(error);
    }
  }

  function beginEdit(account: AccountDTO): void {
    setEditing(account);
    form.reset({
      name: account.name,
      enabled: account.enabled,
      priority: account.priority,
      maxConcurrent: account.maxConcurrent,
      minimumRemaining: account.minimumRemaining,
      cloudflareCookies: "",
      clearCloudflareCookies: false,
      buildSuperEntitled: account.buildSuperEntitled,
      buildRouteMode: account.buildRouteMode,
    });
  }

  const webConversionPending = conversionMutation.isPending || webConsoleSyncMutation.isPending;

  function showError(error: unknown): void {
    toast.error(error instanceof Error ? error.message : t("errors.generic"));
  }

  const result = accountsQuery.data;
  const pageIDs = result?.items.map((account) => account.id) ?? [];
  const selectedOnPage = pageIDs.filter((id) => selected.has(id));
  const allPageSelected = pageIDs.length > 0 && selectedOnPage.length === pageIDs.length;

  function clearSelection(): void {
    setSelection((current) => ({ provider: current.provider, ids: new Set() }));
  }

  function resetExportProgress(): void {
    setExportCursor("0");
    setExportSnapshotMaxId("0");
    setExportBatchNumber(1);
    setExportCompletedCount(0);
  }

  function openProviderExport(): void {
    clearSelection();
    resetExportProgress();
    setExportOpen(true);
  }

  function openSelectedExport(): void {
    resetExportProgress();
    setExportOpen(true);
  }

  function togglePage(checked: boolean): void {
    setSelection((current) => {
      const next = new Set(current.provider === provider ? current.ids : []);
      for (const id of pageIDs) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return { provider, ids: next };
    });
  }

  function toggleAccount(id: string, checked: boolean): void {
    setSelection((current) => {
      const next = new Set(current.provider === provider ? current.ids : []);
      if (checked) next.add(id);
      else next.delete(id);
      return { provider, ids: next };
    });
  }

  function changeSort(field: string, initialOrder: SortOrder): void {
    setSort((current) => nextTableSort(current, field, initialOrder));
    setPage(1);
  }

  function handleSyncAllOpenChange(open: boolean): void {
    if (!open) quotaSyncAbortRef.current?.abort();
    setSyncAllOpen(open);
  }

  function confirmQuotaSyncAll(): void {
    if (provider === "grok_build" && allQuotaTask === "reset") allQuotaResetMutation.mutate();
    else quotaSyncMutation.mutate(provider);
  }

  function handleRenewAllOpenChange(open: boolean): void {
    if (!open) renewalAbortRef.current?.abort();
    setRenewAllOpen(open);
  }

  function confirmRenewAllTokens(): void {
    allTokenMutation.mutate();
  }

  function runDetect(): void {
    detectMutation.mutate(detectMode);
  }

  function handleQuickImportOpenChange(open: boolean): void {
    setQuickImportOpen(open);
    if (!open) setQuickImportTokens("");
  }

  function closeEditDialog(): void {
    setEditing(null);
  }

  function submitAccountEdit(event: FormEvent<HTMLFormElement>): void {
    void form.handleSubmit((values) => updateMutation.mutate(values))(event);
  }

  function handleDeleteOpenChange(open: boolean): void {
    if (open) return;
    setDeleting(null);
    resetLinkedDeleteState();
  }

  function confirmDeleteAccount(): void {
    if (!deleting) return;
    deleteMutation.mutate({ id: deleting.id, provider, linkedDeleteTargets: [...linkedDeleteTargets] });
  }

  function handleBatchDeleteOpenChange(open: boolean): void {
    setBatchDeleteOpen(open);
    if (!open) resetLinkedDeleteState();
  }

  function confirmBatchDelete(): void {
    batchDeleteMutation.mutate({ ids: [...selected], provider, linkedDeleteTargets: [...linkedDeleteTargets] });
  }

  function confirmBatchConcurrency(): void {
    batchConcurrencyMutation.mutate(Number(batchMaxConcurrent));
  }

  function confirmBatchQuotaTask(): void {
    if (batchQuotaTask === "reset") batchQuotaResetMutation.mutate();
    else batchBillingMutation.mutate();
  }

  function handleEgressConfigurationOpenChange(open: boolean): void {
    setEgressConfigurationOpen(open);
    if (!open) {
      setEgressConfigurationTask("bind");
      setEgressNodeID("");
    }
  }

  function confirmEgressConfiguration(): void {
    if (egressConfigurationTask === "bind") bindEgressMutation.mutate();
    else unbindEgressMutation.mutate();
  }

  function confirmExport(): void {
    if (selected.size > 0) {
      exportMutation.mutate({ kind: "selected", ids: [...selected] });
      return;
    }
    exportMutation.mutate({
      kind: "batch",
      limit: Number(exportLimit),
      afterId: exportCursor,
      snapshotMaxId: exportSnapshotMaxId,
      batchNumber: exportBatchNumber,
    });
  }

  function retryDeviceLogin(): void {
    void startDeviceLogin();
  }

  function handleCleanupOpenChange(open: boolean): void {
    setCleanupOpen(open);
    if (!open) resetCleanupState();
  }

  function toggleCleanupStatus(status: AccountCleanupStatus, checked: boolean): void {
    setCleanupStatuses((current) => {
      const next = new Set(current);
      if (checked) next.add(status);
      else next.delete(status);
      return next;
    });
    setCleanupPreviewError(false);
  }

  function confirmCleanup(): void {
    cleanupMutation.mutate({ statuses: [...cleanupStatuses], targets: [...cleanupLinkedTargets] });
  }
  const summary = summaryQuery.data;
  const providerAccountTotal =
    provider === "grok_build"
      ? (summary?.providers.grok_build.total ?? 0)
      : provider === "grok_web"
        ? (summary?.providers.grok_web.total ?? 0)
        : (summary?.providers.grok_console.total ?? 0);
  const hasProviderAccounts = providerAccountTotal > 0 || (result?.total ?? 0) > 0;
  const bindableEgressNodes = (egressNodesQuery.data?.items ?? []).filter(
    (node) => node.enabled && node.proxyConfigured && scopeSupportsAccountProvider(node.scope, provider),
  );
  const egressFilterSearchTerm = egressFilterOptionsSearch.trim().toLocaleLowerCase();
  const consoleWebNodePages = provider === "grok_console" ? (egressFilterConsoleWebNodesQuery.data?.pages ?? []) : [];
  const scopedEgressNodes = [...(egressFilterNodesQuery.data?.pages ?? []), ...consoleWebNodePages]
    .flatMap((nodePage) => nodePage.items)
    .filter((node) => scopeSupportsAccountProvider(node.scope, provider))
    .filter((node) => !egressFilterSearchTerm || node.name.toLocaleLowerCase().includes(egressFilterSearchTerm));
  const consoleWebNodesEnabled = provider === "grok_console";
  const consoleWebSourcePages = consoleWebNodesEnabled ? (egressFilterConsoleWebSourcesQuery.data?.pages ?? []) : [];
  const scopedEgressSources = [...(egressFilterSourcesQuery.data?.pages ?? []), ...consoleWebSourcePages]
    .flatMap((sourcePage) => sourcePage.items)
    .filter((source) => scopeSupportsAccountProvider(source.scope, provider))
    .filter((source) => !egressFilterSearchTerm || source.name.toLocaleLowerCase().includes(egressFilterSearchTerm));
  const egressFilterNodesFailed =
    egressFilterNodesQuery.isError || (consoleWebNodesEnabled && egressFilterConsoleWebNodesQuery.isError);
  const egressFilterNodesFetching =
    egressFilterNodesQuery.isFetching || (consoleWebNodesEnabled && egressFilterConsoleWebNodesQuery.isFetching);
  const egressFilterNodesHaveMore =
    egressFilterNodesFailed ||
    egressFilterNodesQuery.hasNextPage ||
    (consoleWebNodesEnabled && egressFilterConsoleWebNodesQuery.hasNextPage);
  const loadMoreEgressFilterNodes = () => {
    if (egressFilterNodesQuery.isError) void egressFilterNodesQuery.refetch();
    if (consoleWebNodesEnabled && egressFilterConsoleWebNodesQuery.isError)
      void egressFilterConsoleWebNodesQuery.refetch();
    if (egressFilterNodesFailed) return;
    if (egressFilterNodesQuery.hasNextPage) void egressFilterNodesQuery.fetchNextPage();
    if (consoleWebNodesEnabled && egressFilterConsoleWebNodesQuery.hasNextPage)
      void egressFilterConsoleWebNodesQuery.fetchNextPage();
  };
  const egressFilterSourcesFailed =
    egressFilterSourcesQuery.isError || (consoleWebNodesEnabled && egressFilterConsoleWebSourcesQuery.isError);
  const egressFilterSourcesFetching =
    egressFilterSourcesQuery.isFetching || (consoleWebNodesEnabled && egressFilterConsoleWebSourcesQuery.isFetching);
  const egressFilterSourcesHaveMore =
    egressFilterSourcesFailed ||
    egressFilterSourcesQuery.hasNextPage ||
    (consoleWebNodesEnabled && egressFilterConsoleWebSourcesQuery.hasNextPage);
  const loadMoreEgressFilterSources = () => {
    if (egressFilterSourcesQuery.isError) void egressFilterSourcesQuery.refetch();
    if (consoleWebNodesEnabled && egressFilterConsoleWebSourcesQuery.isError)
      void egressFilterConsoleWebSourcesQuery.refetch();
    if (egressFilterSourcesFailed) return;
    if (egressFilterSourcesQuery.hasNextPage) void egressFilterSourcesQuery.fetchNextPage();
    if (consoleWebNodesEnabled && egressFilterConsoleWebSourcesQuery.hasNextPage)
      void egressFilterConsoleWebSourcesQuery.fetchNextPage();
  };
  const egressBoundGroups = [
    {
      id: "nodes",
      label: t("accounts.egressNodeGroup"),
      emptyLabel: egressFilterNodesFailed
        ? t("accounts.egressFilterOptionsLoadFailed")
        : egressFilterNodesFetching
          ? t("common.loading")
          : t("accounts.egressNodeGroupEmpty"),
      options: scopedEgressNodes.map((node) => ({ value: `node:${node.id}`, label: node.name })),
      loading: egressFilterNodesFetching,
      hasMore: egressFilterNodesHaveMore,
      actionLabel: egressFilterNodesFailed
        ? t("common.retry")
        : egressFilterNodesFetching
          ? t("common.loading")
          : t("accounts.egressFilterOptionsLoadMore"),
      onAction: loadMoreEgressFilterNodes,
    },
    {
      id: "sources",
      label: t("accounts.egressSourceGroup"),
      emptyLabel: egressFilterSourcesFailed
        ? t("accounts.egressFilterOptionsLoadFailed")
        : egressFilterSourcesFetching
          ? t("common.loading")
          : t("accounts.egressSourceGroupEmpty"),
      options: scopedEgressSources.map((source) => ({ value: `source:${source.id}`, label: source.name })),
      loading: egressFilterSourcesFetching,
      hasMore: egressFilterSourcesHaveMore,
      actionLabel: egressFilterSourcesFailed
        ? t("common.retry")
        : egressFilterSourcesFetching
          ? t("common.loading")
          : t("accounts.egressFilterSourcesLoadMore"),
      onAction: loadMoreEgressFilterSources,
    },
  ];
  const bulkTaskPending =
    quotaSyncMutation.isPending ||
    allQuotaResetMutation.isPending ||
    allTokenMutation.isPending ||
    conversionMutation.isPending ||
    webConsoleSyncMutation.isPending ||
    importMutation.isPending ||
    batchUpdateMutation.isPending ||
    batchConcurrencyMutation.isPending ||
    batchBillingMutation.isPending ||
    detectMutation.isPending ||
    batchQuotaResetMutation.isPending ||
    batchTokenMutation.isPending ||
    batchDeleteMutation.isPending ||
    bindEgressMutation.isPending ||
    unbindEgressMutation.isPending ||
    cleanupMutation.isPending ||
    webConfirmationMutation.isPending ||
    webAccountScriptsMutation.isPending;

  const detectInvalidItems = detectItems.filter((item) => item.outcome === "invalid");
  const detectVisibleItems = detectMode === "selected" ? detectItems : detectInvalidItems;

  return (
    <div className="space-y-5">
      <header className="flex min-h-8 items-center">
        <h1 className="text-xl font-medium">{t("accounts.title")}</h1>
        <p className="sr-only">{t("console.accountsDescription")}</p>
      </header>
      <AccountsSummaryPanel
        summary={summary}
        loading={summaryQuery.isPending}
        unavailable={summaryQuery.isError}
        language={i18n.language}
      />
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={provider} onValueChange={(value) => changeProvider(value as AccountProvider)}>
            <TabsList>
              <TabsTrigger value="grok_build" className="gap-1.5">
                <SquareTerminal className="size-3.5 text-quota-product-1" />
                <span>Grok Build</span>
              </TabsTrigger>
              <TabsTrigger value="grok_web" className="gap-1.5">
                <Compass className="size-3.5 text-quota-product-2" />
                <span>Grok Web</span>
              </TabsTrigger>
              <TabsTrigger value="grok_console" className="gap-1.5">
                <Webhook className="size-3.5 text-quota-product-4" />
                <span>Grok Console</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus />
                {t("accounts.connectAccount")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {provider === "grok_build" ? (
                <DropdownMenuItem onClick={() => void startDeviceLogin()}>
                  <ExternalLink />
                  {t("accounts.deviceLogin")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem disabled={bulkTaskPending} onClick={() => setQuickImportOpen(true)}>
                <ClipboardPaste />
                {t(provider === "grok_build" ? "accounts.quickImportRT" : "accounts.quickImportSSO")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={bulkTaskPending} onClick={() => fileInputRef.current?.click()}>
                <FileUp />
                {provider === "grok_build"
                  ? t("accounts.importAuth")
                  : provider === "grok_console"
                    ? t("console.importFile")
                    : t("accounts.importWebFile")}
              </DropdownMenuItem>
              {hasProviderAccounts ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={openProviderExport}>
                    <Download />
                    {t("accounts.exportAuth")}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="application/json,text/plain,.json,.txt"
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length > 0) {
              importMutation.mutate(files);
            }
            event.target.value = "";
          }}
        />

        <DataTableShell
          toolbar={
            <>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 pl-9 text-xs"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(1);
                    }}
                    placeholder={t("accounts.search")}
                    aria-label={t("accounts.search")}
                  />
                </div>
                <DataTableFilters
                  filters={[
                    ...(provider === "grok_console"
                      ? []
                      : [
                          {
                            id: "type",
                            label: t("accountType.label"),
                            value: typeFilter,
                            onChange: (value: string) => {
                              setTypeFilter(value);
                              setPage(1);
                            },
                            options:
                              provider === "grok_web"
                                ? [
                                    { value: "auto", label: t("accountType.auto") },
                                    { value: "basic", label: t("accountType.free") },
                                    { value: "super", label: t("accountType.super") },
                                    { value: "heavy", label: t("accountType.heavy") },
                                  ]
                                : [
                                    { value: "free", label: t("accountType.free") },
                                    { value: "paid", label: t("accountType.paid") },
                                    { value: "unknown", label: t("accountType.pending") },
                                  ],
                          },
                        ]),
                    {
                      id: "status",
                      label: t("accounts.status"),
                      value: statusFilter,
                      onChange: (value) => {
                        setStatusFilter(value);
                        setPage(1);
                      },
                      options: [
                        { value: "active", label: t("accounts.statusActive") },
                        { value: "disabled", label: t("accounts.statusDisabled") },
                        { value: "reauthRequired", label: t("accounts.statusReauthRequired") },
                        { value: "cooldown", label: t("accounts.statusCooldown") },
                        { value: "waitingReset", label: t("accounts.waitingReset") },
                        { value: "probing", label: t("accounts.probing") },
                      ],
                    },
                    {
                      id: "egress",
                      label: t("accounts.egressFilter"),
                      value: egressFilter,
                      selectedLabel: egressFilterSelectedLabel || undefined,
                      onChange: (value) => {
                        setEgressFilter(value);
                        setEgressFilterSelectedLabel(
                          value.includes(":")
                            ? (egressBoundGroups
                                .flatMap((group) => group.options)
                                .find((option) => option.value === value)?.label ?? "")
                            : "",
                        );
                        setPage(1);
                      },
                      options: [
                        {
                          value: "bound",
                          label: t("accounts.egressBound"),
                          groups: egressBoundGroups,
                          onGroupsOpenChange: setEgressFilterOptionsOpen,
                          groupSearch: {
                            value: egressFilterOptionsSearch,
                            placeholder: t("accounts.egressFilterOptionsSearch"),
                            onChange: (value) => {
                              setEgressFilterOptionsSearch(value);
                            },
                          },
                        },
                        { value: "unbound", label: t("accounts.egressUnbound") },
                      ],
                    },
                    ...(provider === "grok_build"
                      ? [
                          {
                            id: "renewal",
                            label: t("accountCredential.label"),
                            value: renewalFilter,
                            onChange: (value: string) => {
                              setRenewalFilter(value);
                              setPage(1);
                            },
                            options: [
                              { value: "refreshable", label: t("accountCredential.autoRefresh") },
                              { value: "unrefreshable", label: t("accountCredential.noAutoRefresh") },
                            ],
                          },
                        ]
                      : []),
                    ...(provider === "grok_build"
                      ? [
                          {
                            id: "risk",
                            label: t("accounts.riskFilter"),
                            value: riskFilter,
                            onChange: (value: string) => {
                              setRiskFilter(value);
                              setPage(1);
                            },
                            options: [
                              { value: "flagged", label: t("accounts.botRisk") },
                              { value: "normal", label: t("accounts.riskNormal") },
                            ],
                          },
                        ]
                      : []),
                    ...(provider === "grok_web"
                      ? [
                          {
                            id: "agreement",
                            label: t("accounts.agreementFilter"),
                            value: agreementFilter,
                            onChange: (value: string) => {
                              setAgreementFilter(value);
                              setPage(1);
                            },
                            options: [
                              { value: "nsfwEnabled", label: t("accounts.agreementNsfwEnabled") },
                              { value: "nsfwDisabled", label: t("accounts.agreementNsfwDisabled") },
                              { value: "termsAccepted", label: t("accounts.agreementTermsAccepted") },
                              { value: "termsNotAccepted", label: t("accounts.agreementTermsNotAccepted") },
                              { value: "allAccepted", label: t("accounts.agreementAllAccepted") },
                              { value: "allNotAccepted", label: t("accounts.agreementAllNotAccepted") },
                            ],
                          },
                        ]
                      : []),
                    {
                      id: "association",
                      label: t("accounts.associationFilter"),
                      value: associationFilter,
                      onChange: (value: string) => {
                        setAssociationFilter(value);
                        setPage(1);
                      },
                      options:
                        provider === "grok_web"
                          ? [
                              { value: "buildLinked", label: t("accounts.associationBuildLinked") },
                              { value: "buildUnlinked", label: t("accounts.associationBuildUnlinked") },
                              { value: "consoleLinked", label: t("accounts.associationConsoleLinked") },
                              { value: "consoleUnlinked", label: t("accounts.associationConsoleUnlinked") },
                              { value: "allLinked", label: t("accounts.associationAllLinked") },
                              { value: "allUnlinked", label: t("accounts.associationAllUnlinked") },
                            ]
                          : [
                              { value: "webLinked", label: t("accounts.associationWebLinked") },
                              { value: "webUnlinked", label: t("accounts.associationWebUnlinked") },
                            ],
                    },
                  ]}
                />
              </div>
              {selected.size > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-muted-foreground">
                    {t("common.selectedCount", { count: selected.size })}
                  </span>
                  <Button variant="secondary" size="sm" disabled={bulkTaskPending} onClick={openSelectedExport}>
                    <Download />
                    {t("accounts.exportAuth")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={bulkTaskPending}
                    onClick={() => batchUpdateMutation.mutate(true)}
                  >
                    {t("common.enable")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={bulkTaskPending}
                    onClick={() => batchUpdateMutation.mutate(false)}
                  >
                    {t("common.disable")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={bulkTaskPending}
                    onClick={() => {
                      setBatchMaxConcurrent("1");
                      setBatchConcurrencyOpen(true);
                    }}
                  >
                    {t("accounts.batchSetConcurrency")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={bulkTaskPending}
                    onClick={() => {
                      setEgressNodeID("");
                      setEgressConfigurationTask("bind");
                      setEgressConfigurationOpen(true);
                    }}
                  >
                    {t("accounts.egressConfiguration")}
                  </Button>
                  {provider === "grok_web" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={bulkTaskPending}
                      onClick={() => openWebConversion([...selected])}
                    >
                      {t("accountConversion.action")}
                    </Button>
                  ) : null}
                  {provider === "grok_web" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={bulkTaskPending}
                      onClick={() => setWebAccountScriptsTargets([...selected])}
                    >
                      {t("webAccountScripts.action")}
                    </Button>
                  ) : null}
                  {provider === "grok_build" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={bulkTaskPending}
                      onClick={() => openDetectDialog("selected")}
                    >
                      {t("accountCredential.detectAction")}
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={bulkTaskPending}
                    onClick={() => {
                      if (provider === "grok_build") {
                        setBatchQuotaTask("sync");
                        setBatchQuotaTaskOpen(true);
                        return;
                      }
                      batchBillingMutation.mutate();
                    }}
                  >
                    {t("accountCredential.quotaSyncAction")}
                  </Button>
                  {provider === "grok_build" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={bulkTaskPending}
                      onClick={() => batchTokenMutation.mutate()}
                    >
                      {t("accountCredential.refreshAction")}
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
                    disabled={bulkTaskPending}
                    onClick={() => {
                      resetLinkedDeleteState();
                      setBatchDeleteOpen(true);
                    }}
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {provider === "grok_web" && hasProviderAccounts ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={bulkTaskPending}
                      onClick={() => openWebConversion("all")}
                    >
                      {t("accountConversion.action")}
                    </Button>
                  ) : null}
                  {provider === "grok_web" && hasProviderAccounts ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={bulkTaskPending}
                      onClick={() => setWebAccountScriptsTargets("all")}
                    >
                      {t("webAccountScripts.action")}
                    </Button>
                  ) : null}
                  {hasProviderAccounts && provider === "grok_build" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={bulkTaskPending}
                      onClick={() => openDetectDialog("all")}
                    >
                      {t("accountCredential.detectAction")}
                    </Button>
                  ) : null}
                  {hasProviderAccounts ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={bulkTaskPending}
                      onClick={() => {
                        setAllQuotaTask("sync");
                        setSyncAllOpen(true);
                      }}
                    >
                      {t("accountCredential.quotaSyncAction")}
                    </Button>
                  ) : null}
                  {hasProviderAccounts && provider === "grok_build" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={bulkTaskPending}
                      onClick={() => setRenewAllOpen(true)}
                    >
                      {t("accountCredential.refreshAction")}
                    </Button>
                  ) : null}
                  {hasProviderAccounts ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
                      disabled={bulkTaskPending}
                      onClick={() => {
                        resetCleanupState();
                        setCleanupOpen(true);
                      }}
                    >
                      <Trash2 />
                      {t("accounts.cleanupAction")}
                    </Button>
                  ) : null}
                </div>
              )}
            </>
          }
          footer={
            result && result.total > 0 ? (
              <Pagination
                page={result.page}
                pageSize={result.pageSize}
                total={result.total}
                onPageChange={setPage}
                onPageSizeChange={(value) => {
                  setPageSize(value);
                  setPage(1);
                }}
              />
            ) : undefined
          }
        >
          {accountsQuery.isError ? (
            <ErrorState message={accountsQuery.error.message} onRetry={() => void accountsQuery.refetch()} />
          ) : null}
          {result && result.items.length === 0 ? <EmptyState /> : null}
          {accountsQuery.isPending || (result && result.items.length > 0) ? (
            <Table
              viewportRows={20}
              rowHeight={56}
              className="table-fixed border-collapse min-w-[780px] xl:min-w-[960px] 2xl:min-w-[1080px]"
            >
              <colgroup>
                <col style={{ width: "3%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: provider === "grok_build" ? "27%" : "43%" }} />
                {provider === "grok_build" ? <col style={{ width: "16%" }} /> : null}
                <col style={{ width: "18%" }} />
                <col style={{ width: "4%" }} />
              </colgroup>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-2">
                    <Checkbox
                      checked={allPageSelected ? true : selectedOnPage.length > 0 ? "indeterminate" : false}
                      onCheckedChange={(checked) => togglePage(checked === true)}
                      aria-label={t("common.selectPage")}
                    />
                  </TableHead>
                  <SortableTableHead field="name" sortBy={sort.field} sortOrder={sort.order} onSort={changeSort}>
                    {t("accounts.account")}
                  </SortableTableHead>
                  <SortableTableHead
                    field="type"
                    sortBy={sort.field}
                    sortOrder={sort.order}
                    align="center"
                    onSort={changeSort}
                    className="whitespace-nowrap"
                  >
                    {t("accountType.label")}
                  </SortableTableHead>
                  <SortableTableHead
                    field="status"
                    sortBy={sort.field}
                    sortOrder={sort.order}
                    align="center"
                    onSort={changeSort}
                    className="whitespace-nowrap"
                  >
                    {t("accounts.status")}
                  </SortableTableHead>
                  <TableHead className={cn("whitespace-nowrap", provider !== "grok_build" && "px-6")}>
                    {t("accounts.quota")}
                  </TableHead>
                  {provider === "grok_build" ? (
                    <TableHead className="whitespace-nowrap pl-4">{t("accountCredential.label")}</TableHead>
                  ) : null}
                  <SortableTableHead
                    field="createdAt"
                    sortBy={sort.field}
                    sortOrder={sort.order}
                    initialOrder="desc"
                    onSort={changeSort}
                    className="whitespace-nowrap"
                  >
                    {t("accounts.createdAt")}
                  </SortableTableHead>
                  <TableActionHead />
                </TableRow>
              </TableHeader>
              {accountsQuery.isPending ? (
                <TableBody>
                  <TableLoadingRow colSpan={provider === "grok_build" ? 8 : 7} />
                </TableBody>
              ) : (
                <VirtualTableBody
                  items={result?.items ?? []}
                  colSpan={provider === "grok_build" ? 8 : 7}
                  rowHeight={56}
                  renderRow={(account) => (
                    <TableRow
                      className="group h-14 [&>td]:py-1.5"
                      key={account.id}
                      data-state={selected.has(account.id) ? "selected" : undefined}
                    >
                      <TableCell className="px-2">
                        <Checkbox
                          checked={selected.has(account.id)}
                          onCheckedChange={(checked) => toggleAccount(account.id, checked === true)}
                          aria-label={t("common.selectItem", { name: account.name })}
                        />
                      </TableCell>
                      <TableCell className="min-w-0">
                        <AccountNameCell account={account} />
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        {provider === "grok_web" ? (
                          <WebAccountType tier={account.webTier} />
                        ) : provider === "grok_console" ? (
                          <AccountTypeText label={t("accountType.console")} variant="free" />
                        ) : (
                          <AccountType quota={account.quota} />
                        )}
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        <AccountStatus account={account} />
                      </TableCell>
                      <TableCell className={provider === "grok_build" ? undefined : "px-6"}>
                        {provider === "grok_web" ? (
                          <WebQuota
                            windows={account.quotaWindows ?? []}
                            locale={i18n.language}
                            tier={account.webTier}
                          />
                        ) : provider === "grok_console" ? (
                          <ConsoleQuota windows={account.quotaWindows ?? []} locale={i18n.language} />
                        ) : (
                          <AccountQuota quota={account.quota} billing={account.billing} locale={i18n.language} />
                        )}
                      </TableCell>
                      {provider === "grok_build" ? (
                        <TableCell className="whitespace-nowrap pl-4 text-xs">
                          {account.refreshable ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  tabIndex={0}
                                  className="cursor-help font-medium text-emerald-700 dark:text-emerald-300"
                                >
                                  {t("accountCredential.autoRefresh")}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {account.expiresAt
                                  ? t("accountCredential.expiresAt", {
                                      time: formatDateTime(account.expiresAt, i18n.language),
                                    })
                                  : t("accountCredential.expiryUnknown")}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="font-medium text-amber-700 dark:text-amber-300">
                              {t("accountCredential.noAutoRefresh")}
                            </span>
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(account.createdAt, i18n.language)}
                      </TableCell>
                      <TableActionCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" aria-label={t("common.actions")}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => beginEdit(account)}>
                              <Pencil />
                              {t("common.edit")}
                            </DropdownMenuItem>
                            {provider === "grok_web" ? (
                              <DropdownMenuItem onClick={() => openWebConversion([account.id])}>
                                <ArrowRight />
                                {t("accountConversion.action")}
                              </DropdownMenuItem>
                            ) : null}
                            {provider === "grok_web" ? (
                              <WebAccountSettingsMenu
                                account={account}
                                disabled={bulkTaskPending}
                                onConfirm={setWebConfirmationTarget}
                              />
                            ) : null}
                            {provider === "grok_build" ? (
                              <DropdownMenuItem onClick={() => tokenMutation.mutate(account.id)}>
                                <RotateCw />
                                {t("accounts.refreshToken")}
                              </DropdownMenuItem>
                            ) : null}
                            {account.cooldownUntil && new Date(account.cooldownUntil) > new Date() ? (
                              <DropdownMenuItem
                                onClick={() => clearCooldownMutation.mutate(account.id)}
                                disabled={clearCooldownMutation.isPending}
                              >
                                <TimerOff />
                                {t("accounts.clearCooldown")}
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                              onClick={() =>
                                provider === "grok_build"
                                  ? billingMutation.mutate(account.id)
                                  : quotaMutation.mutate(account.id)
                              }
                            >
                              <RefreshCw />
                              {provider === "grok_build"
                                ? t("accounts.refreshBilling")
                                : t("accounts.refreshModeQuota")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => {
                                resetLinkedDeleteState();
                                setDeleting(account);
                              }}
                            >
                              <Trash2 />
                              {t("common.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableActionCell>
                    </TableRow>
                  )}
                />
              )}
            </Table>
          ) : null}
        </DataTableShell>
      </div>

      <WebAccountSettingsDialogs
        confirmationTarget={webConfirmationTarget}
        confirmationPending={webConfirmationMutation.isPending}
        onConfirmationClose={() => setWebConfirmationTarget(null)}
        onConfirm={(target) => webConfirmationMutation.mutate(target)}
      />

      {webAccountScriptsTargets !== null ? (
        <WebAccountScriptsDialog
          targets={webAccountScriptsTargets}
          pending={webAccountScriptsMutation.isPending}
          progress={webAccountScriptsProgress}
          onClose={() => {
            webAccountScriptsAbortRef.current?.abort();
            setWebAccountScriptsTargets(null);
          }}
          onRun={runSelectedWebAccountScripts}
        />
      ) : null}

      <QuotaSyncAllDialog
        open={syncAllOpen}
        provider={provider}
        task={allQuotaTask}
        onTaskChange={setAllQuotaTask}
        syncPending={quotaSyncMutation.isPending}
        resetPending={allQuotaResetMutation.isPending}
        progress={quotaSyncProgress}
        onOpenChange={handleSyncAllOpenChange}
        onConfirm={confirmQuotaSyncAll}
      />

      <BuildDetectDialog
        open={detectDialogOpen}
        mode={detectMode}
        selectedCount={selected.size}
        pending={detectMutation.isPending}
        progress={detectProgress}
        counts={detectCounts}
        visibleItems={detectVisibleItems}
        onOpenChange={closeDetectDialog}
        onRun={runDetect}
      />

      <WebConversionDialog
        open={webConversionTargets !== null}
        targets={webConversionTargets}
        target={webConversionTarget}
        onTargetChange={setWebConversionTarget}
        strategy={webConversionStrategy}
        onStrategyChange={setWebConversionStrategy}
        pending={webConversionPending}
        conversionProgress={conversionProgress}
        syncProgress={webConsoleSyncProgress}
        onClose={closeWebConversion}
        onConfirm={runWebConversion}
      />

      <RenewAllTokensDialog
        open={renewAllOpen}
        pending={allTokenMutation.isPending}
        progress={renewalProgress}
        onOpenChange={handleRenewAllOpenChange}
        onConfirm={confirmRenewAllTokens}
      />

      <ExportAccountsDialog
        open={exportOpen}
        provider={provider}
        selectedCount={selected.size}
        limit={exportLimit}
        onLimitChange={setExportLimit}
        completedCount={exportCompletedCount}
        batchNumber={exportBatchNumber}
        snapshotMaxId={exportSnapshotMaxId}
        pending={exportMutation.isPending}
        onOpenChange={setExportOpen}
        onConfirm={confirmExport}
      />

      <DeviceLoginDialog
        open={deviceOpen}
        status={deviceStatus}
        session={deviceSession}
        language={i18n.language}
        onOpenChange={setDeviceOpen}
        onRetry={retryDeviceLogin}
      />

      <QuickImportDialog
        open={quickImportOpen}
        provider={provider}
        tokens={quickImportTokens}
        pending={importMutation.isPending}
        onOpenChange={handleQuickImportOpenChange}
        onTokensChange={setQuickImportTokens}
        onFileSelected={loadQuickImportFile}
        onSubmit={submitQuickImport}
      />

      <AccountEditDialog
        editing={editing}
        form={form}
        pending={updateMutation.isPending}
        accountEnabled={accountEnabled}
        clearCloudflareCookies={clearCloudflareCookies}
        buildSuperEntitled={buildSuperEntitled}
        buildRouteMode={buildRouteMode}
        onClose={closeEditDialog}
        onSubmit={submitAccountEdit}
      />

      <AccountDeleteDialog
        account={deleting}
        provider={provider}
        targets={linkedDeleteTargets}
        counts={linkedDeleteCounts}
        previewError={linkedDeletePreviewError}
        pending={deleteMutation.isPending}
        blocking={linkedPreviewBlocking}
        onOpenChange={handleDeleteOpenChange}
        onToggleTarget={toggleLinkedDeleteTarget}
        onSelectAll={selectAllLinkedTargets}
        onConfirm={confirmDeleteAccount}
      />

      <BatchConcurrencyDialog
        open={batchConcurrencyOpen}
        selectedCount={selected.size}
        value={batchMaxConcurrent}
        onValueChange={setBatchMaxConcurrent}
        pending={batchConcurrencyMutation.isPending}
        onOpenChange={setBatchConcurrencyOpen}
        onConfirm={confirmBatchConcurrency}
      />

      <AccountBatchDeleteDialog
        open={batchDeleteOpen}
        selectedCount={selected.size}
        provider={provider}
        targets={linkedDeleteTargets}
        counts={linkedDeleteCounts}
        previewError={linkedDeletePreviewError}
        pending={batchDeleteMutation.isPending}
        blocking={linkedPreviewBlocking}
        onOpenChange={handleBatchDeleteOpenChange}
        onToggleTarget={toggleLinkedDeleteTarget}
        onSelectAll={selectAllLinkedTargets}
        onConfirm={confirmBatchDelete}
      />

      <BatchQuotaTaskDialog
        open={batchQuotaTaskOpen}
        selectedCount={selected.size}
        task={batchQuotaTask}
        onTaskChange={setBatchQuotaTask}
        syncPending={batchBillingMutation.isPending}
        resetPending={batchQuotaResetMutation.isPending}
        onOpenChange={setBatchQuotaTaskOpen}
        onConfirm={confirmBatchQuotaTask}
      />

      <EgressConfigurationDialog
        open={egressConfigurationOpen}
        selectedCount={selected.size}
        task={egressConfigurationTask}
        onTaskChange={setEgressConfigurationTask}
        nodeId={egressNodeID}
        onNodeIdChange={setEgressNodeID}
        nodes={bindableEgressNodes}
        nodesPending={egressNodesQuery.isPending}
        nodesError={egressNodesQuery.isError ? egressNodesQuery.error.message : null}
        pending={bindEgressMutation.isPending || unbindEgressMutation.isPending}
        onOpenChange={handleEgressConfigurationOpenChange}
        onConfirm={confirmEgressConfiguration}
      />

      <CleanupDialog
        open={cleanupOpen}
        provider={provider}
        statuses={cleanupStatuses}
        targets={cleanupLinkedTargets}
        previewTotals={cleanupPreviewTotals}
        previewError={cleanupPreviewError}
        previewFresh={cleanupPreviewFresh}
        pending={cleanupMutation.isPending}
        onOpenChange={handleCleanupOpenChange}
        onToggleStatus={toggleCleanupStatus}
        onToggleTarget={toggleCleanupTarget}
        onSelectAllTargets={selectAllCleanupTargets}
        onConfirm={confirmCleanup}
      />
    </div>
  );
}

function scopeSupportsAccountProvider(scope: EgressScope, provider: AccountProvider): boolean {
  if (provider === "grok_build") return scope === "grok_build";
  if (provider === "grok_web") return scope === "grok_web";
  return scope === "grok_web" || scope === "grok_console";
}

function accountProviderPrimaryEgressScope(provider: AccountProvider): EgressScope {
  return provider;
}
