import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import { cn } from "@/shared/lib/cn";
import { documentation, navigation, type DocumentationSection, type NavigationItem } from "@/app/shell-nav-config";

export type ShellNavigationVariant = "sidebar" | "sheet";

type ShellNavigationProps = {
  variant: ShellNavigationVariant;
  openSections: Record<string, boolean>;
  onToggleSection: (label: string) => void;
  onNavigate: () => void;
};

const NAV_CLASSES: Record<ShellNavigationVariant, string> = {
  sidebar: "mt-7 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2 pb-2",
  sheet: "mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 pb-2",
};

/** 侧栏与移动端抽屉共用的主导航：业务导航 + 可折叠文档分组。 */
export function ShellNavigation({ variant, openSections, onToggleSection, onNavigate }: ShellNavigationProps) {
  const { t } = useTranslation();
  return (
    <nav className={NAV_CLASSES[variant]} aria-label={t("shell.navigation")}>
      <div className="space-y-1">
        {navigation.map((item) => (
          <NavigationLink key={item.href} item={item} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="mt-7">
        <div className="px-2.5 pb-2 text-xs font-normal text-foreground">{t("nav.docs")}</div>
        <div className="space-y-1">
          {documentation.map((section) => (
            <DocumentationGroup
              key={section.label}
              section={section}
              open={openSections[section.label] ?? false}
              onToggle={() => onToggleSection(section.label)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}

function NavigationLink({ item, onNavigate }: { item: NavigationItem; onNavigate: () => void }) {
  const { t } = useTranslation();
  const { href, label, icon: Icon } = item;
  return (
    <NavLink
      to={href}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group flex h-8 items-center gap-2 rounded-md px-2.5 text-xs font-normal text-muted-foreground transition-colors hover:bg-secondary/55 hover:text-foreground",
          isActive && "bg-secondary/60 text-foreground",
        )
      }
      data-testid={`shell-nav-${href.replace(/^\//, "").replace(/\//g, "-")}`}
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
  );
}

function DocumentationGroup({
  section,
  open,
  onToggle,
  onNavigate,
}: {
  section: DocumentationSection;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const { label, icon: Icon, items } = section;
  return (
    <div>
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-xs font-normal text-muted-foreground transition-colors hover:bg-secondary/55 hover:text-foreground"
        aria-expanded={open}
        onClick={onToggle}
        data-testid={`shell-docs-${label.toLowerCase()}`}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          <Icon className="size-[15px] text-muted-foreground" strokeWidth={1.7} />
        </span>
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown className={cn("size-3 text-muted-foreground transition-transform", !open && "-rotate-90")} />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0",
        )}
        aria-hidden={!open}
        data-testid={`shell-docs-panel-${label.toLowerCase()}`}
      >
        <div className="overflow-hidden">
          <div className="space-y-1 pt-1">
            {items.map((item) => (
              <DocumentationLink key={item.href} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DocumentationLink({
  item,
  onNavigate,
}: {
  item: DocumentationSection["items"][number];
  onNavigate: () => void;
}) {
  return (
    <NavLink
      to={item.href}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group flex h-7 min-w-0 items-center gap-2 rounded-md pl-[38px] pr-2.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/55 hover:text-foreground",
          isActive && "bg-secondary/60 text-foreground",
        )
      }
      data-testid={`shell-docs-link-${item.href.replace(/^\/docs\//, "").replace(/\//g, "-")}`}
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
  );
}
