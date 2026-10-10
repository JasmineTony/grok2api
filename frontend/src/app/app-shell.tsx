import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { ChangePasswordDialog } from "@/app/change-password-dialog";
import { MEDIA_WORKSPACE_PATHS } from "@/app/shell-nav-config";
import { ShellMobileHeader } from "@/app/shell-mobile-header";
import { ShellSidebar } from "@/app/shell-sidebar";
import { useAuth } from "@/shared/auth/use-auth";
import { SiteFooter } from "@/shared/components/site-footer";
import { cn } from "@/shared/lib/cn";

/**
 * 应用外壳：持有抽屉/改密弹窗/文档分组展开状态，
 * 侧栏、移动端顶栏与账号控制均为独立组件。
 */
export function AppShell() {
  const { admin } = useAuth();
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const isMediaWorkspace = MEDIA_WORKSPACE_PATHS.includes(pathname);
  const closeMobileNavigation = (): void => setMobileOpen(false);
  const toggleSection = (label: string): void => {
    setOpenSections((current) => ({ ...current, [label]: !(current[label] ?? false) }));
  };

  return (
    <div className="min-h-screen bg-background">
      <ShellSidebar
        username={admin?.username}
        openSections={openSections}
        onToggleSection={toggleSection}
        onNavigate={closeMobileNavigation}
        onOpenPasswordDialog={() => setPasswordOpen(true)}
      />

      <div className="flex min-h-screen flex-col lg:pl-[288px]">
        <ShellMobileHeader
          open={mobileOpen}
          onOpenChange={setMobileOpen}
          username={admin?.username}
          openSections={openSections}
          onToggleSection={toggleSection}
          onOpenPasswordDialog={() => setPasswordOpen(true)}
        />
        <main
          className={cn(
            "mx-auto w-full max-w-[1280px] flex-1 px-5 sm:px-8",
            isMediaWorkspace ? "pt-8 pb-0 lg:pt-20" : "py-8 lg:py-20",
          )}
        >
          <Outlet />
        </main>
        {!isMediaWorkspace ? <SiteFooter /> : null}
      </div>

      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} username={admin?.username} />
    </div>
  );
}
