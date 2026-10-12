import { act, render, screen, waitFor, within } from "@testing-library/react";
import { Component, StrictMode, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18n } from "@/shared/i18n";

type DeferredPromise<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): DeferredPromise<T> {
  let resolve!: DeferredPromise<T>["resolve"];
  let reject!: DeferredPromise<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const renderPage = vi.fn((): ReactElement => <h1 data-testid="deferred-page-ready">页面已就绪</h1>);
const pageExports = { DashboardPage: renderPage, AppShell: renderPage };
const loadPage = vi.fn<() => Promise<typeof pageExports>>();
const loadResources = vi.fn<() => Promise<void>>();
let moduleGate: DeferredPromise<typeof pageExports>;
let resourceGate: DeferredPromise<void>;

class ErrorBoundary extends Component<
  { children: ReactElement; onError: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    this.props.onError(error);
  }

  render(): ReactElement {
    return this.state.failed ? (
      <div role="alert" data-testid="deferred-page-error">
        页面加载失败
      </div>
    ) : (
      this.props.children
    );
  }
}

beforeEach(() => {
  // 每例重新创建真实包装的 lazy 缓存，只替换文案入口和动态 import 的模块边界。
  // setup.ts 的文案预加载已完成，不让它提前完成本例的受控 Promise。
  vi.resetModules();
  moduleGate = deferred<typeof pageExports>();
  resourceGate = deferred<void>();
  renderPage.mockClear();
  loadPage.mockReset().mockReturnValue(moduleGate.promise);
  loadResources.mockReset().mockReturnValue(resourceGate.promise);
  vi.doMock("@/shared/i18n", () => ({ i18n, loadDeferredResources: loadResources }));
  vi.doMock("@/features/dashboard/dashboard-page", () => loadPage());
  vi.doMock("@/app/app-shell", () => loadPage());
});

afterEach(() => {
  vi.doUnmock("@/shared/i18n");
  vi.doUnmock("@/features/dashboard/dashboard-page");
  vi.doUnmock("@/app/app-shell");
  vi.restoreAllMocks();
});

const wrappers = [
  { name: "业务页", exportName: "DeferredDashboardPage", fallbackId: "app-page-loading" },
  { name: "应用外壳", exportName: "DeferredAppShell", fallbackId: "app-shell-loading" },
] as const;

describe.each(wrappers)("$name 的真实懒加载包装", ({ exportName, fallbackId }) => {
  it.each(["模块", "文案"] as const)("%s先完成时仍等待另一项，二者成功后才替换兜底", async (first) => {
    const DeferredWrapper = (await import("@/app/deferred-pages"))[exportName];
    render(<DeferredWrapper />);

    expect(loadResources).toHaveBeenCalledTimes(1);
    // 文案 Promise 尚未完成，模块边界就必须启动；串行实现会在此失败。
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(1));
    const fallback = screen.getByTestId(fallbackId);
    expect(within(fallback).getByRole("status", { name: i18n.t("common.loading") })).toBeVisible();
    expect(renderPage).not.toHaveBeenCalled();

    await act(async () => {
      if (first === "模块") {
        moduleGate.resolve(pageExports);
        await vi.dynamicImportSettled();
      } else {
        resourceGate.resolve();
      }
    });
    expect(screen.getByTestId(fallbackId)).toBeVisible();
    expect(screen.queryByTestId("deferred-page-ready")).not.toBeInTheDocument();
    expect(renderPage).not.toHaveBeenCalled();

    await act(async () => {
      moduleGate.resolve(pageExports);
      resourceGate.resolve();
    });
    expect(await screen.findByTestId("deferred-page-ready")).toHaveTextContent("页面已就绪");
    expect(screen.getByRole("heading", { name: "页面已就绪" })).toBeVisible();
    expect(screen.queryByTestId(fallbackId)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(loadResources).toHaveBeenCalledTimes(1);
  });
});

describe("懒加载失败与缓存", () => {
  it.each(["模块", "文案"] as const)("%s失败立即到达错误边界，不被加载兜底或另一项等待掩盖", async (source) => {
    const { DeferredDashboardPage } = await import("@/app/deferred-pages");
    const caught = vi.fn<(error: Error) => void>();
    const failure = new Error(`${source}加载失败`);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary onError={caught}>
        <DeferredDashboardPage />
      </ErrorBoundary>,
    );
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("app-page-loading")).toBeVisible();

    await act(async () => {
      if (source === "模块") moduleGate.reject(failure);
      else resourceGate.reject(failure);
    });
    expect(await screen.findByTestId("deferred-page-error")).toHaveTextContent("页面加载失败");
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByTestId("app-page-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("deferred-page-ready")).not.toBeInTheDocument();
    expect(caught).toHaveBeenCalledTimes(1);
    const receivedError = caught.mock.calls[0][0];
    // Vitest 会包装模块工厂的 rejection，原始加载错误保留在 cause 中。
    if (source === "模块") expect(receivedError.cause).toBe(failure);
    else expect(receivedError).toBe(failure);

    // 另一项随后失败也必须被观察，不产生未处理 rejection 或再次请求。
    await act(async () => {
      if (source === "模块") resourceGate.reject(new Error("文案随后失败"));
      else moduleGate.reject(new Error("模块随后失败"));
      await vi.dynamicImportSettled();
    });
    expect(caught).toHaveBeenCalledTimes(1);
    expect(renderPage).not.toHaveBeenCalled();
    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(loadResources).toHaveBeenCalledTimes(1);
  });

  it("StrictMode 首次挂载、重渲染及重新挂载均复用加载结果，卸载不残留页面", async () => {
    const { DeferredDashboardPage } = await import("@/app/deferred-pages");
    const element = (
      <StrictMode>
        <DeferredDashboardPage />
      </StrictMode>
    );
    const view = render(element);
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(1));
    view.rerender(
      <StrictMode>
        <DeferredDashboardPage />
      </StrictMode>,
    );
    expect(screen.getByTestId("app-page-loading")).toBeVisible();
    expect(renderPage).not.toHaveBeenCalled();
    expect(loadResources).toHaveBeenCalledTimes(1);

    await act(async () => {
      moduleGate.resolve(pageExports);
      resourceGate.resolve();
    });
    expect(await screen.findByTestId("deferred-page-ready")).toHaveTextContent("页面已就绪");
    expect(screen.queryByTestId("app-page-loading")).not.toBeInTheDocument();
    view.unmount();
    expect(screen.queryByTestId("deferred-page-ready")).not.toBeInTheDocument();

    render(element);
    expect(screen.getByTestId("deferred-page-ready")).toHaveTextContent("页面已就绪");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(loadResources).toHaveBeenCalledTimes(1);
  });
});
