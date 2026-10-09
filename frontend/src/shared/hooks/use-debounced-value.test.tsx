import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedValue", () => {
  it("首次渲染立即返回原值，延迟到期后才更新", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value, delayMs }: { value: string; delayMs: number }) => useDebouncedValue(value, delayMs),
      { initialProps: { value: "first", delayMs: 300 } },
    );
    expect(result.current).toBe("first");

    rerender({ value: "second", delayMs: 300 });
    expect(result.current).toBe("first");

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe("second");
  });

  it("未传 delayMs 时使用 300ms 默认延迟", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }: { value: string }) => useDebouncedValue(value), {
      initialProps: { value: "first" },
    });

    rerender({ value: "second" });
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe("first");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("second");
  });

  it("delayMs 变化时按新延迟重新计时，旧定时器不再生效", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value, delayMs }: { value: string; delayMs: number }) => useDebouncedValue(value, delayMs),
      { initialProps: { value: "first", delayMs: 100 } },
    );

    rerender({ value: "second", delayMs: 500 });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe("first");

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toBe("second");
  });

  it("卸载时清理待执行的定时器，之后不再触发更新", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const { unmount } = renderHook(({ value }: { value: string }) => useDebouncedValue(value, 300), {
      initialProps: { value: "first" },
    });

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    clearTimeoutSpy.mockRestore();
  });
});
