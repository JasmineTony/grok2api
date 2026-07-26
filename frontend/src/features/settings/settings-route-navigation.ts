import {
  loadMediaSettingsPage,
  loadNetworkSettingsPage,
  loadSettingsPage,
} from "@/app/deferred-page-prefetch";

export const settingsRoutes = [
  { to: "/settings", key: "general", preload: loadSettingsPage, end: true },
  { to: "/settings/media", key: "media", preload: loadMediaSettingsPage, end: false },
  { to: "/settings/network", key: "network", preload: loadNetworkSettingsPage, end: false },
] as const;

export function isSettingsPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export function shouldBlockSettingsNavigation(
  dirty: boolean,
  currentPathname: string,
  nextPathname: string,
): boolean {
  return dirty && isSettingsPath(currentPathname) && !isSettingsPath(nextPathname);
}
