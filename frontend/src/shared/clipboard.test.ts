import { beforeEach, describe, expect, it, vi } from "vitest";

import { copyToClipboard } from "@/shared/clipboard";

let execCommand: ReturnType<typeof vi.fn>;

beforeEach(() => {
  execCommand = vi.fn(() => true);
  Object.defineProperty(globalThis, "isSecureContext", {
    configurable: true,
    value: false,
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });
});

describe("copyToClipboard", () => {
  it("uses the synchronous fallback outside secure contexts", async () => {
    expect(await copyToClipboard("secret")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });
  it("uses the Clipboard API in a secure context", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    expect(await copyToClipboard("value")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("value");
  });
});
