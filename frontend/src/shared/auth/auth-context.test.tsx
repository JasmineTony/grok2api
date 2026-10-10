import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/shared/auth/auth-context";
import { useAuthStore } from "@/shared/auth/auth-store";

// AuthProvider 只负责把 store 的 start/stop 挂到 React 生命周期上：
// 断言挂载时注册订阅与首次 restore、卸载时清理，并验证 StrictMode 双调用后不残留订阅。

const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ start: mocks.start, stop: mocks.stop });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuthProvider 生命周期", () => {
  it("挂载时调用 start()，卸载时调用 stop()，并原样渲染子节点", () => {
    const { unmount } = render(
      <AuthProvider>
        <span data-testid="child">ready</span>
      </AuthProvider>,
    );

    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(screen.getByTestId("child")).toHaveTextContent("ready");

    unmount();

    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it("StrictMode 下 start/stop 成对出现，卸载后调用次数平衡", () => {
    const { unmount } = render(
      <StrictMode>
        <AuthProvider>
          <span>ready</span>
        </AuthProvider>
      </StrictMode>,
    );

    unmount();

    // StrictMode 会额外执行一次挂载-卸载演练，因此 start/stop 次数必须相等且都为 2。
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.stop).toHaveBeenCalledTimes(2);
  });
});
