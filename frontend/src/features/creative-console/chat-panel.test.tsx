import { TooltipProvider } from "@/components/ui/tooltip";
import type { ModelRouteDTO } from "@/entities/model/types";
import { ChatPanel } from "@/features/creative-console/chat-panel";
import type { ChatStreamSnapshot } from "@/features/creative-console/creative-console-api";
import { i18n } from "@/shared/i18n";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ createChatResponse: vi.fn() }));

vi.mock("@/features/creative-console/creative-console-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/creative-console/creative-console-api")>()),
  createChatResponse: apiMock.createChatResponse,
}));

type Deferred = {
  resolve: (snapshot: ChatStreamSnapshot) => void;
  reject: (error: unknown) => void;
  update: (snapshot: ChatStreamSnapshot) => void;
};

function deferred(): Deferred {
  let resolve!: (snapshot: ChatStreamSnapshot) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ChatStreamSnapshot>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  void promise.catch(() => undefined);
  const options: { onUpdate?: (snapshot: ChatStreamSnapshot) => void } = {};
  apiMock.createChatResponse.mockImplementationOnce((input: { onUpdate?: (snapshot: ChatStreamSnapshot) => void }) => {
    options.onUpdate = input.onUpdate;
    return promise;
  });
  return {
    resolve,
    reject,
    update: (snapshot) => options.onUpdate?.(snapshot),
  };
}

function snapshot(text: string): ChatStreamSnapshot {
  return { text, reasoning: "", tools: [] };
}

const modelOptions: ModelRouteDTO[] = [
  { id: "m1", publicId: "grok-4", capability: "chat", provider: "grok_web", upstreamModel: "grok-4" },
] as ModelRouteDTO[];

function renderChat(options: { apiKey?: string; toolbarElement?: HTMLDivElement | null } = {}) {
  const toolbarElement = options.toolbarElement ?? null;
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <ChatPanel
          apiKey={options.apiKey ?? "secret-key"}
          model="grok-4"
          modelOptions={modelOptions}
          onModelChange={vi.fn()}
          storageScope="scope-1"
          toolbarElement={toolbarElement}
        />
      </TooltipProvider>
    </I18nextProvider>,
  );
}

async function sendMessage(text: string): Promise<void> {
  const user = userEvent.setup({ delay: null });
  await user.type(screen.getByPlaceholderText(i18n.t("creativeConsole.chatPlaceholder")), text);
  await user.click(screen.getByRole("button", { name: i18n.t("creativeConsole.send") }));
}

