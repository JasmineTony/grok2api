import type { AdminDTO } from "@/shared/api/client";

export type AuthStatus = "restoring" | "authenticated" | "anonymous" | "unavailable";

// 认证全局状态的对外形状：由 auth-store（zustand）持有，useAuth 只读消费。
// 已移除原 React Context 版本，避免 store 与 Context 两套事实来源。
export type AuthStateValue = {
  admin: AdminDTO | null;
  status: AuthStatus;
  retryRestore: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};
