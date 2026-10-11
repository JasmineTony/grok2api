import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copyToClipboard } from "@/shared/clipboard";

// jsdom 不实现 Clipboard API、document.execCommand 与 ClipboardEvent，因此这里显式
// 装上/卸载这三个边界，让 copyToClipboard 的两条路径（异步剪贴板与 execCommand 回退）
// 都能被真实驱动，而不是断言 mock 被调用。
type ClipboardDataStub = { clearData: () => void; setData: (type: string, value: string) => void };

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function setClipboardApi(writeText?: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

function setExecCommand(implementation?: () => boolean): void {
  Object.defineProperty(document, "execCommand", { value: implementation, configurable: true, writable: true });
}

/** 在 execCommand 执行期间派发 copy 事件，复现浏览器的同步复制流程。 */
function dispatchCopyEvent(clipboardData: ClipboardDataStub | null): Event {
  const event = new Event("copy", { cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  document.dispatchEvent(event);
  return event;
}

function temporaryCopyTargets(): NodeListOf<Element> {
  return document.querySelectorAll("body > span[aria-hidden='true']");
}

beforeEach(() => {
  setClipboardApi(undefined);
  setExecCommand(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  } else {
    delete (navigator as { clipboard?: unknown }).clipboard;
  }
  delete (document as { execCommand?: unknown }).execCommand;
});

describe("copyToClipboard 异步剪贴板路径", () => {
  it("安全上下文优先使用 navigator.clipboard.writeText，不触发 execCommand", async () => {
    const writeText = vi.fn(async () => undefined);
    const execCommand = vi.fn(() => true);
    setClipboardApi(writeText);
    setExecCommand(execCommand);
    vi.stubGlobal("isSecureContext", true);

    await expect(copyToClipboard("secure-copy")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("secure-copy");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("异步写入被拒绝时回退到 execCommand 并返回其真实结果", async () => {
    const clipboardData: ClipboardDataStub = { clearData: vi.fn(), setData: vi.fn() };
    setClipboardApi(async () => {
      throw new Error("document is not focused");
    });
    setExecCommand(() => {
      dispatchCopyEvent(clipboardData);
      return true;
    });
    vi.stubGlobal("isSecureContext", true);

    await expect(copyToClipboard("fallback-copy")).resolves.toBe(true);

    expect(clipboardData.setData).toHaveBeenCalledWith("text/plain", "fallback-copy");
  });

  it("非安全上下文即使暴露 navigator.clipboard 也直接走同步回退", async () => {
    const writeText = vi.fn(async () => undefined);
    const execCommand = vi.fn(() => true);
    setClipboardApi(writeText);
    setExecCommand(execCommand);

    await expect(copyToClipboard("plain-http")).resolves.toBe(false);

    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});

describe("copyToClipboard 的 execCommand 回退", () => {
  it("在 copy 事件上写入 text/plain、阻止默认行为并清理临时节点", async () => {
    const clipboardData: ClipboardDataStub = { clearData: vi.fn(), setData: vi.fn() };
    let copyEvent: Event | null = null;
    setExecCommand(() => {
      copyEvent = dispatchCopyEvent(clipboardData);
      return true;
    });

    await expect(copyToClipboard("payload")).resolves.toBe(true);

    expect(clipboardData.clearData).toHaveBeenCalledTimes(1);
    expect(clipboardData.setData).toHaveBeenCalledWith("text/plain", "payload");
    expect((copyEvent as Event | null)?.defaultPrevented).toBe(true);
    expect(temporaryCopyTargets()).toHaveLength(0);
  });

  it("copy 事件缺少 clipboardData 时不写入数据并返回 false", async () => {
    let copyEvent: Event | null = null;
    setExecCommand(() => {
      copyEvent = dispatchCopyEvent(null);
      return true;
    });

    await expect(copyToClipboard("no-clipboard-data")).resolves.toBe(false);

    expect((copyEvent as Event | null)?.defaultPrevented).toBe(false);
    expect(temporaryCopyTargets()).toHaveLength(0);
  });

  it("execCommand 抛错时返回 false 且不残留临时节点", async () => {
    setExecCommand(() => {
      throw new Error("execCommand is restricted");
    });

    await expect(copyToClipboard("throwing")).resolves.toBe(false);

    expect(temporaryCopyTargets()).toHaveLength(0);
  });

  it("复制结束后恢复原有选区", async () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "已选中的文本";
    const trigger = document.createElement("button");
    trigger.textContent = "触发复制";
    document.body.append(paragraph, trigger);
    trigger.focus();
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection?.removeAllRanges();
    selection?.addRange(range);

    setExecCommand(() => true);

    await expect(copyToClipboard("restore-selection")).resolves.toBe(false);

    expect(document.getSelection()?.toString()).toBe("已选中的文本");

    paragraph.remove();
    trigger.remove();
  });

  it("复制结束后把焦点还给复制前的元素", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "触发复制";
    document.body.append(trigger);
    trigger.focus();
    const focusStealer = document.createElement("input");

    setExecCommand(() => {
      // 模拟聚焦弹窗在复制过程中抢走焦点。
      document.body.append(focusStealer);
      focusStealer.focus();
      return true;
    });

    await expect(copyToClipboard("restore-focus")).resolves.toBe(false);

    expect(document.activeElement).toBe(trigger);

    trigger.remove();
    focusStealer.remove();
  });

  it("缺少 document.body 时直接返回 false 且不触碰 DOM", async () => {
    const bodyDescriptor = Object.getOwnPropertyDescriptor(document, "body");
    Object.defineProperty(document, "body", { value: null, configurable: true });
    try {
      await expect(copyToClipboard("no-body")).resolves.toBe(false);
      expect(temporaryCopyTargets()).toHaveLength(0);
    } finally {
      if (bodyDescriptor) {
        Object.defineProperty(document, "body", bodyDescriptor);
      } else {
        delete (document as { body?: unknown }).body;
      }
    }
  });
});
