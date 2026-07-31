import {
  loadAboutSettingsPage,
  loadBuildSettingsPage,
  loadChangelogSettingsPage,
  loadConsoleSettingsPage,
  loadMediaSettingsPage,
  loadNetworkSettingsPage,
  loadSettingsPage,
  loadWebSettingsPage,
} from "@/app/deferred-page-prefetch";

export const settingsRoutes = [
  { to: "/settings", key: "general", preload: loadSettingsPage, end: true, readOnly: false },
  {
    to: "/settings/build",
    key: "build",
    preload: loadBuildSettingsPage,
    end: false,
    readOnly: false,
  },
  {
    to: "/settings/web",
    key: "web",
    preload: loadWebSettingsPage,
    end: false,
    readOnly: false,
  },
  {
    to: "/settings/console",
    key: "console",
    preload: loadConsoleSettingsPage,
    end: false,
    readOnly: false,
  },
  {
    to: "/settings/media",
    key: "media",
    preload: loadMediaSettingsPage,
    end: false,
    readOnly: false,
  },
  {
    to: "/settings/network",
    key: "network",
    preload: loadNetworkSettingsPage,
    end: false,
    readOnly: false,
  },
  {
    to: "/settings/about",
    key: "about",
    preload: loadAboutSettingsPage,
    end: false,
    readOnly: true,
  },
  {
    to: "/settings/changelog",
    key: "changelog",
    preload: loadChangelogSettingsPage,
    end: false,
    readOnly: true,
  },
] as const;

export function isSettingsPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export function isReadOnlySettingsPath(pathname: string): boolean {
  return settingsRoutes.some((route) => route.readOnly && route.to === pathname);
}

export function shouldBlockSettingsNavigation(
  dirty: boolean,
  currentPathname: string,
  nextPathname: string,
): boolean {
  return dirty && isSettingsPath(currentPathname) && !isSettingsPath(nextPathname);
}
