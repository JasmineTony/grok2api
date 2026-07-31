import { type ComponentType, lazy, type LazyExoticComponent, Suspense } from "react";

import {
  loadAboutSettingsPage,
  loadAccountsPage,
  loadApiDocsPage,
  loadBuildSettingsPage,
  loadChangelogSettingsPage,
  loadClientKeysPage,
  loadConsoleSettingsPage,
  loadCreativeConsolePage,
  loadDashboardPage,
  loadGalleryPage,
  loadMediaSettingsPage,
  loadModelsPage,
  loadNetworkSettingsPage,
  loadRequestAuditsPage,
  loadSettingsPage,
  loadSettingsRouteShell,
  loadVideoGalleryPage,
  loadWebSettingsPage,
} from "@/app/deferred-page-prefetch";
import { loadAdminShell } from "@/app/deferred-shell-prefetch";

const AboutSettingsPage = lazyNamed(loadAboutSettingsPage, "AboutSettingsPage");
const ChangelogSettingsPage = lazyNamed(loadChangelogSettingsPage, "ChangelogSettingsPage");
const AccountsPage = lazyNamed(loadAccountsPage, "AccountsPage");
const AdminShell = lazyNamed(loadAdminShell, "AdminShell");
const RequestAuditsPage = lazyNamed(loadRequestAuditsPage, "RequestAuditsPage");
const ClientKeysPage = lazyNamed(loadClientKeysPage, "ClientKeysPage");
const CreativeConsolePage = lazyNamed(loadCreativeConsolePage, "CreativeConsolePage");
const DashboardPage = lazyNamed(loadDashboardPage, "DashboardPage");
const ApiDocsPage = lazyNamed(loadApiDocsPage, "ApiDocsPage");
const GalleryPage = lazyNamed(loadGalleryPage, "GalleryPage");
const VideoGalleryPage = lazyNamed(loadVideoGalleryPage, "VideoGalleryPage");
const ModelsPage = lazyNamed(loadModelsPage, "ModelsPage");
const SettingsRouteShell = lazyNamed(loadSettingsRouteShell, "SettingsRouteShell");
const SettingsPage = lazyNamed(loadSettingsPage, "SettingsPage");
const MediaSettingsPage = lazyNamed(loadMediaSettingsPage, "MediaSettingsPage");
const NetworkSettingsPage = lazyNamed(loadNetworkSettingsPage, "NetworkSettingsPage");
const BuildSettingsPage = lazyNamed(loadBuildSettingsPage, "BuildSettingsPage");
const WebSettingsPage = lazyNamed(loadWebSettingsPage, "WebSettingsPage");
const ConsoleSettingsPage = lazyNamed(loadConsoleSettingsPage, "ConsoleSettingsPage");

function lazyNamed<T extends Record<K, ComponentType>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K,
): LazyExoticComponent<T[K]> {
  return lazy(async () => ({ default: (await loader())[exportName] }));
}

function DeferredPage({ page: Page }: { page: ComponentType }) {
  return (
    <Suspense fallback={<PageLoadingFallback />}>
      <Page />
    </Suspense>
  );
}

export function DeferredAboutSettingsPage() {
  return <DeferredPage page={AboutSettingsPage} />;
}
export function DeferredChangelogSettingsPage() {
  return <DeferredPage page={ChangelogSettingsPage} />;
}
export function DeferredAccountsPage() {
  return <DeferredPage page={AccountsPage} />;
}
export function DeferredAppShell() {
  return (
    <Suspense fallback={<PageLoadingFallback fullScreen />}>
      <AdminShell />
    </Suspense>
  );
}
export function DeferredDashboardPage() {
  return <DeferredPage page={DashboardPage} />;
}
export function DeferredModelsPage() {
  return <DeferredPage page={ModelsPage} />;
}
export function DeferredClientKeysPage() {
  return <DeferredPage page={ClientKeysPage} />;
}
export function DeferredCreativeConsolePage() {
  return <DeferredPage page={CreativeConsolePage} />;
}
export function DeferredRequestAuditsPage() {
  return <DeferredPage page={RequestAuditsPage} />;
}
export function DeferredGalleryPage() {
  return <DeferredPage page={GalleryPage} />;
}
export function DeferredVideoGalleryPage() {
  return <DeferredPage page={VideoGalleryPage} />;
}
export function DeferredApiDocsPage() {
  return <DeferredPage page={ApiDocsPage} />;
}
export function DeferredSettingsRouteShell() {
  return <DeferredPage page={SettingsRouteShell} />;
}
export function DeferredSettingsPage() {
  return <DeferredPage page={SettingsPage} />;
}
export function DeferredMediaSettingsPage() {
  return <DeferredPage page={MediaSettingsPage} />;
}
export function DeferredBuildSettingsPage() {
  return <DeferredPage page={BuildSettingsPage} />;
}
export function DeferredWebSettingsPage() {
  return <DeferredPage page={WebSettingsPage} />;
}
export function DeferredConsoleSettingsPage() {
  return <DeferredPage page={ConsoleSettingsPage} />;
}
export function DeferredNetworkSettingsPage() {
  return <DeferredPage page={NetworkSettingsPage} />;
}

function PageLoadingFallback({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div
      className={
        fullScreen
          ? "mx-auto flex min-h-screen w-full max-w-7xl flex-col justify-center gap-4 px-6"
          : "min-h-[calc(100vh-7rem)] space-y-4 lg:min-h-[calc(100vh-10rem)]"
      }
      aria-hidden="true"
    >
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted/60" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg border bg-muted/30" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-lg border bg-muted/25" />
    </div>
  );
}
