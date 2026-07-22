import { createContext } from "react";

import type { ApiClient } from "@/shared/api/client";

export const ApiClientContext = createContext<ApiClient | null>(null);
