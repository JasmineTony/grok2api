import { useEffect, type ReactNode } from "react";

import { useAuthStore } from "@/shared/auth/auth-store";

// 认证状态已迁移到 zustand store（auth-store.ts），AuthProvider 不再提供任何值，
// 只负责把 store 的订阅（subscribeSessionInvalidated）与首次 restore 定时器挂到 React 生命周期上。
// 保留该组件是为了不改变 providers.tsx 与既有消费者。
export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    useAuthStore.getState().start();
    return () => {
      useAuthStore.getState().stop();
    };
  }, []);

  return <>{children}</>;
}
