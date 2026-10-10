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

describe("聊天消息项", () => {
  it("用户消息展示正文与修改/删除操作，不带重新生成与推理区", () => {
    renderItem({ message: message({ role: "user", content: "用户提问", reasoning: "不会展示" }) });

    expect(screen.getByText("用户提问")).toBeInTheDocument();
    expect(screen.queryByText("不会展示")).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t("creativeConsole.thinkingProcess"))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: label.edit() })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: label.remove() })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: label.regenerate() })).not.toBeInTheDocument();
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

    expect(screen.getByText(i18n.t("creativeConsole.thinkingProcess"))).toBeInTheDocument();
    expect(screen.getByText("思考内容")).toBeInTheDocument();

    const toolCallPrefix = i18n.t("creativeConsole.toolCall");
    expect(
      screen.getByText(new RegExp(`${toolCallPrefix} · ${i18n.t("creativeConsole.toolNames.webSearch")}`)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${toolCallPrefix} · ${i18n.t("creativeConsole.toolNames.xSearch")}`)),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${toolCallPrefix} · custom_tool`))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("creativeConsole.toolStatus.completed"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("creativeConsole.toolStatus.failed"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("creativeConsole.toolStatus.in_progress"))).toBeInTheDocument();
    expect(screen.getByTitle("查询条件")).toBeInTheDocument();
    expect(
      container.querySelectorAll("svg.lucide-globe, svg.lucide-loader-circle, svg.lucide-triangle-alert").length,
    ).toBeGreaterThan(0);
  });

  it("流式生成中显示占位文案、允许停止与重新生成，隐藏修改与删除", async () => {
    const { props } = renderItem({ loading: true });

    expect(screen.getByText(i18n.t("creativeConsole.streaming"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: label.edit() })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: label.remove() })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: label.regenerate() })).toBeInTheDocument();

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: label.regenerate() }));
    expect(props.onRegenerate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: label.stop() }));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });
  it("助手消息正文为空时不渲染正文区，仅保留操作", () => {
    const { container } = renderItem({ message: message({ content: "" }) });
    expect(container.textContent).toBe("");
    expect(screen.getByRole("button", { name: label.regenerate() })).toBeInTheDocument();
  });

  it("忙时（其它消息在生成）隐藏全部操作按钮", () => {
    renderItem({ busy: true });
    expect(screen.queryByRole("button", { name: label.regenerate() })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: label.edit() })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: label.remove() })).not.toBeInTheDocument();
  });

  it("点击操作按钮分别回调修改、重新生成与删除", async () => {
    const { props } = renderItem();
    const user = userEvent.setup({ delay: null });

    await user.click(screen.getByRole("button", { name: label.edit() }));
    expect(props.onStartEdit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: label.regenerate() }));
    expect(props.onRegenerate).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: label.remove() }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(props.onEditDraftChange).not.toHaveBeenCalled();
  });

  it("用户消息编辑态显示保存并重新生成，草稿为空时禁止保存", async () => {
    const { props } = renderItem({
      message: message({ role: "user", content: "用户提问" }),
      editing: true,
      editDraft: "   ",
    });

    expect(screen.queryByRole("button", { name: label.edit() })).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t("creativeConsole.localEditNote"))).not.toBeInTheDocument();
    const save = screen.getByRole("button", { name: label.saveAndRegenerate() });
    expect(save).toBeDisabled();

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: label.cancel() }));
    expect(props.onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("助手消息编辑态显示本地编辑提示，草稿变更与快捷键都回调", async () => {
    const { props } = renderItem({ editing: true, editDraft: "草稿正文" });

    expect(screen.getByText(i18n.t("creativeConsole.localEditNote"))).toBeInTheDocument();
    const textarea = screen.getByRole("textbox", { name: i18n.t("creativeConsole.editMessage") });
    expect(textarea).toHaveValue("草稿正文");

    const user = userEvent.setup({ delay: null });
    await user.type(textarea, "追加");
    expect(props.onEditDraftChange).toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(props.onEditKeyDown).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: label.save() }));
    expect(props.onSaveEdit).toHaveBeenCalledTimes(1);
  });
});
