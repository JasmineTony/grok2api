import { describe, expect, it } from "vitest";

import { describeRouteError } from "@/app/route-error";

describe("describeRouteError", () => {
  it("keeps a useful Error message", () => {
    expect(describeRouteError(new Error("dashboard failed"))).toBe("dashboard failed");
  });

  it("hides unknown thrown values", () => {
    expect(describeRouteError({ secret: "not safe to render" })).toBeNull();
  });
});
