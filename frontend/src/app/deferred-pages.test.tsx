import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode, Suspense, type ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DeferredAccountsPage,
  DeferredApiDocsPage,
  DeferredAppShell,
  DeferredClientKeysPage,
  DeferredCreativeConsolePage,
  DeferredDashboardPage,
  DeferredGalleryPage,
  DeferredModelsPage,
  DeferredQualityGuardPage,
  DeferredRequestAuditsPage,
  DeferredSettingsPage,
  DeferredVideoGalleryPage,
} from "@/app/deferred-pages";
import { useAuthStore } from "@/shared/auth/auth-store";
import { i18n } from "@/shared/i18n";

// deferred-pages.tsx 的真实契约：
//   lazyNamed(loader, exportName) 把动态 import 的具名导出映射为 lazy 组件的 default；
//   DeferredXxxPage 用 Suspense 包裹，加载期间渲染 Spinner 兜底；
//   DeferredAppShell 用 fullScreen 变体兜底，其余页面用常规视口变体。
// 这里只替换每个页面的**模块边界**（真实的 lazy / Suspense / 兜底布局逻辑全部保留），
// 从而既能断言加载态，也能断言每个 Deferred 包装确实解析到它负责的那个页面导出。

function pageProbe(exportName: string): () => ReactElement {
  return () => <div data-testid={`page-${exportName}`}>{exportName}</div>;
}

vi.mock("@/features/accounts/accounts-page", () => ({ AccountsPage: pageProbe("AccountsPage") }));
vi.mock("@/app/app-shell", () => ({ AppShell: pageProbe("AppShell") }));
vi.mock("@/features/audits/request-audits-page", () => ({ RequestAuditsPage: pageProbe("RequestAuditsPage") }));
vi.mock("@/features/client-keys/client-keys-page", () => ({ ClientKeysPage: pageProbe("ClientKeysPage") }));
vi.mock("@/features/creative-console/creative-console-page", () => ({
  CreativeConsolePage: pageProbe("CreativeConsolePage"),
}));
vi.mock("@/features/dashboard/dashboard-page", () => ({ DashboardPage: pageProbe("DashboardPage") }));
vi.mock("@/features/docs/api-docs-page", () => ({ ApiDocsPage: pageProbe("ApiDocsPage") }));
vi.mock("@/features/media/gallery-page", () => ({ GalleryPage: pageProbe("GalleryPage") }));
vi.mock("@/features/media/video-gallery-page", () => ({ VideoGalleryPage: pageProbe("VideoGalleryPage") }));
vi.mock("@/features/models/models-page", () => ({ ModelsPage: pageProbe("ModelsPage") }));
vi.mock("@/features/quality-guard/quality-guard-page", () => ({
  QualityGuardPage: pageProbe("QualityGuardPage"),
}));
vi.mock("@/features/settings/settings-page", () => ({ SettingsPage: pageProbe("SettingsPage") }));

// 兜底布局变体：AppShell 用全屏变体，其余业务页用常规视口变体（deferred-pages.tsx:88-99）。
const deferredWrappers: ReadonlyArray<{ name: string; fallbackLayout: string; element: ReactElement }> = [
  { name: "AppShell", fallbackLayout: "min-h-screen", element: <DeferredAppShell /> },
  { name: "AccountsPage", fallbackLayout: "min-h-[calc(100vh-7rem)]", element: <DeferredAccountsPage /> },
  { name: "DashboardPage", fallbackLayout: "min-h-[calc(100vh-7rem)]", element: <DeferredDashboardPage /> },
  { name: "ModelsPage", fallbackLayout: "min-h-[calc(100vh-7rem)]", element: <DeferredModelsPage /> },
  { name: "QualityGuardPage", fallbackLayout: "min-h-[calc(100vh-7rem)]", element: <DeferredQualityGuardPage /> },
  { name: "ClientKeysPage", fallbackLayout: "min-h-[calc(100vh-7rem)]", element: <DeferredClientKeysPage /> },
  { name: "CreativeConsolePage", fallbackLayout: "min-h-[calc(100vh-7rem)]", element: <DeferredCreativeConsolePage /> },
  { name: "RequestAuditsPage", fallbackLayout: "min-h-[calc(100vh-7rem)]", element: <DeferredRequestAuditsPage /> },
  { name: "GalleryPage", fallbackLayout: "min-h-[calc(100vh-7rem)]", element: <DeferredGalleryPage /> },
  { name: "VideoGalleryPage", fallbackLayout: "min-h-[calc(100vh-7rem)]", element: <DeferredVideoGalleryPage /> },
  { name: "ApiDocsPage", fallbackLayout: "min-h-[calc(100vh-7rem)]", element: <DeferredApiDocsPage /> },
  { name: "SettingsPage", fallbackLayout: "min-h-[calc(100vh-7rem)]", element: <DeferredSettingsPage /> },
];

