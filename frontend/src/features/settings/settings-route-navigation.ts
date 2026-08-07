import {
  FileText,
  GitBranch,
  Globe,
  Hammer,
  Image,
  Info,
  type LucideIcon,
  Network,
  Terminal,
  Users,
} from "lucide-react";

import {
  loadAboutSettingsPage,
  loadAccountMaintenanceSettingsPage,
  loadBuildSettingsPage,
  loadChangelogSettingsPage,
  loadConsoleSettingsPage,
  loadMediaSettingsPage,
  loadNetworkSettingsPage,
  loadRuntimePoliciesSettingsPage,
  loadWebSettingsPage,
} from "@/app/deferred-page-prefetch";

export type SettingsRouteGroup = "providers" | "delivery" | "operations" | "system";

type SettingsRoute = {
  to: string;
  key:
    | "build"
    | "web"
    | "console"
    | "media"
    | "network"
    | "policies"
    | "accounts"
    | "about"
    | "changelog";
  group: SettingsRouteGroup;
  icon: LucideIcon;
  preload: () => Promise<unknown>;
  end: boolean;
  readOnly: boolean;
};

/**
 * Mirrors the upstream runtime-settings hierarchy while keeping independent
 * Media, Network, About, and Changelog destinations.
 */
export const settingsRoutes = [
  {
    to: "/settings/build",
    key: "build",
    group: "providers",
    icon: Hammer,
    preload: loadBuildSettingsPage,
    end: false,
    readOnly: false,
  },
  {
    to: "/settings/web",
    key: "web",
    group: "providers",
    icon: Globe,
    preload: loadWebSettingsPage,
    end: false,
    readOnly: false,
  },
  {
    to: "/settings/console",
    key: "console",
    group: "providers",
    icon: Terminal,
    preload: loadConsoleSettingsPage,
    end: false,
    readOnly: false,
  },
  {
    to: "/settings/media",
    key: "media",
    group: "delivery",
    icon: Image,
    preload: loadMediaSettingsPage,
    end: false,
    readOnly: false,
  },
  {
    to: "/settings/network",
    key: "network",
    group: "delivery",
    icon: Network,
    preload: loadNetworkSettingsPage,
    end: false,
    readOnly: false,
  },
  {
    to: "/settings/policies",
    key: "policies",
    group: "operations",
    icon: GitBranch,
    preload: loadRuntimePoliciesSettingsPage,
    end: false,
    readOnly: false,
  },
  {
    to: "/settings/accounts",
    key: "accounts",
    group: "operations",
    icon: Users,
    preload: loadAccountMaintenanceSettingsPage,
    end: false,
    readOnly: false,
  },
  {
    to: "/settings/about",
    key: "about",
    group: "system",
    icon: Info,
    preload: loadAboutSettingsPage,
    end: false,
    readOnly: true,
  },
  {
    to: "/settings/changelog",
    key: "changelog",
    group: "system",
    icon: FileText,
    preload: loadChangelogSettingsPage,
    end: false,
    readOnly: true,
  },
] as const satisfies readonly SettingsRoute[];

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
