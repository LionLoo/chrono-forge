import fc from 'fast-check';
import {
  checkpointFocus,
  createIdleFocusState,
  pauseFocus,
  resumeFocus,
  startFocus,
} from '../../src/focus';

const configArbitrary = fc.record({
  focusDurationMs: fc.integer({ min: 1, max: 200_000 }),
  breakDurationMs: fc.integer({ min: 0, max: 50_000 }),
  simulationTicksPerFocusSecond: fc.integer({ min: 1, max: 100 }),
});

describe('focus timer properties', () => {
  it('preserves nonnegative bounded accounting through monotonic checkpoints and pause/resume', () => {
    fc.assert(
      fc.property(
        configArbitrary,
        fc.array(fc.integer({ min: 0, max: 50_000 }), { minLength: 1, maxLength: 20 }),
        (configuration, delays) => {
          let epochMs = 1_000;
          let state = startFocus(createIdleFocusState(), configuration, epochMs);
          for (const delay of delays) {
            epochMs += delay;
            state = checkpointFocus(state, epochMs);
            if (state.phase === 'focus-running' || state.phase === 'break-running') {
              state = pauseFocus(state, epochMs);
              state = resumeFocus(state, epochMs);
            }
          }

          expect(state.accumulatedFocusMs).toBeGreaterThanOrEqual(0);
          expect(state.accumulatedFocusMs).toBeLessThanOrEqual(configuration.focusDurationMs);
          expect(state.accumulatedBreakMs).toBeGreaterThanOrEqual(0);
          expect(state.accumulatedBreakMs).toBeLessThanOrEqual(configuration.breakDurationMs);
          expect(state.totalIssuedSimulationTicks).toBeGreaterThanOrEqual(0);
          expect(state.simulationTickRemainder).toBeGreaterThanOrEqual(0);
          expect(state.simulationTickRemainder).toBeLessThan(1_000);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('is partition-invariant for a running focus interval', () => {
    fc.assert(
      fc.property(
        configArbitrary,
        fc.array(fc.integer({ min: 0, max: 5_000 }), { minLength: 1, maxLength: 30 }),
        (configuration, partitions) => {
          const totalElapsedMs = partitions.reduce((sum, value) => sum + value, 0);
          const started = startFocus(createIdleFocusState(), configuration, 10_000);
          const oneCheckpoint = checkpointFocus(started, 10_000 + totalElapsedMs);

          let partitioned = started;
          let epochMs = 10_000;
          for (const elapsedMs of partitions) {
            epochMs += elapsedMs;
            partitioned = checkpointFocus(partitioned, epochMs);
          }

          expect(partitioned).toEqual(oneCheckpoint);
        },
      ),
      { numRuns: 500 },
    );
  });
});