function renderDeferred(node: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
    </I18nextProvider>,
  );
}

/** 首屏兜底是 Spinner；解析完成后必须被真实页面替换，而不是两者共存。 */
function loadingSpinner(): HTMLElement | null {
  return screen.queryByRole("status", { name: i18n.t("common.loading") });
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  // AppShell 读取登录用户名，需要最小 authenticated 状态。
  useAuthStore.setState({ admin: { id: "admin-1", username: "ops" }, status: "authenticated" });
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ admin: null, status: "restoring" });
});

describe("DeferredPage 懒加载包装", () => {
  it.each(deferredWrappers)(
    "$name 先按自身布局变体渲染加载兜底，再解析出对应页面",
    async ({ name, fallbackLayout, element }) => {
      renderDeferred(element);

      // 兜底只在 lazy 首次解析前出现，因此布局断言必须放在这里（同一文件的每个变体只解析一次）。
      const fallbackBox = loadingSpinner()?.parentElement;
      expect(fallbackBox?.className).toContain(fallbackLayout);

      const page = await screen.findByTestId(`page-${name}`);
      expect(page).toHaveTextContent(name);

      await waitFor(() => expect(loadingSpinner()).not.toBeInTheDocument());
      // 懒加载包装只解析自己负责的页面，不会顺带渲染其它页面。
      expect(screen.getAllByTestId(/^page-/)).toHaveLength(1);
    },
  );

  it("懒加载失败不会被兜底掩盖：错误上抛给 ErrorBoundary 而不是永久停留在加载态", async () => {
    // 与 deferred-pages 的 lazyNamed 同构：loader 拒绝时 lazy 组件抛出，Suspense 不吞错。
    const failing = vi.fn(async () => {
      throw new Error("chunk load failed");
    });
    const Failing = (await import("react")).lazy(failing);
    const caught: string[] = [];

    class ErrorBoundary extends (await import("react")).Component<{ children: ReactElement }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
      }
      componentDidCatch(error: Error): void {
        caught.push(error.message);
      }
      render(): ReactElement {
        return this.state.failed ? <div data-testid="lazy-error">failed</div> : this.props.children;
      }
    }

    renderDeferred(
      <ErrorBoundary>
        <Suspense fallback={<span data-testid="lazy-fallback" />}>
          <Failing />
        </Suspense>
      </ErrorBoundary>,
    );

    expect(await screen.findByTestId("lazy-error")).toBeInTheDocument();
    expect(screen.queryByTestId("lazy-fallback")).not.toBeInTheDocument();
    expect(caught).toEqual(["chunk load failed"]);
  });

  it("StrictMode 双挂载下懒加载仍解析成功，卸载后不残留页面", async () => {
    const { unmount } = renderDeferred(
      <StrictMode>
        <Suspense fallback={<span data-testid="outer-fallback" />}>
          <DeferredDashboardPage />
        </Suspense>
      </StrictMode>,
    );

    expect(await screen.findByTestId("page-DashboardPage")).toHaveTextContent("DashboardPage");
    expect(screen.queryByTestId("outer-fallback")).not.toBeInTheDocument();

    unmount();
    expect(screen.queryByTestId("page-DashboardPage")).not.toBeInTheDocument();
  });
});
