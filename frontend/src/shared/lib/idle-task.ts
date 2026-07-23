const DEFAULT_IDLE_TIMEOUT_MS = 1_500;

export function scheduleIdleTask(task: () => void, timeout = DEFAULT_IDLE_TIMEOUT_MS): () => void {
  const idleWindow = window;
  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const handle = idleWindow.requestIdleCallback(task, { timeout });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(task, 0);
  return () => window.clearTimeout(handle);
}
