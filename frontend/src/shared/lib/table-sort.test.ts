import { describe, expect, it } from "vitest";

import { nextTableSort } from "@/shared/lib/table-sort";

describe("nextTableSort", () => {
  it("uses the requested initial order for a new field", () =>
    expect(
      nextTableSort({ field: "name", order: "asc" }, "created", "desc"),
    ).toEqual({ field: "created", order: "desc" }));
  it("toggles the active field", () =>
    expect(nextTableSort({ field: "name", order: "asc" }, "name")).toEqual({
      field: "name",
      order: "desc",
    }));
});
