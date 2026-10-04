import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';

import type { FocusSession } from '../../src/adapters/persistence';
import { checkpointFocus, createIdleFocusState, startFocus } from '../../src/focus';
import {
  focusSessionFromState,
  useFocusController,
  type FocusClock,
} from '../../src/ui/useFocusController';

const configuration = {
  focusDurationMs: 5_000,
  simulationTicksPerFocusSecond: 10,
} as const;

function createClock(initial = 0): { readonly clock: FocusClock; set(value: number): void } {
  let now = initial;
  return { clock: { now: () => now }, set: (value) => (now = value) };
}

describe('focus controller', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('starts a canonical session and issues interval simulation ticks once', () => {
    const controlled = createClock(100);
    const ticks: number[] = [];
    const sessions: FocusSession[] = [];
    const { result } = renderHook(() =>
      useFocusController({
        clock: controlled.clock,
        slotId: 'slot-a',
        createSessionId: () => 'session-a',
        onSimulationTicks: (count) => ticks.push(count),
        onSessionState: (session) => sessions.push(session),
      }),
    );

    act(() => result.current.start(configuration));
    controlled.set(1_600);
    void act(() => vi.advanceTimersByTime(1_000));

    expect(result.current.state).toMatchObject({
      phase: 'focus-running',
      accumulatedFocusMs: 1_500,
    });
    expect(result.current.focusRemainingMs).toBe(3_500);
    expect(ticks).toEqual([15]);
    expect(sessions.at(-1)).toMatchObject({
      sessionId: 'session-a',
      slotId: 'slot-a',
      status: 'active',
      issuedSimulationTicks: 15,
    });
    expect(sessions.at(-1)?.stateJson).toBe(JSON.stringify(result.current.state));
  });

  it('pauses, resumes, manually completes, cancels, and only resets terminal sessions', () => {
    const controlled = createClock();
    const ticks: number[] = [];
    const { result } = renderHook(() =>
      useFocusController({
        clock: controlled.clock,
        slotId: null,
        createSessionId: () => 'session-a',
        onSimulationTicks: (count) => ticks.push(count),
      }),
    );

    act(() => result.current.start(configuration));
    expect(() => result.current.reset()).toThrow('only reset from a terminal state');
    controlled.set(1_000);
    act(() => result.current.pause());
    controlled.set(4_000);
    act(() => result.current.checkpoint());
    expect(result.current.state).toMatchObject({
      phase: 'focus-paused',
      accumulatedFocusMs: 1_000,
    });
    act(() => result.current.resume());
    controlled.set(5_500);
    act(() => result.current.complete());
    expect(result.current.state).toMatchObject({
      phase: 'focus-completed',
      accumulatedFocusMs: 2_500,
    });
    expect(ticks).toEqual([10, 15]);
    act(() => result.current.reset());
    expect(result.current.state).toEqual(createIdleFocusState());
    expect(result.current.session).toBeNull();

    act(() => result.current.start(configuration));
    controlled.set(6_000);
    act(() => result.current.cancel());
    expect(result.current.state).toMatchObject({
      phase: 'focus-cancelled',
      accumulatedFocusMs: 500,
    });
    expect(() => {
      act(() => result.current.reset());
    }).not.toThrow();
    expect(result.current.state.phase).toBe('idle');
  });

  it('runs and skips an optional break without manufacturing simulation ticks', () => {
    const controlled = createClock();
    const ticks: number[] = [];
    const { result } = renderHook(() =>
      useFocusController({
        clock: controlled.clock,
        slotId: 'slot-a',
        createSessionId: () => 'session-break',
        onSimulationTicks: (count) => ticks.push(count),
      }),
    );

    act(() => result.current.start({ ...configuration, breakDurationMs: 2_000 }));
    controlled.set(5_000);
    act(() => result.current.checkpoint());
    expect(result.current.state.phase).toBe('break-running');
    expect(result.current.breakRemainingMs).toBe(2_000);
    controlled.set(5_500);
    act(() => result.current.skipBreak());
    expect(result.current.state).toMatchObject({ phase: 'finished', accumulatedBreakMs: 500 });
    expect(ticks).toEqual([50]);
  });

  it('accounts a sleep-sized recovery exactly once through visibility changes', () => {
    const controlled = createClock();
    const ticks: number[] = [];
    const { result } = renderHook(() =>
      useFocusController({
        clock: controlled.clock,
        slotId: null,
        createSessionId: () => 'session-sleep',
        onSimulationTicks: (count) => ticks.push(count),
      }),
    );
    act(() => result.current.start({ ...configuration, focusDurationMs: 60_000 }));

    controlled.set(86_400_000);
    void act(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(result.current.state).toMatchObject({ phase: 'finished', accumulatedFocusMs: 60_000 });
    expect(ticks).toEqual([600]);
  });

  it('strictly rehydrates an active persisted state and checks it forward on mount', () => {
    const controlled = createClock(2_000);
    const restoredState = checkpointFocus(
      startFocus(createIdleFocusState(), configuration, 0),
      1_000,
    );
    const restored = focusSessionFromState('restored', 'slot-a', restoredState, [1, 2]);
    const ticks: number[] = [];
    const { result } = renderHook(() =>
      useFocusController({
        clock: controlled.clock,
        initialSession: { ...restored, focusedMs: 0 },
        slotId: 'slot-a',
        onSimulationTicks: (count) => ticks.push(count),
      }),
    );

    expect(result.current.state).toEqual(restoredState);
    act(() => result.current.checkpoint());
    expect(result.current.state.accumulatedFocusMs).toBe(2_000);
    expect(ticks).toEqual([10]);
    expect(result.current.session?.focusedMs).toBe(2_000);
  });

  it('does not double-issue tick deltas when mounted in StrictMode', () => {
    const controlled = createClock();
    const ticks: number[] = [];
    const { result } = renderHook(
      () =>
        useFocusController({
          clock: controlled.clock,
          slotId: null,
          createSessionId: () => 'strict-session',
          onSimulationTicks: (count) => ticks.push(count),
        }),
      { wrapper: StrictMode },
    );

    act(() => result.current.start(configuration));
    controlled.set(1_000);
    void act(() => vi.advanceTimersByTime(1_000));

    expect(ticks).toEqual([10]);
    expect(result.current.state.totalIssuedSimulationTicks).toBe(10);
  });

  it('freezes automatic and manual elapsed-time transitions while simulation is suspended', () => {
    const controlled = createClock();
    const ticks: number[] = [];
    const { result, rerender } = renderHook(
      ({ suspended }) =>
        useFocusController({
          clock: controlled.clock,
          slotId: null,
          createSessionId: () => 'suspended-session',
          onSimulationTicks: (count) => ticks.push(count),
          suspended,
        }),
      { initialProps: { suspended: false } },
    );
    act(() => result.current.start(configuration));

    rerender({ suspended: true });
    controlled.set(4_000);
    void act(() => vi.advanceTimersByTime(4_000));
    void act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => result.current.complete());

    expect(result.current.state).toMatchObject({
      phase: 'focus-running',
      accumulatedFocusMs: 0,
      totalIssuedSimulationTicks: 0,
    });
    expect(ticks).toStrictEqual([]);
  });

  it('schedules no periodic work while idle or paused', () => {
    const controlled = createClock();
    const ticks: number[] = [];
    const { result } = renderHook(() =>
      useFocusController({
        clock: controlled.clock,
        slotId: null,
        createSessionId: () => 'idle-session',
        onSimulationTicks: (count) => ticks.push(count),
      }),
    );

    expect(vi.getTimerCount()).toBe(0);
    act(() => result.current.start({ ...configuration, focusDurationMs: 60_000 }));
    expect(vi.getTimerCount()).toBe(1);
    controlled.set(1_000);
    act(() => result.current.pause());
    expect(ticks).toEqual([10]);
    expect(vi.getTimerCount()).toBe(0);

    controlled.set(61_000);
    void act(() => vi.advanceTimersByTime(60_000));
    expect(ticks).toEqual([10]);
    expect(result.current.state).toMatchObject({
      accumulatedFocusMs: 1_000,
      phase: 'focus-paused',
    });
  });
});
