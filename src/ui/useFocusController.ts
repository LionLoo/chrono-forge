import { useCallback, useEffect, useRef, useState } from 'react';

import type { FocusSession, FocusSessionStatus } from '../adapters/persistence';
import {
  cancelFocus,
  checkpointFocus,
  completeFocus,
  createIdleFocusState,
  pauseFocus,
  rehydrateFocusState,
  resumeFocus,
  skipBreak as skipFocusBreak,
  startFocus,
  type FocusConfiguration,
  type FocusState,
} from '../focus';

export interface FocusClock {
  now(): number;
}

export const systemFocusClock: FocusClock = {
  now: () => Date.now(),
};

export interface UseFocusControllerOptions {
  readonly clock: FocusClock;
  readonly initialSession?: FocusSession | null;
  readonly slotId: string | null;
  /** False means Worker backpressure rejected this transition before it became accepted time. */
  readonly onSimulationTicks: (ticks: number) => boolean | void;
  readonly onSessionState?: (session: FocusSession) => void;
  readonly checkpointIntervalMs?: number;
  readonly createSessionId?: () => string;
  /** Freezes all elapsed-time transitions when authoritative simulation ticks cannot be issued. */
  readonly suspended?: boolean;
}

export interface FocusController {
  readonly state: FocusState;
  readonly session: FocusSession | null;
  readonly focusRemainingMs: number;
  readonly breakRemainingMs: number;
  start(configuration: FocusConfiguration): void;
  checkpoint(): void;
  pause(): void;
  resume(): void;
  complete(): void;
  cancel(): void;
  skipBreak(): void;
  reset(): void;
}

function statusFromState(state: FocusState): FocusSessionStatus {
  switch (state.phase) {
    case 'focus-running':
    case 'break-running':
      return 'active';
    case 'focus-paused':
    case 'break-paused':
      return 'paused';
    case 'focus-completed':
    case 'finished':
      return 'completed';
    case 'focus-cancelled':
      return 'cancelled';
    case 'idle':
      throw new Error('An idle focus state cannot be represented as a persisted session.');
  }
}

/** Derives every persisted summary field from strict, authoritative focus state. */
export function focusSessionFromState(
  sessionId: string,
  slotId: string | null,
  state: FocusState,
  recapEventIds: readonly number[] = [],
): FocusSession {
  if (state.phase === 'idle') {
    throw new Error('An idle focus state cannot be represented as a persisted session.');
  }
  if (
    state.startedAtEpochMs === null ||
    state.focusDurationMs === null ||
    state.breakDurationMs === null
  ) {
    throw new TypeError('Configured focus state is missing persisted session fields.');
  }

  return {
    sessionId,
    slotId,
    startedAtMs: state.startedAtEpochMs,
    endedAtMs: state.endedAtEpochMs,
    plannedFocusMs: state.focusDurationMs,
    focusedMs: state.accumulatedFocusMs,
    plannedBreakMs: state.breakDurationMs,
    breakMs: state.accumulatedBreakMs,
    issuedSimulationTicks: state.totalIssuedSimulationTicks,
    status: statusFromState(state),
    stateJson: JSON.stringify(state),
    recapEventIds: [...recapEventIds],
    recapEntries: [],
    review: null,
  };
}

function initialState(session: FocusSession | null | undefined): FocusState {
  if (session === null || session === undefined) return createIdleFocusState();
  return rehydrateFocusState(JSON.parse(session.stateJson) as unknown);
}

function isTerminal(state: FocusState): boolean {
  return (
    state.phase === 'focus-completed' ||
    state.phase === 'focus-cancelled' ||
    state.phase === 'finished'
  );
}

function remaining(duration: number | null, elapsed: number): number {
  return duration === null ? 0 : Math.max(0, duration - elapsed);
}

/**
 * React scheduling shell around the pure, injected-clock focus state machine.
 * The state ref is authoritative between render commits so callbacks never rely
 * on React updater execution (which StrictMode may replay).
 */
