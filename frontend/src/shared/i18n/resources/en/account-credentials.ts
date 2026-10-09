/**
 * en 文案 · 账号凭据、导出、额度重置与额度产品。
 * 命名空间：accountCredential、accountExport、accountQuotaReset、accountQuotaTask、quotaProducts。
 */
export default {
  accountCredential: {
    label: "Credential renewal",
    quotaSyncAction: "Sync quota",
    refreshAction: "Refresh credentials",
    autoRefresh: "Auto-renewal supported",
    noAutoRefresh: "No auto-renewal",
    expiresAt: "Credential expires: {{time}}",
    expiryUnknown: "Credential expiry is unknown",
    detectAction: "Detect accounts",
  },
  accountExport: {
    countDescription: "Exports accounts in stable order, up to 10,000 per batch.",
    batchProgress: "Exported {{count}} accounts; the next download is batch {{batch}}.",
    nextBatch: "Export next batch",
    batchCompleted: "Exported {{count}} accounts in this batch",
    completed: "Export complete: {{count}} accounts",
  },
  accountQuotaReset: {
    action: "Reset quota",
    description:
      "This clears only local waiting-reset and model quota blocks. It does not change upstream Billing or audit history. Accounts that remain exhausted will be marked again by real traffic.",
    completed: "Reset local quota state for {{reset}} accounts",
  },
  accountQuotaTask: {
    title: "Process quota for {{count}} selected accounts",
    description: "Choose the quota task to run for the selected Grok Build accounts.",
    allTitle: "Process quota for all accounts",
    allDescription: "Choose the quota task to run for all enabled Grok Build accounts.",
    syncDescription: "Request upstream Billing and update local quota snapshots, account tiers, and recovery state.",
    resetAllDescription:
      "Clear local waiting-reset and exhausted-quota blocks for all enabled Grok Build accounts without changing upstream Billing or audit history.",
    execute: "Run task",
  },
  quotaProducts: {
    thirdParty: "Third Party",
    api: "API",
    build: "Grok Build",
    plugins: "Grok Plugins",
    chat: "Chat",
    imagine: "Imagine",
    voice: "Voice",
    unknown: "Product {{code}}",
  },
} as const;
