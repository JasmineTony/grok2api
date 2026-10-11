import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { DateTimePicker } from "@/shared/components/date-time-picker";
import { i18n } from "@/shared/i18n";

// jsdom 未实现 ResizeObserver，而 Radix 的 useSize 在 Popover 挂载时直接 new。
// 本文件位于 src/shared，不能反向依赖 features 下的 test-support，故就近定义最小桩。
class ResizeObserverStub {
  observe(): void {
    /* 测试不需要尺寸变化回调 */
  }

  unobserve(): void {
    /* 同上 */
  }

  disconnect(): void {
    /* 同上 */
  }
}

type PickerProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

const user = () => userEvent.setup();

function renderPicker(props: PickerProps) {
  return render(
    <I18nextProvider i18n={i18n}>
      <DateTimePicker {...props} />
    </I18nextProvider>,
  );
}

function createOnChange(): Mock<(value: string) => void> {
  return vi.fn<(value: string) => void>();
}

function committedValues(onChange: Mock<(value: string) => void>): string[] {
  return onChange.mock.calls.map(([value]) => value);
}

/** 打开浮层，返回按 HH/MM/SS 顺序排列的三个时间分段输入框（真实 DOM 元素）。 */
async function openTimeInputs(): Promise<[HTMLInputElement, HTMLInputElement, HTMLInputElement]> {
  await user().click(screen.getByRole("button"));
  const inputs = await screen.findAllByRole("textbox");
  return [inputs[0] as HTMLInputElement, inputs[1] as HTMLInputElement, inputs[2] as HTMLInputElement];
}

beforeEach(async () => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DateTimePicker 触发按钮", () => {
  it("未选时间且无自定义占位时展示默认占位文案", () => {
    renderPicker({ value: "", onChange: createOnChange() });
    expect(screen.getByRole("button")).toHaveTextContent("永不过期");
  });

  it("已选时间时展示格式化时间而非占位文案", () => {
    renderPicker({ value: "2024-03-15T10:20:30", onChange: createOnChange() });
    const trigger = screen.getByRole("button");
    expect(trigger).toHaveTextContent("2024年3月15日 10:20:30");
    expect(trigger).not.toHaveTextContent("永不过期");
  });

  it("支持自定义占位文案与禁用态", () => {
    renderPicker({ value: "", onChange: createOnChange(), placeholder: "自定义占位", disabled: true });
    const trigger = screen.getByRole("button");
    expect(trigger).toHaveTextContent("自定义占位");
    expect(trigger).toBeDisabled();
  });
});

describe("DateTimePicker 时间分段输入", () => {
  it("按 HH/MM/SS 渲染三段输入框并默认 23:59:59", async () => {
    renderPicker({ value: "", onChange: createOnChange() });
    const [hours, minutes, seconds] = await openTimeInputs();

    expect(hours).toHaveAccessibleName(/HH$/);
    expect(minutes).toHaveAccessibleName(/MM$/);
    expect(seconds).toHaveAccessibleName(/SS$/);
    expect(hours).toHaveValue("23");
    expect(minutes).toHaveValue("59");
    expect(seconds).toHaveValue("59");
  });

  it("回车提交时读取三个输入框的当前值", async () => {
    const onChange = createOnChange();
    renderPicker({ value: "", onChange });
    const [hours, minutes, seconds] = await openTimeInputs();

    await user().clear(hours);
    await user().type(hours, "07");
    await user().clear(minutes);
    await user().type(minutes, "08");
    await user().clear(seconds);
    await user().type(seconds, "09");
    await user().type(seconds, "{Enter}");

    const values = committedValues(onChange);
    expect(values.at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}T07:08:09$/);
    // 切换分段焦点时的中间提交只应读到已改动的 07，而不是 defaultValue 的 23。
    for (const value of values) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T07:/);
    }
  });

  it("失焦提交时读取已改动分段并补齐其余分段", async () => {
    const onChange = createOnChange();
    renderPicker({ value: "", onChange });
    const [hours] = await openTimeInputs();

    await user().clear(hours);
    await user().type(hours, "05");
    await user().tab();

    const values = committedValues(onChange);
    expect(values.at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}T05:59:59$/);
  });

  it("选择日期时把输入框时间写入所选日期", async () => {
    const onChange = createOnChange();
    renderPicker({ value: "2024-03-15T10:20:30", onChange });
    const [hours] = await openTimeInputs();

    await user().clear(hours);
    await user().type(hours, "07");

    const dayCell = document.querySelector('[data-day="2024-03-20"]');
    expect(dayCell).not.toBeNull();
    await user().click(within(dayCell as HTMLElement).getByRole("button"));

    const values = committedValues(onChange);
    // 每次提交都必须使用输入框里的 07，而不是 defaultValue 的 10。
    for (const value of values) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T07:20:30$/);
    }
    expect(values.at(-1)).toBe("2024-03-20T07:20:30");
  });

  it("输入框只保留数字且最多两位", async () => {
    renderPicker({ value: "", onChange: createOnChange() });
    const [hours] = await openTimeInputs();

    await user().clear(hours);
    await user().type(hours, "1a2");

    expect(hours).toHaveValue("12");
  });

  it("聚焦时全选内容以便直接覆盖", async () => {
    renderPicker({ value: "", onChange: createOnChange() });
    const [hours] = await openTimeInputs();

    await user().click(hours);

    expect(hours.selectionStart).toBe(0);
    expect(hours.selectionEnd).toBe(hours.value.length);
  });

  it("未选择日期时回车以当前日期补齐默认时间", async () => {
    const onChange = createOnChange();
    renderPicker({ value: "", onChange });
    const [, , seconds] = await openTimeInputs();

    await user().type(seconds, "{Enter}");

    const values = committedValues(onChange);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59$/);
    }
  });
});
