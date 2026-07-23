import { use } from "react";

import {
  AuthActionsContext,
  type AuthActionsValue,
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
