import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";

afterEach(() => vi.useRealTimers());

describe("useDebouncedValue", () => {
  it("updates only after the configured delay", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: "first" } },
    );
    rerender({ value: "second" });
    expect(result.current).toBe("first");
    void act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe("second");
  });
});
