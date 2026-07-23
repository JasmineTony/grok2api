import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDeferredRender } from "@/shared/hooks/use-deferred-render";

type ObserverCallback = ConstructorParameters<typeof IntersectionObserver>[0];

const originalIntersectionObserver = globalThis.IntersectionObserver;
const originalRequestIdleCallback = window.requestIdleCallback;
const originalCancelIdleCallback = window.cancelIdleCallback;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: originalIntersectionObserver,
  });
  Object.defineProperty(window, "requestIdleCallback", {
    configurable: true,
    writable: true,
    value: originalRequestIdleCallback,
  });
  Object.defineProperty(window, "cancelIdleCallback", {
    configurable: true,
    writable: true,
    value: originalCancelIdleCallback,
  });
});

describe("deferred rendering", () => {
  it("reveals content when the observed target enters the viewport", async () => {
    let callback: ObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class TestIntersectionObserver {
      constructor(nextCallback: ObserverCallback) {
        callback = nextCallback;
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
      takeRecords = () => [];
      root = null;
      rootMargin = "240px";
      thresholds = [0];
    }
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: TestIntersectionObserver,
    });
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      writable: true,
      value: vi.fn(() => 1),
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useDeferredRender<HTMLDivElement>(enabled),
      { initialProps: { enabled: false } },
    );
    const target = document.createElement("div");
    await act(() => Promise.resolve(result.current[0](target)));
    rerender({ enabled: true });

    expect(observe).toHaveBeenCalledWith(target);
    expect(result.current[1]).toBe(false);
    await act(() =>
      Promise.resolve(
        callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as never),
      ),
    );
    expect(result.current[1]).toBe(true);

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
