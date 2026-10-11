export type AccountTaskProgressPhase = "importing" | "converting" | "syncing";

export type AccountTaskProgressDTO = {
  completed: number;
  total: number;
  phase?: AccountTaskProgressPhase;
};

export type AccountTaskProgressScheduler = {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

type AccountTaskProgressControllerOptions = {
  onProgress?: (value: AccountTaskProgressDTO) => void;
  phases?: readonly AccountTaskProgressPhase[];
  intervalMs?: number;
  scheduler?: AccountTaskProgressScheduler;
};

export type AccountTaskProgressController = {
  report: (value: AccountTaskProgressDTO) => void;
  flush: () => void;
  dispose: () => void;
};

const browserScheduler: AccountTaskProgressScheduler = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

/** 控制器的全部可变状态；独立成对象后，节流与相位推进可按职责分开实现。 */
type AccountTaskProgressState = {
  onProgress: ((value: AccountTaskProgressDTO) => void) | undefined;
  intervalMs: number;
  scheduler: AccountTaskProgressScheduler;
  phases: readonly AccountTaskProgressPhase[];
  phaseIndexes: Map<AccountTaskProgressPhase, number>;
  latestByPhase: Map<AccountTaskProgressPhase, AccountTaskProgressDTO>;
  latestUnordered: Map<AccountTaskProgressPhase | undefined, AccountTaskProgressDTO>;
  activePhaseIndex: number;
  pending: AccountTaskProgressDTO | undefined;
  lastEmitted: AccountTaskProgressDTO | undefined;
  lastEmittedAt: number | undefined;
  timer: unknown;
  disposed: boolean;
};

function isComplete(value: AccountTaskProgressDTO | undefined): boolean {
  return value !== undefined && value.completed >= value.total;
}

function sameProgress(left: AccountTaskProgressDTO | undefined, right: AccountTaskProgressDTO): boolean {
  return left?.completed === right.completed && left.total === right.total && left.phase === right.phase;
}

function monotonicProgress(
  current: AccountTaskProgressDTO | undefined,
  next: AccountTaskProgressDTO,
): AccountTaskProgressDTO {
  if (!current) return next;
  return {
    ...next,
    completed: Math.max(current.completed, next.completed),
    total: Math.max(current.total, next.total),
  };
}

function createTaskProgressState(options: AccountTaskProgressControllerOptions): AccountTaskProgressState {
  const phases = options.phases ?? [];
  return {
    onProgress: options.onProgress,
    intervalMs: options.intervalMs ?? 100,
    scheduler: options.scheduler ?? browserScheduler,
    phases,
    phaseIndexes: new Map(phases.map((phase, index) => [phase, index])),
    latestByPhase: new Map(),
    latestUnordered: new Map(),
    activePhaseIndex: 0,
    pending: undefined,
    lastEmitted: undefined,
    lastEmittedAt: undefined,
    timer: undefined,
    disposed: false,
  };
}

function clearTaskProgressTimer(state: AccountTaskProgressState): void {
  if (state.timer === undefined) return;
  state.scheduler.clearTimeout(state.timer);
  state.timer = undefined;
}

function emitPendingTaskProgress(state: AccountTaskProgressState): void {
  if (!state.pending || !state.onProgress || state.disposed) return;
  const value = state.pending;
  state.pending = undefined;
  if (sameProgress(state.lastEmitted, value)) return;
  state.lastEmitted = value;
  state.lastEmittedAt = state.scheduler.now();
  state.onProgress(value);
}

function scheduleTaskProgress(state: AccountTaskProgressState, value: AccountTaskProgressDTO): void {
  if (!state.onProgress || state.disposed || sameProgress(state.pending ?? state.lastEmitted, value)) return;
  state.pending = value;
  if (state.lastEmittedAt === undefined) {
    clearTaskProgressTimer(state);
    emitPendingTaskProgress(state);
    return;
  }
  const delay = Math.max(0, state.intervalMs - (state.scheduler.now() - state.lastEmittedAt));
  if (delay === 0) {
    clearTaskProgressTimer(state);
    emitPendingTaskProgress(state);
  } else if (state.timer === undefined) {
    state.timer = state.scheduler.setTimeout(() => {
      state.timer = undefined;
      emitPendingTaskProgress(state);
    }, delay);
  }
}

// 未来相位可能先于当前相位完成到达：先缓冲，等当前相位结束后单向推进，绝不回退。
function advanceActivePhase(state: AccountTaskProgressState): void {
  while (state.activePhaseIndex < state.phases.length - 1) {
    const active = state.latestByPhase.get(state.phases[state.activePhaseIndex]);
    const next = state.latestByPhase.get(state.phases[state.activePhaseIndex + 1]);
    if (!isComplete(active) || !next) break;
    state.activePhaseIndex += 1;
  }
}

function reportOrderedTaskProgress(state: AccountTaskProgressState, value: AccountTaskProgressDTO): void {
  const phase = value.phase ?? state.phases[0];
  const phaseIndex = phase === undefined ? undefined : state.phaseIndexes.get(phase);
  if (phase === undefined || phaseIndex === undefined || phaseIndex < state.activePhaseIndex) return;

  const normalized = monotonicProgress(state.latestByPhase.get(phase), { ...value, phase });
  state.latestByPhase.set(phase, normalized);
  const previousActivePhaseIndex = state.activePhaseIndex;
  advanceActivePhase(state);

  const active = state.latestByPhase.get(state.phases[state.activePhaseIndex]);
  if (!active) return;
  if (state.activePhaseIndex !== previousActivePhaseIndex && state.onProgress) {
    // 相位切换是低频语义事件：立即发布，普通计数仍走全局节流。
    state.pending = active;
    clearTaskProgressTimer(state);
    emitPendingTaskProgress(state);
    return;
  }
  scheduleTaskProgress(state, active);
}

function reportTaskProgress(state: AccountTaskProgressState, value: AccountTaskProgressDTO): void {
  if (state.disposed) return;
  if (state.phases.length > 0) {
    reportOrderedTaskProgress(state, value);
    return;
  }
  const normalized = monotonicProgress(state.latestUnordered.get(value.phase), value);
  state.latestUnordered.set(value.phase, normalized);
  scheduleTaskProgress(state, normalized);
}

function flushTaskProgress(state: AccountTaskProgressState): void {
  if (state.disposed) return;
  clearTaskProgressTimer(state);
  emitPendingTaskProgress(state);
}

function disposeTaskProgress(state: AccountTaskProgressState): void {
  clearTaskProgressTimer(state);
  state.pending = undefined;
  state.disposed = true;
}

// 进度相位由后端同步管线并发产生。该控制器缓冲未来相位、只向前推进可见相位，
// 并在整个任务上应用一次全局渲染节流。
export function createAccountTaskProgressController(
  options: AccountTaskProgressControllerOptions,
): AccountTaskProgressController {
  const state = createTaskProgressState(options);
  return {
    report: (value) => reportTaskProgress(state, value),
    flush: () => flushTaskProgress(state),
    dispose: () => disposeTaskProgress(state),
  };
}
