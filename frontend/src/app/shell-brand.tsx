import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { CurrentVersionLabel } from "@/features/system/version-update";
import { GitHubMark } from "@/shared/components/github-mark";

/** 侧栏品牌入口：应用名 + 当前版本，点击回到仪表盘。 */
export function ShellBrandLink() {
  const { t } = useTranslation();
  return (
    <Link to="/dashboard" className="flex h-7 items-baseline gap-2 text-base font-semibold text-foreground">
      <span>{t("appName")}</span>
      <CurrentVersionLabel />
    </Link>
  );
}

/** 移动端品牌展示：应用名 + 当前版本。 */
export function ShellBrandLabel() {
  const { t } = useTranslation();
  return (
    <span className="flex items-baseline gap-2 text-sm font-semibold">
      <span>{t("appName")}</span>
      <CurrentVersionLabel />
    </span>
  );
}

/** GitHub 入口：侧栏与移动端顶栏共用，仅尺寸/颜色类名不同。 */
export function ShellGitHubLink({ className }: { className: string }) {
  return (
    <Button variant="ghost" size="icon" className={className} asChild>
      <a href="https://github.com/chenyme/grok2api" target="_blank" rel="noreferrer" aria-label="GitHub">
        <GitHubMark />
      </a>
    </Button>
  );
}
