import { createBrowserRouter, Navigate } from "react-router-dom";

import { AnonymousBoundary, AuthBoundary } from "@/app/auth-boundary";
import {
  DeferredAboutSettingsPage,
  DeferredAccountsPage,
  DeferredApiDocsPage,
  DeferredAppShell,
  DeferredBuildSettingsPage,
  DeferredChangelogSettingsPage,
  DeferredClientKeysPage,
  DeferredConsoleSettingsPage,
  DeferredCreativeConsolePage,
  DeferredDashboardPage,
  DeferredGalleryPage,
  DeferredMediaSettingsPage,
  DeferredModelsPage,
  DeferredNetworkSettingsPage,
  DeferredRequestAuditsPage,
  DeferredSettingsPage,
  DeferredSettingsRouteShell,
  DeferredVideoGalleryPage,
  DeferredWebSettingsPage,
} from "@/app/deferred-pages";
import { RouteErrorBoundary } from "@/app/route-error-boundary";
import { LoginPage } from "@/features/auth/login-page";

export const router = createBrowserRouter([
  {
    element: <AnonymousBoundary />,
    errorElement: <RouteErrorBoundary />,
    children: [{ path: "/login", element: <LoginPage /> }],
  },
  {
    element: <AuthBoundary />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <DeferredAppShell />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: "/dashboard", element: <DeferredDashboardPage /> },
          { path: "/accounts", element: <DeferredAccountsPage /> },
          { path: "/models", element: <DeferredModelsPage /> },
          { path: "/creative-console", element: <DeferredCreativeConsolePage /> },
          { path: "/client-keys", element: <DeferredClientKeysPage /> },
          { path: "/gallery", element: <DeferredGalleryPage /> },
          { path: "/video-gallery", element: <DeferredVideoGalleryPage /> },
          { path: "/request-audits", element: <DeferredRequestAuditsPage /> },
          { path: "/docs", element: <Navigate to="/docs/chat/completions" replace /> },
          { path: "/docs/:category/:endpoint", element: <DeferredApiDocsPage /> },
          {
            path: "/settings",
            element: <DeferredSettingsRouteShell />,
            children: [
              { index: true, element: <DeferredSettingsPage /> },
              { path: "build", element: <DeferredBuildSettingsPage /> },
              { path: "web", element: <DeferredWebSettingsPage /> },
              { path: "console", element: <DeferredConsoleSettingsPage /> },
              { path: "media", element: <DeferredMediaSettingsPage /> },
              { path: "network", element: <DeferredNetworkSettingsPage /> },
              { path: "about", element: <DeferredAboutSettingsPage /> },
              { path: "changelog", element: <DeferredChangelogSettingsPage /> },
            ],
          },
        ],
      },
    ],
  },
  {
    path: "*",
    element: <Navigate to="/dashboard" replace />,
    errorElement: <RouteErrorBoundary />,
  },
]);
