import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebAccountSettingsDialogs } from "@/features/accounts/web-account-settings";
import type { AccountDTO } from "@/features/accounts/accounts-api";
import { i18n } from "@/shared/i18n";

// Web 账号协议动作确认弹窗的剩余分支（AGENTS.md TEST-1/TEST-3）：
// 覆盖三个动作的标题/说明/确认文案映射、关闭回调的 pending 阻塞，以及缺目标时的禁用与空操作。

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

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

type DialogsProps = Parameters<typeof WebAccountSettingsDialogs>[0];

function renderDialogs(overrides: Partial<DialogsProps> = {}) {
  const props: DialogsProps = {
    confirmationTarget: null,
    confirmationPending: false,
    onConfirmationClose: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  const user = userEvent.setup();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <WebAccountSettingsDialogs {...props} />
    </I18nextProvider>,
  );
  return { ...view, user, props };
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("WebAccountSettingsDialogs 文案映射", () => {
  it("setBirthDate 与 enableNSFW 各自渲染对应标题、说明与确认文案", async () => {
    const birth = renderDialogs({
      confirmationTarget: { account: account(), action: "setBirthDate" },
    });
    let dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(t("webAccountSettings.setBirthDateTitle"));
    expect(dialog).toHaveTextContent(t("webAccountSettings.setBirthDateDescription"));
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: t("webAccountSettings.setBirthDate") })).toBeInTheDocument(),
    );
    birth.unmount();

    renderDialogs({ confirmationTarget: { account: account(), action: "enableNSFW" } });
    dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(t("webAccountSettings.enableNSFWTitle"));
    expect(dialog).toHaveTextContent(t("webAccountSettings.enableNSFWDescription"));
    expect(within(dialog).getByRole("button", { name: t("webAccountSettings.enableNSFW") })).toBeInTheDocument();
  });

  it("无确认目标时不渲染内容，acceptTerms 是缺省文案", async () => {
    const empty = renderDialogs();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    empty.unmount();

    renderDialogs({ confirmationTarget: { account: account(), action: "acceptTerms" } });
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(t("webAccountSettings.acceptTermsTitle"));
    expect(dialog).toHaveTextContent(t("webAccountSettings.acceptTermsDescription"));
  });
});

describe("WebAccountSettingsDialogs 关闭与确认语义", () => {
  it("进行中时取消按钮禁用、点击确认不回调，关闭请求也阻塞", async () => {
    const { user, props } = renderDialogs({
      confirmationTarget: { account: account(), action: "acceptTerms" },
      confirmationPending: true,
    });

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: t("common.cancel") })).toBeDisabled();

    const confirm = within(dialog).getByRole("button", { name: new RegExp(t("webAccountSettings.acceptTerms")) });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onConfirmationClose).not.toHaveBeenCalled();
    // 进行中展示加载指示，而不是重复的动作文案造成误点。
    expect(within(confirm).getByRole("status")).toBeInTheDocument();
  });

  it("空闲时取消触发关闭回调，确认按目标回调", async () => {
    const { user, props } = renderDialogs({
      confirmationTarget: { account: account({ id: "acct-web" }), action: "acceptTerms" },
    });

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(props.onConfirmationClose).toHaveBeenCalledTimes(1));
    expect(props.onConfirm).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: t("webAccountSettings.acceptTerms") }));
    expect(props.onConfirm).toHaveBeenCalledWith({
      account: expect.objectContaining({ id: "acct-web" }),
      action: "acceptTerms",
    });
  });
});
