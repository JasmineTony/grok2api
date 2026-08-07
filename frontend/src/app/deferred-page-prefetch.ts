const loadAboutSettingsPage = () => import("@/features/settings/about-settings-page");
const loadChangelogSettingsPage = () => import("@/features/settings/changelog-settings-page");
const loadAccountsPage = () => import("@/features/accounts/accounts-page");
const loadRequestAuditsPage = () => import("@/features/audits/request-audits-page");
const loadQualityGuardPage = () => import("@/features/quality-guard/quality-guard-page");
const loadClientKeysPage = () => import("@/features/client-keys/client-keys-page");
const loadCreativeConsolePage = () => import("@/features/creative-console/creative-console-page");
const loadDashboardPage = () => import("@/features/dashboard/dashboard-page");
const loadApiDocsPage = () => import("@/features/docs/api-docs-page");
const loadGalleryPage = () => import("@/features/media/gallery-page");
const loadVideoGalleryPage = () => import("@/features/media/video-gallery-page");
const loadModelsPage = () => import("@/features/models/models-page");
const loadSettingsRouteShell = () => import("@/features/settings/settings-route-shell");
const loadSettingsPage = () => import("@/features/settings/settings-page");
const loadRuntimePoliciesSettingsPage = () =>
  import("@/features/settings/runtime-policies-settings-page");
const loadAccountMaintenanceSettingsPage = () =>
  import("@/features/settings/account-maintenance-settings-page");
const loadMediaSettingsPage = () => import("@/features/settings/media-settings-page");
const loadNetworkSettingsPage = () => import("@/features/settings/network-settings-page");
const loadBuildSettingsPage = () => import("@/features/settings/build-settings-page");
const loadWebSettingsPage = () => import("@/features/settings/web-settings-page");
const loadConsoleSettingsPage = () => import("@/features/settings/console-settings-page");

const routeLoaders: ReadonlyArray<{
  matches: (pathname: string) => boolean;
  load: () => Promise<unknown>;
}> = [
  { matches: (pathname) => pathname === "/dashboard", load: loadDashboardPage },
  { matches: (pathname) => pathname === "/accounts", load: loadAccountsPage },
  { matches: (pathname) => pathname === "/models", load: loadModelsPage },
  { matches: (pathname) => pathname === "/client-keys", load: loadClientKeysPage },
  { matches: (pathname) => pathname === "/creative-console", load: loadCreativeConsolePage },
  { matches: (pathname) => pathname === "/gallery", load: loadGalleryPage },
  { matches: (pathname) => pathname === "/video-gallery", load: loadVideoGalleryPage },
  { matches: (pathname) => pathname === "/request-audits", load: loadRequestAuditsPage },
  { matches: (pathname) => pathname === "/quality-guard", load: loadQualityGuardPage },
  { matches: (pathname) => pathname === "/settings", load: loadSettingsPage },
  {
    matches: (pathname) => pathname === "/settings/policies",
    load: loadRuntimePoliciesSettingsPage,
  },
  {
    matches: (pathname) => pathname === "/settings/accounts",
    load: loadAccountMaintenanceSettingsPage,
  },
  { matches: (pathname) => pathname === "/settings/media", load: loadMediaSettingsPage },
  { matches: (pathname) => pathname === "/settings/network", load: loadNetworkSettingsPage },
  { matches: (pathname) => pathname === "/settings/build", load: loadBuildSettingsPage },
  { matches: (pathname) => pathname === "/settings/web", load: loadWebSettingsPage },
  { matches: (pathname) => pathname === "/settings/console", load: loadConsoleSettingsPage },
  { matches: (pathname) => pathname === "/settings/about", load: loadAboutSettingsPage },
  { matches: (pathname) => pathname === "/settings/changelog", load: loadChangelogSettingsPage },
  { matches: (pathname) => pathname.startsWith("/docs/"), load: loadApiDocsPage },
];

const primaryRoutes = [
  { pathname: "/dashboard", load: loadDashboardPage },
  { pathname: "/accounts", load: loadAccountsPage },
  { pathname: "/models", load: loadModelsPage },
] as const;
function prefetch(loader: () => Promise<unknown>): void {
  void loader().catch(() => undefined);
}
export function prefetchDeferredPage(pathname: string): void {
  const match = routeLoaders.find((route) => route.matches(pathname));
  if (match) prefetch(match.load);
}
type NavigatorWithConnection = Navigator & {
  connection?: { effectiveType?: string; saveData?: boolean };
};

function allowsBackgroundPrefetch(): boolean {
  if (typeof navigator === "undefined") return true;
  const connection = (navigator as NavigatorWithConnection).connection;
  if (connection?.saveData) return false;
  return connection?.effectiveType !== "slow-2g" && connection?.effectiveType !== "2g";
}

export function prefetchPrimaryDeferredPages(currentPathname = ""): void {
  if (!allowsBackgroundPrefetch()) return;
  const candidate =
    primaryRoutes.find((route) => route.pathname !== currentPathname) ?? primaryRoutes[0];
  if (candidate) prefetch(candidate.load);
}
export {
  loadAboutSettingsPage,
  loadAccountMaintenanceSettingsPage,
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
  loadQualityGuardPage,
  loadRequestAuditsPage,
  loadRuntimePoliciesSettingsPage,
  loadSettingsPage,
  loadSettingsRouteShell,
  loadVideoGalleryPage,
  loadWebSettingsPage,
};
