import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AsyncState } from "@/shared/components/async-state";
import { FormSection } from "@/shared/components/form-section";
import { ResponsiveDataView } from "@/shared/components/responsive-data-view";
import { useBulkSelection } from "@/shared/hooks/use-bulk-selection";
import { useDataTableQueryState } from "@/shared/hooks/use-data-table-query-state";
import { createQueryKeys } from "@/shared/lib/query-keys";

describe("frontend component foundation", () => {
  it("renders async error state and exposes a retry action", async () => {
    const retry = vi.fn();
    render(
      <AsyncState
        loading={false}
        error={new Error("network unavailable")}
        empty={false}
        onRetry={retry}
      >
        <span>content</span>
      </AsyncState>,
    );

    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("network unavailable")).toBeInTheDocument();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("keeps form and responsive presentation components free of business dependencies", () => {
    render(
      <>
        <FormSection
          title="Profile"
          description="Account settings"
          actions={<button type="button">Save</button>}
        >
          <label htmlFor="name">Name</label>
          <input id="name" />
        </FormSection>
        <ResponsiveDataView table={<div>table view</div>} cards={<div>card view</div>} />
      </>,
    );

    expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByText("table view")).toBeInTheDocument();
    expect(screen.getByText("card view")).toBeInTheDocument();
  });

  it("provides stable shared table query and selection behavior", () => {
    const { result: selectionResult } = renderHook(() => useBulkSelection());
    act(() => selectionResult.current.toggleMany(["a", "b"], true));
    expect(selectionResult.current.ids).toEqual(["a", "b"]);
    act(() => selectionResult.current.toggle("a", false));
    expect(selectionResult.current.ids).toEqual(["b"]);

    const { result: queryResult } = renderHook(() => useDataTableQueryState({ pageSize: 50 }));
    act(() => queryResult.current.setPage(3));
    act(() => queryResult.current.setSearch("grok"));
    expect(queryResult.current.page).toBe(1);
    expect(queryResult.current.pageSize).toBe(50);
    expect(queryResult.current.search).toBe("grok");

    const keys = createQueryKeys("accounts");
    expect(keys.list(1, "grok")).toEqual(["accounts", "list", 1, "grok"]);
    expect(keys.detail("42")).toEqual(["accounts", "detail", "42"]);
  });
});
