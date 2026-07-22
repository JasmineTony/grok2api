import { describe, expect, it } from "vitest";

import {
  createConversionInput,
  createQuickImportFile,
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
    await expect(
      readQuickImportFile(new File(["token"], "tokens.txt")),
    ).resolves.toBe("token");
    const oversized = {
      size: 30 * 1024 * 1024 + 1,
      text: () => Promise.resolve(""),
    } as File;
    await expect(readQuickImportFile(oversized)).rejects.toThrow(RangeError);
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
