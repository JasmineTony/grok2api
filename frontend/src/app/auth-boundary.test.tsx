import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnonymousBoundary, AuthBoundary } from "@/app/auth-boundary";
import { useAuthStore, type AuthStore } from "@/shared/auth/auth-store";
import { i18n } from "@/shared/i18n";

// 入口守卫的真实契约（auth-boundary.tsx）：
//   restoring -> 全屏 Spinner；anonymous -> 重定向 /login 并带 state.from；
//   unavailable -> 会话不可用屏 + 重试按钮触发 retryRestore；authenticated -> 渲染 Outlet。
// AnonymousBoundary 在已登录时反向重定向 /dashboard，restoring/unavailable 与 AuthBoundary 一致。
// 这里只桩掉 store 的 action（网络边界等价物），守卫、路由与渲染全部走真实实现。
type BoundaryShape = Pick<AuthStore, "admin" | "status"> & { retryRestore?: AuthStore["retryRestore"] };
function setAuthState({ admin, status, retryRestore }: BoundaryShape): void {
  useAuthStore.setState({
    admin,
    status,
    retryRestore: retryRestore ?? useAuthStore.getState().retryRestore,
  });
}

/** 暴露 react-router 传给 /login 的 location.state，用于断言重定向携带的来源路径。 */
function LoginLanding() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "none";
  return <div data-testid="login-landing">{from}</div>;
}

function renderGuarded(path: string): void {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AnonymousBoundary />}>
            <Route path="/login" element={<LoginLanding />} />
          </Route>
          <Route element={<AuthBoundary />}>
            <Route path="/dashboard" element={<div data-testid="protected-outlet">dashboard</div>} />
            <Route path="/accounts" element={<div data-testid="protected-outlet">accounts</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ admin: null, status: "restoring" });
});

describe("AuthBoundary 会话状态守卫", () => {
  it("restoring 时渲染全屏加载态，不渲染受保护内容", () => {
    setAuthState({ admin: null, status: "restoring" });
    renderGuarded("/dashboard");

    expect(screen.getByRole("status", { name: i18n.t("common.loading") })).toBeInTheDocument();
    expect(screen.queryByTestId("protected-outlet")).not.toBeInTheDocument();
    expect(screen.queryByTestId("login-landing")).not.toBeInTheDocument();
  });

  it("anonymous 时重定向到登录页，并把当前路径放进 state.from", async () => {
    setAuthState({ admin: null, status: "anonymous" });
    renderGuarded("/accounts");

    expect(await screen.findByTestId("login-landing")).toHaveTextContent("/accounts");
    expect(screen.queryByTestId("protected-outlet")).not.toBeInTheDocument();
  });

  it("unavailable 时展示会话不可用屏，点击重试触发 retryRestore", async () => {
    const retryRestore = vi.fn(async () => {});
    setAuthState({ admin: null, status: "unavailable", retryRestore });
    const user = userEvent.setup();
    renderGuarded("/dashboard");

    expect(screen.getByText(i18n.t("auth.sessionUnavailable"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("auth.sessionUnavailableDescription"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: i18n.t("auth.retrySession") }));

    await waitFor(() => expect(retryRestore).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("protected-outlet")).not.toBeInTheDocument();
  });

  it("authenticated 时渲染 Outlet，且不出现加载态或重定向", () => {
    setAuthState({ admin: { id: "admin-1", username: "ops" }, status: "authenticated" });
    renderGuarded("/accounts");

    expect(screen.getByTestId("protected-outlet")).toHaveTextContent("accounts");
    expect(screen.queryByRole("status", { name: i18n.t("common.loading") })).not.toBeInTheDocument();
    expect(screen.queryByTestId("login-landing")).not.toBeInTheDocument();
  });

  it("注销后（authenticated -> anonymous）守卫立即重定向到登录页", async () => {
    setAuthState({ admin: { id: "admin-1", username: "ops" }, status: "authenticated" });
    renderGuarded("/dashboard");
    expect(screen.getByTestId("protected-outlet")).toBeInTheDocument();

    setAuthState({ admin: null, status: "anonymous" });

    expect(await screen.findByTestId("login-landing")).toHaveTextContent("/dashboard");
    expect(screen.queryByTestId("protected-outlet")).not.toBeInTheDocument();
  });

  it("StrictMode 双挂载后仍按状态渲染，卸载不残留订阅副作用", () => {
    setAuthState({ admin: { id: "admin-1", username: "ops" }, status: "authenticated" });
    const { unmount } = render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={["/dashboard"]}>
            <Routes>
              <Route element={<AuthBoundary />}>
                <Route path="/dashboard" element={<div data-testid="protected-outlet">dashboard</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </StrictMode>,
    );

    expect(screen.getByTestId("protected-outlet")).toBeInTheDocument();
    unmount();
    expect(screen.queryByTestId("protected-outlet")).not.toBeInTheDocument();
  });
});

describe("AnonymousBoundary 反向守卫", () => {
  it("未登录时放行登录页", () => {
    setAuthState({ admin: null, status: "anonymous" });
    renderGuarded("/login");

    expect(screen.getByTestId("login-landing")).toBeInTheDocument();
  });

  it("已登录时重定向到 /dashboard，不渲染登录页", async () => {
    setAuthState({ admin: { id: "admin-1", username: "ops" }, status: "authenticated" });
    renderGuarded("/login");

    expect(await screen.findByTestId("protected-outlet")).toHaveTextContent("dashboard");
    expect(screen.queryByTestId("login-landing")).not.toBeInTheDocument();
  });

  it("restoring 与 unavailable 时同样拦截登录页", () => {
    const retryRestore = vi.fn(async () => {});
    setAuthState({ admin: null, status: "restoring", retryRestore });
    renderGuarded("/login");

    expect(screen.getByRole("status", { name: i18n.t("common.loading") })).toBeInTheDocument();
    expect(screen.queryByTestId("login-landing")).not.toBeInTheDocument();
  });

  it("unavailable 时登录页也展示重试入口并可重试", async () => {
    const retryRestore = vi.fn(async () => {});
    setAuthState({ admin: null, status: "unavailable", retryRestore });
    const user = userEvent.setup();
    renderGuarded("/login");

    expect(screen.getByText(i18n.t("auth.sessionUnavailable"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: i18n.t("auth.retrySession") }));

    await waitFor(() => expect(retryRestore).toHaveBeenCalledTimes(1));
  });
});
