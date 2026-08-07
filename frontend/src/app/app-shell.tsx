import {
  Box,
  ChevronDown,
  Code2,
  Eye,
  Image,
  KeyRound,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Monitor,
  Moon,
  MoreHorizontal,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  Video,
} from "lucide-react";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { ChangePasswordDialog } from "@/app/change-password-dialog";
import { prefetchDeferredPage, prefetchPrimaryDeferredPages } from "@/app/deferred-page-prefetch";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { CurrentVersionLabel } from "@/entities/system/version-update";
import { NotificationCenter } from "@/features/system/notification-center";
import { useAuthActions, useAuthState } from "@/shared/auth/use-auth";
import { PageScaffold } from "@/shared/components/page-scaffold";
import { SiteFooter } from "@/shared/components/site-footer";
import { cn } from "@/shared/lib/cn";
import { scheduleIdleTask } from "@/shared/lib/idle-task";

const navigation = [
  { href: "/dashboard", label: "nav.dashboard", icon: LayoutDashboard },
  { href: "/accounts", label: "nav.accounts", icon: Users },
  { href: "/client-keys", label: "nav.clientKeys", icon: KeyRound },
  { href: "/models", label: "nav.models", icon: Box },
  { href: "/gallery", label: "nav.gallery", icon: Image },
  { href: "/video-gallery", label: "nav.videoGallery", icon: Video },
  { href: "/request-audits", label: "nav.audits", icon: Eye },
  { href: "/quality-guard", label: "nav.qualityGuard", icon: ShieldCheck },
  { href: "/creative-console", label: "nav.creativeConsole", icon: Sparkles },
] as const;

const documentation = [
  {
    label: "Chat",
    icon: MessageSquareText,
    items: [
      { href: "/docs/chat/completions", label: "Chat Completions", method: "POST" },
      { href: "/docs/chat/responses", label: "Responses", method: "POST" },
      { href: "/docs/chat/messages", label: "Messages", method: "POST" },
    ],
  },
  {
    label: "Image",
    icon: Image,
    items: [
      { href: "/docs/image/generations", label: "Image Generations", method: "POST" },
      { href: "/docs/image/edits", label: "Image Edits", method: "POST" },
    ],
  },
  {
    label: "Video",
    icon: Video,
    items: [
      { href: "/docs/video/generations", label: "Video Generations", method: "POST" },
      { href: "/docs/video/get", label: "Get Video", method: "GET" },
    ],
  },
] as const;

