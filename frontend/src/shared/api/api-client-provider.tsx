import { type ReactNode, useState } from "react";

import { ApiClientContext } from "@/shared/api/api-client-state";
import { ApiClient } from "@/shared/api/client";

export function ApiClientProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new ApiClient());
  return <ApiClientContext value={client}>{children}</ApiClientContext>;
}
