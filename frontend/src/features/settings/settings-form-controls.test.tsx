import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ByteSizeInput, DurationInput, SettingsField } from "@/features/settings/settings-form-layout";
import { SettingsPageHeader } from "@/features/settings/settings-page-tabs";
import type { ByteSizeValue, DurationValue } from "@/features/settings/settings-units";
import { i18n } from "@/shared/i18n";

// 设置页外壳与共享表单控件的组件测试：直接驱动导出的 SettingsPageHeader / SettingsField /
// ByteSizeInput / DurationInput，用受控 props 覆盖设置页集成测试难以稳定进入的分支
// （保存进行中、缺省说明文本、单位切换的数值回落）。断言针对用户可见结果与真实状态变化。

function renderControl(node: ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={0}>{node}</TooltipProvider>
    </I18nextProvider>,
  );
}

/** Radix Select 触发器在 jsdom 下用键盘打开弹层，再用 click 命中选项。 */
async function chooseRadixOption(trigger: HTMLElement, optionLabel: string): Promise<void> {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: optionLabel }));
}

function ByteSizeHarness({ initial }: { initial?: ByteSizeValue }) {
  const [value, setValue] = useState<ByteSizeValue | undefined>(initial);
  return <ByteSizeInput id="byte-size" value={value} onChange={setValue} />;
}

function DurationHarness({ initial }: { initial?: DurationValue }) {
  const [value, setValue] = useState<DurationValue | undefined>(initial);
  return <DurationInput id="duration" value={value} onChange={setValue} />;
}

beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("设置页外壳", () => {
  it("保存进行中时顶部保存按钮展示加载状态且仍可提交", () => {
    renderControl(<SettingsPageHeader disabled={false} pending onReset={() => undefined} />);
    const save = screen.getByTestId("settings-save");

    expect(within(save).getByRole("status")).toBeInTheDocument();
    expect(save).toBeEnabled();
  });

  it("重置按钮把重置意图交给父级", async () => {
    const onReset = vi.fn();
    const user = userEvent.setup();
    renderControl(<SettingsPageHeader disabled={false} pending={false} onReset={onReset} />);

    await user.click(screen.getByTestId("settings-reset"));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("禁用态下保存与重置都不可点击", () => {
    renderControl(<SettingsPageHeader disabled pending={false} onReset={() => undefined} />);

    expect(screen.getByTestId("settings-save")).toBeDisabled();
    expect(screen.getByTestId("settings-reset")).toBeDisabled();
  });
});

describe("设置字段布局", () => {
  it("未提供说明与错误时不渲染说明段落", () => {
    renderControl(
      <SettingsField controlId="plain" label="纯字段">
        <Input id="plain" />
      </SettingsField>,
    );
    const field = screen.getByTestId("settings-field-plain");

    expect(within(field).getByText("纯字段")).toBeInTheDocument();
    expect(within(field).queryAllByRole("paragraph")).toHaveLength(0);
  });

  it("提供说明与错误时分别展示文案", () => {
    renderControl(
      <SettingsField controlId="described" label="带说明字段" description="字段说明" error="字段错误">
        <Input id="described" />
      </SettingsField>,
    );
    const field = screen.getByTestId("settings-field-described");

    expect(within(field).getByText("字段说明")).toBeInTheDocument();
    expect(within(field).getByText(i18n.t("settings.invalidValue"))).toBeInTheDocument();
  });
});

describe("字节大小输入", () => {
  it("填写数值会以当前单位写回表单", () => {
    renderControl(<ByteSizeHarness initial={{ value: 2, unit: "MiB" }} />);
    const input = screen.getByRole("spinbutton");

    fireEvent.change(input, { target: { value: "5" } });

    expect(input).toHaveValue(5);
    expect(screen.getByRole("combobox", { name: i18n.t("settings.media.sizeUnit") })).toHaveTextContent("MiB");
  });

  it("切换单位时保留已填写数值", async () => {
    renderControl(<ByteSizeHarness initial={{ value: 2, unit: "MiB" }} />);
    const unit = screen.getByRole("combobox", { name: i18n.t("settings.media.sizeUnit") });

    await chooseRadixOption(unit, "GiB");

    expect(unit).toHaveTextContent("GiB");
    expect(screen.getByRole("spinbutton")).toHaveValue(2);
  });

  it("未填写数值时切换单位写入默认值 1", async () => {
    renderControl(<ByteSizeHarness />);
    const unit = screen.getByRole("combobox", { name: i18n.t("settings.media.sizeUnit") });

    await chooseRadixOption(unit, "GiB");

    expect(unit).toHaveTextContent("GiB");
    expect(screen.getByRole("spinbutton")).toHaveValue(1);
  });
});

describe("时长输入", () => {
  it("切换单位时保留已填写数值", async () => {
    renderControl(<DurationHarness initial={{ value: 30, unit: "s" }} />);
    const unit = screen.getByRole("combobox", { name: i18n.t("settings.durationUnit") });

    await chooseRadixOption(unit, i18n.t("settings.units.hours"));

    expect(unit).toHaveTextContent(i18n.t("settings.units.hours"));
    expect(screen.getByRole("spinbutton")).toHaveValue(30);
  });

  it("未填写数值时切换单位写入默认值 1", async () => {
    renderControl(<DurationHarness />);
    const unit = screen.getByRole("combobox", { name: i18n.t("settings.durationUnit") });

    await chooseRadixOption(unit, i18n.t("settings.units.minutes"));

    expect(unit).toHaveTextContent(i18n.t("settings.units.minutes"));
    expect(screen.getByRole("spinbutton")).toHaveValue(1);
  });
});
