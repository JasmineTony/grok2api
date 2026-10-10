import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useMediaListState } from "@/features/media/use-media-list-state";

describe("useMediaListState", () => {
  it("默认第一页、每页 20 条且无关键字", () => {
    const { result } = renderHook(() => useMediaListState());

    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(20);
    expect(result.current.search).toBe("");
    expect(result.current.normalizedSearch).toBe("");
  });

  it("搜索去抖后写入 normalizedSearch 并回到第一页", async () => {
    const { result } = renderHook(() => useMediaListState());

    act(() => result.current.changePage(3));
    expect(result.current.page).toBe(3);

    act(() => result.current.changeSearch("  prompt  "));
    expect(result.current.page).toBe(1);
    expect(result.current.search).toBe("  prompt  ");

    await waitFor(() => expect(result.current.normalizedSearch).toBe("prompt"));
  });

  it("调整每页条数会回到第一页", () => {
    const { result } = renderHook(() => useMediaListState());

    act(() => result.current.changePage(2));
    act(() => result.current.changePageSize(50));

    expect(result.current.pageSize).toBe(50);
    expect(result.current.page).toBe(1);
  });
});
