import { create } from "zustand";

import {
  ApiError,
  apiRequest,
  decodeAdminDTO,
  decodeLoggedOut,
  decodeLoginResponseDTO,
  refreshAccessToken,
  setAccessToken,
  subscribeSessionInvalidated,
} from "@/shared/api/client";
import type { AuthStateValue } from "@/shared/auth/auth-state";

export type AuthStore = AuthStateValue & {
  /** 注册会话失效订阅并触发首次 restore（由 AuthProvider 的生命周期调用）。 */
  start: () => void;
  /** 注销订阅并清理首次 restore 定时器（由 AuthProvider 的生命周期调用）。 */
  stop: () => void;
};

// 订阅句柄与首次 restore 定时器属于 React 之外的副作用，放在模块作用域由 start/stop 成对管理。
let unsubscribeSessionInvalidated: (() => void) | null = null;
let restoreTimer: number | null = null;

export const useAuthStore = create<AuthStore>((set, get) => ({
  admin: null,
  status: "restoring",

  // 以下 4 个 action 与迁移前的 AuthProvider 实现逐行等价，不改变任何语义。
  retryRestore: async (): Promise<void> => {
    set({ status: "restoring" });
    const refreshResult = await refreshAccessToken();
    if (refreshResult === "invalid") {
      set({ admin: null, status: "anonymous" });
      return;
    }
    if (refreshResult === "unavailable") {
      set({ status: "unavailable" });
      return;
    }

    try {
      const value = await apiRequest("/api/admin/v1/me", { retryAuth: false }, decodeAdminDTO);
      set({ admin: value, status: "authenticated" });
    } catch (error) {
      setAccessToken(null);
      set({
        admin: null,
        status: error instanceof ApiError && error.status === 401 ? "anonymous" : "unavailable",
      });
    }
  },

  login: async (username: string, password: string): Promise<void> => {
    const response = await apiRequest(
      "/api/admin/v1/auth/login",
      {
        method: "POST",
        body: { username, password },
        authenticated: false,
        retryAuth: false,
      },
      decodeLoginResponseDTO,
    );
    setAccessToken(response.tokens.accessToken);
    set({ admin: response.admin, status: "authenticated" });
  },

  logout: async (): Promise<void> => {
    try {
      await apiRequest(
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
      setAccessToken(null);
      set({ admin: null, status: "anonymous" });
    }
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    await apiRequest(
      "/api/admin/v1/me/password",
      {
        method: "PUT",
        body: { currentPassword, newPassword },
      },
      () => undefined,
    );
  },

  start: (): void => {
    unsubscribeSessionInvalidated = subscribeSessionInvalidated(() => {
      set({ admin: null, status: "anonymous" });
    });

    restoreTimer = window.setTimeout(() => {
      void get().retryRestore();
    }, 0);
  },

  stop: (): void => {
    if (restoreTimer !== null) {
      window.clearTimeout(restoreTimer);
      restoreTimer = null;
    }
    unsubscribeSessionInvalidated?.();
    unsubscribeSessionInvalidated = null;
  },
}));
