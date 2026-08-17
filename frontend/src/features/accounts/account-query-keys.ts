import type { AccountProvider } from "@/features/accounts/accounts-api";

export const accountQueryKeys = {
  lists: () => ["accounts", "list"] as const,
  list: (
    provider: AccountProvider,
    page: number,
    pageSize: number,
    search: string,
    type: string,
    status: string,
    egress: string,
    agreement: string,
    association: string,
    renewal: string,
    risk: string,
    sortBy: string,
    sortOrder: string,
  ) =>
    [
      ...accountQueryKeys.lists(),
      provider,
      page,
      pageSize,
      search,
      type,
      status,
      egress,
      agreement,
      association,
      renewal,
      risk,
      sortBy,
      sortOrder,
    ] as const,
  summary: () => ["accounts", "summary"] as const,
  stateEventsRoot: () => ["accounts", "state-events"] as const,
  stateEvents: (accountID: string) => [...accountQueryKeys.stateEventsRoot(), accountID] as const,
  deletionPreviews: () => ["accounts", "deletion-preview"] as const,
  deletionPreview: (provider: AccountProvider, accountID: string, linkedTargets: string) =>
    [...accountQueryKeys.deletionPreviews(), provider, accountID, linkedTargets] as const,
  cleanupPreviews: () => ["accounts", "cleanup-preview"] as const,
  cleanupPreview: (provider: AccountProvider, statuses: string, linkedTargets: string) =>
    [...accountQueryKeys.cleanupPreviews(), provider, statuses, linkedTargets] as const,
  egressPolicies: () => ["accounts", "egress-policy"] as const,
  egressPolicy: (accountID: string) => [...accountQueryKeys.egressPolicies(), accountID] as const,
  auditFilters: () => ["accounts", "audit-filter"] as const,
};

export function accountMutationInvalidationKeys() {
  return [
    accountQueryKeys.lists(),
    accountQueryKeys.summary(),
    accountQueryKeys.stateEventsRoot(),
    accountQueryKeys.deletionPreviews(),
    accountQueryKeys.cleanupPreviews(),
    accountQueryKeys.egressPolicies(),
    accountQueryKeys.auditFilters(),
  ] as const;
}
