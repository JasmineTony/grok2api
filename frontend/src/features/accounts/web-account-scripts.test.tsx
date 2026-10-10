import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { WebAccountScriptsDialog } from "@/features/accounts/web-account-scripts";
import { i18n } from "@/shared/i18n";

// Grok Web 协议脚本弹窗测试（AGENTS.md TEST-1/TEST-3）：
// 上一轮记录该文件在 jsdom 下无法驱动 Radix Checkbox，本轮用真实事件序列验证可驱动性并覆盖全部动作组合。

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

function renderScripts(overrides: Partial<Parameters<typeof WebAccountScriptsDialog>[0]> = {}) {
  const props = {
    targets: "all" as readonly string[] | "all",
    pending: false,
    progress: null,
    onClose: vi.fn(),
    onRun: vi.fn(),
    ...overrides,
  };
  const user = userEvent.setup();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={0}>
        <WebAccountScriptsDialog {...props} />
      </TooltipProvider>
    </I18nextProvider>,
  );
  return { ...view, user, props };
}

/** 按可见标签定位动作复选框（Radix 把可访问名计算为 label 文本，需按索引取）。 */
function actionCheckbox(index: number): HTMLElement {
  const boxes = screen.getAllByRole("checkbox");
  return boxes[index];
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("WebAccountScriptsDialog 动作选择", () => {
  it("全量目标时标题说明全量范围，默认勾选全部动作且可直接运行", async () => {
    const { user, props } = renderScripts();

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(t("webAccountScripts.allTitle", { count: 0 }));
    expect(dialog).toHaveTextContent(t("webAccountScripts.allDescription"));

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(box).toHaveAttribute("data-state", "checked");

    // enableNSFW 开启时生日动作被锁定（disabled），避免用户做出自相矛盾的选择。
    expect(boxes[1]).toBeDisabled();

    await user.click(screen.getByRole("button", { name: t("webAccountScripts.run") }));
    expect(props.onRun).toHaveBeenCalledWith({ acceptTerms: true, setBirthDate: true, enableNSFW: true });
  });

  it("选中目标时标题带数量，且逐个取消动作后运行按钮被禁用", async () => {
    const { user } = renderScripts({ targets: ["acct-1", "acct-2"] });

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(t("webAccountScripts.selectedTitle", { count: 2 }));
    expect(dialog).toHaveTextContent(t("webAccountScripts.selectedDescription"));

    // 先关 NSFW：生日动作保持勾选但同时解锁。
    await user.click(actionCheckbox(2));
    expect(actionCheckbox(2)).toHaveAttribute("data-state", "unchecked");
    expect(actionCheckbox(1)).toHaveAttribute("data-state", "checked");
    expect(actionCheckbox(1)).toBeEnabled();
    expect(screen.getByRole("button", { name: t("webAccountScripts.run") })).toBeEnabled();

    await user.click(actionCheckbox(1));
    expect(actionCheckbox(1)).toHaveAttribute("data-state", "unchecked");
    expect(screen.getByRole("button", { name: t("webAccountScripts.run") })).toBeEnabled();

    await user.click(actionCheckbox(0));
    expect(screen.getByRole("button", { name: t("webAccountScripts.run") })).toBeDisabled();
    expect(screen.getAllByRole("checkbox")[0]).toHaveAttribute("data-state", "unchecked");
  });

  it("重新勾选 NSFW 会同时确保生日动作被选中", async () => {
    const { user, props } = renderScripts();

    await user.click(actionCheckbox(2)); // 关闭 NSFW
    await user.click(actionCheckbox(1)); // 关闭生日
    expect(actionCheckbox(1)).toHaveAttribute("data-state", "unchecked");

    await user.click(actionCheckbox(1)); // 仅保留生日
    await user.click(actionCheckbox(2)); // 重新打开 NSFW
    expect(actionCheckbox(2)).toHaveAttribute("data-state", "checked");
    expect(actionCheckbox(1)).toHaveAttribute("data-state", "checked");

    await user.click(screen.getByRole("button", { name: t("webAccountScripts.run") }));
    expect(props.onRun).toHaveBeenCalledWith({ acceptTerms: true, setBirthDate: true, enableNSFW: true });
  });

  it("进行中禁用全部动作、阻止提交并展示进度", async () => {
    const { user, props } = renderScripts({ pending: true, progress: { completed: 3, total: 9 } });

    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
    await user.click(actionCheckbox(0));
    expect(actionCheckbox(0)).toHaveAttribute("data-state", "checked");

    const run = screen.getByRole("button", { name: /3 \/ 9/ });
    expect(run).toBeDisabled();
    expect(run).toHaveTextContent("3 / 9");
    await user.click(run);
    expect(props.onRun).not.toHaveBeenCalled();
  });

  it("进行中缺少进度时展示通用加载文案", () => {
    renderScripts({ pending: true });

    const run = screen.getByRole("button", { name: new RegExp(t("webAccountScripts.run")) });
    expect(run).toHaveTextContent(t("webAccountScripts.run"));
    expect(within(run).getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("3 / 9")).not.toBeInTheDocument();
  });

  it("取消关闭弹窗回调 onClose", async () => {
    const { user, props } = renderScripts();

    await user.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
  });

  it("三个动作的标签与说明均来自 i18n 且互不相同", () => {
    renderScripts();

    const dialog = screen.getByRole("alertdialog");
    for (const key of [
      "webAccountSettings.acceptTerms",
      "webAccountSettings.setBirthDate",
      "webAccountSettings.enableNSFW",
      "webAccountScripts.acceptTermsDescription",
      "webAccountScripts.setBirthDateDescription",
      "webAccountScripts.enableNSFWDescription",
    ]) {
      expect(dialog).toHaveTextContent(t(key));
    }
  });
});
