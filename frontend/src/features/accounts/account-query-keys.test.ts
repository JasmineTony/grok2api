import { describe, expect, it } from "vitest";

import {
  accountMutationInvalidationKeys,
  accountQueryKeys,
} from "@/features/accounts/account-query-keys";

describe("account query keys", () => {
  it("separates list, summary, and derived account data", () => {
    expect(
      accountQueryKeys
        .list("grok_web", 1, 20, "", "", "", "", "", "", "", "", "createdAt", "desc")
        .slice(0, 2),
    ).toEqual(["accounts", "list"]);
    expect(accountQueryKeys.summary()).toEqual(["accounts", "summary"]);
    expect(accountQueryKeys.stateEvents("42")).toEqual(["accounts", "state-events", "42"]);
    expect(accountQueryKeys.cleanupPreview("grok_web", "invalid", "grok_build")).toEqual([
      "accounts",
      "cleanup-preview",
      "grok_web",
      "invalid",
      "grok_build",
    ]);
  });

  it("invalidates every account-derived query family after mutations", () => {
    expect(accountMutationInvalidationKeys()).toEqual([
      ["accounts", "list"],
      ["accounts", "summary"],
      ["accounts", "state-events"],
      ["accounts", "deletion-preview"],
      ["accounts", "cleanup-preview"],
      ["accounts", "egress-policy"],
      ["accounts", "audit-filter"],
    ]);
  });
});
