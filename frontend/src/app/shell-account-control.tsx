import { KeyRound, Languages, LogOut, Monitor, Moon, MoreHorizontal, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

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
import { useAuth } from "@/shared/auth/use-auth";
import { cn } from "@/shared/lib/cn";

type ShellAccountControlProps = {
  username?: string;
  onOpenPasswordDialog: () => void;
  onNavigate: () => void;
};

/** 账号控制区：用户名、外观/语言/改密/退出菜单与设置入口。 */
export function ShellAccountControl({ username, onOpenPasswordDialog, onNavigate }: ShellAccountControlProps) {
  const { t } = useTranslation();
  return (
    <div className="flex h-9 items-center gap-1 px-2.5">
      <span className="min-w-0 flex-1 truncate text-xs font-normal capitalize text-muted-foreground">{username}</span>
      <ShellAccountMenu onOpenPasswordDialog={onOpenPasswordDialog} />
      <NavLink
        to="/settings"
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/55 hover:text-foreground",
            isActive && "bg-secondary/60 text-foreground",
          )
        }
        aria-label={t("nav.settings")}
        data-testid="shell-settings-link"
      >
        <Settings className="size-4" strokeWidth={1.8} />
      </NavLink>
    </div>
  );
}

function ShellAccountMenu({ onOpenPasswordDialog }: { onOpenPasswordDialog: () => void }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={t("common.actions")}
          data-testid="shell-account-menu"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-56 p-1.5">
        <ThemeMenuItems />
        <LanguageMenuItems />
        <DropdownMenuItem className="h-8" onClick={onOpenPasswordDialog} data-testid="shell-change-password">
          <KeyRound />
          {t("auth.changePassword")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="h-8" onClick={() => void logout()} data-testid="shell-sign-out">
          <LogOut />
          {t("auth.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeMenuItems() {
  const { t } = useTranslation();
  const { setTheme } = useTheme();
  return (
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
  );
}

function LanguageMenuItems() {
  const { t, i18n } = useTranslation();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="h-8">
        <Languages />
        {t("shell.language")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onClick={() => void i18n.changeLanguage("zh-CN")}>简体中文</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void i18n.changeLanguage("en")}>English</DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
