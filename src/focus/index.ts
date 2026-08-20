/**
 * Pure, explicitly-clocked focus-session accounting.
 *
 * This module deliberately has no scheduler or clock dependency. Callers pass a
 * safe-integer epoch millisecond to every transition, which makes recovery and
 * controlled-clock tests deterministic.
 */

export const FOCUS_STATE_VERSION = 1 as const;
export const FOCUS_MILLISECONDS_PER_SECOND = 1_000;

export type FocusPhase =
  | 'idle'
  | 'focus-running'
  | 'focus-paused'
  | 'focus-completed'
  | 'focus-cancelled'
  | 'break-running'
  | 'break-paused'
  | 'finished';

export type FocusOutcome = 'completed' | 'cancelled';

export interface FocusConfiguration {
  readonly focusDurationMs: number;
  readonly breakDurationMs?: number;
  readonly simulationTicksPerFocusSecond: number;
}

/**
 * Persisted state is JSON-safe. `simulationTickRemainder` is a numerator in
 * thousandths of a simulation tick, so partitioning elapsed focus time cannot
 * round differently from a single checkpoint.
 */
export interface FocusState {
  readonly version: typeof FOCUS_STATE_VERSION;
  readonly phase: FocusPhase;
  readonly focusDurationMs: number | null;
  readonly breakDurationMs: number | null;
  readonly simulationTicksPerFocusSecond: number | null;
  readonly accumulatedFocusMs: number;
  readonly accumulatedBreakMs: number;
  readonly totalIssuedSimulationTicks: number;
  readonly simulationTickRemainder: number;
  readonly startedAtEpochMs: number | null;
  readonly focusStartedAtEpochMs: number | null;
  readonly focusEndedAtEpochMs: number | null;
  readonly breakStartedAtEpochMs: number | null;
  readonly breakEndedAtEpochMs: number | null;
  readonly endedAtEpochMs: number | null;
  readonly activeSegmentStartedAtEpochMs: number | null;
  /** Monotonic floor used only for elapsed accounting across wall-clock rollback. */
  readonly lastObservedEpochMs: number | null;
  readonly outcome: FocusOutcome | null;
}

const FOCUS_STATE_KEYS = [
  'version',
  'phase',
  'focusDurationMs',
  'breakDurationMs',
  'simulationTicksPerFocusSecond',
  'accumulatedFocusMs',
  'accumulatedBreakMs',
  'totalIssuedSimulationTicks',
  'simulationTickRemainder',
  'startedAtEpochMs',
  'focusStartedAtEpochMs',
  'focusEndedAtEpochMs',
  'breakStartedAtEpochMs',
  'breakEndedAtEpochMs',
  'endedAtEpochMs',
  'activeSegmentStartedAtEpochMs',
  'lastObservedEpochMs',
  'outcome',
] as const;

const PHASES: ReadonlySet<string> = new Set([
  'idle',
  'focus-running',
  'focus-paused',
  'focus-completed',
  'focus-cancelled',
  'break-running',
  'break-paused',
  'finished',
]);

function assertSafeInteger(value: number, label: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be a safe integer greater than or equal to ${minimum}.`);
  }
}

function assertEpochMs(value: number): void {
  assertSafeInteger(value, 'Epoch milliseconds');
}

function assertNullableEpochMs(value: number | null, label: string): void {
  if (value !== null) {
    assertSafeInteger(value, label);
  }
}

function assertNullablePositiveInteger(value: number | null, label: string): void {
  if (value !== null) {
    assertSafeInteger(value, label, 1);
  }
}

function assertNullableNonNegativeInteger(value: number | null, label: string): void {
  if (value !== null) {
    assertSafeInteger(value, label);
  }
}

function safeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds the safe integer range.`);
  }

  return Number(value);
}

function issuedTicksForFocus(
  accumulatedFocusMs: number,
  ticksPerSecond: number,
): { readonly ticks: number; readonly remainder: number } {
  const numerator = BigInt(accumulatedFocusMs) * BigInt(ticksPerSecond);
  return {
    ticks: safeNumber(numerator / BigInt(FOCUS_MILLISECONDS_PER_SECOND), 'Issued simulation ticks'),
    remainder: Number(numerator % BigInt(FOCUS_MILLISECONDS_PER_SECOND)),
  };
}

