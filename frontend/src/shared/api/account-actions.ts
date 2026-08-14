import type { ApiClient } from "@/shared/api/client";
import { decodeCountResult } from "@/shared/api/decoder";

export type AccountActionProvider = "grok_build" | "grok_web" | "grok_console";

export function updateAccountsEnabledAction(
  client: ApiClient,
  ids: string[],
  enabled: boolean,
  provider: AccountActionProvider,
): Promise<{ updated: number }> {
  return client.request(
    "/api/admin/v1/accounts/batch",
    { method: "PATCH", body: { ids, enabled, provider } },
    decodeCountResult<{ updated: number }>("updated"),
  );
}
