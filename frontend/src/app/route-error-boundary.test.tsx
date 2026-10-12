import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FE-19-13 回归：懒加载路由的模块加载失败必须落到**可恢复**的错误界面。
 *
 * 缺陷链路：`app/deferred-pages.tsx` 的 React.lazy 包装在页面 chunk 加载失败时把 rejection
 * 上抛给 React 根；`app/router.tsx` 此前没有任何 errorElement，用户只能看到 React Router
 * 自带的默认错误页（英文 "Unexpected Application Error!"，无本地化、无重新加载入口）。
 *
 * 本文件走真实的 `app/router.tsx` 路由表（含 AuthBoundary 守卫与懒加载包装），只替换两个边界：
 *  - `@/features/dashboard/dashboard-page`：由各用例决定加载失败还是成功；
 *  - `fetch`：AppShell 的版本查询（网络边界）。
 * 每个用例先 `vi.resetModules()` 再动态 import，保证拿到全新的 lazy 实例与 store 单例。
 */

const failure = new Error("dashboard chunk 加载失败");

const PAGE_MODULE = "@/features/dashboard/dashboard-page";

function DashboardProbe(): ReactElement {
  return <div data-testid="page-dashboard">仪表盘已就绪</div>;
}

/**
 * vitest 的 `vi.doMock` 工厂抛错时会用 `cause` 包一层帮助信息，
 * 这里沿 cause 链比对，确认被记录的就是原始模块加载失败。
 */
function hasCause(error: unknown, target: Error): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current === target) return true;
    current = current.cause;
  }
  return false;
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
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

/** 渲染真实路由表的 /dashboard：页面模块由 factory 决定加载失败或成功。 */
async function renderDashboardRoute(
  factory: () => Record<string, unknown>,
): Promise<{ i18n: Awaited<typeof import("@/shared/i18n")>["i18n"] }> {
  vi.resetModules();
  vi.doMock(PAGE_MODULE, factory);
  const [{ router }, { i18n }, { useAuthStore }] = await Promise.all([
    import("@/app/router"),
    import("@/shared/i18n"),
    import("@/shared/auth/auth-store"),
  ]);
  await i18n.changeLanguage("zh-CN");
  useAuthStore.setState({ admin: { id: "admin-1", username: "ops" }, status: "authenticated" });

  const memoryRouter = createMemoryRouter(router.routes, { initialEntries: ["/dashboard"] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={memoryRouter} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { i18n };
}

beforeEach(() => {
  installShellApi();
});

afterEach(() => {
  vi.doUnmock(PAGE_MODULE);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

/**
 * 捕获 `console.error` 调用。
 *
 * 不能用 `vi.spyOn(console, "error")`：测试运行器会按用例重新接管 `console`，
 * 整仓并发跑（126 个文件 / 2 worker）时 spy 会被运行器的包装覆盖，
 * 断言会以「没记录到」的形式假失败。整对象替换 `globalThis.console` 与运行器无关。
 */
function captureConsoleError(): unknown[][] {
  const calls: unknown[][] = [];
  vi.stubGlobal("console", {
    ...console,
    error: (...args: unknown[]) => {
      calls.push(args);
    },
  });
  return calls;
}

afterEach(() => {
  vi.doUnmock(PAGE_MODULE);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("路由级错误边界（懒加载 chunk 失败）", () => {
  it("懒加载页面模块加载失败时展示可恢复错误界面，而不是空白页", async () => {
    const consoleError = captureConsoleError();
    const { i18n } = await renderDashboardRoute(() => {
      throw failure;
    });

    const fallback = await screen.findByTestId("route-error-fallback");
    expect(fallback).toBeVisible();
    expect(screen.getByRole("alert", { name: i18n.t("common.pageLoadFailedTitle") })).toBe(fallback);
    // 文案必须真的来自核心资源，不能原样回显 key（deferred chunk 失败时也要可读）。
    expect(i18n.t("common.pageLoadFailedTitle")).not.toBe("common.pageLoadFailedTitle");
    expect(fallback).toHaveTextContent(i18n.t("common.pageLoadFailedDescription"));
    expect(screen.getByRole("button", { name: i18n.t("common.reloadPage") })).toBeVisible();
    // 不是空白页：出错后仍有可见内容，且失败的页面不再残留。
    expect(document.body.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(screen.queryByTestId("page-dashboard")).not.toBeInTheDocument();
    // 原始错误必须被记录，不得静默吞掉。
    const logged = consoleError.some(
      (call) => typeof call[0] === "string" && call[0].includes("[route-error]") && hasCause(call[1], failure),
    );
    expect(logged, "错误界面必须 console.error 记录原始错误").toBe(true);
  });

  it("点击「重新加载」触发 window.location.reload，用户无需手动刷新", async () => {
    captureConsoleError();
    const user = userEvent.setup();
    const reload = vi.fn();
    const { i18n } = await renderDashboardRoute(() => {
      throw failure;
    });
    await screen.findByTestId("route-error-fallback");

    vi.stubGlobal("location", { reload });
    await user.click(screen.getByRole("button", { name: i18n.t("common.reloadPage") }));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("懒加载页面正常解析时错误界面不出现，路由渲染不受影响", async () => {
    const { i18n } = await renderDashboardRoute(() => ({ DashboardPage: DashboardProbe }));

    expect(await screen.findByTestId("page-dashboard")).toBeVisible();
    expect(screen.queryByTestId("route-error-fallback")).not.toBeInTheDocument();
    expect(i18n.t("common.pageLoadFailedTitle")).not.toBe("common.pageLoadFailedTitle");
  });
});
