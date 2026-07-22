import type { AccountDTO } from "@/features/accounts/accounts-api";

export function formatAccountState(
  state: AccountDTO["state"],
  translate: (key: string) => string,
): string {
  const keys: Record<AccountDTO["state"], string> = {
    ready: "accounts.statusActive",
    degraded: "accounts.statusDegraded",
    cooldown: "accounts.statusCooldown",
    quota_exhausted: "accounts.waitingReset",
    reauth_required: "accounts.statusReauthRequired",
    disabled: "accounts.statusDisabled",
  };
  return translate(keys[state]);
}
