import { use } from "react";

import {
  AuthActionsContext,
  type AuthActionsValue,
  AuthContext,
  type AuthContextValue,
  AuthStateContext,
  type AuthStateValue,
} from "@/shared/auth/auth-state";

function requireContext<T>(value: T | null, name: string): T {
  if (!value) throw new Error(`${name} must be used inside AuthProvider`);
  return value;
}

export function useAuthState(): AuthStateValue {
  return requireContext(use(AuthStateContext), "useAuthState");
}

export function useAuthActions(): AuthActionsValue {
  return requireContext(use(AuthActionsContext), "useAuthActions");
}

/** Backward-compatible combined hook for callers that need state and commands together. */
export function useAuth(): AuthContextValue {
  return requireContext(use(AuthContext), "useAuth");
}
