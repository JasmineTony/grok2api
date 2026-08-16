import { describe, expect, it } from "vitest";

import {
  createConversionInput,
  createQuickImportFile,
  decodeImportFileBytes,
  deriveAccountOverview,
  readQuickImportFile,
} from "@/features/accounts/account-page-utils";

const summary = {
  total: 3,
  available: 2,
  recovering: 1,
  attention: 1,
  risk: 1,
  providers: {
    grok_build: { total: 2, available: 1 },
    grok_web: { total: 1, available: 1 },
    grok_console: { total: 0, available: 0 },
  },
  recovery: { cooldown: 1, waitingReset: 0, probing: 0 },
  issues: { disabled: 0, reauthRequired: 0 },
} as const;

describe("account page utilities", () => {
  it("creates provider-specific quick import files and rejects empty input", () => {
    expect(createQuickImportFile("  ", "grok_web")).toBeNull();
    const file = createQuickImportFile("token", "grok_console");
    expect(file?.name).toBe("grok-console-sso-tokens.txt");
    expect(file?.type).toBe("text/plain");
  });

  it("reads bounded files and rejects oversized imports", async () => {
    await expect(readQuickImportFile(new File(["token"], "tokens.txt"))).resolves.toBe("token");
    const oversized = {
      size: 30 * 1024 * 1024 + 1,
      text: () => Promise.resolve(""),
    } as File;
    await expect(readQuickImportFile(oversized)).rejects.toThrow(RangeError);
  });

  it("decodes quick import files across BOM and GBK encodings", async () => {
    const utf8Bytes = (text: string) => new TextEncoder().encode(text);

    expect(decodeImportFileBytes(utf8Bytes("token-123\n中文备注").buffer)).toBe(
      "token-123\n中文备注",
    );

    expect(
      decodeImportFileBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8Bytes("token")]).buffer),
    ).toBe("token");

    const utf16le = new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65, 0x0a, 0x00]);
    expect(decodeImportFileBytes(utf16le.buffer)).toBe("中文\n");

    const utf16be = new Uint8Array([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87, 0x00, 0x0a]);
    expect(decodeImportFileBytes(utf16be.buffer)).toBe("中文\n");

    // GBK bytes for "中文" (0xD6D0 0xCEC4) followed by an ASCII token line.
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0x0a, 0x74, 0x6f, 0x6b, 0x65, 0x6e]);
    expect(decodeImportFileBytes(gbk.buffer)).toBe("中文\ntoken");

    await expect(readQuickImportFile(new File([gbk], "tokens.txt"))).resolves.toBe("中文\ntoken");
  });

  it("keeps conversion input compatible with build and console providers", () => {
    expect(createConversionInput("all", "missing")).toEqual({
      all: true,
      strategy: "missing",
    });
    expect(createConversionInput(["a"], "all")).toEqual({
      ids: ["a"],
      strategy: "all",
    });
  });

  it("derives health counts without mutating API data", () => {
    const result = deriveAccountOverview(summary, "grok_build", 0);
    expect(result.abnormal).toBe(1);
    expect(result.hasProviderAccounts).toBe(true);
    expect(summary.providers.grok_build.available).toBe(1);
  });
});