function assertConfiguredState(state: FocusState): asserts state is FocusState & {
  readonly focusDurationMs: number;
  readonly breakDurationMs: number;
  readonly simulationTicksPerFocusSecond: number;
  readonly startedAtEpochMs: number;
  readonly focusStartedAtEpochMs: number;
  readonly lastObservedEpochMs: number;
} {
  if (
    state.focusDurationMs === null ||
    state.breakDurationMs === null ||
    state.simulationTicksPerFocusSecond === null ||
    state.startedAtEpochMs === null ||
    state.focusStartedAtEpochMs === null ||
    state.lastObservedEpochMs === null
  ) {
    throw new TypeError('Focus session has no valid configuration.');
  }
}

function withLastObserved(state: FocusState, epochMs: number): FocusState {
  assertConfiguredState(state);
  return { ...state, lastObservedEpochMs: Math.max(state.lastObservedEpochMs, epochMs) };
}

function finishFocus(state: FocusState, endedAtEpochMs: number, manual: boolean): FocusState {
  assertConfiguredState(state);
  const focusEnded = {
    ...state,
    focusEndedAtEpochMs: endedAtEpochMs,
    activeSegmentStartedAtEpochMs: null,
    lastObservedEpochMs: Math.max(state.lastObservedEpochMs, endedAtEpochMs),
  };

  if (state.breakDurationMs > 0) {
    return {
      ...focusEnded,
      phase: 'break-running',
      breakStartedAtEpochMs: endedAtEpochMs,
      activeSegmentStartedAtEpochMs: endedAtEpochMs,
    };
  }

  return {
    ...focusEnded,
    phase: manual ? 'focus-completed' : 'finished',
    endedAtEpochMs,
    outcome: 'completed',
  };
}

function finishBreak(state: FocusState, endedAtEpochMs: number): FocusState {
  return {
    ...state,
    phase: 'finished',
    breakEndedAtEpochMs: endedAtEpochMs,
    endedAtEpochMs,
    activeSegmentStartedAtEpochMs: null,
    lastObservedEpochMs: Math.max(state.lastObservedEpochMs ?? endedAtEpochMs, endedAtEpochMs),
    outcome: 'completed',
  };
}

function checkpointRunningFocus(state: FocusState, epochMs: number): FocusState {
  assertConfiguredState(state);
  const effectiveNow = Math.max(state.lastObservedEpochMs, epochMs);
  const availableMs = effectiveNow - state.lastObservedEpochMs;
  const remainingMs = state.focusDurationMs - state.accumulatedFocusMs;
  const consumedMs = Math.min(availableMs, remainingMs);
  const accumulatedFocusMs = state.accumulatedFocusMs + consumedMs;
  const issued = issuedTicksForFocus(accumulatedFocusMs, state.simulationTicksPerFocusSecond);
  const next: FocusState = {
    ...state,
    accumulatedFocusMs,
    totalIssuedSimulationTicks: issued.ticks,
    simulationTickRemainder: issued.remainder,
    lastObservedEpochMs:
      accumulatedFocusMs === state.focusDurationMs
        ? state.lastObservedEpochMs + consumedMs
        : effectiveNow,
  };

  if (accumulatedFocusMs === state.focusDurationMs) {
    return finishFocus(next, next.lastObservedEpochMs ?? effectiveNow, false);
  }

  return next;
}

function checkpointRunningBreak(state: FocusState, epochMs: number): FocusState {
  assertConfiguredState(state);
  const effectiveNow = Math.max(state.lastObservedEpochMs, epochMs);
  const availableMs = effectiveNow - state.lastObservedEpochMs;
  const remainingMs = state.breakDurationMs - state.accumulatedBreakMs;
  const consumedMs = Math.min(availableMs, remainingMs);
  const accumulatedBreakMs = state.accumulatedBreakMs + consumedMs;
  const next: FocusState = {
    ...state,
    accumulatedBreakMs,
    lastObservedEpochMs:
      accumulatedBreakMs === state.breakDurationMs
        ? state.lastObservedEpochMs + consumedMs
        : effectiveNow,
  };

  return accumulatedBreakMs === state.breakDurationMs
    ? finishBreak(next, next.lastObservedEpochMs ?? effectiveNow)
    : next;
}

export function createIdleFocusState(): FocusState {
  return {
    version: FOCUS_STATE_VERSION,
    phase: 'idle',
    focusDurationMs: null,
    breakDurationMs: null,
    simulationTicksPerFocusSecond: null,
    accumulatedFocusMs: 0,
    accumulatedBreakMs: 0,
    totalIssuedSimulationTicks: 0,
    simulationTickRemainder: 0,
    startedAtEpochMs: null,
    focusStartedAtEpochMs: null,
    focusEndedAtEpochMs: null,
    breakStartedAtEpochMs: null,
    breakEndedAtEpochMs: null,
    endedAtEpochMs: null,
    activeSegmentStartedAtEpochMs: null,
    lastObservedEpochMs: null,
    outcome: null,
  };
}

