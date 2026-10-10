import { ShellAccountControl } from "@/app/shell-account-control";
import { ShellBrandLink, ShellGitHubLink } from "@/app/shell-brand";
import { ShellNavigation } from "@/app/shell-navigation";

type ShellSidebarProps = {
  username?: string;
  openSections: Record<string, boolean>;
  onToggleSection: (label: string) => void;
  onNavigate: () => void;
  onOpenPasswordDialog: () => void;
};

/** 桌面侧栏（lg 及以上）：品牌、主导航与账号控制。 */
export function ShellSidebar({
  username,
  openSections,
  onToggleSection,
  onNavigate,
  onOpenPasswordDialog,
}: ShellSidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden h-screen w-[288px] flex-col overflow-hidden bg-sidebar px-4 py-6 lg:flex">
      <div className="flex h-7 shrink-0 items-center justify-between px-2.5">
        <ShellBrandLink />
        <ShellGitHubLink className="size-7 text-muted-foreground [&_svg]:size-[15px]" />
      </div>
      <ShellNavigation
        variant="sidebar"
        openSections={openSections}
        onToggleSection={onToggleSection}
        onNavigate={onNavigate}
      />
      <div className="relative z-10 mt-4 shrink-0 bg-sidebar pt-4">
        <ShellAccountControl username={username} onOpenPasswordDialog={onOpenPasswordDialog} onNavigate={onNavigate} />
      </div>
    </aside>
  );
}
