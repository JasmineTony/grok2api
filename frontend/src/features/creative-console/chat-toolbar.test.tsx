import { TooltipProvider } from "@/components/ui/tooltip";
import type { ChatSession } from "@/features/creative-console/chat-session-model";
import { ChatToolbar } from "@/features/creative-console/chat-toolbar";
import type { CreativeChatController } from "@/features/creative-console/use-creative-chat";
import { i18n } from "@/shared/i18n";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-1",
    title: "历史会话",
    createdAt: 1,
    updatedAt: Date.UTC(2026, 0, 2, 3, 4),
    model: "grok-4",
    promptCacheKey: "cache-1",
    reasoningEffort: "auto",
    webSearch: false,
    xSearch: false,
    messages: [],
    ...overrides,
  };
}

function createController(overrides: Partial<CreativeChatController> = {}): CreativeChatController {
  return {
    isStreaming: false,
    streamError: "",
    canSubmit: false,
    sessions: [],
    sessionId: "session-1",
    messages: [],
    isPending: false,
    cancel: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    start: vi.fn(),
    startNewConversation: vi.fn(),
    clearConversation: vi.fn(),
    switchConversation: vi.fn(),
    ...overrides,
  } as unknown as CreativeChatController;
}

function renderToolbar(controller: CreativeChatController, toolbarElement: HTMLDivElement | null) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <ChatToolbar controller={controller} toolbarElement={toolbarElement} />
      </TooltipProvider>
    </I18nextProvider>,
  );
}

function createSlot(): HTMLDivElement {
  const slot = document.createElement("div");
  document.body.append(slot);
  return slot;
}

afterEach(() => {
  document.querySelectorAll("body > div:empty").forEach((element) => element.remove());
  vi.restoreAllMocks();
});

describe("聊天工具栏", () => {
  it("没有插槽时不渲染任何工具栏内容", () => {
    const { container } = renderToolbar(createController(), null);
    expect(container).toBeEmptyDOMElement();
  });

  it("新会话按钮始终可用，清空按钮在没有消息或生成中时禁用", async () => {
    const controller = createController();
    const slot = createSlot();
    renderToolbar(controller, slot);

    const newButton = within(slot).getByRole("button", { name: i18n.t("creativeConsole.newConversation") });
    const clearButton = within(slot).getByRole("button", { name: i18n.t("creativeConsole.clearCurrent") });
    expect(newButton).toBeEnabled();
    expect(clearButton).toBeDisabled();

    const user = userEvent.setup({ delay: null });
    await user.click(newButton);
    expect(controller.startNewConversation).toHaveBeenCalledTimes(1);
  });

  it("有消息时清空按钮可用，点击后委托清空会话", async () => {
    const controller = createController({ messages: [{ id: "m1", role: "user", content: "提问" }] });
    const slot = createSlot();
    renderToolbar(controller, slot);

    const user = userEvent.setup({ delay: null });
    await user.click(within(slot).getByRole("button", { name: i18n.t("creativeConsole.clearCurrent") }));
    expect(controller.clearConversation).toHaveBeenCalledTimes(1);
  });

  it("生成中禁用全部会话级操作", async () => {
    const controller = createController({ isStreaming: true, messages: [{ id: "m1", role: "user", content: "提问" }] });
    const slot = createSlot();
    renderToolbar(controller, slot);

    expect(within(slot).getByRole("button", { name: i18n.t("creativeConsole.newConversation") })).toBeDisabled();
    expect(within(slot).getByRole("button", { name: i18n.t("creativeConsole.clearCurrent") })).toBeDisabled();
    expect(within(slot).getByRole("button", { name: i18n.t("creativeConsole.history") })).toBeDisabled();
  });

  it("没有历史会话时下拉显示空态文案", async () => {
    const slot = createSlot();
    renderToolbar(createController({ sessions: [] }), slot);

    const trigger = within(slot).getByRole("button", { name: i18n.t("creativeConsole.history") });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

    expect(await screen.findByText(i18n.t("creativeConsole.noHistory"))).toBeInTheDocument();
  });

  it("历史下拉列出会话标题、模型与时间，点击后切换到该会话", async () => {
    const controller = createController({
      sessions: [
        session({ id: "session-1", title: "当前会话", model: "grok-4" }),
        session({ id: "session-2", title: "更早会话", model: "" }),
      ],
      sessionId: "session-1",
    });
    const slot = createSlot();
    renderToolbar(controller, slot);

    fireEvent.pointerDown(within(slot).getByRole("button", { name: i18n.t("creativeConsole.history") }), {
      button: 0,
      ctrlKey: false,
    });

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("当前会话")).toBeInTheDocument();
    expect(within(menu).getByText("更早会话")).toBeInTheDocument();
    expect(within(menu).getAllByText(i18n.t("creativeConsole.model"), { exact: false }).length).toBeGreaterThan(0);
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);

    const user = userEvent.setup({ delay: null });
    await user.click(within(menu).getByText("更早会话"));
    await waitFor(() => expect(controller.switchConversation).toHaveBeenCalledWith("session-2"));
  });
});