export function startFocus(
  state: FocusState,
  configuration: FocusConfiguration,
  epochMs: number,
): FocusState {
  validateFocusState(state);
  if (state.phase !== 'idle') {
    throw new Error('A focus session can only start from idle.');
  }
  assertEpochMs(epochMs);
  assertSafeInteger(configuration.focusDurationMs, 'Focus duration milliseconds', 1);
  assertSafeInteger(configuration.breakDurationMs ?? 0, 'Break duration milliseconds');
  assertSafeInteger(
    configuration.simulationTicksPerFocusSecond,
    'Simulation ticks per focus second',
    1,
  );
  // Validate the maximum result before accepting a configuration that can never
  // be represented by the persisted safe-integer state.
  issuedTicksForFocus(configuration.focusDurationMs, configuration.simulationTicksPerFocusSecond);

  return {
    ...createIdleFocusState(),
    phase: 'focus-running',
    focusDurationMs: configuration.focusDurationMs,
    breakDurationMs: configuration.breakDurationMs ?? 0,
    simulationTicksPerFocusSecond: configuration.simulationTicksPerFocusSecond,
    startedAtEpochMs: epochMs,
    focusStartedAtEpochMs: epochMs,
    activeSegmentStartedAtEpochMs: epochMs,
    lastObservedEpochMs: epochMs,
  };
}

/** Records accepted elapsed time for the currently running phase. */
export function checkpointFocus(state: FocusState, epochMs: number): FocusState {
  validateFocusState(state);
  assertEpochMs(epochMs);

  switch (state.phase) {
    case 'focus-running': {
      const focusCheckpoint = checkpointRunningFocus(state, epochMs);
      // A single long checkpoint must account exactly like partitioned
      // checkpoints: no focus overrun, but any remaining elapsed interval is
      // legitimate break time once the focus target is reached.
      return focusCheckpoint.phase === 'break-running'
        ? checkpointRunningBreak(focusCheckpoint, epochMs)
        : focusCheckpoint;
    }
    case 'break-running':
      return checkpointRunningBreak(state, epochMs);
    case 'focus-paused':
    case 'break-paused':
      return withLastObserved(state, epochMs);
    case 'idle':
    case 'focus-completed':
    case 'focus-cancelled':
    case 'finished':
      return state;
  }
}

export function pauseFocus(state: FocusState, epochMs: number): FocusState {
  const checkpointed = checkpointFocus(state, epochMs);
  if (checkpointed.phase === 'focus-running') {
    return { ...checkpointed, phase: 'focus-paused', activeSegmentStartedAtEpochMs: null };
  }
  if (checkpointed.phase === 'break-running') {
    return { ...checkpointed, phase: 'break-paused', activeSegmentStartedAtEpochMs: null };
  }
  return checkpointed;
}

export function resumeFocus(state: FocusState, epochMs: number): FocusState {
  validateFocusState(state);
  assertEpochMs(epochMs);
  if (state.phase !== 'focus-paused' && state.phase !== 'break-paused') {
    throw new Error('Only a paused focus or break can resume.');
  }
  assertConfiguredState(state);
  const phase = state.phase === 'focus-paused' ? 'focus-running' : 'break-running';
  const resumedAtEpochMs = Math.max(state.lastObservedEpochMs, epochMs);
  return {
    ...state,
    phase,
    activeSegmentStartedAtEpochMs: resumedAtEpochMs,
    lastObservedEpochMs: resumedAtEpochMs,
  };
}

/** Completes the focus phase without crediting time that was not accepted. */
export function completeFocus(state: FocusState, epochMs: number): FocusState {
  const checkpointed = checkpointFocus(state, epochMs);
  if (checkpointed.phase !== 'focus-running' && checkpointed.phase !== 'focus-paused') {
    return checkpointed;
  }
  assertConfiguredState(checkpointed);
  return finishFocus(checkpointed, Math.max(checkpointed.lastObservedEpochMs, epochMs), true);
}

