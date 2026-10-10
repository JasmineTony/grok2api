import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { AccountDTO, AccountSummaryDTO } from "@/features/accounts/accounts-api";
import type { AccountProvider } from "@/features/accounts/accounts-dto";
import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import { useAccountCleanupFlow } from "@/features/accounts/use-account-cleanup-flow";
import { useAccountDeleteFlow } from "@/features/accounts/use-account-delete-flow";
import { useAccountsDeviceFlow } from "@/features/accounts/use-account-device-flow";
import { useAccountEditFlow } from "@/features/accounts/use-account-edit-flow";
import { useAccountsExportFlow } from "@/features/accounts/use-account-export-flow";
import { useAccountRowMutations } from "@/features/accounts/use-account-row-mutations";
import { useAccountsBatchFlow } from "@/features/accounts/use-accounts-batch-flow";
import { useAccountsEgressFlow } from "@/features/accounts/use-accounts-egress-flow";
import { useAccountsEgressFilterGroups } from "@/features/accounts/use-accounts-egress-filter-options";
import { useAccountsFilters } from "@/features/accounts/use-accounts-filters";
import {
  useAccountInvalidation,
  useAccountsListQuery,
  useAccountSummaryQuery,
} from "@/features/accounts/use-accounts-queries";
import { useAccountsSelection } from "@/features/accounts/use-accounts-selection";
import {
  useAccountsDetectFlow,
  useAccountsQuotaSyncFlow,
  useAccountsRenewalFlow,
} from "@/features/accounts/use-accounts-task-flows";
import {
  useAccountsConversionFlow,
  useAccountsImportFlow,
  useAccountsScriptsFlow,
} from "@/features/accounts/use-accounts-transfer-flows";
import type { AccountsBatchFlow } from "@/features/accounts/use-accounts-batch-flow";
import type { AccountsCleanupFlow } from "@/features/accounts/use-account-cleanup-flow";
import type { AccountsDeleteFlow } from "@/features/accounts/use-account-delete-flow";
import type { AccountsDeviceFlow } from "@/features/accounts/use-account-device-flow";
import type { AccountsEditFlow } from "@/features/accounts/use-account-edit-flow";
import type { AccountsExportFlow } from "@/features/accounts/use-account-export-flow";
import type { AccountRowMutations } from "@/features/accounts/use-account-row-mutations";
import type { AccountsEgressFlow } from "@/features/accounts/use-accounts-egress-flow";
import type { AccountsFiltersModel } from "@/features/accounts/use-accounts-filters";
import type { AccountsListQuery } from "@/features/accounts/use-accounts-queries";
import type { AccountsSelection } from "@/features/accounts/use-accounts-selection";
import type {
  AccountsDetectFlow,
  AccountsQuotaSyncFlow,
  AccountsRenewalFlow,
} from "@/features/accounts/use-accounts-task-flows";
import type {
  AccountsConversionFlow,
  AccountsImportFlow,
  AccountsScriptsFlow,
} from "@/features/accounts/use-accounts-transfer-flows";
import type { DataTableFilterOptionGroup } from "@/shared/components/data-table-filters";
import type { PaginatedDTO } from "@/shared/api/client";

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export type AccountsPageModel = {
  t: TranslateFn;
  language: string;
  filters: AccountsFiltersModel;
  selection: AccountsSelection;
  list: AccountsListQuery;
  summary: UseQueryResult<AccountSummaryDTO, Error>;
  result: PaginatedDTO<AccountDTO> | undefined;
  pageIds: string[];
  selectedOnPageIds: string[];
  allPageSelected: boolean;
  hasProviderAccounts: boolean;
  bulkTaskPending: boolean;
  changeProvider: (value: AccountProvider) => void;
  tasks: AccountsTaskModel;
  records: AccountsRecordModel;
};

export type AccountsTaskModel = {
  detect: AccountsDetectFlow;
  quotaSync: AccountsQuotaSyncFlow;
  renewal: AccountsRenewalFlow;
  conversion: AccountsConversionFlow;
  scripts: AccountsScriptsFlow;
  importFlow: AccountsImportFlow;
  exportFlow: AccountsExportFlow;
  cleanup: AccountsCleanupFlow;
  egress: AccountsEgressFlow;
  device: AccountsDeviceFlow;
  egressGroups: DataTableFilterOptionGroup[];
};

export type AccountsRecordModel = {
  rows: AccountRowMutations;
  batch: AccountsBatchFlow;
  edit: AccountsEditFlow;
  remove: AccountsDeleteFlow;
};

type AccountsCore = Omit<
  AccountsPageModel,
  "tasks" | "records" | "bulkTaskPending" | "fileInputRef" | "changeProvider"
> & {
  ctx: AccountsFlowContext;
};

function useAccountsListScope() {
  const filters = useAccountsFilters();
  const selection = useAccountsSelection(filters.provider);
  const list = useAccountsListQuery(filters);
  const summary = useAccountSummaryQuery();
  return { filters, selection, list, summary };
}

