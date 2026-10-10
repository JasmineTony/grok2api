import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatMessageItem, type ChatMessageItemProps } from "@/features/creative-console/chat-message-item";
import type { ConversationMessage } from "@/features/creative-console/chat-session-model";
import { i18n } from "@/shared/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return { id: "m1", role: "assistant", content: "回答正文", ...overrides };
}

function createProps(overrides: Partial<ChatMessageItemProps> = {}): ChatMessageItemProps {
  return {
    message: message(),
    onEditDraftChange: vi.fn(),
    onStartEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onSaveEdit: vi.fn(),
    onEditKeyDown: vi.fn(),
    onRegenerate: vi.fn(),
    onStop: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

function renderItem(overrides: Partial<ChatMessageItemProps> = {}) {
  const props = createProps(overrides);
  const view = render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <ChatMessageItem {...props} />
      </TooltipProvider>
    </I18nextProvider>,
  );
  return { props, ...view };
}

const label = {
  stop: () => i18n.t("creativeConsole.stopGenerating"),
  regenerate: () => i18n.t("creativeConsole.regenerate"),
  edit: () => i18n.t("creativeConsole.editMessage"),
  remove: () => i18n.t("creativeConsole.deleteMessage"),
  save: () => i18n.t("creativeConsole.saveEdit"),
  saveAndRegenerate: () => i18n.t("creativeConsole.saveAndRegenerate"),
  cancel: () => i18n.t("creativeConsole.cancelEdit"),
};

/** 操作按钮用稳定 testid 定位，名称断言由 toHaveAccessibleName 保留。 */
function actionButton(action: "stop" | "regenerate" | "edit-action" | "delete", messageId = "m1"): HTMLElement {
  return screen.getByTestId(`chat-message-${action}-${messageId}`);
}

function queryActionButton(
  action: "stop" | "regenerate" | "edit-action" | "delete",
  messageId = "m1",
): HTMLElement | null {
  return screen.queryByTestId(`chat-message-${action}-${messageId}`);
}

describe("聊天消息项", () => {
  it("用户消息展示正文与修改/删除操作，不带重新生成与推理区", () => {
    renderItem({ message: message({ role: "user", content: "用户提问", reasoning: "不会展示" }) });

    expect(screen.getByText("用户提问")).toBeInTheDocument();
    expect(screen.queryByText("不会展示")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-message-reasoning-m1")).not.toBeInTheDocument();
    expect(actionButton("edit-action")).toHaveAccessibleName(label.edit());
    expect(actionButton("delete")).toHaveAccessibleName(label.remove());
    expect(queryActionButton("regenerate")).not.toBeInTheDocument();
  });

  it("助手消息展示推理过程与工具明细，并按名称与类型给出标签、图标与状态", () => {
    const { container } = renderItem({
      message: message({
        content: "回答正文",
        reasoning: "思考内容",
        tools: [
          { id: "t1", type: "web_search_call", name: "web_search", status: "completed", detail: "查询条件" },
          { id: "t2", type: "x_search_call", name: "x_search", status: "failed", detail: "" },
          { id: "t3", type: "custom_tool", name: "custom_tool", status: "in_progress", detail: "" },
        ],
      }),
    });

    expect(screen.getByTestId("chat-message-reasoning-m1")).toHaveTextContent(
      i18n.t("creativeConsole.thinkingProcess"),
    );
    expect(screen.getByText("思考内容")).toBeInTheDocument();

    const toolCallPrefix = i18n.t("creativeConsole.toolCall");
    expect(screen.getByTestId("chat-tool-activity-t1")).toHaveTextContent(
      new RegExp(`${toolCallPrefix} · ${i18n.t("creativeConsole.toolNames.webSearch")}`),
    );
    expect(screen.getByTestId("chat-tool-activity-t2")).toHaveTextContent(
      new RegExp(`${toolCallPrefix} · ${i18n.t("creativeConsole.toolNames.xSearch")}`),
    );
    expect(screen.getByTestId("chat-tool-activity-t3")).toHaveTextContent(
      new RegExp(`${toolCallPrefix} · custom_tool`),
    );
    expect(screen.getByTestId("chat-tool-activity-t1")).toHaveTextContent(
      i18n.t("creativeConsole.toolStatus.completed"),
    );
    expect(screen.getByTestId("chat-tool-activity-t2")).toHaveTextContent(i18n.t("creativeConsole.toolStatus.failed"));
    expect(screen.getByTestId("chat-tool-activity-t3")).toHaveTextContent(
      i18n.t("creativeConsole.toolStatus.in_progress"),
    );
    expect(screen.getByTitle("查询条件")).toBeInTheDocument();
    expect(
      container.querySelectorAll("svg.lucide-globe, svg.lucide-loader-circle, svg.lucide-triangle-alert").length,
    ).toBeGreaterThan(0);
  });

  it("流式生成中显示占位文案、允许停止与重新生成，隐藏修改与删除", async () => {
    const { props } = renderItem({ loading: true });

    expect(screen.getByTestId("chat-message-streaming-m1")).toHaveTextContent(i18n.t("creativeConsole.streaming"));
    expect(queryActionButton("edit-action")).not.toBeInTheDocument();
    expect(queryActionButton("delete")).not.toBeInTheDocument();
    expect(actionButton("regenerate")).toHaveAccessibleName(label.regenerate());

    const user = userEvent.setup({ delay: null });
    await user.click(actionButton("regenerate"));
    expect(props.onRegenerate).toHaveBeenCalledTimes(1);
    await user.click(actionButton("stop"));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });
  it("助手消息正文为空时不渲染正文区，仅保留操作", () => {
    const { container } = renderItem({ message: message({ content: "" }) });
    expect(container.textContent).toBe("");
    expect(actionButton("regenerate")).toBeInTheDocument();
  });

  it("忙时（其它消息在生成）隐藏全部操作按钮", () => {
    renderItem({ busy: true });
    expect(queryActionButton("regenerate")).not.toBeInTheDocument();
    expect(queryActionButton("edit-action")).not.toBeInTheDocument();
    expect(queryActionButton("delete")).not.toBeInTheDocument();
  });

  it("点击操作按钮分别回调修改、重新生成与删除", async () => {
    const { props } = renderItem();
    const user = userEvent.setup({ delay: null });

    await user.click(actionButton("edit-action"));
    expect(props.onStartEdit).toHaveBeenCalledTimes(1);

    await user.click(actionButton("regenerate"));
    expect(props.onRegenerate).toHaveBeenCalledTimes(1);

    await user.click(actionButton("delete"));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(props.onEditDraftChange).not.toHaveBeenCalled();
  });

  it("用户消息编辑态显示保存并重新生成，草稿为空时禁止保存", async () => {
    const { props } = renderItem({
      message: message({ role: "user", content: "用户提问" }),
      editing: true,
      editDraft: "   ",
    });

    expect(queryActionButton("edit-action")).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t("creativeConsole.localEditNote"))).not.toBeInTheDocument();
    const save = screen.getByTestId("chat-message-edit-save-m1");
    expect(save).toHaveAccessibleName(label.saveAndRegenerate());
    expect(save).toBeDisabled();

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByTestId("chat-message-edit-cancel-m1"));
    expect(props.onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("助手消息编辑态显示本地编辑提示，草稿变更与快捷键都回调", async () => {
    const { props } = renderItem({ editing: true, editDraft: "草稿正文" });

    expect(screen.getByText(i18n.t("creativeConsole.localEditNote"))).toBeInTheDocument();
    const textarea = screen.getByTestId("chat-message-edit-input-m1");
    expect(textarea).toHaveAccessibleName(i18n.t("creativeConsole.editMessage"));
    expect(textarea).toHaveValue("草稿正文");

    const user = userEvent.setup({ delay: null });
    await user.type(textarea, "追加");
    expect(props.onEditDraftChange).toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(props.onEditKeyDown).toHaveBeenCalled();

    await user.click(screen.getByTestId("chat-message-edit-save-m1"));
    expect(props.onSaveEdit).toHaveBeenCalledTimes(1);
  });
});
