import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { AccountDTO } from "@/features/accounts/accounts-api";
import {
  WebAccountSettingsMenu,
  type WebAccountConfirmationAction,
  type WebAccountConfirmationTarget,
} from "@/features/accounts/web-account-settings";
import { i18n } from "@/shared/i18n";

// Web 账号协议动作行菜单（AGENTS.md TEST-1/TEST-3）：三个动作项各自回调自己的 action。

const ACTIONS: readonly WebAccountConfirmationAction[] = ["acceptTerms", "setBirthDate", "enableNSFW"];

function account(overrides: Partial<AccountDTO> = {}): AccountDTO {
  return {
    id: "acct-web",
    provider: "grok_web",
    authType: "oauth",
    name: "web-alpha",
    enabled: true,
    authStatus: "active",
    refreshable: true,
    cloudflareCookieConfigured: false,
    buildSuperEntitled: false,
    buildRouteMode: "auto",
    buildBotFlagged: false,
    refreshFailureCount: 0,
    priority: 1,
    maxConcurrent: 8,
    minimumRemaining: 0,
    failureCount: 0,
    createdAt: "2026-01-02T03:04:05Z",
    quota: {
      type: "free",
      source: "responseModel",
      confidence: "confirmed",
      status: "active",
      used: 1,
      limit: 10,
      remaining: 9,
      usagePercent: 10,
      limitKnown: true,
      observed: true,
      confirmed: true,
    },
    ...overrides,
  };
}

type User = ReturnType<typeof userEvent.setup>;

function renderMenu(onConfirm: (target: WebAccountConfirmationTarget) => void) {
  return render(
    <I18nextProvider i18n={i18n}>
      <DropdownMenu open>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <WebAccountSettingsMenu account={account()} disabled={false} onConfirm={onConfirm} />
        </DropdownMenuContent>
      </DropdownMenu>
    </I18nextProvider>,
  );
}

/** Radix 子菜单在 jsdom 中靠方向键展开；选中后子菜单关闭，因此每个动作各自渲染一次。 */
async function clickAction(user: User, action: WebAccountConfirmationAction): Promise<void> {
  const trigger = await screen.findByRole("menuitem", { name: i18n.t("webAccountSettings.menu") });
  trigger.focus();
  await user.keyboard("{ArrowRight}");
  await user.click(await screen.findByRole("menuitem", { name: i18n.t(`webAccountSettings.${action}`) }));
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("WebAccountSettingsMenu 协议动作", () => {
  it("三个动作项分别回调自己的 action 与所在账号", async () => {
    for (const action of ACTIONS) {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const view = renderMenu(onConfirm);

      await clickAction(user, action);
      expect(onConfirm).toHaveBeenCalledWith({
        account: expect.objectContaining({ id: "acct-web" }),
        action,
      });

      view.unmount();
    }
  });
});