function useAccountsNotifications(t: TranslateFn) {
  const queryClient = useQueryClient();
  const invalidate = useAccountInvalidation();
  const invalidateModels = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["models"] });
  }, [queryClient]);
  const invalidateEgressNodes = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
  }, [queryClient]);
  const showError = useCallback(
    (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("errors.generic"));
    },
    [t],
  );
  return { invalidate, invalidateModels, invalidateEgressNodes, showError };
}

function useAccountsFlowContext(input: {
  t: TranslateFn;
  language: string;
  provider: AccountProvider;
  selection: AccountsSelection;
  notifications: ReturnType<typeof useAccountsNotifications>;
}): AccountsFlowContext {
  const { t, language, provider, selection, notifications } = input;
  return useMemo<AccountsFlowContext>(
    () => ({
      t,
      provider,
      language,
      selectedIds: selection.selectedIds,
      selectedCount: selection.selectedIds.length,
      clearSelection: selection.clearSelection,
      invalidate: notifications.invalidate,
      invalidateModels: notifications.invalidateModels,
      invalidateEgressNodes: notifications.invalidateEgressNodes,
      showError: notifications.showError,
    }),
    [t, language, provider, selection.selectedIds, selection.clearSelection, notifications],
  );
}

function useAccountsCoreModel(): AccountsCore {
  const { t, i18n } = useTranslation();
  const scope = useAccountsListScope();
  const notifications = useAccountsNotifications(t);
  const ctx = useAccountsFlowContext({
    t,
    language: i18n.language,
    provider: scope.filters.provider,
    selection: scope.selection,
    notifications,
  });
  const pageIds = scope.list.pageIds;
  const selectedOnPageIds = pageIds.filter((id) => scope.selection.selected.has(id));
  const providerTotal = accountProviderTotal(scope.summary.data, scope.filters.provider);
  return {
    t,
    language: i18n.language,
    filters: scope.filters,
    selection: scope.selection,
    list: scope.list,
    summary: scope.summary,
    result: scope.list.result,
    pageIds,
    selectedOnPageIds,
    allPageSelected: pageIds.length > 0 && selectedOnPageIds.length === pageIds.length,
    hasProviderAccounts: providerTotal > 0 || (scope.list.result?.total ?? 0) > 0,
    ctx,
  };
}

function accountProviderTotal(summary: AccountSummaryDTO | undefined, provider: AccountProvider): number {
  if (!summary) return 0;
  return summary.providers[provider]?.total ?? 0;
}

function useAccountsTaskModel(ctx: AccountsFlowContext, filters: AccountsFiltersModel): AccountsTaskModel {
  const egressGroups = useAccountsEgressFilterGroups({
    open: filters.egressFilterOptionsOpen,
    provider: ctx.provider,
    search: filters.debouncedEgressFilterOptionsSearch,
  });
  return {
    detect: useAccountsDetectFlow(ctx),
    quotaSync: useAccountsQuotaSyncFlow(ctx),
    renewal: useAccountsRenewalFlow(ctx),
    conversion: useAccountsConversionFlow(ctx),
    scripts: useAccountsScriptsFlow(ctx),
    importFlow: useAccountsImportFlow(ctx),
    exportFlow: useAccountsExportFlow(ctx),
    cleanup: useAccountCleanupFlow(ctx),
    egress: useAccountsEgressFlow(ctx),
    device: useAccountsDeviceFlow(ctx),
    egressGroups,
  };
}

function useAccountsRecordModel(ctx: AccountsFlowContext): AccountsRecordModel {
  return {
    rows: useAccountRowMutations(ctx),
    batch: useAccountsBatchFlow(ctx),
    edit: useAccountEditFlow(ctx),
    remove: useAccountDeleteFlow(ctx),
  };
}

/** 账号页组合入口：核心列表状态 + 任务流 + 记录级流程 + provider 切换收尾。 */
export function useAccountsPageModel(): AccountsPageModel {
  const core = useAccountsCoreModel();
  const { ctx, ...page } = core;
  const tasks = useAccountsTaskModel(ctx, page.filters);
  const records = useAccountsRecordModel(ctx);
  const changeProvider = (value: AccountProvider): void => {
    core.filters.changeProvider(value);
    core.selection.reselect(value);
    tasks.importFlow.reset();
    tasks.cleanup.reset();
  };
  const bulkTaskPending =
    tasks.detect.busy ||
    tasks.quotaSync.busy ||
    tasks.renewal.busy ||
    tasks.conversion.busy ||
    tasks.scripts.busy ||
    tasks.importFlow.busy ||
    records.batch.pending ||
    records.remove.busy ||
    tasks.egress.busy ||
    tasks.cleanup.busy ||
    records.rows.confirmation.busy;
  return {
    ...page,
    tasks,
    records,
    changeProvider,
    bulkTaskPending,
  };
}
