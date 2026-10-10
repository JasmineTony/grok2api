import type { ReactElement } from "react";

import { AccountsDialogHost } from "@/features/accounts/accounts-flow-dialogs";
import { AccountsSummaryPanel } from "@/features/accounts/accounts-summary-panel";
import { AccountsTableSection } from "@/features/accounts/accounts-table";
import { AccountsTabsRow } from "@/features/accounts/accounts-toolbar";
import { useAccountsPageModel } from "@/features/accounts/use-accounts-page-model";

/**
 * 账号页组合入口：列表状态、任务流与弹窗分别由 use-accounts-* 与 accounts-* 模块提供，
 * 这里只保留页面布局、账号池切换与各区块的组合。
 */
export function AccountsPage(): ReactElement {
  const model = useAccountsPageModel();
  const { t, language, summary } = model;
  return (
    <div className="space-y-5">
      <header className="flex min-h-8 items-center">
        <h1 className="text-xl font-medium">{t("accounts.title")}</h1>
        <p className="sr-only">{t("console.accountsDescription")}</p>
      </header>
      <AccountsSummaryPanel
        summary={summary.data}
        loading={summary.isPending}
        unavailable={summary.isError}
        language={language}
      />
      <div className="space-y-5">
        <AccountsTabsRow model={model} />
        <AccountsTableSection model={model} />
      </div>
      <AccountsDialogHost model={model} />
    </div>
  );
}
