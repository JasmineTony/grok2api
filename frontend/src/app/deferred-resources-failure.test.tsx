import { render, screen } from "@testing-library/react";
import { Component, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FE-19-8 回归（端到端形态）：文案 chunk 的**瞬态**失败不得让其它懒加载路由持续失败。
 *
 * 缺陷链路：`app/deferred-pages.tsx` 的 `Promise.all([loadDeferredResources(), loader()])` 让文案
 * 与页面共享同一失败态，而 `shared/i18n` 的单例缓存把 rejected Promise 永久留下 → 一次瞬态失败
 * 之后，导航到任何其它懒加载路由都会立刻失败。
 *
 * 本文件保留真实的 `shared/i18n` 单例、真实的 `lazyNamed`/`Promise.all` 包装与真实的资源合并逻辑，
 * 只替换资源模块与两个页面模块的边界；`src/test/setup.ts` 的 beforeAll 会先真实加载一次文案，
 * 因此每个用例都在 `vi.resetModules()` 之后才动态 import，拿到的才是全新的单例与模块缓存。
 */

const failure = new Error("文案 chunk 加载失败");

const deferredFixture = {
  "zh-CN": { translation: { deferredProbe: "延迟文案" } },
  en: { translation: { deferredProbe: "Deferred copy" } },
};

/** 资源模块工厂被调用的次数：修复后第二次导航必须重新请求，未修复则停留在 1。 */
let resourceImports = 0;

function DashboardProbe(): ReactElement {
  return <div data-testid="page-dashboard">仪表盘已就绪</div>;
}

function ModelsProbe(): ReactElement {
  return <div data-testid="page-models">模型页已就绪</div>;
}

class ErrorBoundary extends Component<{ children: ReactElement }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactElement {
    return this.state.failed ? (
      <div role="alert" data-testid="route-error">
        路由加载失败
      </div>
    ) : (
      this.props.children
    );
  }
}

beforeEach(() => {
  vi.resetModules();
  resourceImports = 0;
  vi.doMock("@/shared/i18n/resources/deferred", () => {
    resourceImports += 1;
    if (resourceImports === 1) return Promise.reject(failure);
    return { default: deferredFixture };
  });
  vi.doMock("@/features/dashboard/dashboard-page", () => ({ DashboardPage: DashboardProbe }));
  vi.doMock("@/features/models/models-page", () => ({ ModelsPage: ModelsProbe }));
});

afterEach(() => {
  vi.doUnmock("@/shared/i18n/resources/deferred");
  vi.doUnmock("@/features/dashboard/dashboard-page");
  vi.doUnmock("@/features/models/models-page");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("文案 chunk 瞬态失败后的下一次导航", () => {
  it("另一条懒加载路由仍能解析并渲染，失败态不被单例永久缓存", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { i18n } = await import("@/shared/i18n");
    const { DeferredDashboardPage, DeferredModelsPage } = await import("@/app/deferred-pages");

    const failedRoute = render(
      <ErrorBoundary>
        <DeferredDashboardPage />
      </ErrorBoundary>,
    );
    expect(await screen.findByTestId("route-error")).toBeVisible();
    expect(screen.queryByTestId("page-dashboard")).not.toBeInTheDocument();
    expect(resourceImports).toBe(1);
    // 失败不得写入半成品文案（禁止静默降级）。
    expect(i18n.getResource("zh-CN", "translation", "deferredProbe")).toBeUndefined();
    failedRoute.unmount();

    render(
      <ErrorBoundary>
        <DeferredModelsPage />
      </ErrorBoundary>,
    );
    expect(await screen.findByTestId("page-models")).toBeVisible();
    expect(screen.queryByTestId("route-error")).not.toBeInTheDocument();
    expect(resourceImports).toBe(2);
    expect(i18n.getResource("zh-CN", "translation", "deferredProbe")).toBe("延迟文案");
  });
});
