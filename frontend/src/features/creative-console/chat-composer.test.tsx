import { TooltipProvider } from "@/components/ui/tooltip";
import type { ModelRouteDTO } from "@/entities/model/types";
import { ChatComposer } from "@/features/creative-console/chat-composer";
import type { CreativeChatController } from "@/features/creative-console/use-creative-chat";
import { i18n } from "@/shared/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

const modelOptions: ModelRouteDTO[] = [
  { id: "m1", publicId: "grok-4", capability: "chat", provider: "grok_web", upstreamModel: "grok-4" },
  { id: "m2", publicId: "grok-4.20-reasoning", capability: "chat", provider: "grok_console", upstreamModel: "grok-4" },
] as ModelRouteDTO[];

function createController(overrides: Partial<CreativeChatController> = {}): CreativeChatController {
  return {
    prompt: "",
    setPrompt: vi.fn(),
    handlePromptKeyDown: vi.fn(),
    streamError: "",
    isStreaming: false,
    stopGenerating: vi.fn(),
    canSubmit: false,
    submit: vi.fn(),
    model: "grok-4",
    modelOptions,
    onModelChange: vi.fn(),
    webSearch: false,
    setWebSearch: vi.fn(),
    xSearch: false,
    setXSearch: vi.fn(),
    reasoningEffort: "auto",
    setReasoningEffort: vi.fn(),
    reasoningEffortOptions: ["auto", "none", "high"],
    fixedReasoningModel: false,
    ...overrides,
  } as unknown as CreativeChatController;
}

function renderComposer(controller: CreativeChatController) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <ChatComposer controller={controller} />
      </TooltipProvider>
    </I18nextProvider>,
  );
}

/** Radix Select 会把候选值同步到隐藏的原生 select，jsdom 下用它驱动 onValueChange（表单提交路径）。 */
function changeHiddenSelect(container: HTMLElement, index: number, value: string): void {
  const select = container.querySelectorAll("select")[index];
  if (!select) throw new Error(`未找到第 ${index} 个原生 select`);
  fireEvent.change(select, { target: { value } });
}

function promptBox(): HTMLElement {
  return screen.getByPlaceholderText(i18n.t("creativeConsole.chatPlaceholder"));
}

function sendButton(): HTMLElement {
  return screen.getByRole("button", { name: i18n.t("creativeConsole.send") });
}

describe("聊天输入区", () => {
  it("没有输入时发送按钮禁用，流式错误按接口文案展示", () => {
    renderComposer(createController({ streamError: "上游中断" }));

    expect(sendButton()).toBeDisabled();
    expect(screen.getByText("上游中断")).toBeInTheDocument();
  });

  it("输入与按键事件回到控制器，可提交时才允许提交表单", async () => {
    const controller = createController({ canSubmit: true });
    const { container } = renderComposer(controller);

    const user = userEvent.setup({ delay: null });
    await user.type(promptBox(), "你好");
    expect(controller.setPrompt).toHaveBeenCalled();

    fireEvent.keyDown(promptBox(), { key: "Enter" });
    expect(controller.handlePromptKeyDown).toHaveBeenLastCalledWith(expect.objectContaining({ key: "Enter" }));

    expect(sendButton()).toBeEnabled();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(controller.submit).toHaveBeenCalledTimes(1);
  });

  it("流式生成中把发送换成停止，点击后终止生成", async () => {
    const controller = createController({ isStreaming: true, canSubmit: true });
    renderComposer(controller);

    expect(screen.queryByRole("button", { name: i18n.t("creativeConsole.send") })).not.toBeInTheDocument();
    const stopButton = screen.getByRole("button", { name: i18n.t("creativeConsole.stopGenerating") });

    const user = userEvent.setup({ delay: null });
    await user.click(stopButton);
    expect(controller.stopGenerating).toHaveBeenCalledTimes(1);
    expect(controller.submit).not.toHaveBeenCalled();
  });

  it("切换模型会回传所选模型", () => {
    const controller = createController();
    const { container } = renderComposer(controller);

    changeHiddenSelect(container, 0, "grok-4.20-reasoning");
    expect(controller.onModelChange).toHaveBeenCalledWith("grok-4.20-reasoning");
  });

  it("网页搜索与 X 搜索开关按开关值回传布尔", () => {
    const off = createController();
    const offView = renderComposer(off);

    changeHiddenSelect(offView.container, 1, "on");
    expect(off.setWebSearch).toHaveBeenCalledWith(true);

    const on = createController({ webSearch: true, xSearch: true });
    const onView = renderComposer(on);

    changeHiddenSelect(onView.container, 1, "off");
    expect(on.setWebSearch).toHaveBeenCalledWith(false);

    changeHiddenSelect(onView.container, 2, "off");
    expect(on.setXSearch).toHaveBeenCalledWith(false);
  });

  it("推理强度选择回传所选等级，未选等级时按钮不高亮", () => {
    const controller = createController();
    const { container } = renderComposer(controller);

    changeHiddenSelect(container, 3, "high");
    expect(controller.setReasoningEffort).toHaveBeenCalledWith("high");

    const active = createController({ reasoningEffort: "high" });
    renderComposer(active);
    expect(
      screen.getAllByRole("combobox", {
        name: `${i18n.t("creativeConsole.reasoningEffort")}: ${i18n.t("creativeConsole.reasoning.high")}`,
      }).length,
    ).toBeGreaterThan(0);
  });

  it("固定推理模型下推理强度不可选，开关仍可切换", () => {
    const controller = createController({ fixedReasoningModel: true });
    const { container } = renderComposer(controller);

    expect(
      screen.getByRole("combobox", {
        name: `${i18n.t("creativeConsole.reasoningEffort")}: ${i18n.t("creativeConsole.reasoning.auto")}`,
      }),
    ).toBeDisabled();
    expect(container.querySelectorAll("select")).toHaveLength(4);

    changeHiddenSelect(container, 1, "on");
    expect(controller.setWebSearch).toHaveBeenCalledWith(true);
  });
});
