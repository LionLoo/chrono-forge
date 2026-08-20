import {
  FOCUS_STATE_VERSION,
  cancelFocus,
  checkpointFocus,
  completeFocus,
  createIdleFocusState,
  pauseFocus,
  rehydrateFocusState,
  resumeFocus,
  skipBreak,
  startFocus,
} from '../../src/focus';

const config = {
  focusDurationMs: 10_000,
  simulationTicksPerFocusSecond: 10,
} as const;

describe('explicit-time focus state machine', () => {
  it('starts only from idle and records a versioned running segment', () => {
    const state = startFocus(createIdleFocusState(), config, 1_000);

    expect(state).toMatchObject({
      version: FOCUS_STATE_VERSION,
      phase: 'focus-running',
      startedAtEpochMs: 1_000,
      activeSegmentStartedAtEpochMs: 1_000,
      accumulatedFocusMs: 0,
      totalIssuedSimulationTicks: 0,
    });
    expect(() => startFocus(state, config, 1_001)).toThrow('only start from idle');
  });

  it('accounts focus time, pauses without accruing time, and resumes in a new segment', () => {
    const started = startFocus(createIdleFocusState(), config, 1_000);
    const paused = pauseFocus(started, 2_234);
    const stillPaused = checkpointFocus(paused, 9_000);
    const resumed = resumeFocus(stillPaused, 9_500);
    const checkpointed = checkpointFocus(resumed, 10_000);

    expect(paused).toMatchObject({
      phase: 'focus-paused',
      accumulatedFocusMs: 1_234,
      totalIssuedSimulationTicks: 12,
      simulationTickRemainder: 340,
      activeSegmentStartedAtEpochMs: null,
    });
    expect(checkpointed).toMatchObject({
      phase: 'focus-running',
      accumulatedFocusMs: 1_734,
      totalIssuedSimulationTicks: 17,
      simulationTickRemainder: 340,
      activeSegmentStartedAtEpochMs: 9_500,
    });
  });

  it('completes at the planned focus target without issuing excess time', () => {
    const started = startFocus(createIdleFocusState(), config, 100);
    const completed = checkpointFocus(started, 999_999);

    expect(completed).toMatchObject({
      phase: 'finished',
      accumulatedFocusMs: 10_000,
      totalIssuedSimulationTicks: 100,
      simulationTickRemainder: 0,
      focusEndedAtEpochMs: 10_100,
      endedAtEpochMs: 10_100,
      outcome: 'completed',
    });
  });

  it('runs an optional break with no simulation ticks and ends it at its target', () => {
    const started = startFocus(createIdleFocusState(), { ...config, breakDurationMs: 2_000 }, 0);
    const breakRunning = checkpointFocus(started, 10_000);
    const finished = checkpointFocus(breakRunning, 12_000);

    expect(breakRunning).toMatchObject({
      phase: 'break-running',
      accumulatedFocusMs: 10_000,
      accumulatedBreakMs: 0,
      totalIssuedSimulationTicks: 100,
      breakStartedAtEpochMs: 10_000,
    });
    expect(finished).toMatchObject({
      phase: 'finished',
      accumulatedBreakMs: 2_000,
      totalIssuedSimulationTicks: 100,
      breakEndedAtEpochMs: 12_000,
      outcome: 'completed',
    });
  });

  it('manual completion checkpoints accepted time and starts an optional break', () => {
    const started = startFocus(createIdleFocusState(), { ...config, breakDurationMs: 500 }, 10);
    const completed = completeFocus(started, 1_510);

    expect(completed).toMatchObject({
      phase: 'break-running',
      accumulatedFocusMs: 1_500,
      totalIssuedSimulationTicks: 15,
      focusEndedAtEpochMs: 1_510,
      breakStartedAtEpochMs: 1_510,
    });
  });

  it('cancels after checkpointing accepted progress without rollback', () => {
    const started = startFocus(createIdleFocusState(), config, 0);
    const cancelled = cancelFocus(started, 2_550);

    expect(cancelled).toMatchObject({
      phase: 'focus-cancelled',
      accumulatedFocusMs: 2_550,
      totalIssuedSimulationTicks: 25,
      simulationTickRemainder: 500,
      focusEndedAtEpochMs: 2_550,
      endedAtEpochMs: 2_550,
      outcome: 'cancelled',
    });
  });

  it('allows a break to be skipped without crediting unspent break time', () => {
    const started = startFocus(createIdleFocusState(), { ...config, breakDurationMs: 2_000 }, 0);
    const breakRunning = checkpointFocus(started, 10_000);
    const skipped = skipBreak(breakRunning, 10_250);

    expect(skipped).toMatchObject({
      phase: 'finished',
      accumulatedBreakMs: 250,
      breakEndedAtEpochMs: 10_250,
      endedAtEpochMs: 10_250,
      totalIssuedSimulationTicks: 100,
    });
  });

  it('treats backwards wall-clock values as zero elapsed time', () => {
    const started = startFocus(createIdleFocusState(), config, 10_000);
    const advanced = checkpointFocus(started, 11_000);
    const rolledBack = checkpointFocus(advanced, 9_000);
    const continued = checkpointFocus(rolledBack, 11_250);

    expect(rolledBack.accumulatedFocusMs).toBe(1_000);
    expect(continued.accumulatedFocusMs).toBe(1_250);
  });

  it('normalizes a backwards resume timestamp to the last accepted observation', () => {
    const paused = pauseFocus(startFocus(createIdleFocusState(), config, 10_000), 11_000);
    const resumed = resumeFocus(paused, 9_000);

    expect(resumed.lastObservedEpochMs).toBe(11_000);
    expect(resumed.activeSegmentStartedAtEpochMs).toBe(11_000);
    expect(checkpointFocus(resumed, 11_250).accumulatedFocusMs).toBe(1_250);
  });

  it('handles a sleep-sized interval without overrun or unsafe tick accounting', () => {
    const started = startFocus(
      createIdleFocusState(),
      { focusDurationMs: 60_000, simulationTicksPerFocusSecond: 7 },
      1,
    );
    const recovered = checkpointFocus(started, 86_400_001);

    expect(recovered).toMatchObject({
      phase: 'finished',
      accumulatedFocusMs: 60_000,
      totalIssuedSimulationTicks: 420,
    });
  });

  it('round-trips strict JSON recovery and rejects malformed or inconsistent data', () => {
    const state = checkpointFocus(startFocus(createIdleFocusState(), config, 0), 1_234);
    const recovered = rehydrateFocusState(JSON.parse(JSON.stringify(state)));

    expect(recovered).toEqual(state);
    expect(() => rehydrateFocusState({ ...state, unexpected: true })).toThrow(TypeError);
    expect(() => rehydrateFocusState({ ...state, accumulatedFocusMs: -1 })).toThrow(RangeError);
    expect(() => rehydrateFocusState({ ...state, totalIssuedSimulationTicks: 0 })).toThrow(
      'accounting is inconsistent',
    );
    expect(() =>
      rehydrateFocusState({
        ...completeFocus(state, 1_500),
        focusEndedAtEpochMs: 500,
      }),
    ).toThrow('end timestamps must match');
  });

  it.each([
    [{ ...config, focusDurationMs: 0 }, 0],
    [{ ...config, breakDurationMs: -1 }, 0],
    [{ ...config, simulationTicksPerFocusSecond: 0 }, 0],
    [config, Number.MAX_SAFE_INTEGER + 1],
  ] as const)('rejects invalid configuration or explicit clock input', (configuration, epochMs) => {
    expect(() => startFocus(createIdleFocusState(), configuration, epochMs)).toThrow(RangeError);
  });
});
