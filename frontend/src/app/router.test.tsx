import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { router } from "@/app/router";
import { useAuthStore } from "@/shared/auth/auth-store";
import { i18n } from "@/shared/i18n";

// router.tsx 的真实契约：
//   /login        -> AnonymousBoundary + LoginPage
//   /docs         -> 重定向 /docs/chat/completions（位于 DeferredAppShell 之下）
//   /`（index）    -> 重定向 /dashboard
//   "*"（未命中）  -> 重定向 /dashboard
//   业务路径       -> AuthBoundary + DeferredAppShell + 对应 Deferred 页面
// 这里复用 router.tsx 导出的真实路由表（router.routes），只把 History 换成内存实现，
// 断言真实重定向结果，而不是复制一份路由表做对照。

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } });
}

/** AppShell 需要版本查询；只替换 fetch 这一个网络边界。 */
function installShellApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/admin/v1/system/version")) {
        return jsonResponse({
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          updateAvailable: false,
          status: "up_to_date",
          checkedAt: null,
          releaseUrl: "",
          releaseNotes: "",
          error: "",
        });
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
}

function renderRouterAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const memoryRouter = createMemoryRouter(router.routes, { initialEntries: [path] });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={memoryRouter} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return memoryRouter;
}

/** 会话恢复中：AuthBoundary 直接渲染兜底，不会加载任何 lazy 页面（用例轻量且确定）。 */
function useRestoringSession(): void {
  useAuthStore.setState({ admin: null, status: "restoring" });
}

function useAuthenticatedSession(): void {
  useAuthStore.setState({ admin: { id: "admin-1", username: "ops" }, status: "authenticated" });
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  installShellApi();
  useRestoringSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useRestoringSession();
});

describe("router 路由表与重定向", () => {
  it("未命中路径由兜底路由重定向到 /dashboard", async () => {
    const memoryRouter = renderRouterAt("/definitely-not-a-route");

    await waitFor(() => expect(memoryRouter.state.location.pathname).toBe("/dashboard"));
  });

  it("/docs 重定向到首个接口文档路径", async () => {
    useAuthenticatedSession();
    const memoryRouter = renderRouterAt("/docs");

    await waitFor(() => expect(memoryRouter.state.location.pathname).toBe("/docs/chat/completions"));
  });

  it("根路径经 AppShell 的 index 路由重定向到 /dashboard", async () => {
    useAuthenticatedSession();
    const memoryRouter = renderRouterAt("/");

    await waitFor(() => expect(memoryRouter.state.location.pathname).toBe("/dashboard"));
  });

  it("受保护路径在会话恢复中展示加载兜底，登录页不出现且路径保持不变", () => {
    const memoryRouter = renderRouterAt("/accounts");

    expect(screen.getByRole("status", { name: i18n.t("common.loading") })).toBeInTheDocument();
    expect(screen.queryByLabelText(i18n.t("auth.username"))).not.toBeInTheDocument();
    expect(memoryRouter.state.location.pathname).toBe("/accounts");
  });

  it("会话已失效时受保护路径重定向到 /login，并保留来源路径供登录后回跳", async () => {
    useAuthStore.setState({ admin: null, status: "anonymous" });
    const memoryRouter = renderRouterAt("/settings");

    expect(await screen.findByLabelText(i18n.t("auth.username"))).toBeInTheDocument();
    await waitFor(() => expect(memoryRouter.state.location.pathname).toBe("/login"));
    expect(memoryRouter.state.location.state).toMatchObject({ from: "/settings" });
  });

  it("/login 在未登录时不被重定向，停留在登录页", () => {
    useAuthStore.setState({ admin: null, status: "anonymous" });
    const memoryRouter = renderRouterAt("/login");

    expect(screen.getByLabelText(i18n.t("auth.username"))).toBeInTheDocument();
    expect(memoryRouter.state.location.pathname).toBe("/login");
  });

  it("会话不可用时受保护路径与登录页都展示重试入口，不发生重定向", async () => {
    const retryRestore = vi.fn(async () => {});
    useAuthStore.setState({ admin: null, status: "unavailable", retryRestore });

    const protectedRouter = renderRouterAt("/dashboard");
    expect(screen.getByText(i18n.t("auth.sessionUnavailable"))).toBeInTheDocument();
    expect(protectedRouter.state.location.pathname).toBe("/dashboard");

    const loginRouter = renderRouterAt("/login");
    expect(screen.getAllByText(i18n.t("auth.sessionUnavailable")).length).toBeGreaterThan(0);
    expect(loginRouter.state.location.pathname).toBe("/login");
  });
});
