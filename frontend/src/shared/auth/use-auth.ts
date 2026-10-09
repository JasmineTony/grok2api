import { useAuthStore } from "@/shared/auth/auth-store";
import type { AuthStateValue } from "@/shared/auth/auth-state";

// 认证状态由 zustand store 持有（auth-store.ts）。zustand 不依赖 Provider，
// 因此原实现里“在 AuthProvider 之外调用 useAuth 会抛错”的行为已消失：
// 现在任何位置调用都会读到 store 的当前值（未 start 时为 status: "restoring"）。
// 逐字段订阅避免选择器每次返回新对象导致的重渲染，返回值形状与迁移前完全一致。
export function useAuth(): AuthStateValue {
  const admin = useAuthStore((state) => state.admin);
  const status = useAuthStore((state) => state.status);
  const retryRestore = useAuthStore((state) => state.retryRestore);
  const login = useAuthStore((state) => state.login);
  const logout = useAuthStore((state) => state.logout);
  const changePassword = useAuthStore((state) => state.changePassword);

  return { admin, status, retryRestore, login, logout, changePassword };
}