/** Cancels an in-progress focus session without rolling back accepted progress. */
export function cancelFocus(state: FocusState, epochMs: number): FocusState {
  const checkpointed = checkpointFocus(state, epochMs);
  if (checkpointed.phase !== 'focus-running' && checkpointed.phase !== 'focus-paused') {
    return checkpointed;
  }
  assertConfiguredState(checkpointed);
  const endedAtEpochMs = Math.max(checkpointed.lastObservedEpochMs, epochMs);
  return {
    ...checkpointed,
    phase: 'focus-cancelled',
    activeSegmentStartedAtEpochMs: null,
    focusEndedAtEpochMs: endedAtEpochMs,
    endedAtEpochMs,
    lastObservedEpochMs: endedAtEpochMs,
    outcome: 'cancelled',
  };
}

/** Ends a break early. It intentionally does not manufacture break elapsed time. */
export function skipBreak(state: FocusState, epochMs: number): FocusState {
  const checkpointed = checkpointFocus(state, epochMs);
  if (checkpointed.phase !== 'break-running' && checkpointed.phase !== 'break-paused') {
    return checkpointed;
  }
  assertConfiguredState(checkpointed);
  return finishBreak(checkpointed, Math.max(checkpointed.lastObservedEpochMs, epochMs));
}

export const completeBreak = skipBreak;

