import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ShellAccountControl } from "@/app/shell-account-control";
import { ShellBrandLabel, ShellGitHubLink } from "@/app/shell-brand";
import { ShellNavigation } from "@/app/shell-navigation";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type ShellMobileHeaderProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username?: string;
  openSections: Record<string, boolean>;
  onToggleSection: (label: string) => void;
  onOpenPasswordDialog: () => void;
};

/** 移动端顶栏：抽屉导航（主导航 + 账号控制）与 GitHub 入口。 */
export function ShellMobileHeader({
  open,
  onOpenChange,
  username,
  openSections,
  onToggleSection,
  onOpenPasswordDialog,
}: ShellMobileHeaderProps) {
  const { t } = useTranslation();
  const close = (): void => onOpenChange(false);
  return (
    <header className="sticky top-0 z-40 flex h-12 items-center justify-between border-b bg-background px-4 lg:hidden">
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={t("shell.openNavigation")}>
            <Menu className="size-4" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="flex h-dvh max-h-dvh w-72 flex-col gap-0 overflow-hidden bg-sidebar px-3 py-4 [&>button]:right-2 [&>button]:top-3.5 [&>button]:flex [&>button]:size-7 [&>button]:items-center [&>button]:justify-center"
        >
          <SheetHeader className="h-7 shrink-0 px-2.5 text-left">
            <SheetTitle className="flex h-7 items-center text-base">{t("appName")}</SheetTitle>
            <SheetDescription className="sr-only">{t("shell.navigation")}</SheetDescription>
          </SheetHeader>
          <ShellNavigation
            variant="sheet"
            openSections={openSections}
            onToggleSection={onToggleSection}
            onNavigate={close}
          />
          <div className="relative z-10 mt-3 shrink-0 border-t border-sidebar-border/60 bg-sidebar pt-3">
            <ShellAccountControl username={username} onOpenPasswordDialog={onOpenPasswordDialog} onNavigate={close} />
          </div>
        </SheetContent>
      </Sheet>
      <ShellBrandLabel />
      <ShellGitHubLink className="size-8 text-muted-foreground hover:text-foreground" />
    </header>
  );
}
