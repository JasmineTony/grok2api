import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactElement } from "react";

import { Spinner } from "@/components/ui/spinner";
import { loadDeferredResources } from "@/shared/i18n";

const AccountsPage = lazyNamed(() => import("@/features/accounts/accounts-page"), "AccountsPage");
const AppShell = lazyNamed(() => import("@/app/app-shell"), "AppShell");
const RequestAuditsPage = lazyNamed(() => import("@/features/audits/request-audits-page"), "RequestAuditsPage");
const ClientKeysPage = lazyNamed(() => import("@/features/client-keys/client-keys-page"), "ClientKeysPage");
const CreativeConsolePage = lazyNamed(
  () => import("@/features/creative-console/creative-console-page"),
  "CreativeConsolePage",
);
const DashboardPage = lazyNamed(() => import("@/features/dashboard/dashboard-page"), "DashboardPage");
const ApiDocsPage = lazyNamed(() => import("@/features/docs/api-docs-page"), "ApiDocsPage");
const GalleryPage = lazyNamed(() => import("@/features/media/gallery-page"), "GalleryPage");
const VideoGalleryPage = lazyNamed(() => import("@/features/media/video-gallery-page"), "VideoGalleryPage");
const ModelsPage = lazyNamed(() => import("@/features/models/models-page"), "ModelsPage");
const QualityGuardPage = lazyNamed(() => import("@/features/quality-guard/quality-guard-page"), "QualityGuardPage");
const SettingsPage = lazyNamed(() => import("@/features/settings/settings-page"), "SettingsPage");

/**
 * 文案与页面模块并发加载；只有二者均成功后才交给 React 渲染，
 * 避免页面短暂显示未翻译的 key，加载失败则继续上抛给错误边界。
 */
async function resolveLazyNamedExport<T extends Record<K, ComponentType>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K,
): Promise<{ default: T[K] }> {
  const [, pageModule] = await Promise.all([loadDeferredResources(), loader()]);
  return { default: pageModule[exportName] };
}

function lazyNamed<T extends Record<K, ComponentType>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K,
): LazyExoticComponent<T[K]> {
  return lazy(() => resolveLazyNamedExport(loader, exportName));
}

function DeferredPage({ page: Page }: { page: ComponentType }): ReactElement {
  return (
    <Suspense fallback={<PageLoadingFallback />}>
      <Page />
    </Suspense>
  );
}

export function DeferredAccountsPage(): ReactElement {
  return <DeferredPage page={AccountsPage} />;
}

export function DeferredAppShell(): ReactElement {
  return (
    <Suspense fallback={<PageLoadingFallback fullScreen />}>
      <AppShell />
    </Suspense>
  );
}

export function DeferredDashboardPage(): ReactElement {
  return <DeferredPage page={DashboardPage} />;
}

export function DeferredModelsPage(): ReactElement {
  return <DeferredPage page={ModelsPage} />;
}

export function DeferredQualityGuardPage(): ReactElement {
  return <DeferredPage page={QualityGuardPage} />;
}

export function DeferredClientKeysPage(): ReactElement {
  return <DeferredPage page={ClientKeysPage} />;
}

export function DeferredCreativeConsolePage(): ReactElement {
  return <DeferredPage page={CreativeConsolePage} />;
}

export function DeferredRequestAuditsPage(): ReactElement {
  return <DeferredPage page={RequestAuditsPage} />;
}

export function DeferredGalleryPage(): ReactElement {
  return <DeferredPage page={GalleryPage} />;
}

export function DeferredVideoGalleryPage(): ReactElement {
  return <DeferredPage page={VideoGalleryPage} />;
}

export function DeferredApiDocsPage(): ReactElement {
  return <DeferredPage page={ApiDocsPage} />;
}

export function DeferredSettingsPage(): ReactElement {
  return <DeferredPage page={SettingsPage} />;
}

function PageLoadingFallback({ fullScreen = false }: { fullScreen?: boolean }): ReactElement {
  return (
    <div
      data-testid={fullScreen ? "app-shell-loading" : "app-page-loading"}
      className={
        fullScreen
          ? "flex min-h-screen items-center justify-center bg-background"
          : "flex min-h-[calc(100vh-7rem)] items-center justify-center lg:min-h-[calc(100vh-10rem)]"
      }
    >
      <Spinner className="size-5" />
    </div>
  );
}
