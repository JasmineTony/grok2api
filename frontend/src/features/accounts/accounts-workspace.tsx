import type { UseQueryResult } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { AccountProviderToolbar } from "@/features/accounts/account-provider-toolbar";
import type {
  AccountCleanupStatus,
  AccountDTO,
  AccountProvider,
} from "@/features/accounts/accounts-api";
import { AccountsDataTable } from "@/features/accounts/accounts-data-table";
import type { WebAccountConfirmationTarget } from "@/features/accounts/web-account-settings";
import type { PaginatedDTO } from "@/shared/api/client";
import type { SortOrder, TableSort } from "@/shared/lib/table-sort";

type ValueMutation<T> = { mutate: (value: T) => void };
type VoidMutation = { mutate: () => void };

export type AccountsWorkspaceProps = {
  t: TFunction;
  i18n: { language: string };
  provider: AccountProvider;
  changeProvider: (provider: AccountProvider) => void;
  bulkTaskPending: boolean;
  hasProviderAccounts: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  startDeviceLogin: () => Promise<void>;
  setQuickImportOpen: Dispatch<SetStateAction<boolean>>;
  importMutation: ValueMutation<File[]>;
  setExportOpen: Dispatch<SetStateAction<boolean>>;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  setPage: Dispatch<SetStateAction<number>>;
  typeFilter: string;
  setTypeFilter: Dispatch<SetStateAction<string>>;
  statusFilter: string;
  setStatusFilter: Dispatch<SetStateAction<string>>;
  renewalFilter: string;
  setRenewalFilter: Dispatch<SetStateAction<string>>;
  riskFilter: string;
  setRiskFilter: Dispatch<SetStateAction<string>>;
  selected: Set<string>;
  selectedOnPage: string[];
  allPageSelected: boolean;
  togglePage: (checked: boolean) => void;
  toggleAccount: (id: string, checked: boolean) => void;
  batchUpdateMutation: ValueMutation<boolean>;
  openWebConversion: (targets: string[] | "all") => void;
  setWebAccountScriptsTargets: Dispatch<SetStateAction<string[] | "all" | null>>;
  batchBillingMutation: VoidMutation;
  batchTokenMutation: VoidMutation;
  setBatchDeleteOpen: Dispatch<SetStateAction<boolean>>;
  setSyncAllOpen: Dispatch<SetStateAction<boolean>>;
  setRenewAllOpen: Dispatch<SetStateAction<boolean>>;
  setCleanupStatuses: Dispatch<SetStateAction<Set<AccountCleanupStatus>>>;
  setCleanupOpen: Dispatch<SetStateAction<boolean>>;
  result: PaginatedDTO<AccountDTO> | undefined;
  setPageSize: Dispatch<SetStateAction<number>>;
  accountsQuery: Pick<
    UseQueryResult<PaginatedDTO<AccountDTO>, Error>,
    "isError" | "error" | "isPending" | "refetch"
  >;
  sort: TableSort;
  changeSort: (field: string, initialOrder: SortOrder) => void;
  beginEdit: (account: AccountDTO) => void;
  setStateHistoryAccount: Dispatch<SetStateAction<AccountDTO | null>>;
  setEgressPolicyAccount: Dispatch<SetStateAction<AccountDTO | null>>;
  setWebConfirmationTarget: Dispatch<SetStateAction<WebAccountConfirmationTarget | null>>;
  tokenMutation: ValueMutation<string>;
  billingMutation: ValueMutation<string>;
  quotaMutation: ValueMutation<string>;
  setDeleting: Dispatch<SetStateAction<AccountDTO | null>>;
};

export function AccountsWorkspace(props: AccountsWorkspaceProps) {
  const {
    provider,
    changeProvider,
    bulkTaskPending,
    hasProviderAccounts,
    fileInputRef,
    startDeviceLogin,
    setQuickImportOpen,
    importMutation,
    setExportOpen,
  } = props;

  return (
    <div className="space-y-5">
      <AccountProviderToolbar
        provider={provider}
        pending={bulkTaskPending}
        hasAccounts={hasProviderAccounts}
        fileInputRef={fileInputRef}
        onProviderChange={changeProvider}
        onDeviceLogin={() => void startDeviceLogin()}
        onQuickImport={() => setQuickImportOpen(true)}
        onImportFiles={(files) => importMutation.mutate(files)}
        onExport={() => setExportOpen(true)}
      />
      <AccountsDataTable {...props} />
    </div>
  );
}