beforeEach(() => {
  window.localStorage.clear();
  apiMock.createChatResponse.mockReset();
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("创作台聊天面板", () => {
  it("空态显示欢迎语，输入为空时发送按钮禁用", () => {
    renderChat();
    expect(screen.getByText(i18n.t("creativeConsole.welcome"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("creativeConsole.send") })).toBeDisabled();
    expect(apiMock.createChatResponse).not.toHaveBeenCalled();
  });

  it("发送后流式渲染，停止生成保留已收到内容并恢复发送按钮", async () => {
    const pending = deferred();
    renderChat();
    await sendMessage("你好");

    expect(screen.getByText("你好")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: i18n.t("creativeConsole.stopGenerating") }).length).toBeGreaterThan(0);
    expect(apiMock.createChatResponse).toHaveBeenCalledTimes(1);

    pending.update(snapshot("第一段"));
    await waitFor(() => expect(screen.getByText("第一段")).toBeInTheDocument());

    pending.update(snapshot("第一段第二段"));
    await waitFor(() => expect(screen.getByText("第一段第二段")).toBeInTheDocument());

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getAllByRole("button", { name: i18n.t("creativeConsole.stopGenerating") })[0]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: i18n.t("creativeConsole.send") })).toBeInTheDocument(),
    );
    expect(screen.getByText("第一段第二段")).toBeInTheDocument();
  });

  it("流式失败展示错误文案并保留已收到的部分内容", async () => {
    const pending = deferred();
    renderChat();
    await sendMessage("你好");
    pending.update(snapshot("半截"));
    await waitFor(() => expect(screen.getByText("半截")).toBeInTheDocument());

    pending.reject(new Error("上游中断"));
    await waitFor(() => expect(screen.getByText("上游中断")).toBeInTheDocument());
    expect(screen.getByText("半截")).toBeInTheDocument();
  });

  it("Enter 发送、Shift+Enter 只换行", async () => {
    deferred();
    renderChat();
    const input = screen.getByPlaceholderText(i18n.t("creativeConsole.chatPlaceholder"));
    fireEvent.change(input, { target: { value: "回车发送" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(apiMock.createChatResponse).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(apiMock.createChatResponse).toHaveBeenCalledTimes(1));
  });

  it("删除带后续轮次的消息需要二次确认，确认后截断后续对话", async () => {
    const first = deferred();
    renderChat();
    await sendMessage("第一条");
    first.resolve(snapshot("回答一"));
    await waitFor(() => expect(screen.getByText("回答一")).toBeInTheDocument());

    const second = deferred();
    await sendMessage("第二条");
    second.resolve(snapshot("回答二"));
    await waitFor(() => expect(screen.getByText("回答二")).toBeInTheDocument());

    const user = userEvent.setup({ delay: null });
    const deleteButtons = screen.getAllByRole("button", { name: i18n.t("creativeConsole.deleteMessage") });
    await user.click(deleteButtons[0]);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(i18n.t("creativeConsole.deleteMessageConfirmTitle"))).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: i18n.t("creativeConsole.deleteMessage") }));

    await waitFor(() => expect(screen.queryByText("第一条")).not.toBeInTheDocument());
    expect(screen.queryByText("回答一")).not.toBeInTheDocument();
  });

  it("恢复本地历史会话并可以重新生成（保留后续轮次时先确认）", async () => {
    window.localStorage.setItem(
      "grok2api:creative-console:chat-history:scope-1",
      JSON.stringify([
        {
          id: "session-1",
          title: "历史会话",
          createdAt: 1,
          updatedAt: 2,
          model: "grok-4",
          promptCacheKey: "cache-1",
          reasoningEffort: "auto",
          webSearch: false,
          xSearch: false,
          messages: [
            { id: "u1", role: "user", content: "历史提问" },
            { id: "a1", role: "assistant", content: "历史回答" },
          ],
        },
      ]),
    );

    renderChat();
    expect(screen.getByText("历史提问")).toBeInTheDocument();
    expect(screen.getByText("历史回答")).toBeInTheDocument();

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getAllByRole("button", { name: i18n.t("creativeConsole.editMessage") })[1]);
    const editArea = screen.getByRole("textbox", { name: i18n.t("creativeConsole.editMessage") });
    await user.clear(editArea);
    await user.type(editArea, "本地改写的回答");
    await user.click(screen.getByRole("button", { name: i18n.t("creativeConsole.saveEdit") }));

    await waitFor(() => expect(screen.getByText("本地改写的回答")).toBeInTheDocument());
    expect(apiMock.createChatResponse).not.toHaveBeenCalled();
  });

  it("缺少密钥时重新生成不会发起请求", async () => {
    window.localStorage.setItem(
      "grok2api:creative-console:chat-history:scope-1",
      JSON.stringify([
        {
          id: "session-1",
          title: "历史会话",
          createdAt: 1,
          updatedAt: 2,
          model: "grok-4",
          promptCacheKey: "cache-1",
          reasoningEffort: "auto",
          webSearch: false,
          xSearch: false,
          messages: [
            { id: "u1", role: "user", content: "历史提问" },
            { id: "a1", role: "assistant", content: "历史回答" },
          ],
        },
      ]),
    );

    renderChat({ apiKey: "" });
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: i18n.t("creativeConsole.regenerate") }));
    expect(apiMock.createChatResponse).not.toHaveBeenCalled();
  });

  it("工具栏的新会话与清空会话按钮挂在外部插槽上", async () => {
    const toolbarElement = document.createElement("div");
    document.body.append(toolbarElement);
    const pending = deferred();
    renderChat({ toolbarElement });
    await sendMessage("待清空");
    pending.resolve(snapshot("已完成"));
    await waitFor(() => expect(screen.getByText("已完成")).toBeInTheDocument());

    const user = userEvent.setup({ delay: null });
    const clearButton = within(toolbarElement).getByRole("button", { name: i18n.t("creativeConsole.clearCurrent") });
    await user.click(clearButton);

    await waitFor(() => expect(screen.queryByText("待清空")).not.toBeInTheDocument());
    expect(screen.getByText(i18n.t("creativeConsole.welcome"))).toBeInTheDocument();

    const newButton = within(toolbarElement).getByRole("button", { name: i18n.t("creativeConsole.newConversation") });
    expect(newButton).toBeEnabled();
  });
});
