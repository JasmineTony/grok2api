import { Navigate, createBrowserRouter } from "react-router-dom";

import { AnonymousBoundary, AuthBoundary } from "@/app/auth-boundary";
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
import { RouteErrorFallback } from "@/app/route-error-fallback";
import { LoginPage } from "@/features/auth/login-page";

export const router = createBrowserRouter([
  {
    element: <AnonymousBoundary />,
    errorElement: <RouteErrorFallback />,
    children: [{ path: "/login", element: <LoginPage /> }],
  },
  {
    element: <AuthBoundary />,
    errorElement: <RouteErrorFallback />,
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
          { path: "/quality-guard", element: <DeferredQualityGuardPage /> },
          { path: "/docs", element: <Navigate to="/docs/chat/completions" replace /> },
          { path: "/docs/:category/:endpoint", element: <DeferredApiDocsPage /> },
          { path: "/settings", element: <DeferredSettingsPage /> },
        ],
      },
    ],
  },
  // 通配路由同样带 errorElement：未知路径上的元素抛错时必须落到与兄弟路由一致的可恢复界面，
  // 而不是 React Router 自带的英文默认错误页。
  { path: "*", element: <Navigate to="/dashboard" replace />, errorElement: <RouteErrorFallback /> },
]);
