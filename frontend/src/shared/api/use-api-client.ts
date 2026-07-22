import { use } from "react";

import { ApiClientContext } from "@/shared/api/api-client-state";
import type { ApiClient } from "@/shared/api/client";

export function useApiClient(): ApiClient {
  const client = use(ApiClientContext);
  if (!client) throw new Error("useApiClient must be used inside ApiClientProvider");
  return client;
}
