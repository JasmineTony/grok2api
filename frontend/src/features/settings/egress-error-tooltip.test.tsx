import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { EgressErrorTooltip } from "@/features/settings/egress-error-tooltip";

// EgressErrorTooltip 的真实契约（egress-error-tooltip.tsx）：
//   <Tooltip> + <TooltipTrigger asChild> 包裹 span（tabIndex=0、aria-label=message、
//   cursor-help、text-destructive 图标），<TooltipContent> 渲染同一 message。
// 这里集中覆盖键盘可访问性：可聚焦、无鼠标也能展开、错误文案与 aria-label 一致。

function renderTooltip(message: string) {
  return render(
    <TooltipProvider delayDuration={0}>
      <EgressErrorTooltip message={message} />
    </TooltipProvider>,
  );
}

describe("EgressErrorTooltip 键盘可访问性", () => {
  it("触发器可聚焦：带 tabIndex=0 与等值 aria-label，默认不渲染 tooltip", () => {
    renderTooltip("连接被拒绝");

    const trigger = screen.getByLabelText("连接被拒绝");
    expect(trigger).toHaveAttribute("tabindex", "0");
    expect(trigger).toHaveClass("cursor-help", "text-destructive");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("可用 Tab 键聚焦并展开文案，无需鼠标悬停", async () => {
    const user = userEvent.setup();
    renderTooltip("出口节点超时");

    await user.tab();

    const trigger = screen.getByLabelText("出口节点超时");
    expect(trigger).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("出口节点超时");
  });

  it("聚焦后按 Escape 收起，触发器仍保持可聚焦", async () => {
    const user = userEvent.setup();
    renderTooltip("DNS 解析失败");

    await user.tab();
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    expect(screen.getByLabelText("DNS 解析失败")).toHaveAttribute("tabindex", "0");
  });

  it("鼠标悬停同样展开同一文案，且 tooltip 文本与 aria-label 完全一致", async () => {
    const user = userEvent.setup();
    const message = "订阅源同步失败：HTTP 502";
    renderTooltip(message);

    await user.hover(screen.getByLabelText(message));

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(message);
    expect(screen.getByLabelText(message)).toBeInTheDocument();
  });

  it("卸载后不残留 tooltip 容器（无泄漏的 portal 节点）", async () => {
    const user = userEvent.setup();
    const { unmount } = renderTooltip("证书校验失败");

    await user.tab();
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();

    unmount();

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("相同 message 的多个触发器各自独立，互不影响展开状态", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <EgressErrorTooltip message="节点错误 A" />
        <EgressErrorTooltip message="节点错误 B" />
      </TooltipProvider>,
    );

    await user.hover(screen.getByLabelText("节点错误 B"));

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("节点错误 B");
    expect(tooltip).not.toHaveTextContent("节点错误 A");
  });

  it("message 变更时 aria-label 与 tooltip 文案同步更新", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TooltipProvider delayDuration={0}>
        <EgressErrorTooltip message="旧错误" />
      </TooltipProvider>,
    );

    rerender(
      <TooltipProvider delayDuration={0}>
        <EgressErrorTooltip message="新错误" />
      </TooltipProvider>,
    );

    expect(screen.queryByLabelText("旧错误")).not.toBeInTheDocument();
    await user.hover(screen.getByLabelText("新错误"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("新错误");
  });

  it("触发器不劫持点击事件，点击不会抛出也无法打开 Tooltip 之外的 UI", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <TooltipProvider delayDuration={0}>
        <div onClick={onClick} data-testid="host">
          <EgressErrorTooltip message="点击透传" />
        </div>
      </TooltipProvider>,
    );

    await user.click(screen.getByLabelText("点击透传"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
