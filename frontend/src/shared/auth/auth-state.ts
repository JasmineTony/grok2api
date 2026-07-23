import { createContext } from "react";

import type { AdminDTO } from "@/shared/api/client";

export type AuthStatus = "restoring" | "authenticated" | "anonymous" | "unavailable";

export type AuthStateValue = {
  admin: AdminDTO | null;
  status: AuthStatus;
};

export type AuthActionsValue = {
  retryRestore: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};

export const AuthStateContext = createContext<AuthStateValue | null>(null);
export const AuthActionsContext = createContext<AuthActionsValue | null>(null);
