import { ChatTruncateDialog } from "@/features/creative-console/chat-truncate-dialog";
import type { PendingTruncateAction } from "@/features/creative-console/chat-session-model";
import type { CreativeChatController } from "@/features/creative-console/use-creative-chat";
import { i18n } from "@/shared/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

function createController(pendingTruncate: PendingTruncateAction | null): CreativeChatController {
  return {
    pendingTruncate,
    setPendingTruncate: vi.fn(),
    confirmPendingTruncate: vi.fn(),
  } as unknown as CreativeChatController;
}

function renderDialog(pendingTruncate: PendingTruncateAction | null) {
  const controller = createController(pendingTruncate);
  render(
    <I18nextProvider i18n={i18n}>
      <ChatTruncateDialog controller={controller} />
    </I18nextProvider>,
  );
  return controller;
}

describe("聊天截断确认框", () => {
  it("没有待确认动作时不渲染对话框", () => {
    renderDialog(null);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("删除动作展示待删除条数，确认后委托二次确认回调", async () => {
    const controller = renderDialog({ kind: "delete", messageId: "m1", trailingCount: 2 });

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(i18n.t("creativeConsole.deleteMessageConfirmTitle"))).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(i18n.t("creativeConsole.deleteMessageConfirmDescription", { count: 2 }))),
    ).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: i18n.t("creativeConsole.deleteMessage") });
    expect(confirm.className).toContain("bg-destructive");

    const user = userEvent.setup({ delay: null });
    await user.click(confirm);
    expect(controller.confirmPendingTruncate).toHaveBeenCalledTimes(1);
  });

  it("重新生成动作展示说明文案，操作按钮不带破坏性样式", async () => {
    const controller = renderDialog({ kind: "regenerate", messageId: "a1", trailingCount: 1 });

    expect(screen.getByText(i18n.t("creativeConsole.regenerateTruncateTitle"))).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: i18n.t("creativeConsole.regenerate") });
    expect(confirm.className).not.toContain("bg-destructive");

    const user = userEvent.setup({ delay: null });
    await user.click(confirm);
    expect(controller.confirmPendingTruncate).toHaveBeenCalledTimes(1);
  });

  it("编辑用户消息动作展示保存并重新生成的文案", async () => {
    const controller = renderDialog({
      kind: "edit-user",
      messageId: "u1",
      content: "改写后的提问",
      trailingCount: 3,
    });

    expect(screen.getByText(i18n.t("creativeConsole.editUserTruncateTitle"))).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: i18n.t("creativeConsole.saveAndRegenerate") });

    const user = userEvent.setup({ delay: null });
    await user.click(confirm);
    expect(controller.confirmPendingTruncate).toHaveBeenCalledTimes(1);
  });

  it("取消关闭时清空待确认动作", async () => {
    const controller = renderDialog({ kind: "delete", messageId: "m1", trailingCount: 1 });

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: i18n.t("common.cancel") }));

    expect(controller.setPendingTruncate).toHaveBeenCalledWith(null);
    expect(controller.confirmPendingTruncate).not.toHaveBeenCalled();
  });
});
