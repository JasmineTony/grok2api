import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import {
  type AdminDTO,
  ApiError,
  decodeAdminDTO,
  decodeLoggedOut,
  decodeLoginResponseDTO,
} from "@/shared/api/client";
import { useApiClient } from "@/shared/api/use-api-client";
import {
  AuthActionsContext,
  AuthContext,
  AuthStateContext,
  type AuthStatus,
} from "@/shared/auth/auth-state";

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useApiClient();
  const [admin, setAdmin] = useState<AdminDTO | null>(null);
  const [status, setStatus] = useState<AuthStatus>("restoring");

  const restoreSession = useCallback(async (): Promise<void> => {
    setStatus("restoring");
    const refreshResult = await client.refreshAccessToken();
    if (refreshResult === "invalid") {
      setAdmin(null);
      setStatus("anonymous");
      return;
    }
    if (refreshResult === "unavailable") {
      setStatus("unavailable");
      return;
    }
    try {
      const value = await client.request("/api/admin/v1/me", { retryAuth: false }, decodeAdminDTO);
      setAdmin(value);
      setStatus("authenticated");
    } catch (error) {
      client.setAccessToken(null);
      setAdmin(null);
      setStatus(error instanceof ApiError && error.status === 401 ? "anonymous" : "unavailable");
    }
  }, [client]);

  useEffect(() => {
    const unsubscribe = client.subscribeSessionInvalidated(() => {
      setAdmin(null);
      setStatus("anonymous");
    });
    const restoreTimer = window.setTimeout(() => void restoreSession(), 0);
    return () => {
      window.clearTimeout(restoreTimer);
      unsubscribe();
    };
  }, [client, restoreSession]);

  const login = useCallback(
    async (username: string, password: string): Promise<void> => {
      const response = await client.request(
        "/api/admin/v1/auth/login",
        {
          method: "POST",
          body: { username, password },
          authenticated: false,
          retryAuth: false,
        },
        decodeLoginResponseDTO,
      );
      client.setAccessToken(response.tokens.accessToken);
      setAdmin(response.admin);
      setStatus("authenticated");
    },
    [client],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await client.request(
        "/api/admin/v1/auth/logout",
        {
          method: "POST",
          body: {},
          authenticated: false,
          retryAuth: false,
        },
        decodeLoggedOut,
      );
    } finally {
      client.setAccessToken(null);
      setAdmin(null);
      setStatus("anonymous");
    }
  }, [client]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> => {
      await client.request(
        "/api/admin/v1/me/password",
        {
          method: "PUT",
          body: { currentPassword, newPassword },
        },
        () => undefined,
      );
    },
    [client],
  );

  const state = useMemo(() => ({ admin, status }), [admin, status]);
  const actions = useMemo(
    () => ({ retryRestore: restoreSession, login, logout, changePassword }),
    [restoreSession, login, logout, changePassword],
  );
  const value = useMemo(() => ({ ...state, ...actions }), [state, actions]);

  return (
    <AuthStateContext value={state}>
      <AuthActionsContext value={actions}>
        <AuthContext value={value}>{children}</AuthContext>
      </AuthActionsContext>
    </AuthStateContext>
  );
}
