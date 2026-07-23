import { type RefCallback, useCallback, useEffect, useState } from "react";

import { scheduleIdleTask } from "@/shared/lib/idle-task";

export function useDeferredRender<T extends Element>(
  enabled: boolean,
): readonly [RefCallback<T>, boolean] {
  const [element, setElement] = useState<T | null>(null);
  const [ready, setReady] = useState(false);
  const targetRef = useCallback<RefCallback<T>>((node) => setElement(node), []);

  useEffect(() => {
    if (!enabled || ready) return;
    let active = true;
    const reveal = () => {
      if (active) setReady(true);
    };
    const cancelIdle = scheduleIdleTask(reveal);
    const observer =
      element && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) reveal();
            },
            { rootMargin: "240px" },
          )
        : null;
    if (element) observer?.observe(element);
    if (!observer) reveal();

    return () => {
      active = false;
      cancelIdle();
      observer?.disconnect();
    };
  }, [element, enabled, ready]);

  return [targetRef, ready] as const;
}
