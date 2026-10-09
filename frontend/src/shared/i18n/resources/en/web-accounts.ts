/**
 * en 文案 · Grok Web / Console 账号与同步。
 * 命名空间：webAccountSettings、webAccountScripts、webConsoleSync、console。
 */
export default {
  webAccountSettings: {
    menu: "Account settings",
    acceptTerms: "Accept terms",
    acceptTermsTitle: "Accept the terms?",
    acceptTermsDescription: "Accept the current xAI terms with this account.",
    termsAccepted: "Terms accepted",
    setBirthDate: "Set birth date",
    setBirthDateTitle: "Set a random birth date?",
    setBirthDateDescription:
      "A birth date corresponding to an age between 20 and 40 will be generated and submitted upstream.",
    birthDateSaved: "Random birth date saved",
    enableNSFW: "Enable NSFW",
    enableNSFWTitle: "Enable NSFW?",
    enableNSFWDescription:
      "A random birth date corresponding to an age between 20 and 40 will be set before NSFW is enabled.",
    nsfwEnabled: "Random birth date and NSFW saved",
  },
  webAccountScripts: {
    action: "Account tools",
    allTitle: "Account tools",
    selectedTitle: "Account tools · {{count}} accounts",
    allDescription: "All Grok Web accounts will be checked, and only unrecorded steps will run.",
    selectedDescription:
      "Only unrecorded steps run for the selected accounts. A failed account does not stop the rest of the batch.",
    operations: "Steps",
    acceptTermsDescription: "Accept the current xAI terms of service.",
    setBirthDateDescription: "Generate a random birth date for an age between 20 and 40; required for NSFW.",
    enableNSFWDescription: "Enable the adult-content preference after setting the birth date.",
    run: "Run tasks",
    completed: "Account tools completed: {{succeeded}} succeeded",
    completedWithFailures: "Account tools completed: {{succeeded}} succeeded, {{failed}} failed",
  },
  webConsoleSync: {
    action: "Convert to Console",
    allAction: "Convert to Console",
    selectedTitle: "Convert selected Web accounts to Console?",
    selectedDescription: "Choose the conversion scope for the selected Web accounts.",
    allTitle: "Convert all Web accounts to Console?",
    allDescription: "Choose the conversion scope. All Web accounts are processed in batches.",
    strategyTitle: "Conversion scope",
    missingStrategy: "Missing only",
    missingStrategyDescription:
      "Sync SSO credentials only for accounts without a Grok Console link; existing Console links remain unchanged.",
    allStrategy: "Reconvert all",
    allStrategyDescription:
      "Resync SSO credentials for every target, creating or updating the corresponding Grok Console account.",
    syncMissing: "Convert missing accounts",
    syncAll: "Reconvert all",
    completed:
      "Conversion complete: {{created}} created, {{updated}} updated, {{skipped}} skipped, {{synced}} initialized, {{syncFailed}} failed",
  },
  console: {
    name: "Grok Console",
    type: "Console",
    accountsDescription:
      "Manage separate Grok Build OAuth, Grok Web SSO, and Grok Console SSO pools, including health, concurrency, and quotas.",
    egressDescription:
      "Manage proxy and health independently for Grok Build, Grok Web, Grok Console, Web assets, and Console assets. Proxy URLs and Cloudflare cookies are write-only.",
    egressDialogDescription: "Configure the node scope, proxy address, and browser identity.",
    syncAllDescription: "Sync quota state for every enabled Grok Console account.",
    importFile: "Import account files",
    quickImportTitle: "Quick import Grok Console accounts",
    quickImportDescription:
      "Paste multiple Console SSO tokens or upload a TXT file with one token per line. Duplicate entries are ignored.",
    accountBreakdown: "Build {{build}} · Web {{web}} · Console {{console}}",
    availableBreakdown: "Build {{build}} · Web {{web}} · Console {{console}} available",
    baseURL: "Upstream URL",
    chatTimeout: "Chat timeout",
    recoveryProbeAt: "Next active recovery probe {{time}}",
  },
} as const;
