import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';

import type { FocusSession } from '../../src/adapters/persistence';
import { checkpointFocus, createIdleFocusState, startFocus } from '../../src/focus';
import {
  MAX_FOCUS_ADVANCE_TICKS_PER_REQUEST,
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
        onSimulationTicks: (count) => {
          ticks.push(count);
        },
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
        onSimulationTicks: (count) => {
          ticks.push(count);
        },
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
        onSimulationTicks: (count) => {
          ticks.push(count);
        },
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
        onSimulationTicks: (count) => {
          ticks.push(count);
        },
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
        onSimulationTicks: (count) => {
          ticks.push(count);
        },
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
          onSimulationTicks: (count) => {
            ticks.push(count);
          },
        }),
      { wrapper: StrictMode },
    );

    act(() => result.current.start(configuration));
    controlled.set(1_000);
    void act(() => vi.advanceTimersByTime(1_000));

    expect(ticks).toEqual([10]);
    expect(result.current.state.totalIssuedSimulationTicks).toBe(10);
  });

  it('does not commit accepted focus time until the Worker accepts its tick command', () => {
    const controlled = createClock();
    const ticks: number[] = [];
    const sessions: FocusSession[] = [];
    let failDispatch = true;
    const { result } = renderHook(() =>
      useFocusController({
        clock: controlled.clock,
        slotId: 'slot-a',
        createSessionId: () => 'dispatch-session',
        onSimulationTicks: (count) => {
          if (failDispatch) throw new Error('Injected Worker tick dispatch failure');
          ticks.push(count);
        },
        onSessionState: (session) => sessions.push(session),
      }),
    );
    act(() => result.current.start(configuration));
    controlled.set(1_000);

    expect(() => act(() => result.current.checkpoint())).toThrow(
      'Injected Worker tick dispatch failure',
    );
    expect(result.current.state).toMatchObject({
      accumulatedFocusMs: 0,
      totalIssuedSimulationTicks: 0,
    });
    expect(sessions.at(-1)).toMatchObject({ focusedMs: 0, issuedSimulationTicks: 0 });

    failDispatch = false;
    act(() => result.current.checkpoint());
    expect(result.current.state).toMatchObject({
      accumulatedFocusMs: 1_000,
      totalIssuedSimulationTicks: 10,
    });
    expect(ticks).toEqual([10]);
    expect(sessions.at(-1)).toMatchObject({ focusedMs: 1_000, issuedSimulationTicks: 10 });
  });

  it('keeps the exact elapsed interval available while Worker advance backpressure is active', () => {
    const controlled = createClock();
    const ticks: number[] = [];
    let acceptsAdvance = false;
    const { result } = renderHook(() =>
      useFocusController({
        clock: controlled.clock,
        slotId: 'slot-a',
        createSessionId: () => 'backpressure-session',
        onSimulationTicks: (count) => {
          ticks.push(count);
          return acceptsAdvance;
        },
      }),
    );
    act(() => result.current.start(configuration));
    controlled.set(1_000);

    act(() => result.current.checkpoint());
    expect(result.current.state).toMatchObject({
      accumulatedFocusMs: 0,
      totalIssuedSimulationTicks: 0,
    });

    acceptsAdvance = true;
    act(() => result.current.checkpoint());
    expect(result.current.state).toMatchObject({
      accumulatedFocusMs: 1_000,
      totalIssuedSimulationTicks: 10,
    });
    expect(ticks).toEqual([10, 10]);
  });

  it('partitions a restored high-rate focus backlog into bounded Worker requests', () => {
    const controlled = createClock();
    const ticks: number[] = [];
    const { result } = renderHook(() =>
      useFocusController({
        clock: controlled.clock,
        slotId: 'slot-a',
        createSessionId: () => 'bounded-backlog-session',
        onSimulationTicks: (count) => {
          ticks.push(count);
        },
      }),
    );
    act(() =>
      result.current.start({
        focusDurationMs: 30_000_000,
        simulationTicksPerFocusSecond: 10_000,
      }),
    );
    controlled.set(101_000);

    act(() => result.current.checkpoint());
    expect(result.current.state).toMatchObject({
      accumulatedFocusMs: 1_000,
      phase: 'focus-running',
      totalIssuedSimulationTicks: MAX_FOCUS_ADVANCE_TICKS_PER_REQUEST,
    });
    expect(ticks).toEqual([MAX_FOCUS_ADVANCE_TICKS_PER_REQUEST]);

    act(() => {
      for (let index = 1; index < 101; index += 1) result.current.checkpoint();
    });
    expect(result.current.state).toMatchObject({
      accumulatedFocusMs: 101_000,
      phase: 'focus-running',
      totalIssuedSimulationTicks: 101 * MAX_FOCUS_ADVANCE_TICKS_PER_REQUEST,
    });
    expect(ticks).toHaveLength(101);
    expect(new Set(ticks)).toEqual(new Set([MAX_FOCUS_ADVANCE_TICKS_PER_REQUEST]));
  });

  it('drains an oversized completion request in bounded chunks at its original click time', () => {
    const controlled = createClock();
    const requests: { readonly priority: string; readonly ticks: number }[] = [];
    const { result } = renderHook(() =>
      useFocusController({
        clock: controlled.clock,
        slotId: 'slot-a',
        createSessionId: () => 'bounded-completion-session',
        onSimulationTicks: (ticks, priority) => {
          requests.push({ priority, ticks });
        },
      }),
    );
    act(() =>
      result.current.start({
        focusDurationMs: 30_000_000,
        simulationTicksPerFocusSecond: 10_000,
      }),
    );
    controlled.set(101_000);

    act(() => result.current.complete());
    expect(result.current.state).toMatchObject({
      accumulatedFocusMs: 1_000,
      phase: 'focus-running',
      totalIssuedSimulationTicks: MAX_FOCUS_ADVANCE_TICKS_PER_REQUEST,
    });

    // Catch-up may take several Worker responses. The manual completion boundary must remain
    // fixed at the original click rather than accepting the later wall-clock interval.
    controlled.set(500_000);
    act(() => {
      for (let index = 1; index < 101; index += 1) result.current.checkpoint();
    });
    expect(result.current.state).toMatchObject({
      accumulatedFocusMs: 101_000,
      endedAtEpochMs: 101_000,
      phase: 'focus-completed',
      totalIssuedSimulationTicks: 101 * MAX_FOCUS_ADVANCE_TICKS_PER_REQUEST,
    });
    expect(requests).toHaveLength(101);
    expect(new Set(requests.map((request) => request.ticks))).toEqual(
      new Set([MAX_FOCUS_ADVANCE_TICKS_PER_REQUEST]),
    );
    expect(new Set(requests.map((request) => request.priority))).toEqual(new Set(['terminal']));
  });

  it.each([
    { action: 'pause', expectedPhase: 'focus-paused' },
    { action: 'cancel', expectedPhase: 'focus-cancelled' },
  ] as const)(
    'drains an oversized $action request at its original click time',
    ({ action, expectedPhase }) => {
      const controlled = createClock();
      const requests: { readonly priority: string; readonly ticks: number }[] = [];
      const { result } = renderHook(() =>
        useFocusController({
          clock: controlled.clock,
          slotId: 'slot-a',
          createSessionId: () => `bounded-${action}-session`,
          onSimulationTicks: (ticks, priority) => {
            requests.push({ priority, ticks });
          },
        }),
      );
      act(() =>
        result.current.start({
          focusDurationMs: 30_000_000,
          simulationTicksPerFocusSecond: 10_000,
        }),
      );
      controlled.set(101_000);

      act(() => result.current[action]());
      controlled.set(500_000);
      act(() => {
        for (let index = 1; index < 101; index += 1) result.current.checkpoint();
      });

      expect(result.current.state).toMatchObject({
        accumulatedFocusMs: 101_000,
        endedAtEpochMs: action === 'cancel' ? 101_000 : null,
        lastObservedEpochMs: 101_000,
        phase: expectedPhase,
        totalIssuedSimulationTicks: 101 * MAX_FOCUS_ADVANCE_TICKS_PER_REQUEST,
      });
      expect(requests).toHaveLength(101);
      expect(new Set(requests.map((request) => request.priority))).toEqual(new Set(['terminal']));
    },
  );

  it('preserves the first terminal click while bounded catch-up is pending', () => {
    const controlled = createClock();
    const ticks: number[] = [];
    const { result } = renderHook(() =>
      useFocusController({
        clock: controlled.clock,
        slotId: 'slot-a',
        createSessionId: () => 'first-terminal-intent-session',
        onSimulationTicks: (count) => {
          ticks.push(count);
        },
      }),
    );
    act(() =>
      result.current.start({
        focusDurationMs: 30_000_000,
        simulationTicksPerFocusSecond: 10_000,
      }),
    );
    controlled.set(101_000);
    act(() => result.current.complete());

    controlled.set(102_000);
    act(() => result.current.cancel());
    act(() => {
      for (let index = 2; index < 101; index += 1) result.current.checkpoint();
    });

    expect(result.current.state).toMatchObject({
      accumulatedFocusMs: 101_000,
      endedAtEpochMs: 101_000,
      lastObservedEpochMs: 101_000,
      phase: 'focus-completed',
      totalIssuedSimulationTicks: 101 * MAX_FOCUS_ADVANCE_TICKS_PER_REQUEST,
    });
    expect(ticks).toHaveLength(101);
  });

  it('lets the first user action supersede a pending automatic checkpoint', () => {
    const controlled = createClock();
    const ticks: number[] = [];
    const { result } = renderHook(() =>
      useFocusController({
        clock: controlled.clock,
        slotId: 'slot-a',
        createSessionId: () => 'checkpoint-upgrade-session',
        onSimulationTicks: (count) => {
          ticks.push(count);
        },
      }),
    );
    act(() =>
      result.current.start({
        focusDurationMs: 30_000_000,
        simulationTicksPerFocusSecond: 10_000,
      }),
    );
    controlled.set(101_000);
    act(() => result.current.checkpoint());

    controlled.set(102_000);
    act(() => result.current.pause());
    act(() => {
      for (let index = 2; index < 102; index += 1) result.current.checkpoint();
    });

    expect(result.current.state).toMatchObject({
      accumulatedFocusMs: 102_000,
      lastObservedEpochMs: 102_000,
      phase: 'focus-paused',
      totalIssuedSimulationTicks: 102 * MAX_FOCUS_ADVANCE_TICKS_PER_REQUEST,
    });
    expect(ticks).toHaveLength(102);
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
          onSimulationTicks: (count) => {
            ticks.push(count);
          },
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
        onSimulationTicks: (count) => {
          ticks.push(count);
        },
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