export function AppShell() {
  const { t, i18n } = useTranslation();
  const { admin } = useAuthState();
  const { logout } = useAuthActions();
  const location = useLocation();
  const { setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [documentationOpen, setDocumentationOpen] = useState<Record<string, boolean>>({});
  const isMediaWorkspace = ["/creative-console", "/gallery", "/video-gallery"].includes(
    location.pathname,
  );

  useEffect(
    () => scheduleIdleTask(() => prefetchPrimaryDeferredPages(location.pathname)),
    [location.pathname],
  );

  function navigationLinks(): ReactNode {
    return navigation.map(({ href, label, icon: Icon }) => (
      <NavLink
        key={href}
        to={href}
        onPointerEnter={() => prefetchDeferredPage(href)}
        onFocus={() => prefetchDeferredPage(href)}
        onClick={() => setMobileOpen(false)}
        className={({ isActive }) =>
          cn(
            "group flex h-9 items-center gap-2.5 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-sidebar-border/70 hover:bg-secondary/55 hover:text-foreground",
            isActive && "border-primary/20 bg-primary/10 text-foreground shadow-sm",
          )
        }
      >
        {({ isActive }) => (
          <>
            <span className="flex size-5 shrink-0 items-center justify-center">
              <Icon
                className={cn("size-4 text-muted-foreground", isActive && "text-foreground")}
                fill={isActive ? "currentColor" : "none"}
                fillOpacity={isActive ? 0.14 : 0}
                strokeWidth={1.8}
              />
            </span>
            {t(label)}
          </>
        )}
      </NavLink>
    ));
  }

  function documentationLinks(): ReactNode {
    return documentation.map(({ label, icon: Icon, items }) => {
      const open = documentationOpen[label] ?? false;
      return (
        <div key={label}>
          <button
            type="button"
            className="flex h-9 w-full items-center gap-2.5 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-sidebar-border/70 hover:bg-secondary/55 hover:text-foreground"
            aria-expanded={open}
            onClick={() => setDocumentationOpen((current) => ({ ...current, [label]: !open }))}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              <Icon className="size-[15px] text-muted-foreground" strokeWidth={1.7} />
            </span>
            <span className="flex-1 text-left">{label}</span>
            <ChevronDown
              className={cn(
                "size-3 text-muted-foreground transition-transform",
                !open && "-rotate-90",
              )}
            />
          </button>
          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
              open
                ? "grid-rows-[1fr] opacity-100"
                : "pointer-events-none grid-rows-[0fr] opacity-0",
            )}
            aria-hidden={!open}
            inert={!open}
          >
            <div className="overflow-hidden">
              <div className="space-y-1 pt-1">
                {items.map((item) => (
                  <NavLink
                    key={item.href}
                    to={item.href}
                    onPointerEnter={() => prefetchDeferredPage(item.href)}
                    onFocus={() => prefetchDeferredPage(item.href)}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        "group flex h-8 min-w-0 items-center gap-2 rounded-xl border border-transparent pl-10 pr-3 text-xs text-muted-foreground transition-colors hover:border-sidebar-border/60 hover:bg-secondary/55 hover:text-foreground",
                        isActive && "border-primary/10 bg-primary/10 text-foreground",
                      )
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-[9px] font-medium text-muted-foreground/70",
                        item.method === "GET" && "text-emerald-600 dark:text-emerald-400",
                        item.method === "POST" && "text-sky-600 dark:text-sky-400",
                      )}
                    >
                      {item.method}
                    </span>
                  </NavLink>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    });
  }

  const navigationContent = (
    <nav
      className="mt-7 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2 pb-2"
      aria-label={t("shell.navigation")}
    >
      <div className="space-y-1">{navigationLinks()}</div>
      <div className="mt-7">
        <div className="px-2.5 pb-2 text-xs font-normal text-foreground">{t("nav.docs")}</div>
        <div className="space-y-1">{documentationLinks()}</div>
      </div>
    </nav>
  );

  const accountControl = (
    <div className="flex h-9 items-center gap-1 px-2.5">
      <span className="min-w-0 flex-1 truncate text-xs font-normal capitalize text-muted-foreground">
        {admin?.username}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={t("common.actions")}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-56 p-1.5">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="h-8">
              <Sun />
              {t("shell.appearance")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <Sun />
                {t("shell.light")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <Moon />
                {t("shell.dark")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <Monitor />
                {t("shell.system")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="h-8">
              <Languages />
              {t("shell.language")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => void i18n.changeLanguage("zh-CN")}>
                简体中文
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void i18n.changeLanguage("en")}>
                English
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem className="h-8" onClick={() => setPasswordOpen(true)}>
            <KeyRound />
            {t("auth.changePassword")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="h-8" onClick={() => void logout()}>
            <LogOut />
            {t("auth.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NavLink
        to="/settings"
        onPointerEnter={() => prefetchDeferredPage("/settings")}
        onFocus={() => prefetchDeferredPage("/settings")}
        onClick={() => setMobileOpen(false)}
        className={({ isActive }) =>
          cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/55 hover:text-foreground",
            isActive && "bg-secondary/60 text-foreground",
          )
        }
        aria-label={t("nav.settings")}
      >
        <Settings className="size-4" strokeWidth={1.8} />
      </NavLink>
    </div>
  );

  return (
    <div className="app-canvas min-h-screen bg-background/70">
      <aside className="fixed inset-y-0 left-0 z-30 hidden h-screen w-[240px] flex-col overflow-hidden border-r border-sidebar-border/70 bg-sidebar px-4 py-6 shadow-xl lg:flex xl:w-[288px]">
        <div className="flex h-7 shrink-0 items-center justify-between px-2.5">
          <Link
            to="/dashboard"
            className="group flex h-9 items-center gap-2.5 text-base font-semibold tracking-tight text-foreground"
          >
            <span className="flex size-8 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-sm transition-transform duration-300 group-hover:rotate-6 group-hover:scale-105">
              <Sparkles className="size-4" strokeWidth={1.8} />
            </span>
            <span className="flex items-baseline gap-2">
              <span>{t("appName")}</span>
              <CurrentVersionLabel />
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <NotificationCenter />
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground [&_svg]:size-[15px]"
              asChild
            >
              <a
                href="https://github.com/JasmineTony/grok2api"
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
              >
                <Code2 className="size-4" />
              </a>
            </Button>
          </div>
        </div>
        {navigationContent}
        <div className="relative z-10 mt-4 shrink-0 border-t border-sidebar-border/60 bg-sidebar pt-4">
          {accountControl}
        </div>
      </aside>

      <div className="flex min-h-screen flex-col lg:pl-[240px] xl:pl-[288px]">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border/60 bg-background px-4 lg:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("shell.openNavigation")}
              >
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="flex h-dvh max-h-dvh w-72 flex-col gap-0 overflow-hidden bg-sidebar px-3 py-4 [&>button]:right-2 [&>button]:top-3.5 [&>button]:flex [&>button]:size-7 [&>button]:items-center [&>button]:justify-center [&>nav]:mt-5 [&>nav]:min-h-0 [&>nav]:flex-1 [&>nav]:overflow-y-auto [&>nav]:overscroll-contain [&>nav]:pr-1 [&>nav]:pb-2"
            >
              <SheetHeader className="h-7 shrink-0 px-2.5 text-left">
                <SheetTitle className="flex h-7 items-center text-base">{t("appName")}</SheetTitle>
                <SheetDescription className="sr-only">{t("shell.navigation")}</SheetDescription>
              </SheetHeader>
              {navigationContent}
              <div className="relative z-10 mt-3 shrink-0 bg-sidebar pt-3">{accountControl}</div>
            </SheetContent>
          </Sheet>
          <span className="flex items-baseline gap-2 text-sm font-semibold">
            <span>{t("appName")}</span>
            <CurrentVersionLabel />
          </span>
          <div className="flex items-center gap-1">
            <NotificationCenter />
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              asChild
            >
              <a
                href="https://github.com/JasmineTony/grok2api"
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
              >
                <Code2 className="size-4" />
              </a>
            </Button>
          </div>
        </header>

        <main className="relative flex min-w-0 flex-1">
          <PageScaffold className={isMediaWorkspace ? "pb-0" : undefined}>
            <Outlet />
          </PageScaffold>
        </main>
        {!isMediaWorkspace ? <SiteFooter /> : null}
      </div>

      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        adminUsername={admin?.username}
      />
    </div>
  );
}