export function useFocusController(options: UseFocusControllerOptions): FocusController {
  const { clock, createSessionId, onSessionState, onSimulationTicks, slotId } = options;
  const suspended = options.suspended ?? false;
  const [state, setState] = useState<FocusState>(() => initialState(options.initialSession));
  const [sessionId, setSessionId] = useState<string | null>(
    options.initialSession?.sessionId ?? null,
  );
  const stateRef = useRef(state);
  const sessionIdRef = useRef<string | null>(options.initialSession?.sessionId ?? null);

  const publish = useCallback(
    (next: FocusState, recapEventIds: readonly number[] = []): void => {
      const sessionId = sessionIdRef.current;
      if (sessionId === null || next.phase === 'idle') return;
      onSessionState?.(focusSessionFromState(sessionId, slotId, next, recapEventIds));
    },
    [onSessionState, slotId],
  );

  const transition = useCallback(
    (operation: (current: FocusState, epochMs: number) => FocusState): void => {
      if (suspended) return;
      const previous = stateRef.current;
      const next = operation(previous, clock.now());
      if (next === previous) return;

      const issuedDelta = next.totalIssuedSimulationTicks - previous.totalIssuedSimulationTicks;
      if (issuedDelta > 0 && onSimulationTicks(issuedDelta) === false) return;
      // The Worker owns world authority. Do not commit accepted focus time locally until the
      // corresponding tick command has crossed that boundary successfully; a synchronous
      // dispatch failure must leave the same elapsed interval available for an exact retry.
      stateRef.current = next;
      setState(next);
      publish(next);
    },
    [clock, onSimulationTicks, publish, suspended],
  );

  const start = useCallback(
    (configuration: FocusConfiguration): void => {
      if (stateRef.current.phase !== 'idle') {
        throw new Error('A focus session can only start from idle.');
      }
      const factory = createSessionId;
      if (factory === undefined) {
        throw new Error('A focus session ID factory is required to start a session.');
      }
      const sessionId = factory();
      if (sessionId.length === 0) throw new Error('A focus session ID must not be empty.');
      sessionIdRef.current = sessionId;
      setSessionId(sessionId);
      transition((current, epochMs) => startFocus(current, configuration, epochMs));
    },
    [createSessionId, transition],
  );

  const checkpoint = useCallback((): void => {
    transition(checkpointFocus);
  }, [transition]);

  const pause = useCallback((): void => {
    transition(pauseFocus);
  }, [transition]);

  const resume = useCallback((): void => {
    transition(resumeFocus);
  }, [transition]);

  const complete = useCallback((): void => {
    transition(completeFocus);
  }, [transition]);

  const cancel = useCallback((): void => {
    transition(cancelFocus);
  }, [transition]);

  const skipBreak = useCallback((): void => {
    transition(skipFocusBreak);
  }, [transition]);

  const reset = useCallback((): void => {
    if (!isTerminal(stateRef.current)) {
      throw new Error('A focus session can only reset from a terminal state.');
    }
    stateRef.current = createIdleFocusState();
    sessionIdRef.current = null;
    setState(stateRef.current);
    setSessionId(null);
  }, []);

  const checkpointIntervalMs = options.checkpointIntervalMs ?? 1_000;
  if (!Number.isSafeInteger(checkpointIntervalMs) || checkpointIntervalMs < 1) {
    throw new RangeError('Focus checkpoint interval must be a positive safe integer.');
  }

  const running =
    !suspended && (state.phase === 'focus-running' || state.phase === 'break-running');
  useEffect(() => {
    if (!running) return undefined;
    const interval = window.setInterval(checkpoint, checkpointIntervalMs);
    return () => window.clearInterval(interval);
  }, [checkpoint, checkpointIntervalMs, running]);

  useEffect(() => {
    if (suspended) return undefined;
    const onVisibilityChange = (): void => checkpoint();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [checkpoint, suspended]);

  const session =
    sessionId === null || state.phase === 'idle'
      ? null
      : focusSessionFromState(sessionId, slotId, state);

  return {
    state,
    session,
    focusRemainingMs: remaining(state.focusDurationMs, state.accumulatedFocusMs),
    breakRemainingMs: remaining(state.breakDurationMs, state.accumulatedBreakMs),
    start,
    checkpoint,
    pause,
    resume,
    complete,
    cancel,
    skipBreak,
    reset,
  };
}
