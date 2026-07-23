const loadAccountsPage = () => import("@/features/accounts/accounts-page");
const loadRequestAuditsPage = () => import("@/features/audits/request-audits-page");
const loadClientKeysPage = () => import("@/features/client-keys/client-keys-page");
const loadCreativeConsolePage = () => import("@/features/creative-console/creative-console-page");
const loadDashboardPage = () => import("@/features/dashboard/dashboard-page");
const loadApiDocsPage = () => import("@/features/docs/api-docs-page");
const loadGalleryPage = () => import("@/features/media/gallery-page");
const loadVideoGalleryPage = () => import("@/features/media/video-gallery-page");
const loadModelsPage = () => import("@/features/models/models-page");
const loadSettingsPage = () => import("@/features/settings/settings-page");

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
  { matches: (pathname) => pathname === "/settings", load: loadSettingsPage },
  { matches: (pathname) => pathname.startsWith("/docs/"), load: loadApiDocsPage },
];

const primaryLoaders = [loadDashboardPage, loadAccountsPage, loadModelsPage] as const;

function prefetch(loader: () => Promise<unknown>): void {
  void loader().catch(() => {
    // Navigation retries the import and reports failures through the route boundary.
  });
}

export function prefetchDeferredPage(pathname: string): void {
  const match = routeLoaders.find((route) => route.matches(pathname));
  if (match) prefetch(match.load);
}

export function prefetchPrimaryDeferredPages(): void {
  for (const loader of primaryLoaders) prefetch(loader);
}

export {
  loadAccountsPage,
  loadApiDocsPage,
  loadClientKeysPage,
  loadCreativeConsolePage,
  loadDashboardPage,
  loadGalleryPage,
  loadModelsPage,
  loadRequestAuditsPage,
  loadSettingsPage,
  loadVideoGalleryPage,
};