export function validateFocusState(value: FocusState): FocusState {
  if (value.version !== FOCUS_STATE_VERSION || !PHASES.has(value.phase)) {
    throw new TypeError('Unsupported focus state version or phase.');
  }
  assertNullablePositiveInteger(value.focusDurationMs, 'Focus duration milliseconds');
  assertNullableNonNegativeInteger(value.breakDurationMs, 'Break duration milliseconds');
  assertNullablePositiveInteger(
    value.simulationTicksPerFocusSecond,
    'Simulation ticks per focus second',
  );
  assertSafeInteger(value.accumulatedFocusMs, 'Accumulated focus milliseconds');
  assertSafeInteger(value.accumulatedBreakMs, 'Accumulated break milliseconds');
  assertSafeInteger(value.totalIssuedSimulationTicks, 'Total issued simulation ticks');
  assertSafeInteger(value.simulationTickRemainder, 'Simulation tick remainder');
  if (value.simulationTickRemainder >= FOCUS_MILLISECONDS_PER_SECOND) {
    throw new RangeError('Simulation tick remainder must be less than one second.');
  }
  assertNullableEpochMs(value.startedAtEpochMs, 'Started epoch milliseconds');
  assertNullableEpochMs(value.focusStartedAtEpochMs, 'Focus started epoch milliseconds');
  assertNullableEpochMs(value.focusEndedAtEpochMs, 'Focus ended epoch milliseconds');
  assertNullableEpochMs(value.breakStartedAtEpochMs, 'Break started epoch milliseconds');
  assertNullableEpochMs(value.breakEndedAtEpochMs, 'Break ended epoch milliseconds');
  assertNullableEpochMs(value.endedAtEpochMs, 'Ended epoch milliseconds');
  assertNullableEpochMs(
    value.activeSegmentStartedAtEpochMs,
    'Active segment started epoch milliseconds',
  );
  assertNullableEpochMs(value.lastObservedEpochMs, 'Last observed epoch milliseconds');
  if (value.outcome !== null && value.outcome !== 'completed' && value.outcome !== 'cancelled') {
    throw new TypeError('Focus outcome is invalid.');
  }

  if (value.phase === 'idle') {
    const idle = createIdleFocusState();
    for (const key of FOCUS_STATE_KEYS) {
      if (value[key] !== idle[key]) {
        throw new TypeError('Idle focus state must not contain session data.');
      }
    }
    return value;
  }

  assertConfiguredState(value);
  if (
    value.accumulatedFocusMs > value.focusDurationMs ||
    value.accumulatedBreakMs > value.breakDurationMs
  ) {
    throw new RangeError('Accepted focus or break time exceeds its configured duration.');
  }
  const issued = issuedTicksForFocus(value.accumulatedFocusMs, value.simulationTicksPerFocusSecond);
  if (
    issued.ticks !== value.totalIssuedSimulationTicks ||
    issued.remainder !== value.simulationTickRemainder
  ) {
    throw new TypeError('Focus simulation tick accounting is inconsistent.');
  }

  const active = value.phase === 'focus-running' || value.phase === 'break-running';
  if (active !== (value.activeSegmentStartedAtEpochMs !== null)) {
    throw new TypeError('Only running focus phases may have an active segment.');
  }
  if (value.lastObservedEpochMs === null) {
    throw new TypeError('Configured focus sessions require an observed epoch.');
  }
  if (
    value.focusStartedAtEpochMs !== value.startedAtEpochMs ||
    value.lastObservedEpochMs < value.startedAtEpochMs ||
    (value.activeSegmentStartedAtEpochMs !== null &&
      (value.activeSegmentStartedAtEpochMs < value.startedAtEpochMs ||
        value.activeSegmentStartedAtEpochMs > value.lastObservedEpochMs))
  ) {
    throw new TypeError('Focus session timestamps are inconsistent.');
  }
  if (
    (value.focusEndedAtEpochMs !== null &&
      (value.focusEndedAtEpochMs < value.focusStartedAtEpochMs ||
        value.focusEndedAtEpochMs > value.lastObservedEpochMs)) ||
    (value.breakStartedAtEpochMs !== null &&
      value.breakStartedAtEpochMs !== value.focusEndedAtEpochMs) ||
    (value.breakEndedAtEpochMs !== null &&
      (value.breakStartedAtEpochMs === null ||
        value.breakEndedAtEpochMs < value.breakStartedAtEpochMs)) ||
    (value.endedAtEpochMs !== null && value.endedAtEpochMs > value.lastObservedEpochMs)
  ) {
    throw new TypeError('Focus completion timestamps are inconsistent.');
  }
  if (value.phase === 'focus-running' || value.phase === 'focus-paused') {
    if (
      value.focusEndedAtEpochMs !== null ||
      value.breakStartedAtEpochMs !== null ||
      value.outcome !== null
    ) {
      throw new TypeError('Incomplete focus phases cannot have a completion record.');
    }
    if (value.accumulatedFocusMs >= value.focusDurationMs) {
      throw new TypeError('Incomplete focus phases must retain planned focus time.');
    }
  }
  if (value.phase === 'break-running' || value.phase === 'break-paused') {
    if (
      value.focusEndedAtEpochMs === null ||
      value.breakStartedAtEpochMs === null ||
      value.outcome !== null
    ) {
      throw new TypeError('Break phases require a completed focus and no terminal outcome.');
    }
    if (value.breakDurationMs === 0 || value.accumulatedBreakMs >= value.breakDurationMs) {
      throw new TypeError('Running or paused breaks must retain planned break time.');
    }
  }
  if (value.phase === 'focus-cancelled') {
    if (
      value.outcome !== 'cancelled' ||
      value.endedAtEpochMs === null ||
      value.focusEndedAtEpochMs === null
    ) {
      throw new TypeError('Cancelled focus sessions require cancellation history.');
    }
    if (value.breakStartedAtEpochMs !== null || value.breakEndedAtEpochMs !== null) {
      throw new TypeError('Cancelled focus sessions cannot contain break history.');
    }
    if (value.endedAtEpochMs !== value.focusEndedAtEpochMs) {
      throw new TypeError('Cancelled focus end timestamps must match.');
    }
  }
  if (value.phase === 'focus-completed' || value.phase === 'finished') {
    if (
      value.outcome !== 'completed' ||
      value.endedAtEpochMs === null ||
      value.focusEndedAtEpochMs === null
    ) {
      throw new TypeError('Completed focus sessions require completion history.');
    }
  }
  if (value.phase === 'focus-completed' && value.breakDurationMs !== 0) {
    throw new TypeError('Focus-completed is only a terminal state without a configured break.');
  }
  if (value.phase === 'focus-completed' && value.endedAtEpochMs !== value.focusEndedAtEpochMs) {
    throw new TypeError('Completed focus end timestamps must match.');
  }
  if (
    value.phase === 'finished' &&
    value.breakDurationMs === 0 &&
    value.accumulatedFocusMs !== value.focusDurationMs
  ) {
    throw new TypeError('A no-break finished session must consume its full focus duration.');
  }
  if (
    value.phase === 'finished' &&
    value.breakDurationMs > 0 &&
    value.breakEndedAtEpochMs === null
  ) {
    throw new TypeError('A configured break must record its end before the session finishes.');
  }
  if (
    value.phase === 'finished' &&
    value.endedAtEpochMs !==
      (value.breakDurationMs > 0 ? value.breakEndedAtEpochMs : value.focusEndedAtEpochMs)
  ) {
    throw new TypeError('Finished session end timestamps must match the final phase.');
  }
  return value;
}

/** Strictly validates an unknown JSON/structured-clone value before recovery. */
export function rehydrateFocusState(value: unknown): FocusState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Focus state must be a plain object.');
  }
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Focus state must be a plain object.');
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const expected = [...FOCUS_STATE_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError('Focus state has missing or unknown fields.');
  }
  return validateFocusState(candidate as unknown as FocusState);
}
